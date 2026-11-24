import {readFile, writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

const marker = 'MSH kit handover v1.';
const fragment = await readFile(new URL('./kit-handover.liquid', import.meta.url), 'utf8');

function locate(text, anchor, after = 0) {
  const index = text.indexOf(anchor, after);
  if (index < 0) throw new Error('The current template has a different layout. No output written. Missing ' + anchor);
  return index;
}

function unique(text, anchor) {
  const index = locate(text, anchor);
  if (text.indexOf(anchor, index + anchor.length) !== -1) {
    throw new Error('Ambiguous template layout. No output written. Repeated ' + anchor);
  }
  return index;
}

export function updateTemplate(source) {
  const crlf = source.includes('\r\n');
  let text = source.replace(/\r\n/g, '\n');
  if (text.includes(marker)) {
    if (!text.includes('{{ msh_kit_html }}')) throw new Error('A handover fragment already exists. Review that copy before updating.');
    return source;
  }
  unique(text, '{%- assign has_bundle_items = false -%}');
  const row = unique(text, '<tr class="{% if has_bundle_items %}bundle-row');
  const sku = locate(text, 'SKU: {{ line_item.sku }}', row);
  const lineBadges = locate(text, '{% if order_is_split_fulfilment %}', sku);
  const kitSection = locate(text, '{% if has_bundle_items %}', lineBadges);
  const oldKitBadges = locate(text, '{% if order_is_split_fulfilment %}', kitSection);
  const oldTable = locate(text, '<table class="subtable"', oldKitBadges);
  const afterTable = locate(text, '</table>', oldTable) + '</table>'.length;
  const nextSection = locate(text, '{%- assign ack_confirmed = false -%}', afterTable);
  if (text.slice(afterTable, nextSection).trim()) throw new Error('The kit section has additional custom content. No output written.');
  // Wrap the merchant's old blocks so web and older unmarked orders keep their original layout.
  text = text.slice(0, lineBadges) + '{% if msh_kit_html == blank %}\n' +
    text.slice(lineBadges, kitSection) + '{% endif %}\n' +
    text.slice(kitSection, oldKitBadges) + '{% if msh_kit_html != blank %}{{ msh_kit_html }}{% else %}\n' +
    text.slice(oldKitBadges, afterTable) + '\n{% endif %}' + text.slice(afterTable);
  const capture = '{%- capture msh_kit_html -%}\n' + fragment.trim() + '\n{%- endcapture -%}\n';
  const prepare = capture + '{%- if msh_kit_html != blank -%}{%- assign has_bundle_items = true -%}{%- endif -%}\n';
  text = text.slice(0, row) + prepare + text.slice(row);

  const props = '{%- assign is_bundle_summary_key = false -%}';
  unique(text, props);
  text = text.replace(props, props + `
                        {% if msh_kit_html != blank %}
                          {% assign msh_number = k | remove_first: 'Item ' | plus: 0 %}
                          {% assign msh_numbered_key = 'Item ' | append: msh_number %}
                          {% if k == msh_numbered_key and msh_number > 0 %}{% assign is_bundle_key = true %}{% endif %}
                          {% if k == 'Bundle Take Now Summary' or k == 'Bundle Summary' %}{% assign is_bundle_summary_key = true %}{% endif %}
                          {% if k_down contains 'bundle component' and k_down contains 'fulfillment' %}{% assign is_component_fulfilment_key = true %}{% endif %}
                        {% endif %}`);

  const posBadge = '{% if pos_has_fulfilled and pos_has_unfulfilled %}';
  if (text.includes(posBadge)) {
    unique(text, posBadge);
    const scan = '{% for scan_line_item in order.line_items %}';
    unique(text, scan);
    // Reuse the exact kit provenance checks without rendering component tables during the header pass.
    const check = fragment.slice(locate(fragment, '{%- assign msh_source ='), locate(fragment, '{%- assign msh_ledger ='));
    text = text.replace(scan, '{% assign msh_order_has_kit = false %}\n' + scan + '\n' +
      check.replaceAll('line_item.properties', 'scan_line_item.properties') +
      '{% assign msh_order_has_kit = true %}{%- endif -%}');
    text = text.replace(posBadge, '{% if msh_order_has_kit %}<span class="badge">Kit handover listed by item below</span>\n' +
      '{% elsif pos_has_fulfilled and pos_has_unfulfilled %}');
  }
  return crlf ? text.replace(/\n/g, '\r\n') : text;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [input, output] = process.argv.slice(2);
  if (!input || !output) throw new Error('Run node update-templates.mjs input.txt new-output.txt');
  const result = updateTemplate(await readFile(input, 'utf8'));
  await writeFile(output, result, {flag: 'wx'});
}
