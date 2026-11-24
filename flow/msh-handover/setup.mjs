import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname, delimiter, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { store, workflows, queries, discoverTasks, buildWorkflow, listWorkflows, matchingWorkflows, selectWorkflow, verifyWorkflow, verifyRuntime } from './workflows.mjs';

const directory = dirname(fileURLToPath(import.meta.url));
const version = '5.0.1';
const flowAdmin = 'https://admin.shopify.com/store/y5y3p1-hw/apps/flow';

function cliPath() {
  const candidates = [join(directory,'node_modules','@shopify','cli'),join(directory,'..','node_modules','@shopify','cli'),
    ...(process.env.PATH ?? '').split(delimiter).map(bin => join(bin,'..','@shopify','cli'))];
  for (const candidate of candidates) {
    try {
      if (JSON.parse(readFileSync(join(candidate,'package.json'),'utf8')).version === version) return join(candidate,'bin','run.js');
    } catch { /* This PATH entry does not contain the pinned Shopify CLI. */ }
  }
  return null;
}

export function cliFailure(output) {
  for (const stream of [output.stdout,output.stderr]) {
    if (!stream?.trim()) continue;
    try {
      const { error,errors } = JSON.parse(stream);
      if (error?.message) return [error.message,...(Array.isArray(error.nextSteps) ? error.nextSteps.filter(v=>typeof v === 'string') : [])].join('\n');
      if (Array.isArray(errors) && errors.length) return errors.map(e=>e.message).join('\n');
    } catch { /* Some CLI failures are plain text. */ }
  }
  return (output.stdout || output.stderr || 'Shopify sign-in or request stopped.').trim();
}

function execute(cli, args, interactive = false) {
  const cmd = spawnSync(process.execPath, [cli,...args], { cwd:directory, encoding:'utf8', stdio:interactive?'inherit':['ignore','pipe','pipe'], maxBuffer:12*1024*1024 });
  if (cmd.error) throw cmd.error;
  if (cmd.status !== 0) throw new Error(cliFailure(cmd));
  return cmd.stdout;
}

export function makeApi(cli, scratch) {
  return async function api(operation, variables, apiVersion = 'unstable') {
    const gqlFile = join(scratch,'operation.graphql'), varFile = join(scratch,'variables.json');
    await writeFile(gqlFile, operation);
    await writeFile(varFile, JSON.stringify(variables));
    const args = ['store','execute','--store',store,'--version',apiVersion,'--query-file',gqlFile,'--variable-file',varFile,'--json','--no-input'];
    if (operation.trim().startsWith('mutation ')) args.push('--allow-mutations');
    const result = JSON.parse(execute(cli,args));
    if (result.errors?.length) throw new Error(result.errors.map(e=>e.message).join('\n'));
    if (!result.data) throw new Error('Shopify returned no data.');
    return result.data;
  };
}

function mutationWorkflow(response, operation) {
  const payload = response?.[operation];
  if (!payload || !Array.isArray(payload.userErrors)) throw new Error('Shopify returned an incomplete response for ' + operation + '.');
  if (payload.userErrors.length) throw new Error(payload.userErrors.map(e=>[e.code,e.message].filter(Boolean).join(' / ')).join('\n'));
  return payload.automationWorkflow;
}

async function readCurrent(api, def, expectedId) {
  const match = selectWorkflow(await listWorkflows(api), def);
  if (!match || (expectedId && expectedId !== match.id)) throw new Error(def.name + ' could not be uniquely identified on the store.');
  const data = await api(queries.read, { id: match.id });
  return verifyWorkflow(data.automationWorkflow,def);
}

export async function install({ api, confirm, log, source }) {
  const existing = await listWorkflows(api);
  const expectedIds = new Map();
  log('Workflow status on ' + store + ':');
  for (const def of workflows) {
    const matches = matchingWorkflows(existing,def);
    const [match] = matches;
    let state = 'Missing';
    if (matches.length > 1) state = 'Multiple matching workflows; review in Flow';
    else if (match) {
      expectedIds.set(def.key,match.id);
      state = match.activeVersion === match.version ? 'Active' : match.activeVersion ? 'Active with a newer draft' : 'Inactive / draft';
      if (match.name !== def.name || !match.tags.includes(def.tag)) state += ' (review existing workflow in Flow)';
    }
    log('  ' + state + ' | ' + def.name);
  }
  const tasks = await discoverTasks(api);
  const definitions = workflows.map(def=>({ ...def, configuration:buildWorkflow(def.key,tasks,source) }));
  const missing = definitions.filter(def=>matchingWorkflows(existing,def).length === 0);
  if (missing.length) {
    log('Shopify will save these inactive drafts on ' + store + ':\n' + missing.map(d=>'  ' + d.name).join('\n'));
    if (!await confirm('Save the drafts?')) return 'No drafts created.';
    for (const def of missing) {
      // A second PC may have installed the workflow since the initial check.
      if (matchingWorkflows(await listWorkflows(api),def).length) continue;
      const response = await api(queries.create,{ name:def.name, tags:[def.tag], configuration:def.configuration, note:'MSH POS. Fulfill only outstanding Take today quantities for eligible paid sales.' });
      const saved = mutationWorkflow(response,'automationWorkflowCreate');
      if (!saved?.id || saved.name !== def.name || !saved.tags?.includes(def.tag) || saved.activeVersion !== null) {
        throw new Error('Shopify did not confirm the inactive draft for ' + def.name + '. Check Flow before running setup again.');
      }
      expectedIds.set(def.key,saved.id);
      log('Saved inactive draft: ' + def.name);
    }
  }
  const ready = [];
  const checkedVersions = new Set();
  for (const def of definitions) {
    const actual = await readCurrent(api,def,expectedIds.get(def.key));
    if (!/^\d{4}-(01|04|07|10)$/.test(actual.adminApiVersion)) throw new Error('Shopify did not report a supported workflow API version for ' + def.name + '.');
    if (!checkedVersions.has(actual.adminApiVersion)) {
      verifyRuntime(await api(queries.runtimeSchema,{},actual.adminApiVersion));
      checkedVersions.add(actual.adminApiVersion);
    }
    ready.push({ def,actual });
    if (actual.activeVersion === actual.version) log('Already active: ' + def.name);
  }
  const inactive = ready.filter(({actual})=>actual.activeVersion !== actual.version);
  if (!inactive.length) return 'Both workflows are active and match this installer.';
  log('Ready for activation on ' + store + ':\n' + inactive.map(r=>'  ' + r.def.name).join('\n') +
      '\nFuture eligible paid MSH POS sales will mark Take today quantities as fulfilled in Shopify. Order in stays outstanding.');
  if (!await confirm('Turn on the listed workflows?')) return 'Drafts are available for review in Shopify Flow.';
  for (const { def,actual } of inactive) {
    const current = await readCurrent(api,def,actual.id);
    if (current.activeVersion === current.version) continue;
    if (current.version !== actual.version) throw new Error('Another user changed ' + def.name + '. Reopen setup before activation.');
    const response = await api(queries.activate,{ id:actual.id, version:actual.version });
    const saved = verifyWorkflow(mutationWorkflow(response,'automationWorkflowActivate'),def);
    if (saved.activeVersion !== actual.version) throw new Error('Shopify did not confirm activation of ' + def.name + '.');
    log('Active: ' + def.name);
  }
  for (const {def,actual} of ready) {
    const current = await readCurrent(api,def,actual.id);
    if (current.activeVersion !== actual.version) throw new Error('Could not verify the active version of ' + def.name + '.');
  }
  return 'Verified: both workflows are active. Test one new paid split sale.';
}

export function isAccessError(message) {
  return /access.denied|forbidden|unauthori[sz]ed|write_automations|access.scope|authenticat|store auth|missing.*token|expired|not logged in|credentials/i.test(message);
}

export async function ensureAccess(api, authenticate) {
  try { await listWorkflows(api); }
  catch (error) {
    if (!isAccessError(error.message)) throw error;
    await authenticate();
    await listWorkflows(api);
  }
}

async function main() {
  const cli = cliPath();
  if (process.argv.includes('--check-cli')) { process.exitCode = cli ? 0 : 1; return; }
  if (!cli) throw new Error('Open setup.cmd to load Shopify CLI ' + version + '.');
  console.log('Macron Sports Hub Hastings POS | Automatic till handover\nStore: ' + store + '\nOpen this installer once on one shop PC.');
  const scratch = await mkdtemp(join(tmpdir(),'msh-flow-'));
  let rl;
  try {
    const api = makeApi(cli,scratch);
    await ensureAccess(api, async () => {
      console.log('Use Shopify\'s own sign-in on this PC to allow Flow workflow setup.');
      execute(cli,['store','auth','--store',store,'--scopes','write_automations'],true);
    });
    const [input,output,script] = await Promise.all(['input.graphql','output.graphql','plan.mjs'].map(f=>readFile(join(directory,f),'utf8')));
    rl = createInterface({ input:process.stdin, output:process.stdout });
    const result = await install({ api,source:{input,output,script}, log:console.log,
      confirm: async question => /^y(?:es)?$/i.test((await rl.question(question + ' [y/N] ')).trim()) });
    console.log(result + '\n' + flowAdmin);
  } finally { rl?.close(); await rm(scratch,{ recursive:true,force:true }); }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error=>{
    console.error('\nSetup stopped. ' + error.message + '\nCheck the workflow status in Shopify Flow: ' + flowAdmin +
      '\nIf Shopify has not approved workflow API access, open README.md in this folder. It uses the same two workflows.' +
      '\nIf your connection dropped, rerun setup. It checks saved drafts and active versions before making changes.');
    process.exitCode = 1;
  });
}
