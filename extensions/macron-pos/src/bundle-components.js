// A recipe can contain the same Shopify product more than once. Its position
// identifies the garment within this kit, including in the order's Item N fields.
export function prepareBundleComponents(products) {
  const components = products.map((product, index) => ({...product, key: String(index + 1)}));
  const selections = {};
  for (const component of components) {
    if (component.variants.length === 1) selections[component.key] = component.variants[0];
  }
  return {components, selections};
}

export function buildBundleComponents(bundleTitle, components, selections, choices, mode) {
  if (!bundleTitle || !components.length || !['take_today', 'order_in', 'split'].includes(mode)) {
    throw new Error('The kit or its handover choice is missing.');
  }

  const result = {Bundle: bundleTitle, _msh_bundle_component_count: String(components.length)};
  const taken = [];
  const owed = [];
  for (const [index, item] of components.entries()) {
    const selected = selections[item.key];
    const variant = item.variants.find(option => option.id && option.id === selected?.id);
    if (!item.title || !variant?.title) throw new Error('Choose a size for each kit item.');
    const choice = mode === 'split' ? choices[item.key] : mode === 'take_today' ? 'take_now' : 'order_later';
    if (choice !== 'take_now' && choice !== 'order_later') throw new Error('Choose a handover for each kit item.');

    const position = index + 1;
    const label = item.title + ' — ' + variant.title;
    result['Item ' + position] = label;
    result['Bundle Component ' + position + ' Fulfilment'] = choice;
    if (choice === 'take_now') taken.push(position + '. Taken today · ' + label);
    else owed.push(position + '. Owed for collection · ' + label);
  }
  if (taken.length) result['Bundle Take Now Summary'] = taken.join('\n');
  if (owed.length) result['Bundle Order Later Summary'] = owed.join('\n');
  return result;
}
