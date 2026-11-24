import {addCollections, exactKitFulfillment, parseLedger, readKitLine, safeKitOrder} from '../../../app/kit-collections.js';
import {resolveServiceFee} from '../../../flow/msh-handover/plan.mjs';
import {pilotShop} from './handover-config.js';

const snapshotQuery = `query MshKitOrder($id: ID!, $after: String) {
  shop { myshopifyDomain }
  order(id: $id) {
    id sourceName displayFinancialStatus cancelledAt edited returnStatus refunds { id } retailLocation { id }
    ledger: metafield(namespace: "macron_pos", key: "kit_collections_v1") { type value compareDigest }
    lineItems(first: 60, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes { id title name sku quantity currentQuantity unfulfilledQuantity isGiftCard requiresShipping
        variant { id } lineItemGroup { id } customAttributes { key value } }
    }
  }
}`;
const routesQuery = `query MshKitRoutes($id: ID!) {
  order(id: $id) {
    id sourceName displayFinancialStatus cancelledAt edited returnStatus refunds { id } retailLocation { id }
    fulfillmentOrders(first: 5) {
      pageInfo { hasNextPage }
      nodes { id status deliveryMethod { methodType } supportedActions { action } assignedLocation { location { id } }
        lineItems(first: 80) { pageInfo { hasNextPage } nodes { id remainingQuantity lineItem { id } } }
      }
    }
  }
}`;
const saveQuery = `mutation MshKitCollection($inputs: [MetafieldsSetInput!]!) {
  metafieldsSet(metafields: $inputs) { metafields { compareDigest } userErrors { message } }
}`;
const finishQuery = `mutation MshFinishKit($fulfillment: FulfillmentInput!) {
  fulfillmentCreate(fulfillment: $fulfillment) { fulfillment { id } userErrors { message } }
}`;

async function request(query, document, variables) {
  const response = await query(document, {variables});
  if (!response?.data || response.errors?.length) throw new Error('Shopify could not read or update this order. Check access and refresh.');
  return response.data;
}

export async function loadKitOrder(query, id) {
  if (!/^gid:\/\/shopify\/Order\/[1-9]\d*$/.test(id)) throw new Error('Open an MSH order to see its kits.');
  const lines = [];
  const cursors = new Set();
  let after = null;
  let order;
  do {
    const data = await request(query, snapshotQuery, {id, after});
    order = data.order;
    if (data.shop?.myshopifyDomain !== pilotShop || order?.id !== id) throw new Error('This MSH order is unavailable.');
    const page = order.lineItems;
    if (!Array.isArray(page?.nodes) || typeof page.pageInfo?.hasNextPage !== 'boolean') throw new Error('The kit line list could not be read.');
    lines.push(...page.nodes);
    if (!page.pageInfo.hasNextPage) break;
    after = page.pageInfo.endCursor;
    if (!after || cursors.has(after)) throw new Error('The kit line list is incomplete.');
    cursors.add(after);
  } while (after);
  if (new Set(lines.map(line => line.id)).size !== lines.length) throw new Error('Order lines changed while loading. Refresh to continue.');
  if (order.ledger !== null && (order.ledger?.type !== 'json' || !order.ledger.compareDigest)) throw new Error('The kit collection record could not be verified.');
  return {order, lines, ledger: parseLedger(order.ledger?.value ?? null), digest: order.ledger?.compareDigest ?? null};
}

export async function recordKitPieces(query, id, lineId, indexes, displayedDigest, displayedComponents) {
  const current = await loadKitOrder(query, id);
  const line = current.lines.find(row => row.id === lineId);
  const kit = line && readKitLine(line, current.ledger);
  if (!safeKitOrder(current.order) || !kit?.canRecord) throw new Error('This kit needs an order review before recording a collection.');
  if (displayedDigest !== current.digest || indexes.some(idx => {
    const piece = kit.components.find(item => item.index === idx);
    return !piece || piece.status !== 'owed' || piece.label !== displayedComponents.find(item => item.index === idx)?.label;
  })) throw new Error('The collection record changed. Refresh and check the remaining pieces.');
  const ledger = addCollections(current.ledger, line, indexes);
  const data = await request(query, saveQuery, {inputs: [{
    ownerId: id, namespace: 'macron_pos', key: 'kit_collections_v1', type: 'json',
    compareDigest: current.digest, value: JSON.stringify(ledger),
  }]});
  const saved = data.metafieldsSet;
  if (!saved?.metafields?.[0]?.compareDigest || saved.userErrors?.length) throw new Error('Refresh the order to check whether this collection was saved before trying again.');
  return readKitLine(line, ledger).complete;
}

export async function finishCollectedKit(query, id, lineId) {
  const current = await loadKitOrder(query, id);
  const line = current.lines.find(item => item.id === lineId);
  const kit = line && readKitLine(line, current.ledger);
  if (!safeKitOrder(current.order) || !kit?.complete || !kit.components.some(item => item.status === 'collected')) {
    throw new Error('The component record is not ready to complete this kit.');
  }
  const pair = resolveServiceFee(current.lines, line);
  if (!pair.valid) throw new Error('Collection saved. Check the kit and its personalisation fee in Shopify before completing fulfilment.');
  if (line.unfulfilledQuantity === 0 && !pair.fee?.unfulfilledQuantity) return;
  const data = await request(query, routesQuery, {id});
  const variables = data.order?.id === id && exactKitFulfillment(data.order, line, current.lines, current.ledger);
  if (!variables) throw new Error('Collection saved. Shopify fulfilment is pending. Check this kit’s location and remaining quantity.');
  const result = (await request(query, finishQuery, variables)).fulfillmentCreate;
  if (result?.userErrors?.length || !result?.fulfillment?.id) throw new Error('Collection saved. Refresh to check Shopify fulfilment before retrying.');
}
