import assert from 'node:assert/strict';
import test from 'node:test';
import {confirmCartState, hasProperties, writeOrderMarkers} from '../extensions/macron-pos/src/cart-properties.js';

const order = {_msh_order_fulfilment_mode: 'split', _msh_order_source: 'macron_pos'};
const note = {_msh_pos_note_token: '[MSH_POS] mode=split'};

function fakeCart(write) {
  const properties = {staff: 'existing'};
  const calls = [];
  return {
    current: {value: {properties}},
    calls,
    async addCartProperties(batch) {
      calls.push(batch);
      if (write) await write(properties, batch, calls.length);
      else Object.assign(properties, batch);
    },
  };
}

test('saves both order fallback groups in one native call and keeps unrelated properties', async () => {
  const cart = fakeCart();
  await writeOrderMarkers(cart, order, note);
  assert.deepEqual(cart.calls, [{...order,...note}]);
  assert.deepEqual(cart.current.value.properties, {staff:'existing',...order,...note});
});

test('retries only missing groups if the host partly applies or rejects the combined write', async () => {
  const partiallySaved = fakeCart((props,batch,index) => {
    Object.assign(props,index === 1 ? order : batch);
  });
  await writeOrderMarkers(partiallySaved,order,note);
  assert.deepEqual(partiallySaved.calls, [{...order,...note},note]);
  const rejected = fakeCart((props,batch,index) => {
    if (index === 1) throw new Error('Unsupported batch');
    Object.assign(props,batch);
  });
  await writeOrderMarkers(rejected,order,note);
  assert.deepEqual(rejected.calls,[{...order,...note},order,note]);
  assert.deepEqual(rejected.current.value.properties, {staff:'existing',...order,...note});
});

test('same keys with the opposite fulfilment choice still require a write', () => {
  assert.equal(hasProperties({_msh_order_fulfilment_mode:'order_in'}, {_msh_order_fulfilment_mode:'take_today'}),false);
  assert.equal(hasProperties({...order,staff:'existing'},order),true);
});

test('waits for the exact pilot line and releases the subscription on success or timeout', async () => {
  const signal = {value:{ready:false}, callback:null,subscribe(callback) {
    this.callback = callback;
    return () => { this.callback = null; };
  }};
  const expected = state => state?.ready === true;
  const wait = confirmCartState(signal,expected);
  signal.value = {ready:true};
  signal.callback(signal.value);
  assert.equal(await wait,true);
  assert.equal(signal.callback,null);
  signal.value = {ready:false};
  assert.equal(await confirmCartState(signal,expected,5),false);
  assert.equal(signal.callback,null);
  assert.equal(await confirmCartState(null,expected,5),false);
});
