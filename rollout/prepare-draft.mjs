import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {cliFailure} from '../flow/msh-handover/setup.mjs';
import {store} from '../flow/msh-handover/workflows.mjs';

const appId = 'd8042c43f44b53d95f006ebc6b3221cf';
const appName = 'Macron POS';
const root = fileURLToPath(new URL('../', import.meta.url));
const config = 'shopify.app.toml';
const noGlob = /[()[\]{}*?!|]/;

function checkApp(text) {
  const header = text.split(/^\s*\[/m, 1)[0];
  if (!/^client_id\s*=\s*"d8042c43f44b53d95f006ebc6b3221cf"\s*$/m.test(header) ||
      !/^name\s*=\s*"Macron POS"\s*$/m.test(header)) {
    throw new Error('This setup needs the original Macron POS app. Check the account in Shopify.');
  }
}

export function checkPackage(directory) {
  const text = readFileSync(join(directory, config), 'utf8');
  checkApp(text);
  if (!/^application_url\s*=\s*"https:\/\/shopify\.dev\/apps\/default-app-home"\s*$/m.test(text) ||
      !/^redirect_urls\s*=\s*\[\s*\]\s*$/m.test(text) || /onrender\.com|webhooks\.subscriptions|write_gift_cards/i.test(text) ||
      store !== 'y5y3p1-hw.myshopify.com') throw new Error('Extract the complete Shopify-only MSH download and try again.');
  const extension = readFileSync(join(directory,'extensions','macron-pos','shopify.extension.toml'),'utf8');
  const sales = extension.split(/^\s*\[\[extensions\]\]\s*$/m).find(section => /^handle\s*=\s*"macron-pos"\s*$/m.test(section));
  if (!sales || !/^uid\s*=\s*"c759fc65-75f0-de50-374a-af70ce8e81123c4fac84"\s*$/m.test(sales) ||
      !/target\s*=\s*"admin\.order-details\.block\.render"/.test(extension) || /macron-pos-gift-cards/.test(extension)) {
    throw new Error('Check that the ZIP contains the MSH sales tile and kit handover block.');
  }
  if (!existsSync(join(directory,'package-lock.json'))) throw new Error('Extract the complete ZIP before opening Setup-Windows.cmd.');
}

function versionLabel(directory) {
  const hash = createHash('sha256');
  function visit(relative) {
    const absolute = join(directory, relative);
    const entries = readdirSync(absolute, {withFileTypes:true}).sort((a,b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    for (const entry of entries) {
      if (entry.name.startsWith('.') || ['node_modules','dist','build','manifest.json','shopify.d.ts'].includes(entry.name)) continue;
      const path = relative + '/' + entry.name;
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) add(path);
    }
  }
  function add(path) {
    hash.update(path + '\0').update(readFileSync(join(directory, path))).update('\0');
  }
  for (const path of [config, 'package.json', 'package-lock.json', 'flow/msh-handover/plan.mjs']) add(path);
  if (existsSync(join(directory,'app/kit-collections.js'))) add('app/kit-collections.js');
  visit('extensions');
  return 'msh-shopify-' + hash.digest('hex').slice(0, 14);
}

function command(entry, args, cwd, interactive) {
  // CLI account credentials can be reused; a previous project's ambient flags
  // (app, config, path, release mode) must not change this launcher's target.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('SHOPIFY_FLAG_')));
  const result = spawnSync(process.execPath,[entry,...args],{cwd, env:{...env, INIT_CWD:cwd}, encoding:'utf8',
    stdio:interactive?'inherit':['ignore','pipe','pipe'], maxBuffer:12*1024*1024});
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(interactive ? 'Shopify stopped. Check the message above.' : cliFailure(result));
  return result.stdout;
}

export function prepareApp(directory, cli) {
  checkPackage(directory);
  const tempParent = noGlob.test(tmpdir()) ? directory : tmpdir();
  if (noGlob.test(tempParent)) throw new Error('Extract the ZIP into a simple path such as C:\\MSH\\Till and reopen setup.');
  const scratch = mkdtempSync(join(tempParent,'.msh-app-draft-'));
  const version = versionLabel(directory);
  try {
    // The CLI uses absolute paths as globs. A junction handles names like
    // "Downloads/MSH Till (2)" on Windows without moving the user's folder.
    let project = directory;
    if (noGlob.test(project)) {
      project = join(scratch,'project');
      symlinkSync(directory,project,process.platform === 'win32' ? 'junction' : 'dir');
    }
    const verify = join(scratch,'link');
    mkdirSync(verify);
    copyFileSync(join(directory, config),join(verify, config));
    command(cli,['app','config','link','--client-id',appId,'--file-name','msh-verified','--path',verify],verify,true);
    checkApp(readFileSync(join(verify,'shopify.app.msh-verified.toml'),'utf8'));
    const versions = () => {
      const rows = JSON.parse(command(cli,['app','versions','list','--config',config,'--path',project,'--json'],project,false));
      if (!Array.isArray(rows)) throw new Error('Shopify did not return an app version list.');
      return rows.find(row => row.versionTag === version);
    };
    const previous = versions();
    if (previous) {
      console.log('This version already exists: ' + version + ' (' + previous.status + ').');
      return version;
    }
    console.log('Uploading unreleased ' + appName + ' version ' + version + '.');
    command(cli,['app','deploy','--config',config,'--path',project,'--no-release','--version',version],project,true);
    const saved = versions();
    if (!saved) throw new Error('Shopify has not confirmed this version. Check the Dev Dashboard before rerunning setup.');
    console.log('Verified version ' + version + ' in Shopify (' + saved.status + ').');
    return version;
  } finally {
    rmSync(scratch,{recursive:true,force:true});
  }
}

function main() {
  checkPackage(root);
  if (process.argv.includes('--check-package')) return;
  const cliDirectory = join(root,'node_modules','@shopify','cli');
  const cli = join(cliDirectory,'bin','run.js');
  if (JSON.parse(readFileSync(join(cliDirectory,'package.json'),'utf8')).version !== '5.0.1') {
    throw new Error('Open Setup-Windows.cmd to install the packaged Shopify CLI version.');
  }
  console.log('Preparing drafts for ' + appName + ' and ' + store + '. Sign in through Shopify on this PC when prompted.');
  prepareApp(root,cli);
  console.log('Next, check the two MSH workflows and save missing drafts.');
  command(join(root,'flow','msh-handover','setup.mjs'),['--draft-only'],root,true);
  console.log('Review the app version in the Dev Dashboard and the two workflows in MSH Shopify Flow. Follow START-HERE.md for release.');
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
