// This file is also used as the Shopify Flow Run code action (ES2020, no imports).
const ownerKey = '_msh_handover_owner';
export const NATIVE_HANDOVER_OWNER = 'flow_v2';
const roleKey = '_msh_handover_role';
const pairKey = '_msh_handover_pair';
// Shopify exposes the cart UUID as an opaque string. Its identity is scoped to this order.
export function validHandoverPair(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 255 && !/\s/.test(value) &&
    [...value].every(char => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127);
}

function stop(reason) {
  return {ready: false, mutationInput: '', reason};
}

// Shopify can fulfil one flat kit only when all its numbered pieces were taken.
function flatBundleHandover(attributes) {
  const names = new Map(), choices = new Map(), fields = new Map();
  let isKit = false, invalid = false;
  for (const attr of attributes || []) {
    const key = attr?.key;
    if (typeof key !== 'string') { invalid = true; continue; }
    const name = /^Item ([1-9]\d*)$/i.exec(key);
    const choice = /^Bundle Component ([1-9]\d*) Fulfill?ment$/i.exec(key);
    const slotField = /^Item \d|^Bundle Component /i.test(key);
    isKit = isKit || slotField || key === 'Bundle' || key === '_msh_bundle_component_count' ||
      (key === '_msh_intent_is_bundle' && attr.value === 'true') || key.startsWith('Bundle ');
    if (slotField && !name && !choice) invalid = true;
    if (name || choice) {
      const index = Number((name || choice)[1]);
      const entries = name ? names : choices;
      if (!Number.isSafeInteger(index) || entries.has(index)) invalid = true;
      entries.set(index, attr.value);
    }
    if (fields.has(key)) invalid = true;
    fields.set(key, attr.value);
  }
  if (!isKit) return null;
  if (invalid || typeof fields.get('Bundle') !== 'string' || !fields.get('Bundle').trim() || !names.size ||
      names.size !== choices.size || fields.get('_msh_bundle_component_count') !== String(names.size)) return 'invalid';

  const taken = [], owed = [];
  for (let i = 1; i <= names.size; i++) {
    const name = names.get(i), raw = choices.get(i);
    if (typeof name !== 'string' || !name.trim() || typeof raw !== 'string') return 'invalid';
    if (!fields.has('Item ' + i) || !fields.has('Bundle Component ' + i + ' Fulfilment') || !/^.+ — .+$/.test(name)) return 'invalid';
    if (raw === 'take_now') taken.push(i + '. Taken today · ' + name);
    else if (raw === 'order_later') owed.push(i + '. Owed for collection · ' + name);
    else return 'invalid';
  }
  for (const [key, group] of [['Bundle Take Now Summary', taken], ['Bundle Order Later Summary', owed]]) {
    if ((fields.get(key) || '') !== group.join('\n')) return 'invalid';
  }
  return taken.length === names.size ? 'take' : !taken.length ? 'owe' : 'mixed';
}

// Imported directly by POS and used here by Flow. Both sides reserve the
// same parent only when its editable stock choice agrees with every kit slot.
export function verifiedKitHandover(attributes, title) {
  const outcome = flatBundleHandover(attributes);
  if (!['take','owe','mixed'].includes(outcome)) return null;
  const fields = new Map(attributes.map(a => [a.key, a.value]));
  if (fields.get('Bundle') !== title || fields.get('_msh_source') !== 'macron_pos') return null;
  const mode = fields.get('_msh_fulfilment_mode');
  if (mode === 'take_today' && outcome === 'take' && fields.get('_msh_take_now') === 'true') return 'take';
  if (mode === 'order_in' && outcome === 'owe' && fields.get('_msh_take_now') === 'false') return 'owe';
  if (mode === 'split' && fields.get('_msh_take_now') === 'false') return outcome === 'take' ? 'take' : 'owe';
  return null;
}

function numericId(id, type) {
  const prefix = 'gid://shopify/' + type + '/';
  if (typeof id !== 'string' || !id.startsWith(prefix)) return '';
  const value = id.slice(prefix.length);
  return /^[1-9]\d*$/.test(value) ? value : '';
}

function allEqual(attrs, keys, expected) {
  return keys.every(key => attrs.get(key) === expected);
}

function attributesOf(line) {
  if (!Array.isArray(line?.customAttributes)) return null;
  const fields = new Map();
  for (const attr of line.customAttributes) {
    if (typeof attr?.key !== 'string' || fields.has(attr.key)) return null;
    fields.set(attr.key, attr.value);
  }
  return fields;
}

// Order-level notes and titles alone cannot identify a handed-over unit.
function readChoice(line, attrs) {
  if (!attrs) return null;
  const version = attrs.get(ownerKey);
  if (version !== 'flow_v1' && version !== NATIVE_HANDOVER_OWNER) return null;
  const variant = numericId(line.variant?.id, 'ProductVariant');
  if (!variant || attrs.get('_msh_intent_variant_id') !== variant ||
      attrs.get('_msh_intent_quantity') !== String(line.quantity)) return null;
  const bundle = attrs.get('_msh_intent_is_bundle');
  const hasFee = attrs.get('_msh_intent_has_fee');
  if (version === NATIVE_HANDOVER_OWNER && (line.quantity !== 1 || line.currentQuantity !== 1 ||
      attrs.get('_msh_intent_product_title') !== line.title || attrs.get(roleKey) !== (bundle === 'true' ? 'kit' : 'merchandise'))) return null;
  if (version === 'flow_v1' && (attrs.has(roleKey) || attrs.has(pairKey))) return null;
  if (line.lineItemGroup !== null || line.isGiftCard !== false || line.requiresShipping !== true ||
      attrs.has('Fee For Product') || attrs.has('_MSH_PersoFee') || attrs.has('_msh_gc_sale') ||
      /gift\s*card|personali[sz]ation[ -]fee|persofee/i.test([line.title, line.sku].join(' ')) ||
      !['true','false'].includes(bundle) || !['true','false'].includes(hasFee)) return null;
  const sources = ['_msh_source', '_msh_intent_source', '_msh_fallback_source'];
  if (!allEqual(attrs, sources, 'macron_pos')) return null;
  const mode = attrs.get('_msh_fulfilment_mode');
  const take = attrs.get('_msh_take_now');
  if (!['take_today','order_in','split'].includes(mode) || !['true','false'].includes(take)) return null;
  if (mode !== 'split' && (mode === 'take_today') !== (take === 'true')) return null;
  if (!allEqual(attrs, ['_msh_fulfillment_mode', '_msh_intent_fulfilment_mode', '_msh_intent_fulfillment_mode',
    '_msh_fallback_fulfilment_mode', '_msh_fallback_fulfillment_mode'], mode) ||
      !allEqual(attrs, ['_msh_intent_take_now','_msh_fallback_take_now'], take)) return null;
  if (bundle === 'true') {
    if (line.quantity !== 1 || attrs.get('_msh_intent_product_title') !== line.title) return null;
    return verifiedKitHandover(line.customAttributes, line.title);
  }
  if (version === 'flow_v1' && (hasFee !== 'false' || attrs.get('Personalisation Summary') || attrs.get('Personalization Summary'))) return null;
  if ([...attrs.keys()].some(key => /^(?:Bundle(?: |$)|Item \d|_msh_bundle_component_count$)/i.test(key))) return null;
  return take === 'true' ? 'take' : 'owe';
}

function indexServicePairs(lines) {
  const pairs = new Map();
  for (const line of lines) {
    if (!Array.isArray(line?.customAttributes)) continue;
    const field = line.customAttributes.find(attr => attr?.key === pairKey);
    if (!field) continue;
    if (!pairs.has(field.value)) pairs.set(field.value, []);
    pairs.get(field.value).push(line);
  }
  return pairs;
}

// Both the paid-sale workflow and the final kit collection use the original
// cart UUID, reciprocal Shopify variant IDs and the independently priced fee.
export function resolveServiceFee(lines, parent) {
  const invalid = {valid:false, fee:null};
  const none = {valid:true, fee:null};
  const main = attributesOf(parent);
  if (!main || !Array.isArray(lines)) return invalid;
  if (main.get(ownerKey) !== NATIVE_HANDOVER_OWNER) {
    return main.has(roleKey) || main.has(pairKey) || (main.has(ownerKey) && main.get(ownerKey) !== 'flow_v1') ? invalid : none;
  }
  if (!numericId(parent.id, 'LineItem') || !readChoice(parent, main)) return invalid;
  return feeForValidatedParent(indexServicePairs(lines), parent, main);
}

function feeForValidatedParent(pairs, parent, main) {
  const invalid = {valid:false, fee:null};
  const none = {valid:true, fee:null};
  if (main.get('_msh_intent_has_fee') === 'false') {
    return main.has(pairKey) || main.has('Linked Fee Variant Id') || main.has('Personalisation Fee') ? invalid : none;
  }
  const pair = main.get(pairKey);
  const price = main.get('Personalisation Fee');
  if (!validHandoverPair(pair) || !/^£(?:0|[1-9]\d*)\.\d{2}$/.test(price) || price === '£0.00') return invalid;
  const members = pairs.get(pair) || [];
  if (members.length !== 2 || !members.some(member => member.id === parent.id)) return invalid;
  const fee = members.find(member => member.id !== parent.id);
  const attrs = attributesOf(fee);
  if (!attrs || !numericId(fee.id, 'LineItem') || attrs.get(ownerKey) !== NATIVE_HANDOVER_OWNER ||
      attrs.get(roleKey) !== 'service_fee' || attrs.get('_msh_source') !== 'macron_pos' ||
      attrs.has('_msh_gc_sale') || attrs.has('_msh_intent_is_bundle') || attrs.has('Bundle') ||
      fee.title !== 'Personalisation fee (system)' || fee.isGiftCard !== false || fee.lineItemGroup !== null ||
      typeof fee.requiresShipping !== 'boolean' || fee.quantity !== 1 || fee.currentQuantity !== 1 ||
      ![0,1].includes(fee.unfulfilledQuantity) || attrs.get('Fee For Product') !== parent.title ||
      attrs.get('Personalisation Fee') !== price) return invalid;
  const feeId = numericId(fee.variant?.id, 'ProductVariant');
  const parentId = numericId(parent.variant?.id, 'ProductVariant');
  return feeId && feeId !== parentId && main.get('Linked Fee Variant Id') === feeId &&
    attrs.get('Linked Product Variant Id') === parentId ? {valid:true, fee} : invalid;
}

export default function main(input) {
  const order = input?.order || input?.fulfillmentOrder?.order;
  if (!numericId(order?.id, 'Order') || order.sourceName !== 'pos' || order.displayFinancialStatus !== 'PAID') {
    return stop('Requires a fully paid Shopify POS order.');
  }
  if (order.cancelledAt !== null || order.edited !== false || order.returnStatus !== 'NO_RETURN' ||
      !Array.isArray(order.refunds) || order.refunds.length) return stop('Order has an edit, cancellation, return or refund.');
  const locationId = order.retailLocation?.id;
  if (!numericId(locationId, 'Location') || !Array.isArray(order.lineItems) || !Array.isArray(order.fulfillmentOrders)) {
    return stop('Order lines or retail location unavailable.');
  }

  let total = 0;
  const quantities = new Map();
  const take = new Set();
  const pairs = indexServicePairs(order.lineItems);
  const fees = new Set();
  const pairedFees = new Set();
  for (const line of order.lineItems) {
    if (!numericId(line?.id, 'LineItem') || quantities.has(line.id) || !Number.isSafeInteger(line.quantity) ||
        line.quantity <= 0 || line.quantity !== line.currentQuantity ||
        !Number.isSafeInteger(line.unfulfilledQuantity) || line.unfulfilledQuantity < 0 ||
        line.unfulfilledQuantity > line.quantity || !Array.isArray(line.customAttributes)) return stop('Incomplete order line.');
    total += line.quantity;
    quantities.set(line.id, line.unfulfilledQuantity);
    if (!line.customAttributes.some(a => a?.key === ownerKey || a?.key === roleKey || a?.key === pairKey)) continue;
    const attrs = attributesOf(line);
    if (!attrs) return stop('Conflicting line ownership.');
    const current = attrs.get(ownerKey) === NATIVE_HANDOVER_OWNER;
    if (!current && (attrs.has(roleKey) || attrs.has(pairKey))) return stop('Incomplete line ownership.');
    if (current && attrs.get(roleKey) === 'service_fee') {
      fees.add(line.id);
      continue;
    }
    const choice = readChoice(line, attrs);
    if (!choice) return stop('Marked line instructions need review.');
    if (choice === 'take' && line.unfulfilledQuantity > 0) take.add(line.id);
    if (current) {
      const match = feeForValidatedParent(pairs, line, attrs);
      if (!match.valid || (match.fee && pairedFees.has(match.fee.id))) return stop('Personalisation fee link needs review.');
      if (match.fee) {
        pairedFees.add(match.fee.id);
        if (choice === 'take' && match.fee.unfulfilledQuantity > 0) take.add(match.fee.id);
      }
    }
  }
  if (fees.size !== pairedFees.size || [...fees].some(id => !pairedFees.has(id))) return stop('Unpaired service fee.');
  if (total !== order.subtotalLineItemsQuantity) return stop('Incomplete order line list.');
  if (!take.size) return stop('No eligible outstanding Take today lines.');

  const groups = [];
  const routeIds = new Set();
  const itemIds = new Set();
  for (const fo of order.fulfillmentOrders) {
    if (!numericId(fo?.id, 'FulfillmentOrder') || routeIds.has(fo.id) || !Array.isArray(fo.lineItems)) return stop('Incomplete routing.');
    routeIds.add(fo.id);
    const targets = [];
    for (const item of fo.lineItems) {
      const id = item?.lineItem?.id;
      if (!quantities.has(id) || !numericId(item.id, 'FulfillmentOrderLineItem') || itemIds.has(item.id) ||
          !Number.isSafeInteger(item.remainingQuantity) || item.remainingQuantity < 0) return stop('Invalid routing line.');
      itemIds.add(item.id);
      quantities.set(id, quantities.get(id) - item.remainingQuantity);
      if (!take.has(id) || !item.remainingQuantity) continue;
      if (fo.assignedLocation?.location?.id !== locationId || fo.deliveryMethod?.methodType !== 'RETAIL' ||
          !['OPEN', 'IN_PROGRESS'].includes(fo.status) ||
          !Array.isArray(fo.supportedActions) || !fo.supportedActions.some(a => a?.action === 'CREATE_FULFILLMENT')) {
        return stop('Take today stock is not ready at the selling location.');
      }
      targets.push({id: item.id, quantity: item.remainingQuantity});
    }
    if (targets.length) groups.push({fulfillmentOrderId: fo.id, fulfillmentOrderLineItems: targets});
  }
  if (!groups.length || [...quantities.values()].some(q => q !== 0)) return stop('Wait for complete Shopify routing.');
  if (groups.length > 250 || groups.some(g => g.fulfillmentOrderLineItems.length > 250)) return stop('Large order needs review.');
  const mutationInput = JSON.stringify({fulfillment: {notifyCustomer: false, lineItemsByFulfillmentOrder: groups}});
  if (mutationInput.length > 40000) return stop('Large order needs review.');
  return {ready: true, mutationInput, reason: 'Verified Take today quantities.'};
}
