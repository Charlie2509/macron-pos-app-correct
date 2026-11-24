import test from 'node:test';
import assert from 'node:assert/strict';
import main, {resolveServiceFee, NATIVE_HANDOVER_OWNER} from './plan.mjs';
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
test('native flow leaves unmarked manual merchandise, legacy fees, gifts and old kits alone',()=>{
  const plain=shirt(7,'take_today','true'); plain.customAttributes=[];
  const fee=shirt(3,'take_today','true',false); fee.customAttributes.push({key:'Fee For Product',value:'shirt'});
  const gift=shirt(4,'take_today','true',false); gift.isGiftCard=true;
  const bundle=shirt(5,'take_today','true',false);bundle.customAttributes.push({key:'Item 1',value:'Shirt'});
  const o=basket([shirt(1,'take_today','true'),shirt(2,'order_in','false'),fee,gift,bundle,shirt(6,'take_today','true',false),plain]);
  assert.deepEqual(targets(main({order:o})),[['1',1]]);
  o.lineItems[5].customAttributes.push({key:'Personalisation Summary',value:'Initials applied'});
  o.lineItems[5].customAttributes.find(a=>a.key==='_msh_take_now').value='false';
  checkBothEvents(o,[['1',1]]);
});
test('unmarked historical take and owe records stay untouched and an unrecognised owner blocks action',()=>{
  const old=basket([shirt(1,'split','false',false),shirt(2,'take_today','true',false)]);
  assert.deepEqual(targets(main({order:old})),[]);
  const o=basket();
  o.lineItems[0].customAttributes.find(a=>a.key==='_msh_handover_owner').value='unknown';
  assert.deepEqual(targets(main({order:o})),[]);
});
test('honours full payment and exact location, route, ownership, quantities and unedited order',()=>{
  const mutations=[
    o=>o.displayFinancialStatus='PENDING', o=>o.displayFinancialStatus='AUTHORIZED',o=>o.cancelledAt='yesterday',
    o=>o.edited=true,o=>o.refunds=[{id:'r'}],o=>o.returnStatus='IN_PROGRESS',o=>o.sourceName='web',
    o=>o.fulfillmentOrders=[],o=>o.fulfillmentOrders[0].status='ON_HOLD',o=>o.fulfillmentOrders[0].deliveryMethod.methodType='SHIPPING',
    o=>o.fulfillmentOrders[0].supportedActions=[],o=>o.fulfillmentOrders[0].assignedLocation.location={id:gid('Location',8)},
    o=>o.lineItems[0].currentQuantity=2,o=>o.lineItems[0].customAttributes={},o=>o.fulfillmentOrders[0].lineItems.pop(),
    o=>o.lineItems.pop(),o=>o.subtotalLineItemsQuantity=3,
    o=>o.lineItems[0].customAttributes[0].value='other',o=>o.lineItems[0].customAttributes.push(o.lineItems[0].customAttributes[0]),
    o=>o.lineItems[0].lineItemGroup={id:'legacy'},o=>o.lineItems[0].requiresShipping=false,o=>o.lineItems[0].isGiftCard=true,
    o=>o.lineItems[0].variant.id=gid('ProductVariant',11),o=>o.lineItems[0].sku='PERSOFEE',
    o=>o.lineItems[0].customAttributes.find(a=>a.key==='_msh_intent_take_now').value='false',
    o=>o.fulfillmentOrders[0].lineItems.push(o.fulfillmentOrders[0].lineItems[0])];
  for(const mutate of mutations){const o=basket();mutate(o);assert.deepEqual(targets(main({order:o})),[],String(mutate));}
});
test('the native till accepts physical personalised merchandise and rejects ambiguous system fields',()=>{
  const product={title:'Shirt',isGiftCard:false,bundleMeta:{isBundle:false},personalisationMeta:{}};
  const variant={sku:'shirt',requiresShipping:true};
  const props={_msh_source:'macron_pos',_msh_fulfilment_mode:'take_today',_msh_take_now:'true'};
  const eligible=(shop=MSH_PILOT_SHOP,p=product,v=variant,b=false,f=false,m=props)=>isNativeHandoverProduct(shop,p,v,b,f,m);
  assert.equal(eligible(),true);
  assert.equal(eligible('unknown'),false);assert.equal(eligible(undefined,{...product,isGiftCard:true}),false);
  assert.equal(eligible(undefined,product,{...variant,requiresShipping:false}),false);
  assert.equal(eligible(undefined,{...product,personalisationMeta:{enablePersonalisation:true}}),true);
  assert.equal(eligible(undefined,product,variant,true),false);assert.equal(eligible(undefined,product,variant,false,true),false);
  assert.equal(eligible(undefined,product,variant,false,false,{...props,Initials:'GG'}),true);
  assert.equal(eligible(undefined,product,variant,false,true,{...props,Initials:'GG','Personalisation Fee':'£2.50'}),true);
  for (const extra of [{_msh_gc_sale:'true'},{'Linked Fee Variant Id':'1'},{'Item 1':'Tee'},{'Fee For Product':'A'}, {Bundle:'X'},
    {'Personalisation Fee':'£2.50'},{_msh_fulfilment_mode:'take_today',_msh_take_now:'false'}]) {
    assert.equal(eligible(undefined,product,variant,false,false,{...props,...extra}),false);
  }
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

test('unmarked kits never enter native fulfilment, even if their complete component records survive', () => {
  const stripped = recordedKit(1,['take_now','take_now'],'take_today',true);
  stripped.customAttributes = stripped.customAttributes.filter(a => a.key !== '_msh_handover_owner');
  checkBothEvents(basket([stripped]), []);
});

function nativeParent(line, role = 'merchandise') {
  setAttr(line, '_msh_handover_owner', NATIVE_HANDOVER_OWNER);
  setAttr(line, '_msh_handover_role', role);
  setAttr(line, '_msh_intent_product_title', line.title);
  setAttr(line, 'Initials', 'JM');
  setAttr(line, 'Personalisation Summary', 'Initials: JM');
  return line;
}

function attachTestFee(parent, feeId) {
  const pair = 'ad5a9fec-e417-4d42-9dd7-' + parent.id.split('/').at(-1).padStart(12,'0');
  setAttr(parent, '_msh_handover_pair', pair);
  setAttr(parent, '_msh_intent_has_fee', 'true');
  setAttr(parent, 'Personalisation Fee', '£2.50');
  setAttr(parent, 'Linked Fee Variant Id', '111');
  const fee = {...parent, id:gid('LineItem',feeId), title:'Personalisation fee (system)', sku:'', variant:{id:gid('ProductVariant',111)}};
  const fields = {
    _msh_source:'macron_pos',_msh_handover_owner:NATIVE_HANDOVER_OWNER,_msh_handover_role:'service_fee',_msh_handover_pair:pair,
    'Fee For Product':parent.title, 'Linked Product Variant Id':'7','Personalisation Fee':'£2.50'
  };
  fee.customAttributes = Object.entries(fields).map(([key,value]) => ({key,value}));
  return fee;
}

test('native paid and routed flows fulfil only the exact taken garment and its fee among equal variants and prices', () => {
  const taken=nativeParent(shirt(21,'split','true'));
  const owed=nativeParent(shirt(22,'split','false'));
  const feeTaken=attachTestFee(taken,31), feeOwed=attachTestFee(owed,32);
  const freeInitials=nativeParent(shirt(23,'take_today','true'));
  const unrelated=shirt(24,'take_today','true',false);
  const order=basket([owed,feeTaken,freeInitials,unrelated,taken,feeOwed]);
  checkBothEvents(order,[['2',1], ['3',1], ['5',1]]);
  assert.equal(resolveServiceFee(order.lineItems,taken).fee.id, feeTaken.id);
  assert.equal(resolveServiceFee(order.lineItems,owed).fee.id, feeOwed.id);
  assert.deepEqual(resolveServiceFee(order.lineItems,freeInitials),{valid:true,fee:null});
  assert.deepEqual(resolveServiceFee(order.lineItems,unrelated),{valid:true,fee:null});
  feeTaken.requiresShipping=false;
  checkBothEvents(order,[['2',1], ['3',1], ['5',1]]);
  feeTaken.unfulfilledQuantity=0;
  order.fulfillmentOrders[0].lineItems.splice(1,1);
  checkBothEvents(order,[['3',1], ['5',1]]);
  order.displayFinancialStatus='PARTIALLY_PAID';
  checkBothEvents(order,[]);
});

test('an owed or mixed kit and its fee stay open together through repeated paid or routing events', () => {
  const mixed=nativeParent(recordedKit(1,['take_now','order_later']),'kit');
  const complete=nativeParent(recordedKit(2,['take_now','take_now']),'kit');
  const feeOpen=attachTestFee(mixed,5), feeReady=attachTestFee(complete,6);
  const order=basket([mixed,complete,feeOpen,feeReady]);
  checkBothEvents(order,[['2',1],['4',1]]);
  assert.equal(resolveServiceFee(order.lineItems,mixed).fee.id,feeOpen.id);
  for(const index of [1,3]) {
    order.lineItems[index].unfulfilledQuantity=0;
    order.fulfillmentOrders[0].lineItems[index].remainingQuantity=0;
  }
  checkBothEvents(order,[]);
});

test('missing, conflicting, duplicated or unverified native fee records cannot fulfil any merchandise', () => {
  const changes = [
    (parent,fee,rows)=>rows.pop(), (parent,fee,rows)=>rows.shift(),
    (parent,fee,rows)=>rows.push({...fee,id:gid('LineItem',99)}),
    (parent,fee,rows)=>rows.push({...parent,id:gid('LineItem',99)}),
    (parent,fee)=>setAttr(parent,'_msh_handover_pair','bad'), (parent,fee)=>setAttr(fee,'_msh_handover_pair','bad'),
    (parent,fee)=>setAttr(parent,'Linked Fee Variant Id','112'),(parent,fee)=>setAttr(fee,'Linked Product Variant Id','8'),
    (parent,fee)=>setAttr(fee,'Personalisation Fee','£20.00'),(parent,fee)=>setAttr(parent,'Personalisation Fee','£0.00'),
    (parent,fee)=>setAttr(fee,'Fee For Product','Other shirt'),(parent,fee)=>fee.title='Gift card',
    (parent,fee)=>fee.isGiftCard=true,(parent,fee)=>fee.currentQuantity=fee.quantity=2,
    (parent,fee)=>setAttr(fee,'_msh_handover_owner','unknown'), (parent,fee)=>setAttr(parent,'_msh_handover_role','kit'),
    (parent,fee)=>setAttr(parent,'_msh_intent_has_fee','false'), (parent,fee)=>setAttr(fee,'_msh_source','external'),
    (parent,fee)=>setAttr(fee,'_msh_handover_role','other'), (parent,fee)=>fee.lineItemGroup={id:gid('LineItemGroup',1)},
    (parent,fee)=>fee.customAttributes.push(fee.customAttributes[0]),(parent,fee)=>setAttr(fee,'_msh_gc_sale','true'),
    (parent,fee)=>parent.customAttributes=parent.customAttributes.filter(a=>a.key!=='_msh_handover_owner'),
    (parent,fee)=>fee.customAttributes=fee.customAttributes.filter(a=>a.key!=='_msh_handover_role'),
    (parent,fee)=>fee.customAttributes=fee.customAttributes.filter(a=>a.key!=='_msh_handover_owner'),
    (parent,fee)=>setAttr(parent,'_msh_handover_owner','flow_v1'), (parent,fee)=>fee.variant={id:gid('ProductVariant',7)},
  ];
  for(const edit of changes) {
    const parent=nativeParent(shirt(1,'take_today','true')), fee=attachTestFee(parent,2), rows=[parent,fee];
    edit(parent,fee,rows);
    assert.equal(resolveServiceFee(rows,parent).valid,false,String(edit));
    const independent=nativeParent(shirt(43,'take_today','true'));
    checkBothEvents(basket([...rows,independent]),[]);
  }
});
