// Run against a saved merchant template; fixtures contain only synthetic POS data.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Liquid} from 'liquidjs';
import {updateTemplate} from './update-templates.mjs';

const engine = new Liquid();
const source = await readFile(process.argv[2], 'utf8');
const patched = updateTemplate(source);
assert.equal(updateTemplate(patched), patched);
const line = {
  id: 17, quantity: 1, refunded_quantity: 0, successfully_fulfilled_quantity: 0,
  title: 'Sample kit', sku: 'TEST', final_line_price: 1800, final_price: 1800, tax_lines: [],
  product: {title: 'Sample kit'}, properties: {'Printed initials': 'XX'},
};
const order = {id: 101, name: 'Preview', tags: ['POS'], line_items: [line], financial_status: 'paid', shipping_methods: [], total_price: 1800, tax_price: 0};
const context = {order, shop: {name: 'Preview'}};
const render = (text) => engine.parseAndRender(text, context);
const normalise = html => html.replace(/\s+/g, ' ').replace(/> </g, '><').trim();
assert.equal(normalise(await render(patched)), normalise(await render(source)), 'Ordinary item output changed');

line.properties = {
  ...line.properties, _msh_source: 'macron_pos', Bundle: 'Training kit', _msh_bundle_component_count: '3',
  'Item 1': 'Shirt — S', 'Bundle Component 1 Fulfilment': 'take_now',
  'Item 2': 'Shorts — M', 'Bundle Component 2 Fulfilment': 'order_later',
  'Item 3': 'Shorts — L', 'Bundle Component 3 Fulfilment': 'order_later',
  'Bundle Take Now Summary': '- Shirt — S', 'Bundle Order Later Summary': '- Shorts — M\n- Shorts — L',
};
order.metafields = {macron_pos: {kit_collections_v1: {value: {version: 1, lines: {17: {2: 'Shorts — M'}}}}}};
let html = await render(patched);
for (const label of ['Shirt — S', 'Shorts — M', 'Shorts — L', 'Taken at sale', 'Collected later', 'Still owed', 'Printed initials']) {
  assert.equal(html.split(label).length - 1, 1, 'Expected one visible ' + label);
}
assert.doesNotMatch(html, /Kit record incomplete|Bundle Take Now Summary|Bundle Order Later Summary|POS order in|Bundle status: order in/);
line.successfully_fulfilled_quantity = 1;
html = await render(patched);
assert.doesNotMatch(html, /Still owed/);
assert.match(html, /Owed at sale/);
console.log('Passed full-template checks for an ordinary till sale and a mixed-size kit before and after native fulfilment.');
