import {test} from 'node:test';
import assert from 'node:assert/strict';
import {addCollections, exactKitFulfillment, parseLedger, readKitLine, safeKitOrder} from '../app/kit-collections.js';
import {buildBundleComponents} from '../extensions/macron-pos/src/bundle-components.js';

const gid = (resource, id) => 'gid://shopify/' + resource + '/' + id;
const page = nodes => ({nodes, pageInfo: {hasNextPage: false}});
const empty = () => parseLedger(null);

function kitLine(id = 12, changes = {}) {
  const fields = {
    Bundle: 'Training kit', _msh_source: 'macron_pos', _msh_intent_is_bundle: 'true', _msh_intent_quantity: '1',
    _msh_fulfilment_mode: 'split', _msh_bundle_component_count: '3',
    'Item 1': 'Shirt — M', 'Bundle Component 1 Fulfilment': 'take_now',
    'Item 2': 'Shorts — 32', 'Bundle Component 2 Fulfilment': 'order_later',
    'Item 3': 'Shorts — 32', 'Bundle Component 3 Fulfilment': 'Order later',
    ...changes
  };
  return {id: gid('LineItem', id), quantity: 1, currentQuantity: 1, unfulfilledQuantity: 1,
    customAttributes: Object.entries(fields).filter(([,value]) => value !== null).map(([key, value]) => ({key, value}))};
}

function order(line) {
  const location = {id: gid('Location', 1)};
  const otherLine = {id: gid('FulfillmentOrderLineItem', 10), remainingQuantity: 4, lineItem: {id: gid('LineItem', 90)}};
  const target = {id: gid('FulfillmentOrderLineItem', 11), remainingQuantity: 1, lineItem: {id: line.id}};
  const route = {id: gid('FulfillmentOrder', 8), status: 'OPEN', supportedActions: [{action: 'CREATE_FULFILLMENT'}],
    assignedLocation: {location}, deliveryMethod: {methodType: 'RETAIL'}, lineItems: page([otherLine, target])};
  return {id: gid('Order', 7), sourceName: 'pos', displayFinancialStatus: 'PAID', returnStatus: 'NO_RETURN',
    cancelledAt: null, edited: false, refunds: [], retailLocation: location, fulfillmentOrders: page([route])};
}

test('records exact garments per kit without changing sale evidence or another kit of the same size', () => {
  const first = kitLine(), second = kitLine(13);
  const blank = empty(), saved = addCollections(blank, first, [2]);
  assert.deepEqual(blank, empty());
  assert.deepEqual(saved, {version: 1, lines: {'12': {'2': 'Shorts — 32'}}});
  assert.equal(readKitLine(first, saved).canRecord, true);
  assert.deepEqual(readKitLine(first, saved).components.map(c => c.status), ['taken','collected','owed']);
  assert.deepEqual(readKitLine(second, saved).components.map(c => c.status), ['taken','owed','owed']);
  assert.deepEqual(addCollections(saved, first, [2]), saved);
  assert.equal(readKitLine(first, addCollections(saved, first, [3])).complete, true);
  assert.equal(readKitLine(first, saved).complete, false);
  assert.throws(() => addCollections(saved, first, [1]));
  assert.throws(() => addCollections(saved, first, [99]));
  assert.throws(() => addCollections(saved, first, []));
  assert.deepEqual(parseLedger(JSON.stringify(saved)), saved);
});

test('legacy numbered choices work without a count; unknown, contradictory or stripped fields never imply collection', () => {
  const legacy = kitLine(12, {_msh_bundle_component_count: null, 'Bundle Take Now Summary': '- Shirt — M',
    'Bundle Order Later Summary': '- Shorts — 32\n- Shorts — 32'});
  assert.equal(readKitLine(legacy, empty()).canRecord, true);
  const uncorroborated = kitLine(12, {_msh_bundle_component_count: null, 'Bundle Take Now Summary': '- Shirt — M'});
  const visible = readKitLine(uncorroborated, empty());
  assert.deepEqual(visible.components.map(c => c.status), ['taken','owed','owed']);
  assert.equal(visible.canRecord, false);
  assert.equal(visible.complete, false);
  assert.throws(() => addCollections(empty(), uncorroborated, [2]));
  assert.equal(exactKitFulfillment(order(uncorroborated), uncorroborated), null);
  const stripped = structuredClone(legacy);
  stripped.customAttributes = stripped.customAttributes.filter(a => !a.key.includes('3'));
  assert.equal(readKitLine(stripped, empty()).canRecord, false);
  const badLines = [
    kitLine(12, {'Bundle Component 3 Fulfilment': null}),
    kitLine(12, {'Item 2': null, 'Bundle Component 2 Fulfilment': null}),
    kitLine(12, {_msh_bundle_component_count: '4'}),
    kitLine(12, {_msh_fulfilment_mode: 'order_in'}),
    kitLine(12, {_msh_source: 'other'}),
    kitLine(12, {'Bundle Component 1 Fulfilment': 'unknown'}),
    kitLine(12, {'Bundle Component 1 Fulfillment': 'order_later'}),
    {...kitLine(), quantity: 2}, {...kitLine(), currentQuantity: 0}, {...kitLine(), unfulfilledQuantity: null}
  ];
  for (const line of badLines) {
    const kit = readKitLine(line, empty());
    assert.equal(kit.canRecord, false);
    assert.equal(kit.complete, false);
    assert(kit.problem);
  }
  assert.equal(readKitLine({id: gid('LineItem', 9), customAttributes: []}, empty()), null);
  assert.equal(readKitLine({id: gid('LineItem', 9), customAttributes: [
    {key: 'Bundle', value: 'Another shop’s set'}, {key: 'Item 1', value: 'Jacket'}]}, empty()), null);
  const vanished = {id: gid('LineItem', 12), customAttributes: []};
  assert.equal(readKitLine(vanished, addCollections(empty(), kitLine(), [2])).canRecord, false);
});

test('reads the exact numbered summaries emitted by the current till for repeated garments', () => {
  const variant = {id: 'S', title: 'Small'};
  const components = ['1','2','3'].map(key => ({key, title: 'Training top', variants: [variant]}));
  const properties = buildBundleComponents('Kit', components, {'1': variant, '2': variant, '3': variant},
    {'1':'order_later', '2':'take_now', '3':'order_later'}, 'split');
  const line = kitLine(12, properties);
  const kit = readKitLine(line, empty());
  assert.equal(kit.canRecord, true);
  assert.deepEqual(kit.components.map(c => c.status), ['owed','taken','owed']);
  assert.deepEqual(readKitLine(line, addCollections(empty(), line, [3])).components.map(c => c.status), ['owed','taken','collected']);
});

test('stale or malformed collection data cannot silently remap garment indices', () => {
  const ledger = addCollections(empty(), kitLine(), [2]);
  for (const line of [kitLine(12, {'Item 2': 'Shorts — 34'}), kitLine(12, {'Bundle Component 2 Fulfilment': 'take_now'})]) {
    assert.equal(readKitLine(line, ledger).components[1].status, 'unknown');
    assert.throws(() => addCollections(ledger, line, [3]));
  }
  assert.equal(readKitLine(kitLine(), {version: 1, lines: {'12': {'7': 'Missing item'}}}).canRecord, false);
  for (const value of [undefined, '', 'null', '{"version":2,"lines":{}}', '{"version":1,"lines":[]}',
    '{"version":1,"lines":{"__proto__":{}}}', '{"version":1,"lines":{"2":{"0":"Shirt"}}}',
    '{"version":1,"lines":{"2":{"1":true}}}', '{"version":1,"lines":{},"unexpected":true}']) {
    assert.throws(() => parseLedger(value));
  }
});

test('order or native fulfilment status cannot invent an initial or later physical collection', () => {
  const line = kitLine();
  line.unfulfilledQuantity = 0;
  const summary = readKitLine(line, empty());
  assert.deepEqual(summary.components.map(c => c.status), ['taken','owed','owed']);
  assert.equal(summary.canRecord, false);
  assert.equal(summary.complete, false);
  assert.match(summary.problem, /fulfilled/);
  const ledger = addCollections(empty(), kitLine(), [2,3]);
  assert.equal(readKitLine(line, ledger).complete, true);
  assert.equal(exactKitFulfillment(order(line), line), null);
});

test('completion targets only the exact kit and selling location and stops after native fulfilment', () => {
  const line = kitLine(), current = order(line);
  assert(safeKitOrder(current));
  assert.deepEqual(exactKitFulfillment(current, line), {fulfillment: {notifyCustomer: false,
    lineItemsByFulfillmentOrder: [{fulfillmentOrderId: gid('FulfillmentOrder', 8), fulfillmentOrderLineItems: [
      {id: gid('FulfillmentOrderLineItem', 11), quantity: 1}]}]}});
  for (const edit of [
    o => o.sourceName = 'web', o => o.edited = true, o => o.refunds.push({id: 'refund'}), o => o.cancelledAt = 'today',
    o => o.returnStatus = 'IN_PROGRESS', o => o.displayFinancialStatus = 'PENDING', o => o.retailLocation = null
  ]) {
    const bad = order(line);
    edit(bad);
    assert.equal(safeKitOrder(bad), false);
    assert.equal(exactKitFulfillment(bad, line), null);
  }
  for (const edit of [
    (o,f) => f.status = 'ON_HOLD', (o,f) => f.deliveryMethod.methodType = 'SHIPPING',
    (o,f) => f.assignedLocation.location = {id: gid('Location', 3)}, (o,f) => f.supportedActions = [],
    (o,f) => f.lineItems.nodes[1].remainingQuantity = 0, (o,f) => f.lineItems.nodes[1].remainingQuantity = 2,
    (o,f) => f.lineItems.nodes.push({...f.lineItems.nodes[1]}), (o,f) => f.lineItems.pageInfo.hasNextPage = true,
    o => o.fulfillmentOrders.pageInfo.hasNextPage = true
  ]) {
    const bad = order(line);
    edit(bad,bad.fulfillmentOrders.nodes[0]);
    assert.equal(exactKitFulfillment(bad, line), null);
  }
});
