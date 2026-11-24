import {resolveServiceFee} from '../flow/msh-handover/plan.mjs';

const positiveId = /^[1-9]\d*$/;
const itemField = /^Item (\d+)$/i;
const choiceField = /^Bundle Component (\d+) Fulfill?ment$/i;

function numericId(gid, resource) {
  const prefix = 'gid://shopify/' + resource + '/';
  if (typeof gid !== 'string' || !gid.startsWith(prefix)) return null;
  const id = gid.slice(prefix.length);
  return positiveId.test(id) ? id : null;
}

function isRecord(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function validIndex(value) {
  return positiveId.test(value) && Number.isSafeInteger(Number(value));
}

function present(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export function parseLedger(value) {
  if (value === null) return {version: 1, lines: {}};
  const invalid = 'The saved kit collection record could not be read.';
  if (typeof value !== 'string') throw new Error(invalid);
  let ledger;
  try { ledger = JSON.parse(value); } catch { throw new Error(invalid); }
  if (!isRecord(ledger) || ledger.version !== 1 || !isRecord(ledger.lines) ||
      Object.keys(ledger).some(key => !['version', 'lines'].includes(key))) throw new Error(invalid);
  for (const [id, components] of Object.entries(ledger.lines)) {
    if (!positiveId.test(id) || !isRecord(components)) throw new Error(invalid);
    for (const [index, label] of Object.entries(components)) {
      if (!validIndex(index) || !present(label)) throw new Error(invalid);
    }
  }
  return ledger;
}

function initialStatus(value) {
  switch (typeof value === 'string' ? value.toLowerCase().trim().replace(/ /g, '_') : '') {
    case 'take_now': return 'taken';
    case 'order_later': return 'owed';
    default: return 'unknown';
  }
}

export function readKitLine(line, ledger) {
  const lineId = numericId(line?.id, 'LineItem');
  const collected = lineId && ledger.lines[lineId];
  const fields = Array.isArray(line?.customAttributes) ? line.customAttributes : [];
  const hasKitStamp = fields.some(f => f && (f.key === '_msh_bundle_component_count' ||
    (f.key === '_msh_intent_is_bundle' && f.value === 'true')));
  const hasMshSource = fields.some(f => f?.value === 'macron_pos' &&
    ['_msh_source','_msh_intent_source','_msh_fallback_source'].includes(f.key));
  const hasKitFields = fields.some(f => f && (f.key === 'Bundle' || itemField.test(f.key) || choiceField.test(f.key)));
  if (!collected && !hasKitStamp && !(hasMshSource && hasKitFields)) return null;

  const attrs = new Map();
  const items = new Map();
  const choices = new Map();
  let conflicting = false;
  for (const field of fields) {
    if (!field || typeof field.key !== 'string') { conflicting = true; continue; }
    if (attrs.has(field.key)) conflicting = true;
    attrs.set(field.key, field.value);
    const item = field.key.match(itemField);
    const choice = field.key.match(choiceField);
    if (!item && !choice) continue;
    const index = (item || choice)[1];
    const group = item ? items : choices;
    if (!validIndex(index) || group.has(index)) conflicting = true;
    group.set(index, field.value);
  }

  const evidence = ['_msh_source','_msh_intent_source','_msh_fallback_source']
    .filter(key => attrs.has(key)).map(key => attrs.get(key));
  const indexes = [...new Set([...items.keys(), ...choices.keys()])].sort((a,b) => Number(a) - Number(b));
  const components = indexes.map(index => {
    const label = items.get(index);
    let status = present(label) ? initialStatus(choices.get(index)) : 'unknown';
    if (collected && Object.prototype.hasOwnProperty.call(collected, index)) {
      status = collected[index] === label && status === 'owed' ? 'collected' : 'unknown';
    }
    return {index: Number(index), label: present(label) ? label : 'Unidentified kit item', status};
  });

  // Older kits predate the explicit count. Their printed groups can reveal
  // a missing component even when its numbered label and choice both vanished.
  let missingLegacySummary = false;
  for (const [key, status] of [['Bundle Take Now Summary', 'taken'], ['Bundle Order Later Summary', 'owed']]) {
    const group = indexes.filter(i => initialStatus(choices.get(i)) === status);
    if (!attrs.has(key)) {
      if (group.length && !attrs.has('_msh_bundle_component_count')) missingLegacySummary = true;
      continue;
    }
    const legacy = group.map(i => '- ' + items.get(i)).join('\n');
    const heading = status === 'taken' ? 'Taken today' : 'Owed for collection';
    const numbered = group.map(i => i + '. ' + heading + ' · ' + items.get(i)).join('\n');
    if (attrs.get(key) !== legacy && attrs.get(key) !== numbered) conflicting = true;
  }
  const modes = ['_msh_fulfilment_mode', '_msh_fulfillment_mode', '_msh_intent_fulfilment_mode', '_msh_intent_fulfillment_mode']
    .filter(key => attrs.has(key)).map(key => attrs.get(key));
  if (modes.some(mode => !['take_today','order_in','split'].includes(mode) || mode !== modes[0]) ||
      (modes[0] === 'take_today' && indexes.some(i => initialStatus(choices.get(i)) !== 'taken')) ||
      (modes[0] === 'order_in' && indexes.some(i => initialStatus(choices.get(i)) !== 'owed'))) conflicting = true;

  let problem = '';
  if (!lineId || !present(attrs.get('Bundle')) || !evidence.length || evidence.some(source => source !== 'macron_pos') ||
      (attrs.has('_msh_intent_is_bundle') && attrs.get('_msh_intent_is_bundle') !== 'true')) {
    problem = 'The order line could not be verified as an MSH kit.';
  } else if (line.quantity !== 1 || line.currentQuantity !== 1 ||
      (attrs.has('_msh_intent_quantity') && attrs.get('_msh_intent_quantity') !== '1')) {
    problem = 'This line does not represent one unchanged kit. Check its quantities before recording collection.';
  } else if (conflicting || !components.length || components.some((part, i) => part.index !== i + 1 || part.status === 'unknown') ||
      (attrs.has('_msh_bundle_component_count') && attrs.get('_msh_bundle_component_count') !== String(components.length)) ||
      (collected && Object.keys(collected).some(index => !items.has(index)))) {
    problem = 'The kit component choices are incomplete or conflict with the collection record.';
  } else if (missingLegacySummary) {
    problem = 'This older kit has no complete component count or handover summary. Check the original sale before recording collection.';
  } else if (![0, 1].includes(line.unfulfilledQuantity)) {
    problem = 'Shopify’s remaining kit quantity could not be verified.';
  }
  const complete = !problem && components.every(part => part.status === 'taken' || part.status === 'collected');
  if (!problem && !complete && line.unfulfilledQuantity === 0) {
    problem = 'Shopify shows this kit as fulfilled while its component record still shows items owed.';
  }
  return {components, canRecord: !problem && line.unfulfilledQuantity === 1, problem, complete};
}

export function addCollections(ledger, line, indexes) {
  const kit = readKitLine(line, ledger);
  if (!kit?.canRecord) throw new Error(kit?.problem || 'This kit cannot be updated.');
  if (!Array.isArray(indexes) || !indexes.length) throw new Error('Select an outstanding kit item.');
  const id = numericId(line.id, 'LineItem');
  const changes = {...ledger.lines[id]};
  for (const index of indexes) {
    const component = kit.components.find(part => part.index === index);
    if (!component || !['owed','collected'].includes(component.status)) {
      throw new Error('One of the selected items does not match an outstanding collection.');
    }
    changes[index] = component.label;
  }
  return {version: 1, lines: {...ledger.lines, [id]: changes}};
}

export function safeKitOrder(order) {
  return Boolean(numericId(order?.id, 'Order') && order.sourceName === 'pos' && order.displayFinancialStatus === 'PAID' &&
    order.cancelledAt === null && order.edited === false && order.returnStatus === 'NO_RETURN' &&
    Array.isArray(order.refunds) && !order.refunds.length && numericId(order.retailLocation?.id, 'Location'));
}

function completeConnection(connection) {
  return Array.isArray(connection?.nodes) && connection.pageInfo?.hasNextPage === false;
}

// The caller first saves every actual handover, then calls this planner only
// for a complete kit. A failed native fulfilment can be retried independently.
export function exactKitFulfillment(order, line, lines = [line], ledger = null) {
  if (!safeKitOrder(order) || !completeConnection(order.fulfillmentOrders)) return null;
  const kit = readKitLine(line, ledger || {version: 1, lines: {}});
  if (!kit || kit.problem || (ledger && !kit.complete)) return null;
  const pair = resolveServiceFee(lines, line);
  if (!pair.valid) return null;
  const targets = new Map();
  for (const target of pair.fee ? [line, pair.fee] : [line]) {
    if (!numericId(target.id, 'LineItem') || ![0, 1].includes(target.unfulfilledQuantity) ||
        targets.has(target.id)) return null;
    targets.set(target.id, target.unfulfilledQuantity);
  }

  const groups = [];
  const routeIds = new Set();
  const routeItemIds = new Set();
  for (const route of order.fulfillmentOrders.nodes) {
    if (!numericId(route?.id, 'FulfillmentOrder') || routeIds.has(route.id) || !completeConnection(route.lineItems)) return null;
    routeIds.add(route.id);
    const pending = [];
    for (const item of route.lineItems.nodes) {
      const id = item?.lineItem?.id;
      if (!numericId(id, 'LineItem') || !numericId(item.id, 'FulfillmentOrderLineItem') || routeItemIds.has(item.id) ||
          !Number.isSafeInteger(item.remainingQuantity) || item.remainingQuantity < 0) return null;
      routeItemIds.add(item.id);
      if (!targets.has(id) || !item.remainingQuantity) continue;
      if (targets.get(id) !== 1 || item.remainingQuantity !== 1 ||
          route.assignedLocation?.location?.id !== order.retailLocation.id || route.deliveryMethod?.methodType !== 'RETAIL' ||
          !['OPEN', 'IN_PROGRESS'].includes(route.status) || !Array.isArray(route.supportedActions) ||
          !route.supportedActions.some(action => action?.action === 'CREATE_FULFILLMENT')) return null;
      targets.set(id, 0);
      pending.push({id: item.id, quantity: 1});
    }
    if (pending.length) groups.push({fulfillmentOrderId: route.id, fulfillmentOrderLineItems: pending});
  }
  if (!groups.length || [...targets.values()].some(quantity => quantity !== 0)) return null;
  return {fulfillment: {notifyCustomer: false, lineItemsByFulfillmentOrder: groups}};
}

// Ordinary Order in garments use Shopify's normal partial fulfilment screen.
// Show guidance only where both outstanding lines are verifiably paired.
export function orderedGarmentFees(order, lines) {
  if (!safeKitOrder(order)) return [];
  const pending = [];
  for (const line of lines) {
    const attrs = new Map((line.customAttributes || []).map(field => [field.key, field.value]));
    if (attrs.get('_msh_handover_owner') !== 'flow_v2' || attrs.get('_msh_intent_is_bundle') !== 'false' ||
        attrs.get('_msh_intent_has_fee') !== 'true' || attrs.get('_msh_take_now') !== 'false' ||
        !['order_in', 'split'].includes(attrs.get('_msh_fulfilment_mode')) || line.unfulfilledQuantity !== 1) continue;
    const pair = resolveServiceFee(lines, line);
    if (pair.valid && pair.fee?.unfulfilledQuantity === 1) pending.push({line, fee: pair.fee, link: attrs.get('_msh_handover_pair')});
  }
  return pending;
}
