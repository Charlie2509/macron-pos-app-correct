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

function normalizeStringValue(value) {
  return String(value == null ? "" : value).trim().toLowerCase();
}

function normalizeMode(rawMode) {
  const mode = normalizeStringValue(rawMode);
  if (mode === "take_today" || mode === "order_in" || mode === "split") return mode;
  return "";
}

function normalizeSource(rawSource) {
  return normalizeStringValue(rawSource);
}

function normalizeTakeNow(rawTakeNow) {
  const takeNowValue = normalizeStringValue(rawTakeNow);
  if (takeNowValue === "true") return true;
  if (takeNowValue === "false") return false;
  return null;
}

function shouldFulfillNowForMode(mode, takeNow) {
  if (mode === "take_today") return true;
  if (mode === "order_in") return false;
  if (mode === "split") return takeNow === true;
  return false;
}

function evaluateLineEligibility(attributes = {}) {
  const source = normalizeSource(attributes._msh_source);
  const rawMode = attributes._msh_fulfillment_mode || attributes._msh_fulfilment_mode;
  const mode = normalizeMode(rawMode);
  const rawTakeNow = attributes._msh_take_now;
  const takeNow = normalizeTakeNow(rawTakeNow);
  const feeOrSystem = isFeeOrSystemLine(attributes);
  const eligible = source === "macron_pos" && !feeOrSystem && shouldFulfillNowForMode(mode, takeNow);

  return {
    source,
    rawMode: rawMode == null ? "" : String(rawMode),
    mode,
    rawTakeNow: rawTakeNow == null ? "" : String(rawTakeNow),
    takeNow,
    feeOrSystem,
    eligible,
  };
}

function summarizeAttributes(attributes = {}) {
  return Object.fromEntries(
    Object.entries(attributes).filter(([key]) =>
      [
        "_msh_source",
        "_msh_fulfillment_mode",
        "_msh_fulfilment_mode",
        "_msh_take_now",
        "Fee For Product",
        "Linked Product Variant Id",
        "Linked Fee Variant Id",
      ].includes(key),
    ),
  );
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
      .filter((line) => normalizeSource(line.properties._msh_source) === "macron_pos");

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
    const orderLineByGid = new Map();
    for (const orderLine of order.lineItems?.nodes || []) {
      const gid = String(orderLine?.id || "");
      const legacyId = String(orderLine?.legacyResourceId || "");
      const normalized = {
        ...orderLine,
        attributes: attributeMap(orderLine.customAttributes),
      };
      if (gid) {
        orderLineByGid.set(gid, normalized);
      }
      if (!legacyId) continue;
      orderLineByLegacyId.set(legacyId, normalized);
    }

    const lineDecisions = [];
    for (const orderLine of order.lineItems?.nodes || []) {
      const attributes = attributeMap(orderLine.customAttributes);
      const { source, rawMode, mode, rawTakeNow, takeNow, eligible, feeOrSystem } = evaluateLineEligibility(attributes);
      const orderLineGid = String(orderLine?.id || "");
      const orderLineLegacyId = String(orderLine?.legacyResourceId || "");
      lineDecisions.push({
        orderLineGid,
        orderLineLegacyId,
        title: orderLine?.title || "",
        rawMode,
        parsedMode: mode,
        rawTakeNow,
        parsedTakeNow: takeNow,
        feeOrSystem,
        eligible,
        attributes: summarizeAttributes(attributes),
      });
      console.log(
        `[orders/create] Decision for order ${order.id} (${order.name || "unknown"}) line "${orderLine.title}": source=${source || "missing"} mode=${mode || "missing"} take_now=${
          takeNow === null ? "missing" : String(takeNow)
        } fee_or_system=${String(feeOrSystem)} => ${eligible ? "FULFILL" : "SKIP"}`,
      );
    }

    const hasSplitLines = lineDecisions.some((line) => normalizeMode(line.rawMode) === "split");
    if (hasSplitLines) {
      console.log(
        `[orders/create][split-debug] Order ${order.id} (${order.name || "unknown"}) line decisions: ${JSON.stringify(lineDecisions)}`,
      );
    }

    if (!lineDecisions.some((line) => line.eligible)) {
      console.log(`[orders/create] No lines eligible for immediate fulfillment for order ${order.id}`);
      return new Response();
    }

    const lineItemsByFulfillmentOrder = [];
    for (const fulfillmentOrder of order.fulfillmentOrders?.nodes || []) {
      const selectedLineItems = [];
      const splitDebugFoLines = [];

      for (const foLineItem of fulfillmentOrder.lineItems?.nodes || []) {
        const linkedOrderLine = foLineItem.lineItem || {};
        const orderLineGid = String(linkedOrderLine.id || "");
        const legacyId = String(linkedOrderLine.legacyResourceId || "");
        const orderLine = (orderLineGid && orderLineByGid.get(orderLineGid)) || (legacyId && orderLineByLegacyId.get(legacyId));
        const linkedOrderLineAttributes = attributeMap(linkedOrderLine.customAttributes);
        const fallbackAttributes = orderLine?.attributes || {};
        const selection = evaluateLineEligibility({
          ...fallbackAttributes,
          ...linkedOrderLineAttributes,
        });
        const quantity = Number(foLineItem.remainingQuantity || 0);

        splitDebugFoLines.push({
          fulfillmentOrderId: fulfillmentOrder.id,
          fulfillmentOrderLineId: String(foLineItem.id || ""),
          linkedOrderLineId: orderLineGid,
          linkedOrderLineLegacyId: legacyId,
          linkedOrderLineTitle: linkedOrderLine?.title || "",
          remainingQuantity: quantity,
          parsedMode: selection.mode || "",
          parsedTakeNow: selection.takeNow,
          isFeeLine: selection.feeOrSystem,
          isSelectedByOrderLine: selection.eligible,
          attributes: summarizeAttributes({
            ...fallbackAttributes,
            ...linkedOrderLineAttributes,
          }),
        });

        if (!selection.eligible) continue;
        if (!quantity || quantity < 1) continue;

        selectedLineItems.push({
          id: foLineItem.id,
          quantity,
        });
        console.log(
          `[orders/create] Selected fulfillment-order line for order ${order.id} (${order.name || "unknown"}): "${linkedOrderLine.title}" mode=${
            selection.mode || "missing"
          } take_now=${selection.takeNow === null ? "missing" : String(selection.takeNow)} qty=${quantity} fo=${fulfillmentOrder.id} fo_line=${foLineItem.id}`,
        );
      }

      if (hasSplitLines) {
        console.log(
          `[orders/create][split-debug] Order ${order.id} (${order.name || "unknown"}) FO ${fulfillmentOrder.id} evaluation: ${JSON.stringify(
            splitDebugFoLines,
          )}`,
        );
      }

      if (selectedLineItems.length > 0) {
        lineItemsByFulfillmentOrder.push({
          fulfillmentOrderId: fulfillmentOrder.id,
          fulfillmentOrderLineItems: selectedLineItems,
        });
      }
    }

    if (lineItemsByFulfillmentOrder.length === 0) {
      console.log(
        `[orders/create] No fulfillment-order line items eligible for immediate fulfillment for order ${order.id}. lineDecisions=${JSON.stringify(
          lineDecisions,
        )}`,
      );
      return new Response();
    }

    const fulfillmentInput = {
      notifyCustomer: false,
      lineItemsByFulfillmentOrder,
    };
    console.log(
      `[orders/create] Fulfillment mutation payload for order ${order.id} (${order.name || "unknown"}): ${JSON.stringify(
        fulfillmentInput,
      )}`,
    );

    const mutationResponse = await admin.graphql(FULFILLMENT_CREATE_MUTATION, {
      variables: {
        fulfillment: fulfillmentInput,
      },
    });
    const mutationBody = await mutationResponse.json();
    if (Array.isArray(mutationBody?.errors) && mutationBody.errors.length > 0) {
      console.log(`[orders/create] fulfillmentCreate GraphQL errors for order ${order.id}: ${JSON.stringify(mutationBody.errors)}`);
      return new Response();
    }
    const result = mutationBody?.data?.fulfillmentCreate;
    if (!result) {
      console.log(`[orders/create] fulfillmentCreate missing result for order ${order.id}: ${JSON.stringify(mutationBody)}`);
      return new Response();
    }
    const userErrors = result?.userErrors || [];

    if (userErrors.length > 0) {
      console.log(`[orders/create] fulfillmentCreate userErrors for order ${order.id}: ${JSON.stringify(userErrors)}`);
      return new Response();
    }

    console.log(
      `[orders/create] fulfillmentCreate success for order ${order.id}: fulfillment_id=${
        result?.fulfillment?.id || "unknown"
      } status=${result?.fulfillment?.status || "unknown"}`,
    );
    return new Response();
  } catch (error) {
    console.log(`[orders/create] webhook handler failed safely: ${error?.message || String(error)}`);
    return new Response();
  }
};
