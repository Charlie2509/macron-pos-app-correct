import db from "../db.server";
import { unauthenticated } from "../shopify.server";

// Reconciler — safety-net sweeper for Macron POS take_today orders.
//
// Why this exists:
//   The orders/create webhook is the primary fulfilment path. But a transient
//   failure (webhook timeout, race between intent DB commit and webhook fire,
//   transient fulfillmentCreate error) will leave a take_today order
//   UNFULFILLED with no automatic retry. Before this reconciler the only way
//   to catch those was for staff to spot them by accident days later.
//
// What it does:
//   1. Lists POS-source unfulfilled orders from the last RECONCILE_LOOKBACK_MS.
//   2. For each order, checks the SAME positive signals the webhook checks:
//        a. _msh_source=macron_pos on any line item / order custom attribute
//        b. _msh_fallback_source=macron_pos
//        c. _msh_order_source=macron_pos
//        d. A pending intent in the DB with a fingerprint match
//   3. If any positive signal is present, calls fulfillmentCreate on every
//      open fulfillment order — same mutation the webhook uses.
//   4. Marks the matched intent (if any) as consumed.
//
// What it deliberately does NOT do:
//   - It will NOT auto-fulfil an order purely because source_name=pos. That
//     would wrongly fulfil order_in / split orders. A positive Macron POS
//     marker or fingerprint match is required.
//
// Auth: shared secret in MACRON_POS_RECONCILE_TOKEN env var. The route accepts
//   POST or GET (for easy curl). Requests without the token return 401.
//
// Designed to be hit on a 10-minute cron (Cowork scheduled task or any cron
// service). Idempotent: re-fulfilling an already-fulfilled order is a no-op
// because the order's open fulfillment orders will be empty.

const DEBUG_MARKER = "[MSH-RECONCILE]";
const RECONCILE_LOOKBACK_MS = 1000 * 60 * 60 * 6; // 6 hours of orders
const PENDING_INTENT_MATCH_WINDOW_MS = 1000 * 60 * 60; // 60 min — matches webhook
const MAX_ORDERS_PER_RUN = 50;

const ORDER_LIST_QUERY = `#graphql
  query MacronReconcileOrders($query: String!, $first: Int!) {
    orders(query: $query, first: $first, sortKey: CREATED_AT, reverse: true) {
      nodes {
        id
        name
        sourceName
        createdAt
        processedAt
        updatedAt
        note
        displayFulfillmentStatus
        tags
        customAttributes {
          key
          value
        }
        lineItems(first: 250) {
          nodes {
            id
            name
            title
            variantTitle
            sku
            quantity
            variant { id title }
            customAttributes { key value }
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
                lineItem { id title }
              }
            }
          }
        }
      }
    }
  }
`;

const FULFILLMENT_CREATE_MUTATION = `#graphql
  mutation MacronReconcileFulfillmentCreate($fulfillment: FulfillmentInput!) {
    fulfillmentCreate(fulfillment: $fulfillment) {
      fulfillment { id status }
      userErrors { field message }
    }
  }
`;

function logInfo(stage, details = "") {
  if (details) console.log(`${DEBUG_MARKER} ${stage} | ${details}`);
  else console.log(`${DEBUG_MARKER} ${stage}`);
}
function logError(stage, details = "") {
  if (details) console.error(`${DEBUG_MARKER}[ERROR] ${stage} | ${details}`);
  else console.error(`${DEBUG_MARKER}[ERROR] ${stage}`);
}

function normalizeStringValue(value) {
  return String(value == null ? "" : value).trim();
}
function normalizeLowerString(value) {
  return normalizeStringValue(value).toLowerCase();
}
function normalizeComparableText(value) {
  return normalizeLowerString(value).replace(/\s+/g, " ");
}
function normalizeVariantIdValue(value) {
  const raw = normalizeStringValue(value);
  if (!raw) return "";
  const m = raw.match(/(\d+)(?:\?.*)?$/);
  return m ? m[1] : raw;
}
function attributeMap(customAttributes) {
  const map = {};
  for (const attr of customAttributes || []) {
    if (!attr) continue;
    const k = normalizeStringValue(attr.key || attr.name);
    const v = normalizeStringValue(attr.value);
    if (k) map[k] = v;
  }
  return map;
}

function hasMacronPosMarker(order) {
  // 1. Order-level customAttributes
  const orderAttrs = attributeMap(order?.customAttributes);
  if (normalizeLowerString(orderAttrs._msh_source) === "macron_pos") return "order_attr_msh_source";
  if (normalizeLowerString(orderAttrs._msh_order_source) === "macron_pos") return "order_attr_msh_order_source";
  if (normalizeLowerString(orderAttrs._msh_fallback_source) === "macron_pos") return "order_attr_msh_fallback_source";

  // 2. Any line item's customAttributes
  for (const line of order?.lineItems?.nodes || []) {
    const lineAttrs = attributeMap(line?.customAttributes);
    if (normalizeLowerString(lineAttrs._msh_source) === "macron_pos") return "line_attr_msh_source";
    if (normalizeLowerString(lineAttrs._msh_fallback_source) === "macron_pos") return "line_attr_msh_fallback_source";
    if (normalizeLowerString(lineAttrs._msh_intent_source) === "macron_pos") return "line_attr_msh_intent_source";
  }

  // 3. Order note durable token
  const note = normalizeStringValue(order?.note);
  if (note.includes("[MSH_POS]") || note.toLowerCase().includes("[msh_pos]")) return "note_token";

  return "";
}

// Determines fulfilment intent (take_today vs order_in) from the same signals
// the webhook reads. Returns "take_today" | "order_in" | "" (unknown).
function readFulfilmentMode(order) {
  const orderAttrs = attributeMap(order?.customAttributes);
  const orderMode = normalizeLowerString(
    orderAttrs._msh_fulfilment_mode || orderAttrs._msh_fulfillment_mode || orderAttrs._msh_intent_fulfilment_mode,
  );
  if (orderMode === "take_today" || orderMode === "order_in" || orderMode === "split") return orderMode;

  for (const line of order?.lineItems?.nodes || []) {
    const lineAttrs = attributeMap(line?.customAttributes);
    const lineMode = normalizeLowerString(
      lineAttrs._msh_fulfilment_mode ||
        lineAttrs._msh_fulfillment_mode ||
        lineAttrs._msh_intent_fulfilment_mode ||
        lineAttrs._msh_fallback_fulfilment_mode,
    );
    if (lineMode === "take_today" || lineMode === "order_in" || lineMode === "split") return lineMode;
    const lineTakeNow = normalizeLowerString(lineAttrs._msh_take_now || lineAttrs._msh_intent_take_now);
    if (lineTakeNow === "true") return "take_today";
  }
  return "";
}

function getOrderLineSummary(order) {
  return (order?.lineItems?.nodes || [])
    .map((line) => ({
      title: normalizeStringValue(line?.title),
      variantTitle: normalizeStringValue(line?.variantTitle || line?.variant?.title),
      normalizedVariantId: normalizeVariantIdValue(line?.variant?.id),
      quantity: Number(line?.quantity || 0),
    }))
    .filter((l) => l.title && l.quantity > 0);
}

// Fingerprint match against pending intents — same shape as webhook.
async function findMatchingPendingIntent({ shop, order }) {
  const now = new Date();
  const earliest = new Date(now.getTime() - PENDING_INTENT_MATCH_WINDOW_MS);
  const intents = await db.pendingMacronPosIntent.findMany({
    where: {
      shop,
      source: "macron_pos",
      consumedAt: null,
      expiresAt: { gt: now },
      createdAt: { gte: earliest },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  if (intents.length === 0) return null;

  const orderLines = getOrderLineSummary(order);
  for (const intent of intents) {
    const cmpIntentTitle = normalizeComparableText(intent.productTitle);
    const intentQty = Number(intent.quantity || 0);
    const intentVariantId = normalizeVariantIdValue(intent.normalizedVariantId);
    for (const line of orderLines) {
      if (normalizeComparableText(line.title) !== cmpIntentTitle) continue;
      if (intentQty > 0 && intentQty !== line.quantity) continue;
      if (intentVariantId && line.normalizedVariantId && line.normalizedVariantId !== intentVariantId) continue;
      // (Bundle summary fingerprint isn't enforced here — webhook already
      // tries that path. The reconciler is intentionally a slightly looser
      // match because by the time we run, we already know an intent exists
      // and the order looks POS-y.)
      return intent;
    }
  }
  return null;
}

async function fulfilOrder(admin, order) {
  const fulfillmentOrders = (order?.fulfillmentOrders?.nodes || []).filter(
    (fo) => normalizeStringValue(fo?.status).toUpperCase() === "OPEN",
  );
  if (fulfillmentOrders.length === 0) {
    return { ok: true, reason: "no_open_fulfillment_orders", fulfilledCount: 0 };
  }

  const fulfillmentOrderLineItems = [];
  for (const fo of fulfillmentOrders) {
    const lineItems = (fo?.lineItems?.nodes || [])
      .filter((li) => Number(li?.remainingQuantity || 0) > 0)
      .map((li) => ({ id: li.id, quantity: Number(li.remainingQuantity || 0) }));
    if (lineItems.length === 0) continue;
    fulfillmentOrderLineItems.push({ fulfillmentOrderId: fo.id, fulfillmentOrderLineItems: lineItems });
  }
  if (fulfillmentOrderLineItems.length === 0) {
    return { ok: true, reason: "no_remaining_quantities", fulfilledCount: 0 };
  }

  const fulfillment = {
    lineItemsByFulfillmentOrder: fulfillmentOrderLineItems,
    notifyCustomer: false,
  };
  const response = await admin.graphql(FULFILLMENT_CREATE_MUTATION, {
    variables: { fulfillment },
  });
  const body = await response.json();
  const data = body?.data?.fulfillmentCreate;
  const userErrors = data?.userErrors || [];
  if (userErrors.length > 0) {
    return { ok: false, reason: "fulfillmentCreate_userErrors", userErrors };
  }
  return { ok: true, reason: "fulfilled", fulfilledCount: fulfillmentOrderLineItems.length };
}

async function reconcileShop(shop) {
  const adminCtx = await unauthenticated.admin(shop);
  const admin = adminCtx?.admin;
  if (!admin) {
    return { shop, ok: false, error: "no_admin_client", processed: 0, fulfilled: 0, skipped: 0, errors: 0 };
  }

  const lookbackHours = Math.max(1, Math.floor(RECONCILE_LOOKBACK_MS / (1000 * 60 * 60)));
  // Shopify search query language: only fetch orders that are open POS orders
  // with status:open AND fulfillment_status:unfulfilled, created in the
  // lookback window. Unfulfilled gift cards are ignored — they're handled
  // separately and have remainingQuantity=0 after the gift-card webhook runs.
  const searchQuery = `created_at:>-${lookbackHours}h source_name:pos status:open fulfillment_status:unfulfilled`;
  let listResponse;
  try {
    listResponse = await admin.graphql(ORDER_LIST_QUERY, {
      variables: { query: searchQuery, first: MAX_ORDERS_PER_RUN },
    });
  } catch (err) {
    logError("ORDER LIST FAILED", `shop=${shop} error=${err && err.message ? err.message : String(err)}`);
    return { shop, ok: false, error: "order_list_failed", processed: 0, fulfilled: 0, skipped: 0, errors: 0 };
  }
  const listBody = await listResponse.json();
  const orders = listBody?.data?.orders?.nodes || [];
  logInfo("ORDER LIST OK", `shop=${shop} count=${orders.length} query=${searchQuery}`);

  let fulfilledCount = 0;
  let skippedCount = 0;
  let errorCount = 0;
  const details = [];

  for (const order of orders) {
    const orderId = order?.id || "unknown";
    const orderName = order?.name || "unknown";

    if (normalizeStringValue(order?.displayFulfillmentStatus).toUpperCase() === "FULFILLED") {
      skippedCount += 1;
      continue;
    }

    const markerHit = hasMacronPosMarker(order);
    const intent = markerHit ? null : await findMatchingPendingIntent({ shop, order });
    const positiveSignal = markerHit || (intent ? `pending_intent:${intent.id}` : "");

    if (!positiveSignal) {
      skippedCount += 1;
      details.push({ id: orderId, name: orderName, action: "skipped", reason: "no_positive_signal" });
      continue;
    }

    const mode = readFulfilmentMode(order);
    if (mode && mode !== "take_today" && mode !== "split") {
      // Explicitly order_in — must NOT auto-fulfil here.
      skippedCount += 1;
      details.push({ id: orderId, name: orderName, action: "skipped", reason: `mode_is_${mode}`, signal: positiveSignal });
      continue;
    }

    try {
      const result = await fulfilOrder(admin, order);
      if (result.ok && result.reason === "fulfilled") {
        fulfilledCount += 1;
        if (intent) {
          try {
            await db.pendingMacronPosIntent.update({
              where: { id: intent.id },
              data: { consumedAt: new Date(), matchedOrderId: String(orderId) },
            });
          } catch (markErr) {
            logError(
              "INTENT MARK CONSUMED FAILED",
              `intent_id=${intent.id} order_id=${orderId} error=${markErr && markErr.message ? markErr.message : String(markErr)}`,
            );
          }
        }
        details.push({ id: orderId, name: orderName, action: "fulfilled", signal: positiveSignal });
        logInfo(
          "ORDER FULFILLED",
          `shop=${shop} order_id=${orderId} order_name=${orderName} signal=${positiveSignal} mode=${mode || "unknown"}`,
        );
      } else if (result.ok) {
        skippedCount += 1;
        details.push({ id: orderId, name: orderName, action: "skipped", reason: result.reason, signal: positiveSignal });
      } else {
        errorCount += 1;
        details.push({
          id: orderId,
          name: orderName,
          action: "error",
          reason: result.reason,
          userErrors: result.userErrors || [],
          signal: positiveSignal,
        });
        logError(
          "FULFILLMENT FAILED",
          `shop=${shop} order_id=${orderId} reason=${result.reason} userErrors=${JSON.stringify(result.userErrors || [])}`,
        );
      }
    } catch (fulfilErr) {
      errorCount += 1;
      const message = fulfilErr && fulfilErr.message ? fulfilErr.message : String(fulfilErr);
      details.push({ id: orderId, name: orderName, action: "error", reason: "exception", message, signal: positiveSignal });
      logError("FULFILLMENT EXCEPTION", `shop=${shop} order_id=${orderId} message=${message}`);
    }
  }

  return {
    shop,
    ok: true,
    processed: orders.length,
    fulfilled: fulfilledCount,
    skipped: skippedCount,
    errors: errorCount,
    details,
  };
}

function isAuthorized(request) {
  const expected = normalizeStringValue(process.env.MACRON_POS_RECONCILE_TOKEN);
  if (!expected) {
    // No token configured — refuse to run rather than be wide-open.
    return { ok: false, reason: "token_not_configured" };
  }
  const url = new URL(request.url);
  const provided =
    normalizeStringValue(request.headers.get("x-macron-pos-token")) ||
    normalizeStringValue(url.searchParams.get("token"));
  if (provided && provided === expected) return { ok: true };
  return { ok: false, reason: "unauthorized" };
}

async function runReconcile(request) {
  const auth = isAuthorized(request);
  if (!auth.ok) {
    logError("AUTH FAILED", auth.reason);
    return Response.json({ ok: false, error: auth.reason }, { status: 401 });
  }

  // Reconcile every shop with an installed offline session.
  let sessions = [];
  try {
    sessions = await db.session.findMany({ select: { shop: true } });
  } catch (err) {
    logError("SESSION LOOKUP FAILED", err && err.message ? err.message : String(err));
    return Response.json({ ok: false, error: "session_lookup_failed" }, { status: 500 });
  }
  const shops = Array.from(
    new Set((sessions || []).map((s) => normalizeStringValue(s?.shop).toLowerCase()).filter(Boolean)),
  );
  if (shops.length === 0) {
    logInfo("NO SHOPS");
    return Response.json({ ok: true, shops: [], note: "no_installed_shops" }, { status: 200 });
  }

  const startedAt = new Date();
  logInfo("RUN START", `shops=${JSON.stringify(shops)} lookback_ms=${RECONCILE_LOOKBACK_MS}`);

  const results = [];
  for (const shop of shops) {
    try {
      const result = await reconcileShop(shop);
      results.push(result);
    } catch (shopErr) {
      logError(
        "SHOP RECONCILE EXCEPTION",
        `shop=${shop} error=${shopErr && shopErr.message ? shopErr.message : String(shopErr)}`,
      );
      results.push({ shop, ok: false, error: "exception", processed: 0, fulfilled: 0, skipped: 0, errors: 1 });
    }
  }

  const totals = results.reduce(
    (acc, r) => {
      acc.processed += r.processed || 0;
      acc.fulfilled += r.fulfilled || 0;
      acc.skipped += r.skipped || 0;
      acc.errors += r.errors || 0;
      return acc;
    },
    { processed: 0, fulfilled: 0, skipped: 0, errors: 0 },
  );

  logInfo(
    "RUN END",
    `shops=${shops.length} processed=${totals.processed} fulfilled=${totals.fulfilled} skipped=${totals.skipped} errors=${totals.errors} duration_ms=${
      Date.now() - startedAt.getTime()
    }`,
  );

  return Response.json(
    {
      ok: true,
      ranAt: startedAt.toISOString(),
      durationMs: Date.now() - startedAt.getTime(),
      totals,
      results,
    },
    { status: 200 },
  );
}

export const action = async ({ request }) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204 });
  }
  return runReconcile(request);
};

export const loader = async ({ request }) => {
  // GET allowed so a simple cron `curl -H "x-macron-pos-token: ..." URL`
  // works without faff.
  return runReconcile(request);
};
