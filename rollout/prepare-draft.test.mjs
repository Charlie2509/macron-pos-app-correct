import test from 'node:test';
import assert from 'node:assert/strict';
import {cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {checkPackage, prepareApp} from './prepare-draft.mjs';

const repo = fileURLToPath(new URL('../',import.meta.url));
const appId = 'd8042c43f44b53d95f006ebc6b3221cf';

function fixture(t, remoteId = appId) {
  const temporary = mkdtempSync(join(tmpdir(),'msh-test-'));
  t.after(() => rmSync(temporary,{recursive:true,force:true}));
  const folder = join(temporary,'MSH POS (2) [downloads]');
  for (const path of ['shopify.app.toml','extensions/macron-pos/shopify.extension.toml','flow/msh-handover/plan.mjs','package.json','package-lock.json']) {
    const target = join(folder,path);
    mkdirSync(dirname(target),{recursive:true});
    cpSync(join(repo,path),target);
  }
  const calls = join(temporary,'calls.jsonl');
  const saved = join(temporary,'versions.json');
  const fake = join(temporary,'cli.cjs');
  writeFileSync(saved,'[]');
  writeFileSync(fake,`
    const fs = require('node:fs'), path = require('node:path');
    const args = process.argv.slice(2), dir = args[args.indexOf('--path') + 1];
    fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify({args,dir, cwd:process.cwd(), project:fs.realpathSync(dir), env:process.env.SHOPIFY_FLAG_ALLOW_DELETES}) + '\\n');
    if (/[()\\[\\]]/.test(dir)) process.exit(101);
    if (args[1] === 'config') {
      if (args[args.indexOf('--client-id')+1] !== '${appId}' || fs.existsSync(path.join(dir,'extensions'))) process.exit(102);
      fs.writeFileSync(path.join(dir,'shopify.app.msh-verified.toml'),'client_id = "${remoteId}"\\nname = "Macron POS"\\n');
    } else if (args[1] === 'versions') {
      process.stdout.write(fs.readFileSync(${JSON.stringify(saved)}));
    } else if (args[1] === 'deploy') {
      if (!args.includes('--no-release') || !args.includes('--version')) process.exit(103);
      const versionTag = args[args.indexOf('--version') + 1];
      fs.writeFileSync(${JSON.stringify(saved)},JSON.stringify([{versionTag,status:'unreleased'}]));
    } else process.exit(104);
  `);
  return {folder,fake,calls:()=>existsSync(calls)?readFileSync(calls,'utf8').trim().split('\n').map(line=>JSON.parse(line)):[]};
}

test('the actual CLI invocation preserves the installed MSH identity, safe paths and draft-only state across retries', t => {
  const f=fixture(t);
  const original=process.env.SHOPIFY_FLAG_ALLOW_DELETES;
  process.env.SHOPIFY_FLAG_ALLOW_DELETES='true';
  t.after(()=>{ if(original===undefined)delete process.env.SHOPIFY_FLAG_ALLOW_DELETES; else process.env.SHOPIFY_FLAG_ALLOW_DELETES=original; });
  const tag=prepareApp(f.folder,f.fake);
  assert.equal(prepareApp(f.folder,f.fake),tag);
  const calls=f.calls();
  assert.deepEqual(calls.map(c=>c.args[1]),['config','versions','deploy','versions','config','versions']);
  const [deploy]=calls.filter(c=>c.args[1]==='deploy');
  assert.equal(deploy.project,f.folder);
  assert.equal(deploy.args[deploy.args.indexOf('--config')+1],'shopify.app.toml');
  assert.ok(calls.every(call=>!call.env && !call.args.includes('--allow-deletes') && !call.args.includes('--allow-updates')));
  assert(!calls.some(c=>c.args[1]==='release'));
  assert(existsSync(join(f.folder,'shopify.app.toml')));
  writeFileSync(join(f.folder,'extensions/macron-pos/new.js'),'// changed extension');
  assert.notEqual(prepareApp(f.folder,f.fake),tag);
});

test('wrong linked app and legacy configurations cannot upload to Shopify', t => {
  const f=fixture(t,'f'.repeat(32));
  assert.throws(()=>prepareApp(f.folder,f.fake), /original Macron POS/);
  assert.deepEqual(f.calls().map(call=>call.args[1]),['config']);
  const cfg=join(f.folder,'shopify.app.toml');
  const original=readFileSync(cfg,'utf8');
  for(const invalid of [original.replace(appId,'0'.repeat(32)), original.replace('Macron POS','Superstitch 86 POS'),
    original.replace('https://shopify.dev/apps/default-app-home','https://example.onrender.com'), original+'\n[[webhooks.subscriptions]]\n']) {
    writeFileSync(cfg,invalid);
    assert.throws(()=>checkPackage(f.folder));
  }
  assert.equal(f.calls().length,1);
});
