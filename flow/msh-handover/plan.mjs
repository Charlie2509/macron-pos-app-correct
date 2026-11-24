// This file is also used as the Shopify Flow Run code action (ES2020, no imports).
const ownerKey = '_msh_handover_owner';
const ownerVersion = 'flow_v1';

function stop(reason) {
  return {ready: false, mutationInput: '', reason};
}

export function hasHandoverOwner(attributes) {
  return Array.isArray(attributes) && attributes.some(a => (a?.key || a?.name) === ownerKey);
}

// With a pilot marker somewhere in the cart, an ordinary line missing its
// owner could be a stripped pilot line. Only unmistakable legacy specialty
// merchandise can then be handled by the old service.
export function isLegacySpecialty(attributes) {
  if (!Array.isArray(attributes)) return false;
  // A new kit might have lost its line owner while the cart marker survived.
  // A legacy kit can be positively identified by its old printed bullet format.
  if (attributes.some(a => a?.key === '_msh_bundle_component_count')) return false;
  if (attributes.some(a => a?.key === 'Bundle' || (a?.key === '_msh_intent_is_bundle' && a.value === 'true'))) {
    return attributes.some(a => ['Bundle Take Now Summary','Bundle Order Later Summary'].includes(a?.key)
      && typeof a.value === 'string' && a.value.startsWith('- '));
  }
  return attributes.some(a => (a?.key === '_msh_intent_has_fee' && a.value === 'true') ||
    (['Personalisation Summary','Personalization Summary'].includes(a?.key) && Boolean(a.value)));
}

// A flat MSH kit is one Shopify unit. Counted records are written by the new
// till. Older kits can still be read by legacy recovery but cannot be reserved.
export function flatBundleHandover(attributes, requireNew = false) {
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
  const counted = fields.has('_msh_bundle_component_count');
  if (invalid || (requireNew && !counted) || typeof fields.get('Bundle') !== 'string' || !fields.get('Bundle').trim() ||
      !names.size || names.size !== choices.size || (counted && fields.get('_msh_bundle_component_count') !== String(names.size))) return 'invalid';

  const taken = [], owed = [];
  for (let i = 1; i <= names.size; i++) {
    const name = names.get(i), raw = choices.get(i);
    if (typeof name !== 'string' || !name.trim() || typeof raw !== 'string') return 'invalid';
    const choice = counted ? raw : raw.toLowerCase().replace(/ /g, '_');
    if (counted && (!fields.has('Item ' + i) || !fields.has('Bundle Component ' + i + ' Fulfilment') ||
        !/^.+ — .+$/.test(name))) return 'invalid';
    if (choice === 'take_now') taken.push(i + '. Taken today · ' + name);
    else if (choice === 'order_later') owed.push(i + '. Owed for collection · ' + name);
    else return 'invalid';
  }
  for (const [key, group] of [['Bundle Take Now Summary', taken], ['Bundle Order Later Summary', owed]]) {
    if (counted && (fields.get(key) || '') !== group.join('\n')) return 'invalid';
    if (!counted && !group.length && fields.get(key)) return 'invalid';
  }
  return taken.length === names.size ? 'take' : !taken.length ? 'owe' : 'mixed';
}

// Imported directly by POS and used here by Flow. Both sides reserve the
// same parent only when its editable stock choice agrees with every kit slot.
export function verifiedKitHandover(attributes, title) {
  const outcome = flatBundleHandover(attributes, true);
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

// Legacy recovery and Flow both require affirmative line-level evidence.
// Free-text order notes, the last product added and title guesses are never allocation.
function readChoice(line, owner) {
  const attrs = new Map();
  for (const a of line.customAttributes) {
    if (typeof a?.key !== 'string' || attrs.has(a.key)) return null;
    attrs.set(a.key, a.value);
  }
  if (owner === 'flow' && attrs.get(ownerKey) !== ownerVersion) return null;
  const variant = numericId(line.variant?.id, 'ProductVariant');
  if (!variant || attrs.get('_msh_intent_variant_id') !== variant ||
      attrs.get('_msh_intent_quantity') !== String(line.quantity)) return null;
  const bundle = attrs.get('_msh_intent_is_bundle');
  const hasFee = attrs.get('_msh_intent_has_fee');
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
  if (owner === 'flow' && bundle === 'true') {
    if (line.quantity !== 1 || attrs.get('_msh_intent_product_title') !== line.title) return null;
    return verifiedKitHandover(line.customAttributes, line.title);
  }
  if (owner === 'flow' && (hasFee !== 'false' || isLegacySpecialty(line.customAttributes))) return null;
  const kit = flatBundleHandover(line.customAttributes);
  if ((bundle === 'true') !== (kit !== null) || kit === 'invalid') return null;
  if (kit !== null) {
    if (mode === 'split') return kit === 'take' ? 'take' : 'owe';
    if (take === 'true' && kit !== 'take') return null;
  }
  return take === 'true' ? 'take' : 'owe';
}

function planHandover(order, owner) {
  if (!numericId(order?.id, 'Order') || order.sourceName !== 'pos' || order.displayFinancialStatus !== 'PAID') {
    return stop('Requires a fully paid Shopify POS order.');
  }
  if (order.cancelledAt !== null || order.edited !== false || order.returnStatus !== 'NO_RETURN' ||
      !Array.isArray(order.refunds) || order.refunds.length) return stop('Order has an edit, cancellation, return or refund.');
  const locationId = order.retailLocation?.id;
  if (!numericId(locationId, 'Location') || !Array.isArray(order.lineItems) || !Array.isArray(order.fulfillmentOrders)) {
    return stop('Order lines or retail location unavailable.');
  }

  const pilotCart = owner === 'legacy' && (order.customAttributes?.some(a => a.key === '_msh_handover_pilot_seen') ||
    order.lineItems.some(line => hasHandoverOwner(line?.customAttributes)));
  let total = 0;
  const quantities = new Map();
  const take = new Set();
  for (const line of order.lineItems) {
    if (!numericId(line?.id, 'LineItem') || quantities.has(line.id) || !Number.isSafeInteger(line.quantity) ||
        line.quantity <= 0 || line.quantity !== line.currentQuantity ||
        !Number.isSafeInteger(line.unfulfilledQuantity) || line.unfulfilledQuantity < 0 ||
        line.unfulfilledQuantity > line.quantity || !Array.isArray(line.customAttributes)) return stop('Incomplete order line.');
    total += line.quantity;
    quantities.set(line.id, line.unfulfilledQuantity);
    const reserved = hasHandoverOwner(line.customAttributes);
    if ((owner === 'flow') !== reserved || (pilotCart && !isLegacySpecialty(line.customAttributes))) continue;
    const choice = readChoice(line, owner);
    if (reserved && !choice) return stop('Pilot line instructions need review.');
    if (choice === 'take' && line.unfulfilledQuantity > 0) take.add(line.id);
  }
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

export default function main(input) {
  return planHandover(input?.order || input?.fulfillmentOrder?.order, 'flow');
}

// The recovery endpoint uses the same exact-line planner, restricted to old unreserved rows.
export function planLegacyReconciliation(order) {
  if (order?.lineItems?.pageInfo?.hasNextPage !== false || order?.fulfillmentOrders?.pageInfo?.hasNextPage !== false ||
      !Array.isArray(order.lineItems.nodes) || !Array.isArray(order.fulfillmentOrders.nodes) ||
      order.fulfillmentOrders.nodes.some(fo => fo?.lineItems?.pageInfo?.hasNextPage !== false || !Array.isArray(fo.lineItems.nodes))) {
    return stop('Incomplete order or routing page.');
  }
  return planHandover({...order, lineItems: order.lineItems.nodes,
    fulfillmentOrders: order.fulfillmentOrders.nodes.map(fo => ({...fo, lineItems: fo.lineItems.nodes}))}, 'legacy');
}
