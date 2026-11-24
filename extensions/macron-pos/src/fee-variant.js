import {nextCatalogueCursor, readCatalogue} from './catalogue.js';

export const feeProductHandle = 'personalisation-fee';
export const feeProductTitle = 'Personalisation fee (system)';

const feePage = `query FeeVariants($handle: String!, $after: String) {
  shop { currencyCode }
  product: productByIdentifier(identifier: {handle: $handle}) {
    id handle title
    variants(first: 100, after: $after) {
      nodes { id title price availableForSale selectedOptions { value } }
      pageInfo { hasNextPage endCursor }
    }
  }
}`;

function pence(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const match = /^(\d+)(?:\.(\d{1,2})0*)?$/.exec(String(value).trim());
  if (!match) return null;
  const amount = Number(match[1]) * 100 + Number((match[2] || '').padEnd(2, '0'));
  return Number.isSafeInteger(amount) ? amount : null;
}

function feeLabel(variant, amount) {
  const fixed = (amount / 100).toFixed(2);
  const title = variant.title?.trim();
  const options = (variant.selectedOptions ?? []).map(option => option.value?.trim()).filter(Boolean);
  if (title === fixed) return {text: title, method: 'exact_title'};
  if (options.includes(fixed)) return {text: fixed, method: 'exact_option'};
  for (const text of [title, ...options]) {
    if (!text) continue;
    const match = /^(?:GBP\s*|£\s*)?(\d+(?:\.\d+)?)(?:\s*GBP)?$/i.exec(text);
    if (match && pence(match[1]) === amount) return {text, method: 'numeric_text'};
  }
  return null;
}

export async function findFeeVariant(feeAmount, read = readCatalogue) {
  const amount = pence(feeAmount);
  if (amount === null || amount <= 0) throw new Error('Invalid personalisation fee in GBP.');
  const cursors = new Set();
  let after = null;
  let productId = null;
  let scanned = 0;
  do {
    const {product, shop} = await read(feePage, {handle:feeProductHandle, after});
    if (shop?.currencyCode !== 'GBP') throw new Error('The fee must be priced in GBP.');
    if (product === null && after === null) return {productId:null, scanned, match:null};
    if (!product?.id || product.handle !== feeProductHandle || product.title !== feeProductTitle ||
        (productId && product.id !== productId)) throw new Error('The system fee product could not be verified.');
    productId = product.id;
    const page = product.variants;
    if (!Array.isArray(page?.nodes)) throw new Error('The fee variant list is incomplete.');
    after = nextCatalogueCursor(page.pageInfo, cursors);
    scanned += page.nodes.length;
    for (const variant of page.nodes) {
      if (!variant?.id) throw new Error('Shopify returned an incomplete fee variant.');
      const label = feeLabel(variant, amount);
      if (!label) continue;
      if (pence(variant.price) !== amount) throw new Error('The price and label of the personalisation fee do not match.');
      if (variant.availableForSale !== true) throw new Error('matched fee variant is not available for sale');
      return {productId, scanned, match:{id:variant.id, ...label}};
    }
  } while (after);
  return {productId, scanned, match:null};
}
