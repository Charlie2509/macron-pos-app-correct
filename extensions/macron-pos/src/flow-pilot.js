import {pilotShop} from './handover-config.js';
import {verifiedKitHandover} from '../../../flow/msh-handover/plan.mjs';

export {pilotShop as MSH_PILOT_SHOP};
export {NATIVE_HANDOVER_OWNER, validHandoverPair} from '../../../flow/msh-handover/plan.mjs';

function shippableMerchandise(shop, product, variant) {
  return shop === pilotShop && product?.isGiftCard === false && variant?.requiresShipping === true &&
    !/gift\s*card|personali[sz]ation[ -]fee|persofee/i.test([product.title, variant.sku].join(' '));
}

export function isNativeHandoverProduct(shop, product, variant, bundle, fee, properties) {
  if (bundle || !shippableMerchandise(shop, product, variant) || product.bundleMeta?.isBundle ||
      !properties || properties._msh_source !== 'macron_pos') return false;
  const mode = properties._msh_fulfilment_mode;
  const take = properties._msh_take_now;
  if (!['take_today','order_in','split'].includes(mode) || !['true','false'].includes(take) ||
      (mode !== 'split' && (mode === 'take_today') !== (take === 'true'))) return false;
  const feeAmount = properties['Personalisation Fee'];
  if (fee ? !/^£(?:0|[1-9]\d*)\.\d{2}$/.test(feeAmount) || feeAmount === '£0.00' : feeAmount !== undefined) return false;
  return Object.keys(properties).every(key =>
    ['_msh_source', '_msh_fulfilment_mode', '_msh_take_now'].includes(key) ||
    !/^(?:_msh_|Item \d+$|Bundle(?: |$)|Fee For Product$|Linked (?:Fee|Product) Variant Id$)/i.test(key));
}

export function isNativeHandoverBundle(shop, product, variant, properties) {
  if (!shippableMerchandise(shop, product, variant) || product.bundleMeta?.isBundle !== true || !properties ||
      ['Fee For Product', '_MSH_PersoFee', '_msh_gc_sale'].some(key => key in properties)) return false;
  const attributes = Object.entries(properties).map(([key, value]) => ({key, value}));
  return verifiedKitHandover(attributes, product.title) !== null;
}
