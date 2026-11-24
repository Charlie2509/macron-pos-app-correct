// Exercise the real React Router action with Shopify and Prisma disconnected.
// Vite's bundler lets Node import this .jsx route without starting the server.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const require = createRequire(import.meta.url);
const {build} = createRequire(require.resolve('vite/package.json'))('esbuild');
const fixturePlugin = {
  name:'offline-fulfilment-test',
  setup(b) {
    b.onResolve({filter:/^\.\.\/(db|shopify)\.server$/}, args=>({path:args.path,namespace:'fixture'}));
    b.onLoad({filter:/.*/,namespace:'fixture'}, args=>({contents:args.path.includes('shopify')
      ? 'export const authenticate={webhook:async req=>req};export const sessionStorage={};export const unauthenticated={};'
      : 'export default {pendingGiftCardActivation:{findFirst:(query)=>globalThis.mockGiftIntentLookup(query)}};'}));
  }
};
const bundle = await build({entryPoints:[fileURLToPath(new URL('../app/routes/webhooks.orders.create.jsx',import.meta.url))],
  bundle:true,write:false,format:'esm',platform:'node',plugins:[fixturePlugin]});
const {action} = await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));

function garment(id, title, mode, take, extra={}) {
  const properties=mode?{_msh_source:'macron_pos',_msh_fulfilment_mode:mode,_msh_take_now:take,
    _msh_intent_quantity:'1',_msh_intent_variant_id:'7',...extra}:extra;
  return {id:'gid://shopify/LineItem/'+id,title,name:title,quantity:1,currentQuantity:1,lineItemGroup:null,isGiftCard:false,requiresShipping:true,variant:{id:'gid://shopify/ProductVariant/7'},
    customAttributes:Object.entries(properties).map(([key,value])=>({key,value}))};
}
const kit={'Bundle':'Training kit','Item 1':'Tee — M','Bundle Component 1 Fulfilment':'Take now',
  'Item 2':'Short — M','Bundle Component 2 Fulfilment':'Order later',_msh_intent_is_bundle:'true'};
async function webhook(lines, options={}) {
  const lookup={id:'gid://shopify/Order/3',updatedAt:'2026-11-24T12:00:00Z',sourceName:'pos',displayFulfillmentStatus:'UNFULFILLED',
    displayFinancialStatus:options.status || 'PAID',retailLocation:{id:'gid://shopify/Location/9'},
    cancelledAt:null,edited:false,returnStatus:'NO_RETURN',refunds:[],
    lineItems:{nodes:lines,pageInfo:{hasNextPage:false}},customAttributes:options.attrs || [],
    fulfillmentOrders:{pageInfo:{hasNextPage:Boolean(options.extraRoutes)},nodes:[{id:'gid://shopify/FulfillmentOrder/33',status:'OPEN',
      assignedLocation:{location:{id:'gid://shopify/Location/9'}},deliveryMethod:{methodType:'RETAIL'},supportedActions:[{action:'CREATE_FULFILLMENT'}],
      lineItems:{pageInfo:{hasNextPage:Boolean(options.extraRouteLines)},nodes:lines.map((l,i)=>({id:'gid://shopify/FulfillmentOrderLineItem/'+(i+1),remainingQuantity:1,lineItem:l}))}}]}};
  const mutations=[], queries=[];
  const admin={graphql:async(q,{variables})=>{
    if(q.includes('mutation MacronFulfillmentCreate')) {
      mutations.push(variables.fulfillment);
      for(const group of variables.fulfillment.lineItemsByFulfillmentOrder) {
        for(const target of group.fulfillmentOrderLineItems)lookup.fulfillmentOrders.nodes[0].lineItems.nodes.find(l=>l.id===target.id).remainingQuantity=0;
      }
      return Response.json({data:{fulfillmentCreate:{userErrors:[],fulfillment:{id:'gid://shopify/Fulfillment/42',status:'SUCCESS'}}}});
    }
    if(q.includes('query MacronAdditionalHandoverLines')) {
      assert.equal(variables.after,'page-two');
      return Response.json({data:{order:{...lookup,updatedAt:options.stalePage?'changed':lookup.updatedAt,
        lineItems:{nodes:lines.slice(1),pageInfo:{hasNextPage:false}}}}});
    }
    assert(q.includes('query MacronOrderForFulfillment'));queries.push(q);
    if(options.paged) return Response.json({data:{order:{...lookup,
      lineItems:{nodes:lines.slice(0,1),pageInfo:{hasNextPage:true,endCursor:'page-two'}}}}});
    return Response.json({data:{order:lookup}});
  }};
  const payload={id:3,source_name:'pos',line_items:lines.map(l=>({id:l.id.split('/').pop(),title:l.title,
    properties:l.customAttributes.map(({key,value})=>({name:key,value}))}))};
  const response=await action({request:{admin,payload,shop:'test.myshopify.com',topic:options.topic || 'ORDERS_CREATE'}});
  assert.equal(response.status,options.expectedStatus || 200);assert(queries.length>0);
  return mutations.flatMap(m=>m.lineItemsByFulfillmentOrder.flatMap(g=>g.fulfillmentOrderLineItems.map(x=>x.id.split('/').pop())));
}
test('flat kit with one owed component and a similarly named loose garment never fulfils either',async()=>{
  assert.deepEqual(await webhook([garment(1,'Training kit','split','true',kit),garment(2,'Tee — M','order_in','false')]),[]);
  assert.deepEqual(await webhook([garment(1,'Training kit','split','true',kit),garment(2,'Tee — M','take_today','true')]),['2']);
});
test('legacy whole-kit handover still works; Render skips a native-pilot garment in the same order',async()=>{
  assert.deepEqual(await webhook([garment(1,'Training kit','take_today','true',{...kit,'Bundle Component 2 Fulfilment':'Take now','Bundle Take Now Summary':'- Tee — M\n- Short — M'}),
    garment(2,'Tee — M','take_today','true',{_msh_handover_owner:'flow_v1'})]),['1']);
});
test('ordinary legacy split marked Order in stays open beside a verified taken garment',async()=>{
  assert.deepEqual(await webhook([garment(1,'Tee — M','split','false'),garment(2,'Tee — M','split','true')]),['2']);
});

test('split parent whose every component is explicitly taken can close even with default split header false',async()=>{
  assert.deepEqual(await webhook([garment(1,'Kit','split','false',{...kit,'Bundle Component 2 Fulfilment':'take_now'})]),['1']);
  const incomplete={...kit};delete incomplete['Bundle Component 2 Fulfilment'];
  assert.deepEqual(await webhook([garment(1,'Kit','split','true',incomplete)]),[]);
});
test('unpaid creation waits for payment and sticky cart owner never falls back to a missing plain owner',async()=>{
  const shirt=garment(1,'Shirt','take_today','true');
  assert.deepEqual(await webhook([shirt],{status:'PENDING'}),[]);
  assert.deepEqual(await webhook([shirt],{topic:'ORDERS_PAID'}),['1']);
  assert.deepEqual(await webhook([shirt],{attrs:[{key:'_msh_handover_pilot_seen',value:'flow_v1'}]}),[]);
  const personalised=garment(2,'Shirt','take_today','true',{'Personalisation Summary':'Included'});
  assert.deepEqual(await webhook([shirt,personalised],{attrs:[{key:'_msh_handover_pilot_seen',value:'flow_v1'}]}),['2']);
});

test('gift-card intent is checked only when the order is created, including a later paid event',async t=>{
  const lookup=t.mock.fn(async()=>null);
  globalThis.mockGiftIntentLookup=lookup;
  t.after(()=>{delete globalThis.mockGiftIntentLookup;});
  const gift=garment(1,'Gift Card','take_today','true',{_msh_gc_sale:'true',_msh_gc_intent_id:'gift-fixture'});
  gift.isGiftCard=true;
  assert.deepEqual(await webhook([gift],{status:'PENDING'}),[]);
  assert.equal(lookup.mock.callCount(),1);
  assert.equal(lookup.mock.calls[0].arguments[0].where.id,'gift-fixture');
  assert.deepEqual(await webhook([gift],{topic:'ORDERS_PAID'}),[]);
  assert.equal(lookup.mock.callCount(),1);
});

test('only full numbered component pairs can close the exact paid kit parent',async()=>{
  const take={...kit,'Bundle Component 1 Fulfilment':'take_now','Bundle Component 2 Fulfilment':'take_now',_msh_bundle_component_count:'2',
    'Bundle Take Now Summary':'1. Taken today · Tee — M\n2. Taken today · Short — M'};
  const full=garment(1,'Training kit','take_today','true',take);
  const partial=garment(2,'Training kit','take_today','true',kit);
  assert.deepEqual(await webhook([full,partial]),['1']);
  const trimmed={...take};delete trimmed['Item 2'];delete trimmed['Bundle Component 2 Fulfilment'];
  assert.deepEqual(await webhook([garment(1,'Kit','take_today','true',trimmed)]),[]);
  const duplicate=garment(1,'Kit','take_today','true',take);
  duplicate.customAttributes.push({key:'Bundle Component 2 Fulfilment',value:'order_later'});
  assert.deepEqual(await webhook([duplicate]),[]);
  full.quantity=2;full.currentQuantity=2;
  assert.deepEqual(await webhook([full]),[]);
  full.quantity=1;full.currentQuantity=1;
  full.lineItemGroup={id:'gid://shopify/LineItemGroup/1'};
  assert.deepEqual(await webhook([full]),[]);
});

test('reads every sold line for gifts and handover but leaves truncated native routes for review',async t=>{
  const lookup=t.mock.fn(async()=>null);
  globalThis.mockGiftIntentLookup=lookup;
  t.after(()=>{delete globalThis.mockGiftIntentLookup;});
  const taken=garment(1,'Sweater','take_today','true');
  const gift=garment(2,'Gift card','take_today','true',{_msh_gc_sale:'true',_msh_gc_intent_id:'overflow-gift'});
  gift.isGiftCard=true;
  assert.deepEqual(await webhook([taken,gift],{paged:true,extraRoutes:true}),[]);
  assert.equal(lookup.mock.callCount(),1);
  assert.equal(lookup.mock.calls[0].arguments[0].where.id,'overflow-gift');
  assert.deepEqual(await webhook([taken,gift],{paged:true,extraRouteLines:true}),[]);
  assert.deepEqual(await webhook([taken,gift],{paged:true}),['1']);
  assert.equal(lookup.mock.callCount(),3);
  assert.deepEqual(await webhook([taken,gift],{paged:true,stalePage:true,expectedStatus:503}),[]);
  assert.equal(lookup.mock.callCount(),3);
});
