import {pilotShop} from './handover-config.js';
import {verifiedKitHandover} from '../../../flow/msh-handover/plan.mjs';

export {pilotShop as MSH_PILOT_SHOP};

function shippableMerchandise(shop, product, variant) {
  return shop === pilotShop && product?.isGiftCard === false && variant?.requiresShipping === true &&
    !/gift\s*card|personali[sz]ation[ -]fee|persofee/i.test([product.title, variant.sku].join(' '));
}

export function isNativeHandoverProduct(shop, product, variant, bundle, fee, properties) {
  if (bundle || fee || !shippableMerchandise(shop, product, variant)) return false;
  if (product.bundleMeta?.isBundle || product.personalisationMeta?.enablePersonalisation ||
      product.personalisationMeta?.extraField1Enabled || product.personalisationMeta?.extraField2Enabled ||
      product.personalisationMeta?.enableFileUpload) return false;
  return Object.keys(properties).every(key => key === '_msh_source' || key === '_msh_fulfilment_mode' || key === '_msh_take_now');
}

export function isNativeHandoverBundle(shop, product, variant, properties) {
  if (!shippableMerchandise(shop, product, variant) || product.bundleMeta?.isBundle !== true || !properties ||
      ['Fee For Product', '_MSH_PersoFee', '_msh_gc_sale'].some(key => key in properties)) return false;
  const attributes = Object.entries(properties).map(([key, value]) => ({key, value}));
  return verifiedKitHandover(attributes, product.title) !== null;
}
