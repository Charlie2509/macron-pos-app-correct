import assert from 'node:assert/strict';
import test from 'node:test';
import {addHandoverToCart, confirmCartState} from '../extensions/macron-pos/src/cart-properties.js';

const main = {
  variantId: 101,
  properties: {
    _msh_handover_owner: 'flow_v2', _msh_handover_role: 'merchandise', _msh_source: 'macron_pos',
    _msh_fulfilment_mode: 'take_today', _msh_intent_product_title: 'Blue top', Initials: 'AA',
  },
};
const fee = {variantId: 202, label: '£2.50'};

function fakeCart() {
  let index = 0;
  const value = {lineItems: [], properties: {staff: 'Keep this note'}};
  const calls = [];
  const cart = {
    calls, current: {value},
    async addLineItem(variantId, quantity) {
      const uuid = '00000000-0000-4000-8000-' + String(++index).padStart(12, '0');
      value.lineItems.push({uuid, variantId, quantity, properties: {}});
      calls.push(['item', uuid]);
      return uuid;
    },
    async addLineItemProperties(uuid, updates) {
      Object.assign(value.lineItems.find(line => line.uuid === uuid).properties, updates);
      calls.push(['properties', uuid]);
    },
    async addCartProperties(updates) {
      Object.assign(value.properties, updates);
      calls.push(['cart']);
    },
    async removeLineItem(uuid) {
      value.lineItems = value.lineItems.filter(line => line.uuid !== uuid);
      calls.push(['remove', uuid]);
    },
  };
  return cart;
}

test('a plain garment writes its native handover once; later garments preserve staff notes and their own choices', async () => {
  const cart = fakeCart();
  const first = await addHandoverToCart(cart, main);
  const next = await addHandoverToCart(cart, {...main, properties: {...main.properties, _msh_fulfilment_mode: 'order_in'}});
  assert.notEqual(first.mainUuid, next.mainUuid);
  assert.deepEqual(cart.calls.map(call => call[0]), ['item','properties','cart','item','properties']);
  assert.deepEqual(cart.current.value.properties, {staff: 'Keep this note', _msh_handover_pilot_seen: 'flow_v2'});
  const [taken, owed] = cart.current.value.lineItems;
  assert.equal(taken.properties._msh_fulfilment_mode, 'take_today');
  assert.equal(owed.properties._msh_fulfilment_mode, 'order_in');
  assert.equal(next.feeUuid, null);
});

test('identical personalisation fees have distinct reciprocal pairs, including on repeated kits', async () => {
  const cart = fakeCart();
  const result1 = await addHandoverToCart(cart, {...main, fee});
  const result2 = await addHandoverToCart(cart, {...main, properties: {...main.properties, _msh_handover_role: 'kit'}, fee});
  const [line1, fee1, line2, fee2] = cart.current.value.lineItems;
  assert.notEqual(result1.mainUuid, result2.mainUuid);
  for (const [parent, charge] of [[line1, fee1],[line2, fee2]]) {
    assert.equal(parent.properties['Linked Fee Variant Id'], '202');
    assert.equal(charge.properties['Linked Product Variant Id'], '101');
    assert.equal(charge.properties['Fee For Product'], 'Blue top');
    assert.equal(charge.properties['Personalisation Fee'], '£2.50');
    assert.equal(charge.properties._msh_handover_owner, 'flow_v2');
    assert.equal(charge.properties._msh_handover_role, 'service_fee');
    assert.equal(charge.properties._msh_handover_pair, parent.uuid);
    assert.equal(parent.properties._msh_handover_pair, parent.uuid);
  }
});

test('an unlabelled matching product or fee blocks the add before any mutation', async () => {
  for (const variantId of [main.variantId, fee.variantId]) {
    const cart = fakeCart();
    cart.current.value.lineItems.push({uuid: 'existing', variantId, quantity: 3, properties: {}});
    await assert.rejects(addHandoverToCart(cart, {...main, fee}), /Review/);
    assert.deepEqual(cart.calls, []);
  }
});

test('a merged fee receipt cannot overwrite or remove a previously priced fee', async () => {
  const cart = fakeCart();
  const original = await addHandoverToCart(cart, {...main, fee});
  const existingFee = cart.current.value.lineItems[1];
  const originalProperties = {...existingFee.properties};
  const add = cart.addLineItem.bind(cart);
  cart.addLineItem = async (id, count) => {
    if (id !== fee.variantId) return add(id, count);
    existingFee.quantity += count;
    return existingFee.uuid;
  };
  await assert.rejects(addHandoverToCart(cart, {...main, fee}), /existing quantity/);
  assert.deepEqual(cart.current.value.lineItems.map(line => line.uuid), [original.mainUuid, original.feeUuid]);
  assert.deepEqual(existingFee.properties, originalProperties);
  assert.equal(existingFee.quantity, 2);
});

test('a stripped fee or sticky marker rolls back both newly added lines and keeps unrelated items', async () => {
  for (const strip of ['fee', 'marker']) {
    const cart = fakeCart();
    await cart.addLineItem(900, 3);
    if (strip === 'marker') cart.addCartProperties = async () => {};
    else {
      const attach = cart.addLineItemProperties.bind(cart);
      cart.addLineItemProperties = (uuid, props) => {
        const saved = {...props};
        if (saved._msh_handover_role === 'service_fee') delete saved._msh_handover_pair;
        return attach(uuid, saved);
      };
    }
    await assert.rejects(addHandoverToCart(cart, {...main, fee}), /could not verify/);
    assert.deepEqual(cart.current.value.lineItems.map(line => line.variantId), [900]);
  }
});

test('a lost properties reply is accepted only when the precise data is already present', async () => {
  const cart = fakeCart();
  const attach = cart.addLineItemProperties.bind(cart);
  cart.addLineItemProperties = async (...args) => { await attach(...args); throw new Error('Lost reply'); };
  await addHandoverToCart(cart, main);
  assert.equal(cart.current.value.lineItems.length, 1);
  assert.equal(cart.current.value.lineItems[0].properties.Initials, 'AA');
});

test('reads delayed native signals and releases its listener at timeout or success', async () => {
  const signal = {value: {ready: false}, callback: null, subscribe(callback) {
    this.callback = callback;
    return () => { this.callback = null; };
  }};
  const expected = state => state?.ready === true;
  const wait = confirmCartState(signal, expected);
  signal.value = {ready: true};
  signal.callback(signal.value);
  assert.equal(await wait, true);
  assert.equal(signal.callback, null);
  signal.value = {ready: false};
  assert.equal(await confirmCartState(signal, expected, 5), false);
  assert.equal(signal.callback, null);
});
