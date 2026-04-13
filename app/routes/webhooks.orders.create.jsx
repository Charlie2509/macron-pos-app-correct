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

const DEBUG_MARKER = "[MSH-FULFILL-DEBUG]";

function logDebug(stage, details = "") {
  if (details) {
    console.log(`${DEBUG_MARKER} ${stage} | ${details}`);
    return;
  }
  console.log(`${DEBUG_MARKER} ${stage}`);
}

function logDebugError(stage, details = "") {
  if (details) {
    console.log(`${DEBUG_MARKER}[ERROR] ${stage} | ${details}`);
    return;
  }
  console.log(`${DEBUG_MARKER}[ERROR] ${stage}`);
}

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

function parseNumericId(value) {
  if (value == null) return "";
  const raw = String(value).trim();
  if (!raw) return "";
  const match = raw.match(/(\d+)(?:\?.*)?$/);
  return match ? match[1] : "";
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

async function queryOrderWithRetry(admin, orderGid, options = {}) {
  const attempts = Number(options.attempts || 8);
  const baseDelayMs = Number(options.baseDelayMs || 600);

  let lastOrder = null;
  let lastBody = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const response = await admin.graphql(ORDER_WITH_FULFILLMENT_ORDERS_QUERY, {
      variables: { orderId: orderGid },
    });
    const body = await response.json();
    lastBody = body;

    const order = body?.data?.order || null;
    lastOrder = order;

    const foNodes = order?.fulfillmentOrders?.nodes || [];
    const foCount = foNodes.length;
    const foLineCount = foNodes.reduce(
      (sum, fo) => sum + ((fo?.lineItems?.nodes || []).length || 0),
      0,
    );

    logDebug(
      "ORDER FETCH ATTEMPT",
      `attempt=${attempt}/${attempts} order_gid=${orderGid} order_found=${String(Boolean(order))} fulfillment_orders=${foCount} fulfillment_order_lines=${foLineCount}`,
    );

    if (order && foCount > 0 && foLineCount > 0) {
      return { order, attemptsUsed: attempt, exhausted: false, lastBody };
    }

    if (attempt < attempts) {
      const delayMs = baseDelayMs * attempt;
      logDebug("ORDER FETCH RETRY WAIT", `order_gid=${orderGid} delay_ms=${delayMs}`);
      await sleep(delayMs);
    }
  }

  return {
    order: lastOrder,
    attemptsUsed: attempts,
    exhausted: true,
    lastBody,
  };
}

export const action = async ({ request }) => {
  try {
    const { payload, topic, shop, admin } = await authenticate.webhook(request);
    logDebug(
      "WEBHOOK START",
      `topic=${topic} shop=${shop} payload_order_id=${payload?.id || "unknown"}`,
    );

    if (!admin) {
      logDebugError("EARLY EXIT", `reason=admin client unavailable shop=${shop}`);
      logDebug("FINAL RESULT: failed", "reason=admin client unavailable");
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
      logDebugError(
        "EARLY EXIT",
        `reason=no Macron POS marker in payload order_id=${payload?.id || "unknown"}`,
      );
      logDebug("FINAL RESULT: skipped", "reason=no Macron POS marker in payload");
      return new Response();
    }

    const orderGid = toOrderGid(payload);
    logDebug("ORDER GID", `${orderGid || "missing"}`);

    if (!orderGid) {
      logDebugError("EARLY EXIT", `reason=missing order gid payload_keys=${JSON.stringify(Object.keys(payload || {}))}`);
      logDebug("FINAL RESULT: failed", "reason=missing order gid");
      return new Response();
    }

    const orderLookup = await queryOrderWithRetry(admin, orderGid, { attempts: 8, baseDelayMs: 600 });
    const order = orderLookup.order;

    if (!order) {
      logDebugError(
        "ORDER FETCH FAIL",
        `order_gid=${orderGid} attempts=${orderLookup.attemptsUsed} raw_body=${JSON.stringify(orderLookup.lastBody)}`,
      );
      logDebug("FINAL RESULT: failed", "reason=order fetch returned null");
      return new Response();
    }

    logDebug(
      "ORDER FETCH SUCCESS",
      `order_id=${order.id} order_name=${order.name || "unknown"} displayFulfillmentStatus=${
        order.displayFulfillmentStatus || "unknown"
      } retries_used=${orderLookup.attemptsUsed} exhausted=${String(orderLookup.exhausted)}`,
    );

    const foNodes = order.fulfillmentOrders?.nodes || [];
    logDebug("FULFILLMENT ORDER COUNT", `order_id=${order.id} count=${foNodes.length}`);

    const eligibleOrderLineGids = new Set();
    const eligibleOrderLineNumericIds = new Set();
    const eligibleOrderLineLegacyIds = new Set();
    const eligibleOrderLines = [];
    const lineDecisions = [];
    const simplifiedOrderLines = [];

    let takeTodayEligibleCount = 0;
    let splitEligibleCount = 0;
    let orderInCount = 0;
    let feeSystemCount = 0;

    for (const orderLine of order.lineItems?.nodes || []) {
      const attributes = attributeMap(orderLine.customAttributes);
      const { source, rawMode, mode, rawTakeNow, takeNow, eligible, feeOrSystem } = evaluateLineEligibility(attributes);
      const orderLineGid = String(orderLine?.id || "");
      const orderLineLegacyId = String(orderLine?.legacyResourceId || "");
      const orderLineNumericId = parseNumericId(orderLineGid);

      if (feeOrSystem) feeSystemCount += 1;
      if (mode === "order_in") orderInCount += 1;
      if (mode === "take_today" && source === "macron_pos" && !feeOrSystem) takeTodayEligibleCount += 1;
      if (mode === "split" && source === "macron_pos" && !feeOrSystem && takeNow === true) splitEligibleCount += 1;

      const decision = {
        orderLineGid,
        orderLineLegacyId,
        title: orderLine?.title || "",
        quantity: Number(orderLine?.quantity || 0),
        source,
        rawMode,
        parsedMode: mode,
        rawTakeNow,
        parsedTakeNow: takeNow,
        feeOrSystem,
        eligible,
        attributes: summarizeAttributes(attributes),
      };

      lineDecisions.push(decision);
      simplifiedOrderLines.push({
        id: orderLineGid,
        numericId: orderLineNumericId,
        legacyResourceId: orderLineLegacyId,
        title: orderLine?.title || "",
        quantity: Number(orderLine?.quantity || 0),
        attributes: summarizeAttributes(attributes),
        eligibility: {
          source,
          mode,
          takeNow,
          feeOrSystem,
          eligible,
        },
      });

      if (eligible) {
        if (orderLineGid) eligibleOrderLineGids.add(orderLineGid);
        if (orderLineNumericId) eligibleOrderLineNumericIds.add(orderLineNumericId);
        if (orderLineLegacyId) eligibleOrderLineLegacyIds.add(orderLineLegacyId);
        eligibleOrderLines.push({
          orderLineGid,
          orderLineNumericId,
          orderLineLegacyId,
          title: orderLine?.title || "",
          quantity: Number(orderLine?.quantity || 0),
          mode,
          takeNow,
        });
      }
    }

    logDebug(
      "ELIGIBLE ORDER LINE COUNT",
      `order_id=${order.id} eligible_count=${eligibleOrderLines.length} take_today_eligible_count=${takeTodayEligibleCount} split_eligible_count=${splitEligibleCount} order_in_count=${orderInCount} fee_system_count=${feeSystemCount}`,
    );
    logDebug("ORDER LINE DECISIONS JSON", `order_id=${order.id} data=${JSON.stringify(lineDecisions)}`);
    logDebug("SIMPLIFIED ORDER LINES JSON", `order_id=${order.id} data=${JSON.stringify(simplifiedOrderLines)}`);

    if (eligibleOrderLines.length === 0) {
      logDebugError(
        "EARLY EXIT",
        `reason=no eligible order lines order_id=${order.id} decisions=${JSON.stringify(lineDecisions)}`,
      );
      logDebug("FINAL RESULT: skipped", "reason=no eligible order lines");
      return new Response();
    }

    const lineItemsByFulfillmentOrder = [];
    const fulfillmentOrderDecisions = [];
    const simplifiedFulfillmentOrders = [];
    let selectedFoLineCount = 0;

    for (const fulfillmentOrder of foNodes) {
      const selectedLineItems = [];
      const foLineDecisions = [];
      const simplifiedFoLines = [];

      for (const foLineItem of fulfillmentOrder.lineItems?.nodes || []) {
        const linkedOrderLine = foLineItem.lineItem || {};
        const orderLineGid = String(linkedOrderLine.id || "");
        const orderLineNumericId = parseNumericId(orderLineGid);
        const legacyId = String(linkedOrderLine.legacyResourceId || "");
        const foLineId = String(foLineItem.id || "");
        const quantity = Number(foLineItem.remainingQuantity || 0);

        const matchedByGid = Boolean(orderLineGid && eligibleOrderLineGids.has(orderLineGid));
        const matchedByNumericId = Boolean(
          !matchedByGid && orderLineNumericId && eligibleOrderLineNumericIds.has(orderLineNumericId),
        );
        const matchedByLegacyId = Boolean(legacyId && eligibleOrderLineLegacyIds.has(legacyId));
        const matched = matchedByGid || matchedByNumericId || matchedByLegacyId;
        const validFoLineId = foLineId.startsWith("gid://shopify/FulfillmentOrderLineItem/");

        const foDecision = {
          fulfillmentOrderId: fulfillmentOrder.id,
          fulfillmentOrderStatus: fulfillmentOrder.status,
          fulfillmentOrderLineId: foLineId,
          linkedOrderLineId: orderLineGid,
          linkedOrderLineNumericId: orderLineNumericId,
          linkedOrderLineLegacyId: legacyId,
          linkedOrderLineTitle: linkedOrderLine?.title || "",
          remainingQuantity: quantity,
          matchedByGid,
          matchedByNumericId,
          matchedByLegacyId,
          matchedEligibleOrderLine: matched,
          validFulfillmentOrderLineId: validFoLineId,
          selectedForMutation: false,
        };

        if (matched && quantity > 0 && validFoLineId) {
          selectedLineItems.push({
            id: foLineItem.id,
            quantity,
          });
          foDecision.selectedForMutation = true;
          selectedFoLineCount += 1;
        }

        foLineDecisions.push(foDecision);
        simplifiedFoLines.push({
          fulfillmentOrderId: fulfillmentOrder.id,
          fulfillmentOrderLineId: foLineId,
          remainingQuantity: quantity,
          linkedLineItem: {
            id: orderLineGid,
            numericId: orderLineNumericId,
            legacyResourceId: legacyId,
            title: linkedOrderLine?.title || "",
          },
          matchedBy: {
            gid: matchedByGid,
            numericId: matchedByNumericId,
            legacyId: matchedByLegacyId,
          },
          selectedForMutation: foDecision.selectedForMutation,
        });
      }

      simplifiedFulfillmentOrders.push({
        id: fulfillmentOrder.id,
        status: fulfillmentOrder.status,
        lineItems: simplifiedFoLines,
      });

      fulfillmentOrderDecisions.push({
        fulfillmentOrderId: fulfillmentOrder.id,
        status: fulfillmentOrder.status,
        selectedLineCount: selectedLineItems.length,
        lineDecisions: foLineDecisions,
      });

      if (selectedLineItems.length > 0) {
        lineItemsByFulfillmentOrder.push({
          fulfillmentOrderId: fulfillmentOrder.id,
          fulfillmentOrderLineItems: selectedLineItems,
        });
      }
    }

    logDebug("SELECTED FO LINE COUNT", `order_id=${order.id} selected_count=${selectedFoLineCount}`);
    logDebug("FULFILLMENT ORDER DECISIONS JSON", `order_id=${order.id} data=${JSON.stringify(fulfillmentOrderDecisions)}`);
    logDebug("SIMPLIFIED FULFILLMENT ORDERS JSON", `order_id=${order.id} data=${JSON.stringify(simplifiedFulfillmentOrders)}`);

    if (lineItemsByFulfillmentOrder.length === 0) {
      if (takeTodayEligibleCount > 0) {
        logDebugError("take_today had no selected FO lines", `order_id=${order.id}`);
      }
      logDebugError(
        "EARLY EXIT",
        `reason=no selected fulfillment-order lines order_id=${order.id} fulfillment_order_decisions=${JSON.stringify(
          fulfillmentOrderDecisions,
        )}`,
      );
      logDebug("FINAL RESULT: skipped", "reason=no selected fulfillment-order lines");
      return new Response();
    }

    const fulfillmentInput = {
      notifyCustomer: false,
      lineItemsByFulfillmentOrder,
    };

    logDebug("FINAL fulfillmentInput JSON", `order_id=${order.id} payload=${JSON.stringify(fulfillmentInput)}`);

    const mutationResponse = await admin.graphql(FULFILLMENT_CREATE_MUTATION, {
      variables: {
        fulfillment: fulfillmentInput,
      },
    });
    const mutationBody = await mutationResponse.json();

    logDebug("RAW fulfillmentCreate RESPONSE JSON", `order_id=${order.id} body=${JSON.stringify(mutationBody)}`);

    if (Array.isArray(mutationBody?.errors) && mutationBody.errors.length > 0) {
      logDebugError(
        "fulfillmentCreate GraphQL errors",
        `order_id=${order.id} raw_body=${JSON.stringify(mutationBody)}`,
      );
      logDebug("FINAL RESULT: failed", "reason=fulfillmentCreate GraphQL errors");
      return new Response();
    }

    const result = mutationBody?.data?.fulfillmentCreate;
    if (!result) {
      logDebugError(
        "fulfillmentCreate missing data.fulfillmentCreate",
        `order_id=${order.id} raw_body=${JSON.stringify(mutationBody)}`,
      );
      logDebug("FINAL RESULT: failed", "reason=fulfillmentCreate missing data node");
      return new Response();
    }

    const userErrors = Array.isArray(result?.userErrors) ? result.userErrors : [];
    if (userErrors.length > 0) {
      logDebugError(
        "fulfillmentCreate userErrors",
        `order_id=${order.id} raw_body=${JSON.stringify(mutationBody)}`,
      );
      logDebug("FINAL RESULT: failed", "reason=fulfillmentCreate userErrors");
      return new Response();
    }

    logDebug(
      "FINAL RESULT: fulfilled",
      `order_id=${order.id} fulfillment_id=${result?.fulfillment?.id || "unknown"} fulfillment_status=${
        result?.fulfillment?.status || "unknown"
      }`,
    );

    return new Response();
  } catch (error) {
    logDebugError("EARLY EXIT", `reason=exception`);
    logDebugError("WEBHOOK HANDLER EXCEPTION", `${error?.stack || error?.message || String(error)}`);
    logDebug("FINAL RESULT: failed", "reason=exception");
    return new Response();
  }
};
