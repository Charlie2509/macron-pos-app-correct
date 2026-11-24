import test from 'node:test';
import assert from 'node:assert/strict';
import main, {hasHandoverOwner, planLegacyReconciliation} from './plan.mjs';
import {MSH_PILOT_SHOP, isNativeHandoverProduct, isNativeHandoverBundle} from '../../extensions/macron-pos/src/flow-pilot.js';

import {buildBundleComponents} from '../../extensions/macron-pos/src/bundle-components.js';

const gid = (type, id) => 'gid://shopify/' + type + '/' + id;
function shirt(id, mode, now, owner = true) {
  const attrs = {
    _msh_source:'macron_pos', _msh_fallback_source:'macron_pos', _msh_intent_source:'macron_pos',
    _msh_fulfilment_mode:mode, _msh_fulfillment_mode:mode, _msh_intent_fulfilment_mode:mode,
    _msh_intent_fulfillment_mode:mode, _msh_fallback_fulfilment_mode:mode, _msh_fallback_fulfillment_mode:mode,
    _msh_take_now:now, _msh_intent_take_now:now, _msh_fallback_take_now:now,
    _msh_intent_quantity:'1', _msh_intent_variant_id:'7', _msh_intent_is_bundle:'false', _msh_intent_has_fee:'false'
  };
  if (owner) attrs._msh_handover_owner='flow_v1';
  return {id:gid('LineItem',id),title:'Match shirt',sku:'MSHKIT',isGiftCard:false,requiresShipping:true,
    quantity:1,currentQuantity:1,unfulfilledQuantity:1,lineItemGroup:null,variant:{id:gid('ProductVariant',7)},
    customAttributes:Object.entries(attrs).map(([key,value])=>({key,value}))};
}

function basket(lines=[shirt(1,'split','true'),shirt(2,'split','false')]) {
  const loc={id:gid('Location',1)};
  return {id:gid('Order',1),sourceName:'pos',displayFinancialStatus:'PAID',retailLocation:loc,cancelledAt:null,
    edited:false,returnStatus:'NO_RETURN',refunds:[],subtotalLineItemsQuantity:lines.reduce((n,l)=>n+l.quantity,0),
    lineItems:lines,fulfillmentOrders:[{id:gid('FulfillmentOrder',1),status:'OPEN',supportedActions:[{action:'CREATE_FULFILLMENT'}],
      assignedLocation:{location:loc},deliveryMethod:{methodType:'RETAIL'},
      lineItems:lines.map((l,i)=>({id:gid('FulfillmentOrderLineItem',i+1),lineItem:{id:l.id},remainingQuantity:l.unfulfilledQuantity}))}]};
}
const page = nodes => ({nodes, pageInfo:{hasNextPage:false}});
const admin = order => ({...order,lineItems:page(order.lineItems),fulfillmentOrders:page(order.fulfillmentOrders.map(r=>({...r,lineItems:page(r.lineItems)})))});
function targets(result) {
  if (!result.ready) {assert.equal(result.mutationInput,'');return [];}
  const args=JSON.parse(result.mutationInput).fulfillment;
  assert.equal(args.notifyCustomer,false);
  return args.lineItemsByFulfillmentOrder.flatMap(g=>g.fulfillmentOrderLineItems.map(x=>[x.id.split('/').pop(),x.quantity]));
}
test('paid and routing events select only the take unit, even for identical variants and a repeated event',()=>{
  const o=basket();
  assert.deepEqual(targets(main({order:o})),[['1',1]]);
  assert.deepEqual(targets(main({fulfillmentOrder:{order:o}})),[['1',1]]);
  o.lineItems[0].unfulfilledQuantity=0; o.fulfillmentOrders[0].lineItems[0].remainingQuantity=0;
  assert.deepEqual(targets(main({order:o})),[]);assert.equal(o.lineItems[1].unfulfilledQuantity,1);
});
test('the two engines select disjoint line IDs in mixed baskets. Native, fee, gift and bundle lines stay open in recovery',()=>{
  const plain=shirt(7,'take_today','true'); plain.customAttributes=[];
  const fee=shirt(3,'take_today','true',false); fee.customAttributes.push({key:'Fee For Product',value:'shirt'});
  const gift=shirt(4,'take_today','true',false); gift.isGiftCard=true;
  const bundle=shirt(5,'take_today','true',false);bundle.customAttributes.push({key:'Item 1',value:'Shirt'});
  const o=basket([shirt(1,'take_today','true'),shirt(2,'order_in','false'),fee,gift,bundle,shirt(6,'take_today','true',false),plain]);
  assert.deepEqual(targets(main({order:o})),[['1',1]]);
  assert.deepEqual(targets(planLegacyReconciliation(admin(o))),[]);
  o.lineItems[5].customAttributes.push({key:'Personalisation Summary',value:'Initials applied'});
  assert.deepEqual(targets(planLegacyReconciliation(admin(o))),[['6',1]]);
  o.lineItems[5].customAttributes.find(a=>a.key==='_msh_take_now').value='false';
  assert.deepEqual(targets(planLegacyReconciliation(admin(o))),[]);
});
test('older explicit take and owe orders are exclusively Render; newer invalid owners remain reserved',()=>{
  const old=basket([shirt(1,'split','false',false),shirt(2,'take_today','true',false)]);
  assert.deepEqual(targets(main({order:old})),[]);
  assert.deepEqual(targets(planLegacyReconciliation(admin(old))),[['2',1]]);
  const o=basket();
  o.lineItems[0].customAttributes.find(a=>a.key==='_msh_handover_owner').value='unknown';
  assert.deepEqual(targets(main({order:o})),[]);
  assert.deepEqual(targets(planLegacyReconciliation(admin(o))),[]);
  assert.equal(hasHandoverOwner([{name:'_msh_handover_owner',value:'unknown'}]),true);
});
test('honours full payment and exact location, route, ownership, quantities and unedited order',()=>{
  const mutations=[
    o=>o.displayFinancialStatus='PENDING', o=>o.displayFinancialStatus='AUTHORIZED',o=>o.cancelledAt='yesterday',
    o=>o.edited=true,o=>o.refunds=[{id:'r'}],o=>o.returnStatus='IN_PROGRESS',o=>o.sourceName='web',
    o=>o.fulfillmentOrders=[],o=>o.fulfillmentOrders[0].status='ON_HOLD',o=>o.fulfillmentOrders[0].deliveryMethod.methodType='SHIPPING',
    o=>o.fulfillmentOrders[0].supportedActions=[],o=>o.fulfillmentOrders[0].assignedLocation.location={id:gid('Location',8)},
    o=>o.lineItems[0].currentQuantity=2,o=>o.fulfillmentOrders[0].lineItems.pop(),o=>o.lineItems.pop(),o=>o.subtotalLineItemsQuantity=3,
    o=>o.lineItems[0].customAttributes[0].value='other',o=>o.lineItems[0].customAttributes.push(o.lineItems[0].customAttributes[0]),
    o=>o.lineItems[0].lineItemGroup={id:'legacy'},o=>o.lineItems[0].requiresShipping=false,o=>o.lineItems[0].isGiftCard=true,
    o=>o.lineItems[0].variant.id=gid('ProductVariant',11),o=>o.lineItems[0].sku='PERSOFEE',
    o=>o.lineItems[0].customAttributes.find(a=>a.key==='_msh_intent_take_now').value='false',
    o=>o.fulfillmentOrders[0].lineItems.push(o.fulfillmentOrders[0].lineItems[0])];
  for(const mutate of mutations){const o=basket();mutate(o);assert.deepEqual(targets(main({order:o})),[],String(mutate));}
  const snapshot=admin(basket());snapshot.fulfillmentOrders.nodes[0].lineItems.pageInfo.hasNextPage=true;
  assert.deepEqual(targets(planLegacyReconciliation(snapshot)),[]);
});
test('pilot scope excludes gift cards, digital, bundle and personalisation products',()=>{
  const product={title:'Shirt',isGiftCard:false,bundleMeta:{isBundle:false},personalisationMeta:{}};
  const variant={sku:'shirt',requiresShipping:true};
  const props={_msh_source:'macron_pos',_msh_fulfilment_mode:'take_today',_msh_take_now:'true'};
  const eligible=(shop=MSH_PILOT_SHOP,p=product,v=variant,b=false,f=false,m=props)=>isNativeHandoverProduct(shop,p,v,b,f,m);
  assert.equal(eligible(),true);
  assert.equal(eligible('unknown'),false);assert.equal(eligible(undefined,{...product,isGiftCard:true}),false);
  assert.equal(eligible(undefined,product,{...variant,requiresShipping:false}),false);
  assert.equal(eligible(undefined,{...product,personalisationMeta:{enablePersonalisation:true}}),false);
  assert.equal(eligible(undefined,product,variant,true),false);assert.equal(eligible(undefined,product,variant,false,true),false);
  assert.equal(eligible(undefined,product,variant,false,false,{...props,Initials:'GG'}),false);
});
test('simultaneous sales from two tills with the same SKU never cross order or fulfilment IDs',async()=>{
  const orders=Array.from({length:200},(_,i)=>{
    const order=basket([shirt(2*i+1,'split','true'),shirt(2*i+2,'split','false')]);
    order.id=gid('Order',i+1);order.fulfillmentOrders[0].id=gid('FulfillmentOrder',i+1);
    order.fulfillmentOrders[0].lineItems.forEach((row,j)=>row.id=gid('FulfillmentOrderLineItem',2*i+j+1));
    return order;
  });
  await Promise.all(orders.map(async(order,i)=>{
    const p=main({order});const routed=main({fulfillmentOrder:{order}});
    assert.deepEqual(targets(p),[[String(2*i+1),1]]);assert.deepEqual(p,routed);
    assert.equal(JSON.parse(p.mutationInput).fulfillment.lineItemsByFulfillmentOrder[0].fulfillmentOrderId,
      order.fulfillmentOrders[0].id);
  }));
});

test('recovery respects cart-level reservation even if all pilot line stamps were stripped',()=>{
  const l=shirt(1,'take_today','true',false);
  const o=basket([l]);o.customAttributes=[{key:'_msh_handover_pilot_seen',value:'flow_v1'}];
  assert.deepEqual(targets(planLegacyReconciliation(admin(o))),[]);
  l.customAttributes.push({key:'Personalisation Summary',value:'captured'});
  assert.deepEqual(targets(planLegacyReconciliation(admin(o))),[['1',1]]);
});
test('recovery fulfils an all-taken flat split kit; mixed kit and incomplete kit stay open',()=>{
  const l=shirt(1,'split','false',false);
  l.customAttributes.find(a=>a.key==='_msh_intent_is_bundle').value='true';
  l.customAttributes.push({key:'Bundle',value:'Training kit'},{key:'Item 1',value:'Tee'},{key:'Item 2',value:'Socks'},
    {key:'Bundle Component 1 Fulfilment',value:'Take now'},{key:'Bundle Component 2 Fulfilment',value:'Take now'});
  const o=basket([l]);assert.deepEqual(targets(planLegacyReconciliation(admin(o))),[['1',1]]);
  l.customAttributes.at(-1).value='Order later';
  assert.deepEqual(targets(planLegacyReconciliation(admin(o))),[]);
  l.customAttributes.pop();assert.deepEqual(targets(planLegacyReconciliation(admin(o))),[]);
});

const kitTitle = 'Matchday kit';
const parentProduct = {title:kitTitle, isGiftCard:false, bundleMeta:{isBundle:true}};
const parentVariant = {requiresShipping:true, sku:'MATCH-KIT'};
const parts = [
  {key:'1', title:'Match shorts', variants:[{id:'S',title:'Youth / S'}]},
  {key:'2', title:'Match shorts', variants:[{id:'L',title:'Adult / L'}]},
];
const selectedParts = Object.fromEntries(parts.map(item => [item.key, item.variants[0]]));
function recordedKit(id, choices, mode='split', fee=false) {
  const line = shirt(id, mode, mode==='take_today' ? 'true' : 'false');
  line.title = kitTitle;
  const attrs = Object.fromEntries(line.customAttributes.map(a => [a.key, a.value]));
  Object.assign(attrs, buildBundleComponents(kitTitle,parts,selectedParts,{'1':choices[0],'2':choices[1]},mode),
    {_msh_intent_is_bundle:'true',_msh_intent_has_fee:String(fee),_msh_intent_product_title:kitTitle});
  if (fee) Object.assign(attrs, {Initials:'JS','Personalisation Fee':'5.00'});
  line.customAttributes = Object.entries(attrs).map(([key,value])=>({key,value}));
  return line;
}
const writeAttrs = line => Object.fromEntries(line.customAttributes.map(a=>[a.key,a.value]));
const setAttr = (line, key, value) => {
  const field = line.customAttributes.find(a => a.key === key);
  if (field) field.value = value;
  else line.customAttributes.push({key,value});
};
function checkBothEvents(order, expected) {
  assert.deepEqual(targets(main({order})),expected);
  assert.deepEqual(targets(main({fulfillmentOrder:{order}})),expected);
}

test('paid and routed events target the exact fully taken kit, leaving its fee and same-variant mixed and owed kits open', () => {
  const take = recordedKit(11,['take_now','take_now'],'split',true);
  const mixed = recordedKit(12,['take_now','order_later'],'split',true);
  const owe = recordedKit(13,['order_later','order_later'],'order_in');
  const oweSplit = recordedKit(14,['order_later','order_later'],'split');
  const fee = shirt(15,'take_today','true',false);
  fee.title = 'Personalisation fee (system)';
  setAttr(fee,'Fee For Product',kitTitle);
  const order = basket([take,mixed,owe,oweSplit,fee]);
  for (const line of [take,mixed,owe,oweSplit]) {
    assert.equal(isNativeHandoverBundle(MSH_PILOT_SHOP,parentProduct,parentVariant,writeAttrs(line)),true);
  }
  assert.equal(isNativeHandoverBundle(MSH_PILOT_SHOP,{...parentProduct,title:fee.title},parentVariant,writeAttrs(fee)),false);
  checkBothEvents(order,[['1',1]]);
  assert.deepEqual(targets(planLegacyReconciliation(admin(order))),[]);
  order.lineItems[0].unfulfilledQuantity = 0;
  checkBothEvents(order,[]);
  order.fulfillmentOrders[0].lineItems[0].remainingQuantity = 0;
  checkBothEvents(order,[]);
  assert.equal(mixed.unfulfilledQuantity,1);
  assert.equal(owe.unfulfilledQuantity,1);
});

test('invalid kit reservation halts the entire native plan, including unrelated, otherwise valid take lines', () => {
  const changes = [
    kit=>setAttr(kit,'_msh_bundle_component_count','1'),
    kit=>kit.customAttributes=kit.customAttributes.filter(a=>a.key!=='_msh_bundle_component_count'),
    kit=>kit.customAttributes=kit.customAttributes.filter(a=>!['Item 2','Bundle Component 2 Fulfilment'].includes(a.key)),
    kit=>setAttr(kit,'Item 2','no size'),
    kit=>setAttr(kit,'Item 2',''),
    kit=>setAttr(kit,'Bundle Component 1 Fulfilment','other'),
    kit=>kit.customAttributes.push({key:'Bundle Component 1 Fulfillment',value:'take_now'}),
    kit=>setAttr(kit,'Bundle Component 0 Fulfilment','take_now'),
    kit=>setAttr(kit,'Item 01','wrong slot'),
    kit=>setAttr(kit,'Bundle Take Now Summary','2. Taken today · Match shorts — Adult / L'),
    kit=>setAttr(kit,'Bundle Order Later Summary','Unexpected owed piece'),
    kit=>setAttr(kit,'_msh_intent_product_title','Other kit'),
    kit=>setAttr(kit,'_msh_intent_is_bundle','false'),
    kit=>setAttr(kit,'_msh_intent_has_fee','unknown'),
    kit=>setAttr(kit,'Fee For Product','Some product'),
    kit=>{ kit.quantity = kit.currentQuantity = kit.unfulfilledQuantity = 2; setAttr(kit,'_msh_intent_quantity','2'); },
    kit=>{ kit.title = 'Personalisation fee (system)'; },
    kit=>{ kit.lineItemGroup = {id:gid('LineItemGroup',1)}; },
    kit=>{ kit.requiresShipping=false; },
  ];
  for (const change of changes) {
    const kit = recordedKit(1,['take_now','take_now'],'take_today');
    change(kit);
    checkBothEvents(basket([shirt(9,'take_today','true'),kit]),[]);
  }
  const kit = recordedKit(1,['order_later','order_later'],'order_in');
  for (const a of kit.customAttributes) {
    if (a.value==='order_in') a.value='take_today';
    if (a.key.includes('take_now')) a.value='true';
  }
  checkBothEvents(basket([shirt(9,'take_today','true'),kit]),[]);
});

test('new kits must have positive parent merchandise and per-slot evidence to be reserved at the till', () => {
  const kit = recordedKit(1,['take_now','order_later']);
  const attrs = writeAttrs(kit);
  const eligible = (p=parentProduct,v=parentVariant,m=attrs,shop=MSH_PILOT_SHOP) => isNativeHandoverBundle(shop,p,v,m);
  assert.equal(eligible(),true);
  assert.equal(eligible(undefined,undefined,undefined,'elsewhere'),false);
  assert.equal(eligible({...parentProduct,bundleMeta:{isBundle:false}}),false);
  assert.equal(eligible({...parentProduct,isGiftCard:true}),false);
  assert.equal(eligible({...parentProduct,title:'Gift card'}),false);
  assert.equal(eligible(undefined,{...parentVariant,requiresShipping:false}),false);
  assert.equal(eligible(undefined,{...parentVariant,sku:'PERSOFEE'}),false);
  assert.equal(eligible(undefined,undefined,{...attrs,'Fee For Product':'a kit'}),false);
  assert.equal(eligible(undefined,undefined,{...attrs,'_MSH_PersoFee':'true'}),false);
  assert.equal(eligible(undefined,undefined,{...attrs,Bundle:'A different item'}),false);
  assert.equal(eligible(undefined,undefined,{...attrs,'_msh_bundle_component_count':'7'}),false);
});

test('a new kit that lost its owner stays open in a pilot cart, while a legacy kit in an older order still recovers', () => {
  const stripped = recordedKit(1,['take_now','take_now'],'take_today',true);
  stripped.customAttributes = stripped.customAttributes.filter(a=>a.key!=='_msh_handover_owner');
  const order = basket([stripped]);
  order.customAttributes = [{key:'_msh_handover_pilot_seen',value:'flow_v1'}];
  checkBothEvents(order,[]);
  assert.deepEqual(targets(planLegacyReconciliation(admin(order))),[]);
  stripped.customAttributes = stripped.customAttributes.filter(a=>a.key!=='_msh_bundle_component_count');
  assert.deepEqual(targets(planLegacyReconciliation(admin(order))),[]);
  order.customAttributes=[];
  setAttr(stripped,'Bundle Take Now Summary','- Match shorts — Youth / S\n- Match shorts — Adult / L');
  assert.deepEqual(targets(planLegacyReconciliation(admin(order))),[['1',1]]);
});
