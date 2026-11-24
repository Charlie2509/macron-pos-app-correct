import assert from 'node:assert/strict';
import test from 'node:test';
import {finishCollectedKit, loadKitOrder, recordKitPieces} from '../extensions/macron-pos/src/kit-handover-api.js';
import {buildBundleComponents} from '../extensions/macron-pos/src/bundle-components.js';
import {readKitLine} from '../app/kit-collections.js';

const gid = (resource, id) => 'gid://shopify/' + resource + '/' + id;
const orderId = gid('Order', 71);
const kitId = gid('LineItem', 101);
const siblingId = gid('LineItem', 102);
const locationId = gid('Location', 9);
const routeId = gid('FulfillmentOrder', 80);
const kitRouteLine = gid('FulfillmentOrderLineItem', 801);
const rows = nodes => ({nodes, pageInfo: {hasNextPage: false, endCursor: null}});
const attributes = data => Object.entries(data).map(([key, value]) => ({key, value}));

// A physical kit is one native order unit. Each numbered component is an
// independent size choice. A sibling with identical component names must not
// be assigned any part of this kit's collection or native fulfilment.
function kit(id) {
  return {id, title: 'Training kit', quantity: 1, currentQuantity: 1, unfulfilledQuantity: 1,
    customAttributes: attributes({
      _msh_source: 'macron_pos', _msh_fulfilment_mode: 'split', _msh_take_now: 'false',
      _msh_intent_quantity: '1', _msh_intent_is_bundle: 'true',
      Bundle: 'Training kit',
      'Item 1': 'Tee — M', 'Bundle Component 1 Fulfilment': 'take_now',
      'Item 2': 'Shorts — S', 'Bundle Component 2 Fulfilment': 'order_later',
      'Item 3': 'Socks — L', 'Bundle Component 3 Fulfilment': 'order_later',
      'Bundle Take Now Summary': '- Tee — M', 'Bundle Order Later Summary': '- Shorts — S\n- Socks — L',
    }),
  };
}
function fakeAdmin() {
  const lines = [kit(kitId), kit(siblingId)];
  const state = {
    order: {id: orderId, sourceName: 'pos', displayFinancialStatus: 'PAID', cancelledAt: null,
      edited: false, returnStatus: 'NO_RETURN', refunds: [], retailLocation: {id: locationId}},
    lines, ledger: null, saves: 0, fulfils: [], attempted: [], nextSave: '', nextFinish: '',
    shop: 'y5y3p1-hw.myshopify.com',
    route: {id: routeId, status: 'OPEN', assignedLocation: {location: {id: locationId}},
      deliveryMethod: {methodType: 'RETAIL'}, supportedActions: [{action: 'CREATE_FULFILLMENT'}],
      lineItems: rows(lines.map((l,i) => ({id: gid('FulfillmentOrderLineItem',801+i),
        remainingQuantity: 1, lineItem: {id: l.id}})))},
  };
  let version = 0;
  async function query(document, {variables}) {
    if (document.includes('query MshKitOrder(')) {
      assert.equal(variables.id, orderId);
      return {data: structuredClone({shop: {myshopifyDomain: state.shop},
        order: {...state.order, ledger: state.ledger, lineItems: rows(state.lines)}})};
    }
    if (document.includes('query MshKitRoutes(')) {
      assert.equal(variables.id, orderId);
      return {data: structuredClone({order: {...state.order, fulfillmentOrders: rows([state.route])}})};
    }
    if (document.includes('mutation MshKitCollection(')) {
      assert.equal(variables.inputs.length, 1);
      const input = variables.inputs[0];
      assert.equal(input.ownerId, orderId);
      assert.equal(input.namespace, 'macron_pos');
      assert.equal(input.key, 'kit_collections_v1');
      assert.equal(input.type, 'json');
      const mode = state.nextSave;
      state.nextSave = '';
      if (mode === 'reject' || input.compareDigest !== (state.ledger?.compareDigest ?? null)) {
        return {data: {metafieldsSet: {metafields: [], userErrors: [{message: 'compareDigest mismatch'}]}}};
      }
      state.saves++;
      state.ledger = {type: 'json', value: input.value, compareDigest: 'digest-' + (++version)};
      if (mode === 'lost') throw Error('Connection lost after saving on Shopify');
      return {data: {metafieldsSet: {metafields: [{compareDigest: state.ledger.compareDigest}], userErrors: []}}};
    }
    assert(document.includes('mutation MshFinishKit('));
    state.attempted.push(structuredClone(variables));
    const mode = state.nextFinish;
    state.nextFinish = '';
    if (mode === 'reject') return {data: {fulfillmentCreate: {fulfillment: null, userErrors: [{message: 'Order changed'}]}}};
    const group = variables.fulfillment.lineItemsByFulfillmentOrder[0];
    for (const target of group.fulfillmentOrderLineItems) {
      const routed = state.route.lineItems.nodes.find(row => row.id === target.id);
      assert(routed && target.quantity <= routed.remainingQuantity);
      routed.remainingQuantity -= target.quantity;
      state.lines.find(row => row.id === routed.lineItem.id).unfulfilledQuantity -= target.quantity;
    }
    state.fulfils.push(structuredClone(variables));
    if (mode === 'lost') throw Error('Connection lost after Shopify fulfilled the kit');
    return {data: {fulfillmentCreate: {fulfillment: {id: gid('Fulfillment',91)}, userErrors: []}}};
  }
  return {state, query};
}
async function view(query, id = kitId) {
  const {lines, ledger, digest} = await loadKitOrder(query, orderId);
  const model = readKitLine(lines.find(l => l.id === id), ledger);
  return {...model, digest};
}
function save(query, model, indices, id = kitId) {
  return recordKitPieces(query, orderId, id, indices, model.digest, model.components);
}
test('mixed kit records an individual collection and fulfils only its own final native unit',async () => {
  const {query,state} = fakeAdmin();
  const opened = await view(query);
  assert.deepEqual(opened.components.map(p => p.status), ['taken','owed','owed']);
  assert.equal(await save(query, opened, [2]), false);
  assert.deepEqual((await view(query)).components.map(p => p.status), ['taken','collected','owed']);
  await assert.rejects(finishCollectedKit(query,orderId,kitId));
  assert.equal(state.attempted.length, 0);
  assert.equal(await save(query, await view(query), [3]), true);
  assert.equal(state.attempted.length, 0);
  await finishCollectedKit(query,orderId,kitId);
  const expected = {fulfillment: {notifyCustomer: false,
    lineItemsByFulfillmentOrder: [{fulfillmentOrderId: routeId,
      fulfillmentOrderLineItems: [{id: kitRouteLine, quantity: 1}]}]}};
  assert.deepEqual(state.fulfils, [expected]);
  assert.deepEqual(JSON.parse(state.ledger.value).lines, {'101': {'2':'Shorts — S','3':'Socks — L'}});
  assert.deepEqual((await view(query, siblingId)).components.map(p => p.status), ['taken','owed','owed']);
  assert.equal(state.lines[1].unfulfilledQuantity, 1);
  await finishCollectedKit(query,orderId,kitId);
  assert.equal(state.attempted.length, 1);
});
test('two tills submitting the same displayed version cannot overwrite each other’s collection',async () => {
  const {query,state} = fakeAdmin();
  const [left,right] = await Promise.all([view(query),view(query)]);
  const outcomes = await Promise.allSettled([save(query,left,[2]),save(query,right,[3])]);
  assert.deepEqual(outcomes.map(x => x.status).sort(), ['fulfilled','rejected']);
  assert.equal(state.saves, 1);
  const now = await view(query);
  const remaining = now.components.filter(p => p.status === 'owed').map(p => p.index);
  assert.equal(remaining.length, 1);
  await assert.rejects(save(query, right, remaining));
  assert.equal(await save(query, now, remaining), true);
  assert.equal(state.saves, 2);
});
test('rejected and lost acknowledgements require refresh and safely resume from Shopify',async () => {
  const {query,state} = fakeAdmin();
  const first = await view(query);
  state.nextSave = 'reject';
  await assert.rejects(save(query,first,[2]));
  assert.equal(state.saves, 0);
  state.nextSave = 'lost';
  await assert.rejects(save(query,first,[2]));
  assert.equal(state.saves, 1);
  await assert.rejects(save(query,first,[2]));
  assert.equal(await save(query,await view(query),[3]), true);
  state.nextFinish = 'reject';
  await assert.rejects(finishCollectedKit(query,orderId,kitId));
  assert.equal(state.fulfils.length, 0);
  state.nextFinish = 'lost';
  await assert.rejects(finishCollectedKit(query,orderId,kitId));
  await finishCollectedKit(query,orderId,kitId);
  assert.equal(state.fulfils.length, 1);
  assert.equal(state.lines[1].unfulfilledQuantity, 1);
});
test('merged or edited kit, moved route, changed labels and manually fulfilled siblings cannot drive a write',async () => {
  const {query,state} = fakeAdmin();
  const original = await view(query);
  state.lines[0].quantity = state.lines[0].currentQuantity = 2;
  await assert.rejects(save(query,original,[2]));
  state.lines[0].quantity = state.lines[0].currentQuantity = 1;
  state.order.edited = true;
  await assert.rejects(save(query,original,[2]));
  state.order.edited = false;
  const changed = original.components.map(part => part.index === 2 ? {...part,label:'Shorts — XS'} : part);
  await assert.rejects(save(query,{...original,components:changed},[2]));
  assert.equal(state.saves, 0);
  state.lines[1].unfulfilledQuantity = 0;
  assert.equal(await save(query,await view(query),[2,3]), true);
  state.route.assignedLocation.location.id = gid('Location',77);
  await assert.rejects(finishCollectedKit(query,orderId,kitId));
  assert.equal(state.attempted.length, 0);
});

test('current till output can collect repeated garment names independently by kit position', async () => {
  const {query, state} = fakeAdmin();
  const size = {id: 'M', title: 'Medium'};
  const pieces = ['1', '2', '3'].map(key => ({key, title: 'Training shirt', variants: [size]}));
  const properties = buildBundleComponents('Two training shirts and a spare', pieces, {'1':size,'2':size,'3':size},
    {'1':'order_later','2':'take_now','3':'order_later'}, 'split');
  state.lines[0].customAttributes = attributes({...properties, _msh_source:'macron_pos',
    _msh_fulfilment_mode:'split', _msh_intent_quantity:'1', _msh_intent_is_bundle:'true'});
  assert.equal(await save(query, await view(query), [3]), false);
  assert.deepEqual((await view(query)).components.map(c => c.status), ['owed','taken','collected']);
  assert.equal(await save(query, await view(query), [1]), true);
  await finishCollectedKit(query, orderId, kitId);
  assert.equal(state.lines[0].unfulfilledQuantity, 0);
  assert.equal(state.lines[1].unfulfilledQuantity, 1);
});
