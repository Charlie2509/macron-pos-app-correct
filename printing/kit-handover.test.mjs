import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {Liquid} from 'liquidjs';
import {updateTemplate} from './update-templates.mjs';

const engine = new Liquid();
const fragment = await readFile(new URL('./kit-handover.liquid', import.meta.url), 'utf8');
const properties = {
  _msh_source: 'macron_pos', Bundle: 'Training kit', 'Item 1': 'Shorts — S',
  'Bundle Component 1 Fulfilment': 'take_now', 'Item 2': 'Shorts — L',
  'Bundle Component 2 Fulfilment': 'order_later',
};
const line = {id: 92, quantity: 1, properties};
const saved = {version: 1, lines: {92: {2: 'Shorts — L'}}};
const render = (row, metafield, status = 'paid') => engine.parseAndRender(fragment, {
  line_item: row, order: {financial_status: status, metafields: {macron_pos: {kit_collections_v1: metafield}}},
});

test('two positions and sizes from the same product keep their own handover', async () => {
  const html = await render(line);
  assert.match(html, /1\. Shorts — S[\s\S]*?Taken at sale<\/td>/);
  assert.match(html, /2\. Shorts — L[\s\S]*?Owed at sale<\/span><\/td>/);
  assert.doesNotMatch(html, /Collected later|_msh|Bundle Component/);
});

test('later collection is matched on version, line ID, quantity, slot and exact label', async () => {
  for (const ledger of [saved, {value: saved}]) assert.match(await render(line, ledger), /Collected later/);
  for (const [row, ledger] of [
    [{...line, id: 93}, saved], [{...line, quantity: 2}, saved], [line, {...saved, version: 2}],
    [line, {version: 1, lines: {92: {1: 'Shorts — L'}}}],
    [line, {version: 1, lines: {92: {2: 'Shorts — L '}}}],
    [line, JSON.stringify(saved)], [{...line, successfully_fulfilled_quantity: 1}, null],
  ]) {
    const html = await render(row, ledger);
    assert.match(html, /Owed at sale|Check in Shopify/);
    assert.doesNotMatch(html, /Collected later/);
  }
});

test('still owed requires a paid, outstanding, unrefunded kit and readable current ledger', async () => {
  const row = {...line, properties: {...properties, _msh_bundle_component_count: '2'}, refunded_quantity: 0, successfully_fulfilled_quantity: 0};
  const ledger = {version: 1, lines: {}};
  assert.match(await render(row, ledger), /Still owed/);
  assert.doesNotMatch(await render(row, null), /Still owed/);
  assert.doesNotMatch(await render(row, {version: 1, lines: 'bad data'}), /Still owed/);
  assert.doesNotMatch(await render(row, {version: 1, lines: {92: []}}), /Still owed/);
  assert.doesNotMatch(await render({...row, successfully_fulfilled_quantity: 1}, ledger), /Still owed/);
  assert.doesNotMatch(await render({...row, refunded_quantity: 1}, ledger), /Still owed/);
  assert.doesNotMatch(await render(row, ledger, 'pending'), /Still owed/);
  assert.doesNotMatch(await render({...row, properties: {...row.properties, 'Bundle Component 3 Fulfilment': 'order_later'}}, ledger), /Still owed/);
});

test('other channels and conflicting markers do not produce a kit header', async () => {
  for (const attrs of [{}, {...properties, Bundle: ''}, {...properties, _msh_source: 'web'},
    {...properties, _msh_fallback_source: 'another_app'}]) {
    assert.equal((await render({...line, properties: attrs})).trim(), '');
  }
});

test('legacy groups, unexpected modes, missing labels and escaping', async () => {
  const attrs = {_msh_intent_source: 'macron_pos', Bundle: 'Kit', 'Bundle Take Now Summary': '- <Tee>', 'Bundle Order Later Summary': '- Socks'};
  const legacy = await render({...line, properties: attrs});
  assert.match(legacy, /Take today at sale<br>- &lt;Tee&gt;/);
  assert.match(legacy, /Owed at sale<br>- Socks/);
  const unknown = await render({...line, properties: {...properties, 'Item 1': '<Hat>', 'Item 2': '', _msh_bundle_component_count: '3', 'Bundle Component 1 Fulfilment': 'unspecified'}});
  assert.match(unknown, /&lt;Hat&gt;/);
  assert.match(unknown, /Unidentified kit item/);
  assert.equal(unknown.match(/Check in Shopify/g).length, 2);
  assert.match(unknown, /record incomplete/);
  assert.doesNotMatch(unknown, /Taken at sale|Collected later|Owed at sale/);
  assert.match(await render({...line, properties: {...properties, 'Bundle Component 1 Fulfilment': 'taken_now'}}, null, 'pending'), /Take today at sale/);
});

test('encoded ampersands display normally while saved label matching remains exact', async () => {
  const label = 'Blue &amp; white shorts — M';
  const row = {...line, properties: {...properties, 'Item 2': label}};
  const html = await render(row, {version: 1, lines: {92: {2: label}}});
  assert.match(html, /Blue &amp; white shorts/);
  assert.doesNotMatch(html, /&amp;amp;/);
  assert.match(html, /Collected later/);
});

test('refuses unrecognised or partially modified templates', () => {
  assert.throws(() => updateTemplate('<h1>Invoice</h1>'), /No output written/);
  assert.throws(() => updateTemplate(fragment), /fragment already exists/);
});
