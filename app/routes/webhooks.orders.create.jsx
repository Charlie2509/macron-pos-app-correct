import { authenticate } from "../shopify.server";

const ORDER_WITH_FULFILLMENT_ORDERS_QUERY = `#graphql
  query MacronOrderForFulfillment($orderId: ID!) {
    order(id: $orderId) {
      id
      name
      displayFulfillmentStatus
      lineItems(first: 250) {
        nodes {
          id
          legacyResourceId
          title
          quantity
          customAttributes {
            key
            value
          }
        }
      }
      fulfillmentOrders(first: 25) {
        nodes {
          id
          status
          lineItems(first: 250) {
            nodes {
              id
              remainingQuantity
              totalQuantity
              lineItem {
                id
                legacyResourceId
                title
                customAttributes {
                  key
                  value
                }
              }
            }
          }
        }
      }
    }
  }
`;

const FULFILLMENT_CREATE_MUTATION = `#graphql
  mutation MacronFulfillmentCreate($fulfillment: FulfillmentInput!) {
    fulfillmentCreate(fulfillment: $fulfillment) {
      fulfillment {
        id
        status
      }
      userErrors {
        field
        message
      }
    }
  }
`;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function attributeMap(customAttributes) {
  const attributes = {};
  for (const attr of customAttributes || []) {
    if (!attr || typeof attr.key !== "string") continue;
    attributes[attr.key] = attr.value == null ? "" : String(attr.value);
  }
  return attributes;
}

function isFeeOrSystemLine(attributes) {
  return Boolean(
    attributes["Fee For Product"] ||
      attributes["Linked Product Variant Id"] ||
      attributes["Linked Fee Variant Id"],
  );
}

function normalizeTakeNow(rawTakeNow, mode) {
  const takeNowValue = String(rawTakeNow || "").toLowerCase();
  if (mode === "take_today") return true;
  if (mode === "order_in") return false;
  return takeNowValue === "true" || takeNowValue === "1" || takeNowValue === "yes";
}

function shouldFulfillNowForMode(mode, takeNow) {
  if (mode === "take_today") return true;
  if (mode === "order_in") return false;
  if (mode === "split") return takeNow;
  return false;
}

function toOrderGid(payload) {
  if (payload && typeof payload.admin_graphql_api_id === "string" && payload.admin_graphql_api_id.length > 0) {
    return payload.admin_graphql_api_id;
  }
  if (payload && payload.id) {
    return `gid://shopify/Order/${payload.id}`;
  }
  return null;
}

async function queryOrderWithRetry(admin, orderGid, attempts = 4) {
  let lastOrder = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const response = await admin.graphql(ORDER_WITH_FULFILLMENT_ORDERS_QUERY, {
      variables: { orderId: orderGid },
    });
    const body = await response.json();
    const order = body?.data?.order || null;
    lastOrder = order;

    if (order && Array.isArray(order.fulfillmentOrders?.nodes) && order.fulfillmentOrders.nodes.length > 0) {
      return order;
    }

    if (attempt < attempts) {
      await sleep(500 * attempt);
    }
  }

  return lastOrder;
}

export const action = async ({ request }) => {
  try {
    const { payload, topic, shop, admin } = await authenticate.webhook(request);
    console.log(`[orders/create] Received ${topic} webhook for ${shop}`);

    if (!admin) {
      console.log(`[orders/create] Ignored for ${shop}: admin client unavailable for webhook context`);
      return new Response();
    }

    const payloadLineItems = Array.isArray(payload?.line_items) ? payload.line_items : [];
    const markedPayloadLines = payloadLineItems
      .map((line) => {
        const properties = {};
        for (const property of line?.properties || []) {
          if (!property || typeof property.name !== "string") continue;
          properties[property.name] = property.value == null ? "" : String(property.value);
        }
        return {
          id: line?.id,
          properties,
        };
      })
      .filter((line) => line.properties._msh_source === "macron_pos");

    if (markedPayloadLines.length === 0) {
      console.log(`[orders/create] Ignored ${shop} order ${payload?.id || "unknown"}: no Macron POS marker found`);
      return new Response();
    }

    const orderGid = toOrderGid(payload);
    if (!orderGid) {
      console.log(`[orders/create] Ignored ${shop}: missing order id in payload`);
      return new Response();
    }

    const order = await queryOrderWithRetry(admin, orderGid);
    if (!order) {
      console.log(`[orders/create] Could not load order ${orderGid} for ${shop}`);
      return new Response();
    }

    const orderLineByLegacyId = new Map();
    for (const orderLine of order.lineItems?.nodes || []) {
      const legacyId = String(orderLine?.legacyResourceId || "");
      if (!legacyId) continue;
      orderLineByLegacyId.set(legacyId, {
        ...orderLine,
        attributes: attributeMap(orderLine.customAttributes),
      });
    }

    const linesToFulfillNow = new Set();
    for (const orderLine of order.lineItems?.nodes || []) {
      const attributes = attributeMap(orderLine.customAttributes);
      if (attributes._msh_source !== "macron_pos") continue;
      if (isFeeOrSystemLine(attributes)) continue;

      const mode = attributes._msh_fulfilment_mode;
      const takeNow = normalizeTakeNow(attributes._msh_take_now, mode);
      if (shouldFulfillNowForMode(mode, takeNow)) {
        linesToFulfillNow.add(String(orderLine.legacyResourceId));
      }
    }

    if (linesToFulfillNow.size === 0) {
      console.log(`[orders/create] No lines eligible for immediate fulfillment for order ${order.id}`);
      return new Response();
    }

    const lineItemsByFulfillmentOrder = [];
    for (const fulfillmentOrder of order.fulfillmentOrders?.nodes || []) {
      const selectedLineItems = [];

      for (const foLineItem of fulfillmentOrder.lineItems?.nodes || []) {
        const linkedOrderLine = foLineItem.lineItem || {};
        const legacyId = String(linkedOrderLine.legacyResourceId || "");
        if (!legacyId || !linesToFulfillNow.has(legacyId)) continue;

        const orderLine = orderLineByLegacyId.get(legacyId);
        if (!orderLine || isFeeOrSystemLine(orderLine.attributes || {})) continue;

        const quantity = Number(foLineItem.remainingQuantity || 0);
        if (!quantity || quantity < 1) continue;

        selectedLineItems.push({
          id: foLineItem.id,
          quantity,
        });
      }

      if (selectedLineItems.length > 0) {
        lineItemsByFulfillmentOrder.push({
          fulfillmentOrderId: fulfillmentOrder.id,
          fulfillmentOrderLineItems: selectedLineItems,
        });
      }
    }

    if (lineItemsByFulfillmentOrder.length === 0) {
      console.log(`[orders/create] No fulfillment-order line items eligible for immediate fulfillment for order ${order.id}`);
      return new Response();
    }

    const mutationResponse = await admin.graphql(FULFILLMENT_CREATE_MUTATION, {
      variables: {
        fulfillment: {
          notifyCustomer: false,
          lineItemsByFulfillmentOrder,
        },
      },
    });
    const mutationBody = await mutationResponse.json();
    const result = mutationBody?.data?.fulfillmentCreate;
    const userErrors = result?.userErrors || [];

    if (userErrors.length > 0) {
      console.log(`[orders/create] fulfillmentCreate userErrors for order ${order.id}: ${JSON.stringify(userErrors)}`);
      return new Response();
    }

    console.log(
      `[orders/create] fulfillmentCreate success for order ${order.id}: ${result?.fulfillment?.id || "unknown"}`,
    );
    return new Response();
  } catch (error) {
    console.log(`[orders/create] webhook handler failed safely: ${error?.message || String(error)}`);
    return new Response();
  }
};
