import {validHandoverPair} from './flow-pilot.js';

// The native cart sometimes publishes its change after the API call returns.
export async function confirmCartState(signal, predicate, timeout = 1500) {
  if (predicate(signal?.value)) return true;
  if (typeof signal?.subscribe !== 'function') return false;
  let timer, unsubscribe;
  try {
    return await new Promise(resolve => {
      timer = setTimeout(() => resolve(predicate(signal.value)), timeout);
      unsubscribe = signal.subscribe(state => {
        if (predicate(state)) resolve(true);
      });
      if (predicate(signal.value)) resolve(true);
    });
  } finally {
    clearTimeout(timer);
    if (typeof unsubscribe === 'function') unsubscribe();
  }
}

function propertiesOf(line) {
  const props = line?.properties ?? line?.customAttributes;
  if (!Array.isArray(props)) return props ?? {};
  return Object.fromEntries(props.filter(Boolean).map(row => [row.key ?? row.name, row.value]));
}

function cartLine(state, uuid) {
  return state?.lineItems?.find(item => item.uuid === uuid);
}

function matchesLine(state, receipt) {
  const line = cartLine(state, receipt.uuid);
  if (Number(line?.variantId) !== receipt.variantId || line.quantity !== 1) return false;
  const saved = propertiesOf(line);
  return Object.entries(receipt.properties).every(([key, value]) => saved[key] === value);
}

export async function addHandoverToCart(cart, {variantId, properties, fee}) {
  if (['addLineItem','addLineItemProperties','addCartProperties','removeLineItem'].some(key => typeof cart?.[key] !== 'function')) {
    throw new Error('Shopify POS cart is unavailable. Reopen the till and try again.');
  }
  const signal = cart.current;
  const original = signal?.value?.lineItems;
  if (!Array.isArray(original) || original.some(row => !row?.uuid)) throw new Error('Wait for the POS cart to finish updating.');
  if (fee && fee.variantId === variantId) throw new Error('The product and fee must have different variants.');
  const idsBefore = new Set(original.map(row => row.uuid));
  for (const row of original) {
    const saved = propertiesOf(row);
    if (Number(row.variantId) === variantId &&
        (saved._msh_source !== 'macron_pos' || !['take_today', 'order_in', 'split'].includes(saved._msh_fulfilment_mode))) {
      throw new Error('This size is already in the cart without a handover choice. Review it before adding another.');
    }
    if (Number(row.variantId) === fee?.variantId && !saved['Fee For Product']) {
      throw new Error('There is an unlinked personalisation fee in the cart. Review it before adding another.');
    }
  }

  const added = [];
  async function newLine(id) {
    let uuid;
    try { uuid = await cart.addLineItem(id, 1); }
    catch { throw new Error('Shopify did not confirm the add. Check the cart before retrying.'); }
    if (!uuid || idsBefore.has(uuid) || added.some(line => line.uuid === uuid)) {
      throw new Error('Shopify may have changed an existing quantity. Check the cart before paying or adding again.');
    }
    const confirmed = await confirmCartState(signal, state => {
      const line = cartLine(state, uuid);
      return Number(line?.variantId) === id && line.quantity === 1;
    });
    if (!confirmed) throw new Error('Shopify returned an unexpected cart line. Check the cart before paying or retrying.');
    const receipt = {uuid, variantId: id, properties: {}};
    added.push(receipt);
    return receipt;
  }

  async function attach(receipt, props) {
    receipt.properties = props;
    try { await cart.addLineItemProperties(receipt.uuid, props); }
    catch { /* A response can be lost after Shopify has saved the properties. Read them back. */ }
    if (!await confirmCartState(signal, state => matchesLine(state, receipt))) {
      throw new Error('Shopify could not verify the handover details. Check the POS cart before retrying.');
    }
  }

  try {
    const main = await newLine(variantId);
    const owner = properties._msh_handover_owner;
    if (fee && !validHandoverPair(main.uuid)) throw new Error('Shopify could not identify the garment and its fee as a pair.');
    const linked = fee ? {
      _msh_handover_pair: main.uuid, 'Linked Fee Variant Id': String(fee.variantId), 'Personalisation Fee': fee.label,
    } : {};
    await attach(main, {...properties, ...linked});

    if (fee) {
      const feeLine = await newLine(fee.variantId);
      await attach(feeLine, {
        _msh_source: 'macron_pos', _msh_handover_role: 'service_fee', _msh_handover_owner: owner,
        _msh_handover_pair: main.uuid, 'Linked Product Variant Id': String(variantId),
        'Fee For Product': properties._msh_intent_product_title, 'Personalisation Fee': fee.label,
      });
    }
    // Older installed handover services recognise this cart flag while stores move to Flow.
    // Never replace staff notes or assign a whole-cart Take today choice.
    const marked = state => state?.properties?._msh_handover_pilot_seen === owner;
    if (!marked(signal.value)) {
      try { await cart.addCartProperties({_msh_handover_pilot_seen: owner}); }
      catch { /* Re-read before deciding whether to unwind. */ }
    }
    if (!await confirmCartState(signal, state => marked(state) && added.every(receipt => matchesLine(state, receipt)))) {
      throw new Error('Shopify could not verify the final cart. Check it before retrying.');
    }
    return {mainUuid: main.uuid, feeUuid: added[1]?.uuid ?? null, properties: main.properties};
  } catch (error) {
    let incomplete = false;
    for (const receipt of added.reverse()) {
      const line = cartLine(signal.value, receipt.uuid);
      if (!line) continue;
      if (line.quantity !== 1 || Number(line.variantId) !== receipt.variantId) {
        incomplete = true;
        continue;
      }
      try { await cart.removeLineItem(receipt.uuid); }
      catch { /* Verify removal, including a lost response. */ }
      if (!await confirmCartState(signal, state => Array.isArray(state?.lineItems) && !cartLine(state, receipt.uuid))) incomplete = true;
    }
    if (incomplete) throw new Error('A cart line could not be undone. Open the POS cart and check the quantity and fee before paying or retrying.');
    throw error;
  }
}
