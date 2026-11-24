import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { workflows, queries, buildWorkflow, listWorkflows, routedInput, verifyWorkflow, verifyRuntime, store, discoverTasks } from '../workflows.mjs';
import { cliFailure, ensureAccess, install, isAccessError } from '../setup.mjs';

const source = Object.fromEntries(await Promise.all([['input','input.graphql'],['output','output.graphql'],['script','plan.mjs']]
  .map(async ([k,f])=>[k,await readFile(new URL('../' + f,import.meta.url),'utf8')])));
const fields = ids=>ids.map(id=>({ id,required:true }));
const makeTask = (taskType,taskId,label,configFields=[],outputPortIds=['output'])=>({
  id:'gid://shopify/AutomationTask/'+taskId, taskId,taskType,label, state:'MAIN',version:'test.2',
  connector:{installed:true},configFields,outputPortIds,returnFields:[],
});
const tasks = {
  paid:makeTask('TRIGGER','shopify::admin::order_paid','Order paid'),
  routed:makeTask('TRIGGER','shopify::admin::ready','Fulfillment order ready to fulfill'),
  plan:makeTask('ACTION','shopify::flow::run_code','Run code',fields(['input','script','output_schema'])),
  check:makeTask('CONDITION','shopify::flow::condition','Condition',fields(['condition']),['true','false']),
  fulfill:makeTask('ACTION','shopify::admin::admin_api_operation','Send Admin API request',fields(['api_call']),[]),
  wait:makeTask('WAIT','shopify::flow::wait','Wait',[{ id:'wait_duration',required:true,__typename:'AutomationDurationConfigField',possibleUnits:['SECONDS','MINUTES'] }]),
};
const schemaFields = names => names.map(name => ({name}));
const runtime = { mutation:{fields:[{name:'fulfillmentCreate',args:schemaFields(['fulfillment','message'])}]},
  payload:{inputFields:schemaFields(['lineItemsByFulfillmentOrder','notifyCustomer'])}, group:{inputFields:schemaFields(['fulfillmentOrderId','fulfillmentOrderLineItems'])},
  line:{inputFields:schemaFields(['id','quantity'])} };
const page = nodes=>({nodes,pageInfo:{hasNextPage:false,endCursor:null}});

function storeStub() {
  const saved = new Map(), calls = [];
  async function api(op,v,version) {
    calls.push({op,v,version});
    if(op===queries.tasks) return {automationTasks:page(Object.values(tasks).filter(t=>t.taskType===v.type))};
    if(op===queries.task) return {automationTask:Object.values(tasks).find(t=>t.id===v.id)};
    if(op===queries.list) return {shop:{myshopifyDomain:store},automationWorkflows:page([...saved.values()])};
    if(op===queries.read) return {automationWorkflow:saved.get(v.id)};
    if(op===queries.runtimeSchema) { assert.equal(version,'2026-10'); return runtime; }
    if(op===queries.create) {
      const id = String(saved.size+1), workflow = { id, name:v.name, configuration:v.configuration,tags:v.tags,version:'1',activeVersion:null,adminApiVersion:'2026-10',validationErrors:[] };
      saved.set(id,workflow);
      return { automationWorkflowCreate:{automationWorkflow:workflow,userErrors:[]} };
    }
    if(op===queries.activate) {
      const workflow=saved.get(v.id);
      workflow.activeVersion=v.version;
      return { automationWorkflowActivate:{automationWorkflow:workflow,userErrors:[]} };
    }
    throw new Error('Unexpected API operation');
  }
  return { saved,calls,api };
}
const run=(api,confirm=async()=>true)=>install({api,confirm,source,log:()=>{}});

test('actual input in both trigger environments, raw mutation string, native wait',async()=>{
  const editorInput = await readFile(new URL('../input-routed.graphql',import.meta.url),'utf8');
  assert.equal(editorInput.trim(),routedInput(source.input));
  assert.match(routedInput(source.input),/fulfillmentOrder\s*\{\s*order\s*\{/);
  assert.equal(routedInput('query ' +source.input),routedInput(source.input));
  for(const def of workflows) {
    const conf=buildWorkflow(def.key,tasks,source).root;
    const step=id=>conf.steps.find(s=>s.step_id===id), val=(id,field)=>step(id).config_field_values.find(f=>f.config_field_id===field).value;
    assert.equal(val('plan','script'),source.script);
    assert.equal(val('plan','output_schema'),source.output);
    assert.equal(val('plan','input'),def.key==='paid'?source.input:routedInput(source.input));
    assert.equal(val('check','condition'),'(runCode.ready == true)');
    assert.deepEqual(JSON.parse(val('fulfill','api_call')),{name:'fulfillmentCreate',blob:'{{ runCode.mutationInput }}'});
    assert.deepEqual(conf.links.filter(l=>l.to_step_id==='fulfill'),[{from_step_id:'check',from_port_id:'true',to_step_id:'fulfill',to_port_id:'input'}]);
    if(def.key==='paid') assert.deepEqual(JSON.parse(val('wait_for_routing','wait_duration')),{amount:10,unit:'seconds'});
    else assert(!step('wait_for_routing'));
  }
});

test('create, validate, activate, reread, then reuse two active workflows',async()=>{
  const s=storeStub(), questions=[];
  assert.match(await run(s.api,async q=>{questions.push(q);return true;}),/both workflows are active/i);
  assert.equal(questions.length,2);
  const first=s.calls.length;
  assert.match(await run(s.api,async()=>{throw Error('unexpected question');}),/both workflows are active/i);
  assert.equal(s.saved.size,2);
  assert(!s.calls.slice(first).some(c=>c.op.startsWith('mutation')));
});

test('valid inactive drafts resume; declining creation makes zero store writes',async()=>{
  const s=storeStub();
  assert.match(await run(s.api,async()=>false),/No drafts/);
  assert.equal(s.saved.size,0);
  await run(s.api,async q=>q.startsWith('Save'));
  assert.equal(s.saved.size,2); assert([...s.saved.values()].every(w=>!w.activeVersion));
  await run(s.api);
  assert([...s.saved.values()].every(w=>w.activeVersion==='1'));
});

test('reports an active paid workflow and creates just its missing partner',async()=>{
  const s = storeStub();
  await run(s.api);
  s.saved.delete('2');
  const paid = s.saved.get('1');
  paid.configuration.root.steps.find(step=>step.step_id==='wait_for_routing').config_field_values[0].value =
    JSON.stringify({unit:'seconds',amount:10});
  const originalPaid = structuredClone(paid);
  s.calls.length = 0;
  const messages = [];
  await install({api:s.api,confirm:async()=>true,source,log:m=>messages.push(m)});
  assert(messages.includes('  Active | '+workflows[0].name));
  assert(messages.includes('  Missing | '+workflows[1].name));
  assert.deepEqual(s.calls.filter(c=>c.op===queries.create).map(c=>c.v.name),[workflows[1].name]);
  assert.deepEqual(s.calls.filter(c=>c.op===queries.activate).map(c=>c.v.id),['2']);
  assert.deepEqual(s.saved.get('1'),originalPaid);
});

test('active payment Wait is configurable; malformed durations, other edits and changed drafts require review', async()=>{
  const s=storeStub();
  await run(s.api);
  const paid=s.saved.get('1');
  const def={...workflows[0],configuration:buildWorkflow('paid',tasks,source)};
  const wait=paid.configuration.root.steps.find(step=>step.step_id==='wait_for_routing').config_field_values[0];
  for (const valid of [{amount:0,unit:'seconds'},{amount:'10',unit:'seconds'},{amount:2.5,unit:'minutes'}]) {
    wait.value=JSON.stringify(valid);
    assert.equal(verifyWorkflow(paid,def),paid);
  }
  for (const invalid of ['broken','null','[]','{}',...[
    {amount:91,unit:'days'},{amount:-1,unit:'seconds'},{amount:'',unit:'seconds'},
    {amount:true,unit:'seconds'},{amount:10,unit:['seconds']},{amount:10,unit:'unknown'},
    {amount:10,unit:'seconds',extra:true},
  ].map(value=>JSON.stringify(value))]) {
    wait.value=invalid;
    assert.throws(()=>verifyWorkflow(paid,def),/saved steps differ/);
  }
  wait.value=JSON.stringify({amount:30,unit:'seconds'});
  assert.throws(()=>verifyWorkflow({...paid,activeVersion:null},def),/saved steps differ/);
  paid.configuration.root.steps.find(step=>step.step_id==='check').config_field_values[0].value='true';
  assert.throws(()=>verifyWorkflow(paid,def),/saved steps differ/);
});

test('saves the missing routing draft when the first workflow needs manual review; no activation occurs',async()=>{
  for (const problem of ['manual','schema','changed']) {
    const s = storeStub();
    await run(s.api,async q=>q.startsWith('Save'));
    s.saved.delete('2');
    const first = s.saved.get('1');
    if (problem === 'manual') first.tags=[];
    if (problem === 'schema') first.adminApiVersion=null;
    if (problem === 'changed') first.validationErrors=[{message:'Unknown field in input query',stepId:'plan'}];
    const snapshot = structuredClone(first);
    s.calls.length = 0;
    const messages = [];
    await assert.rejects(install({api:s.api,confirm:async q=>q.startsWith('Save'),source,log:m=>messages.push(m)}),
      problem==='manual'?/manually created/:problem==='schema'?/supported workflow API version/:/Unknown field in input query/);
    assert(messages.some(m=>m.includes('Inactive / draft') && m.includes(first.name)));
    assert(messages.includes('  Missing | '+workflows[1].name));
    assert.deepEqual(s.calls.filter(c=>c.op===queries.create).map(c=>c.v.name),[workflows[1].name]);
    assert.deepEqual(s.saved.get('1'), snapshot);
    assert.equal(s.saved.get('2').activeVersion,null);
    assert(!s.calls.some(c=>c.op===queries.activate));
  }
});

test('validation error, mutation user error and unconfirmed activation cannot pass',async()=>{
  for (const failure of ['validate','create','activate']) {
    const s=storeStub();
    await assert.rejects(run(async(op,v,version)=>{
      const result=await s.api(op,v,version);
      if(op===queries.create && failure==='validate') result.automationWorkflowCreate.automationWorkflow.validationErrors.push({message:'bad planner field',stepId:'plan'});
      if(op===queries.create && failure==='create') result.automationWorkflowCreate.userErrors.push({code:'DENIED',message:'no access'});
      if(op===queries.activate && failure==='activate') result.automationWorkflowActivate.automationWorkflow.activeVersion=null;
      return result;
    }), failure==='validate'?/bad planner field/:failure==='create'?/DENIED/:/did not confirm/);
    if(failure!=='activate') assert(!s.calls.some(c=>c.op===queries.activate));
  }
});

test('duplicate, manually created, renamed and edited workflows cannot be overwritten',async()=>{
  for(const mode of ['duplicate','renamed','manual','edited']) {
    const s=storeStub(); await run(s.api,async q=>q.startsWith('Save'));
    const first = s.saved.get('1');
    if(mode==='duplicate') s.saved.set('3',{...first,id:'3'});
    if(mode==='renamed') first.name='Staff renamed this';
    if(mode==='manual') first.tags=[];
    if(mode==='edited') first.configuration.root.links=[];
    await assert.rejects(run(s.api),/check for a duplicate|saved steps differ/);
    assert(!s.calls.some(c=>c.op===queries.activate));
  }
});

test('Shopify task changes, incomplete status and a wrong store fail closed',async()=>{
  const s=storeStub();
  const modified={...tasks,check:{...tasks.check,outputPortIds:['false']}};
  assert.throws(()=>buildWorkflow('paid',modified,source),/missing the true output/);
  await assert.rejects(discoverTasks(async(op,v)=>{
    const r=await s.api(op,v);
    if(op===queries.tasks) r.automationTasks.nodes=r.automationTasks.nodes.map(t=>t===tasks.routed?{...t,state:'DRAFT'}:t);
    return r;
  }),/one installed MAIN/);
  assert.throws(()=>verifyWorkflow({id:'1',version:'1'},{name:'test'}),/incomplete/);
  assert.throws(()=>verifyRuntime({...runtime,line:null}),/line-specific/);
  await assert.rejects(listWorkflows(async()=>({shop:{myshopifyDomain:'other.myshopify.com'}})),/signed-in store/);
});

test('reuse an authorised PC; reauthorise once for missing/expired access; network errors leave credentials alone', async()=>{
  const s=storeStub();
  await ensureAccess(s.api,()=>assert.fail('existing session'));
  let calls=0,auth=0;
  await ensureAccess(async(op,v)=>{if(!calls++)throw Error('Run shopify store auth first');return s.api(op,v);},async()=>{auth++;});
  assert.equal(auth,1);
  await assert.rejects(ensureAccess(async()=>{throw Error('ACCESS_DENIED write_automations');},async()=>{auth++;}),/ACCESS_DENIED/);
  assert.equal(auth,2);
  await assert.rejects(ensureAccess(async()=>{throw Error('connection lost');},()=>assert.fail('no auth on network failure')),/connection lost/);
  assert(isAccessError('stored authentication expired'));
});

test('CLI 5 structured errors take priority over progress messages on stderr',()=>{
  const error = {type:'abort',message:'No stored app authentication found for this store.',nextSteps:['Run shopify store auth.']};
  const message = cliFailure({stdout:JSON.stringify({error}),stderr:JSON.stringify({message:'Loading stored store auth'})});
  assert.equal(message,error.message+'\n'+error.nextSteps[0]);
  assert(isAccessError(message));
  assert.equal(cliFailure({stdout:'',stderr:'Connection lost'}),'Connection lost');
});
