import assert from 'node:assert/strict';
import test from 'node:test';
import {buildBundleComponents, prepareBundleComponents} from '../extensions/macron-pos/src/bundle-components.js';

const shirt = {id: 'shirt', title: 'Training shirt', variants: [
  {id: 'small', title: 'Navy / S'}, {id: 'large', title: 'Navy / L'},
]};
const bag = {id: 'bag', title: 'Kit bag', variants: [{id: 'bag-os', title: 'One size'}]};
const kit = prepareBundleComponents([shirt, shirt, bag]);
const sizes = {...kit.selections, '1': shirt.variants[0], '2': shirt.variants[1]};

for (const [mode, expected] of [['take_today','take_now'],['order_in','order_later']]) {
  test('records every component of a ' + mode + ' kit in its own position', () => {
    const props = buildBundleComponents('Training kit', kit.components, sizes, {}, mode);
    assert.equal(props._msh_bundle_component_count, '3');
    assert.deepEqual([props['Item 1'],props['Item 2'],props['Item 3']],
      ['Training shirt — Navy / S','Training shirt — Navy / L','Kit bag — One size']);
    assert.deepEqual([1,2,3].map(index => props['Bundle Component ' + index + ' Fulfilment']), Array(3).fill(expected));
    const isTaken = mode === 'take_today';
    const label = isTaken ? 'Taken today' : 'Owed for collection';
    const group = isTaken ? 'Bundle Take Now Summary' : 'Bundle Order Later Summary';
    assert.deepEqual(props[group].split('\n'), [1,2,3].map(index => index + '. ' + label + ' · ' + props['Item ' + index]));
    assert.equal(props[isTaken ? 'Bundle Order Later Summary' : 'Bundle Take Now Summary'], undefined);
  });
}

test('duplicate products with different sizes and handovers retain kit position; only single variants are preselected', () => {
  assert.deepEqual(kit.components.map(component => component.key), ['1','2','3']);
  assert.deepEqual(kit.selections, {'3':bag.variants[0]});
  const props = buildBundleComponents('Training kit', kit.components, sizes,
    {1:'order_later',2:'take_now',3:'order_later'}, 'split');
  assert.equal(props['Bundle Take Now Summary'], '2. Taken today · Training shirt — Navy / L');
  assert.equal(props['Bundle Order Later Summary'], '1. Owed for collection · Training shirt — Navy / S\n3. Owed for collection · Kit bag — One size');
  assert.equal(props['Bundle Component 1 Fulfilment'], 'order_later');
  assert.equal(props['Bundle Component 2 Fulfilment'], 'take_now');
  assert.equal(props['Bundle Component 3 Fulfilment'], 'order_later');
});

test('prevents a kit with missing sizes, unknown variants or an incomplete handover from reaching checkout', () => {
  const build = (selections, choices) => buildBundleComponents('Training kit', kit.components, selections, choices, 'split');
  assert.throws(() => build(kit.selections, {}), /size/);
  assert.throws(() => build({...sizes, '1':bag.variants[0]}, {}), /size/);
  assert.throws(() => build(sizes, {1:'take_now',2:'order_later'}), /handover/);
  assert.throws(() => buildBundleComponents('Training kit', [], {}, {}, 'take_today'), /kit/);
});
