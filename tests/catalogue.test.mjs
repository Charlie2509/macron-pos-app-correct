import assert from 'node:assert/strict';
import test from 'node:test';
import {allVariantEdges, createRangeLoader, nextCatalogueCursor} from '../extensions/macron-pos/src/catalogue.js';

function controlledRead() {
  let resolve, reject;
  const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
  return {resolve, reject, promise};
}

test('late range responses cannot change a newer selection; revisiting a loading range shares its request', async () => {
  const requests = {coaches: controlledRead(), players: controlledRead()};
  const calls = [];
  const range = createRangeLoader(async id => { calls.push(id); return requests[id].promise; });
  const shown = [];
  const select = id => range.select(id, state => shown.push(state));
  const first = select('coaches');
  const second = select('players');
  const third = select('coaches');
  requests.coaches.resolve(['polo']);
  await Promise.all([first, third]);
  requests.players.reject(new Error('connection lost'));
  await second;
  assert.deepEqual(calls, ['coaches', 'players']);
  assert.deepEqual(shown.filter(s => !s.loading), [{id:'coaches',products:['polo'],loading:false,error:''}]);

  const retry = controlledRead();
  requests.players = retry;
  const fourth = select('players');
  range.leave();
  retry.resolve(['tee']);
  await fourth;
  assert.equal(shown.filter(s => !s.loading).length, 1);
  await select('players');
  assert.deepEqual(shown.at(-1).products, ['tee']);
});

test('ranges are bounded and expire; a failure releases the pending request and allows an immediate retry', async () => {
  let now = 0;
  const calls = [];
  let fail = true;
  const range = createRangeLoader(async id => {
    calls.push(id);
    if (fail) throw new Error('network');
    return [id];
  }, () => now);
  let state;
  const select = id => range.select(id, value => { state = value; });
  await select('first');
  assert.equal(state.error, 'network');
  fail = false;
  await select('first');
  await select('first');
  assert.equal(calls.length, 2);
  now = 300_000;
  await select('first');
  for (let i=0; i<16; i++) await select('range-' + i);
  await select('first');
  assert.equal(calls.filter(id => id === 'first').length, 4);
  assert.equal(state.error, '');
});

test('all product and bundle sizes remain selectable beyond the first page; broken cursors never publish partial data', async () => {
  const page = (numbers, endCursor) => ({
    edges: numbers.map(id => ({node:{id}})),
    pageInfo: {hasNextPage: !!endCursor, endCursor},
  });
  const first = page(Array.from({length:20}, (_, idx) => idx + 1), 'size20');
  const options = await allVariantEdges('product', first, async (_query, variables) => {
    assert.deepEqual(variables, {id:'product',cursor:'size20'});
    return {product:{variants:page([21,22], null)}};
  });
  assert.equal(options.length, 22);
  assert.equal(options.at(-1).node.id, 22);
  await assert.rejects(allVariantEdges('product', first, async () => ({product:{variants:first}})), /invalid catalogue cursor/);
  await assert.rejects(allVariantEdges('product', first, async () => ({product:null})), /incomplete size options/);
  assert.throws(() => nextCatalogueCursor(null, new Set()), /incomplete catalogue/);
});
