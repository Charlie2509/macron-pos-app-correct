import db from "../db.server";
import { unauthenticated } from "../shopify.server";

import { planLegacyReconciliation } from "../../flow/msh-handover/plan.mjs";

// Recover fully paid, explicitly allocated legacy merchandise at the selling till.
// The orders/create webhook retains bundle, gift card and older fallback processing.
// Requests are authenticated by MACRON_POS_RECONCILE_TOKEN.
const DEBUG_MARKER = "[MSH-RECONCILE]";
const RECONCILE_LOOKBACK_MS = 1000 * 60 * 60 * 6; // 6 hours of orders
const MAX_ORDERS_PER_RUN = 50;

const ORDER_LIST_QUERY = `#graphql
  query MacronReconcileOrders($query: String!, $first: Int!) {
    orders(query: $query, first: $first, sortKey: CREATED_AT, reverse: true) {
      nodes { id name }
    }
  }
`;

// A deep, nested connection for every order in the list exceeds Shopify's
// request cost budget. Read the current state of each candidate before writing.
const ORDER_DETAIL_QUERY = `#graphql
  query MacronReconcileOrder($id: ID!) {
    order(id: $id) {
      id name sourceName displayFinancialStatus retailLocation { id } customAttributes { key value }
      cancelledAt edited returnStatus refunds { id } subtotalLineItemsQuantity
      lineItems(first: 100) {
        pageInfo { hasNextPage }
        nodes {
          id title sku quantity currentQuantity unfulfilledQuantity
          requiresShipping isGiftCard variant { id } lineItemGroup { id }
          customAttributes { key value }
        }
      }
      fulfillmentOrders(first: 5) {
        pageInfo { hasNextPage }
        nodes {
          id status assignedLocation { location { id } } deliveryMethod { methodType }
          supportedActions { action }
          lineItems(first: 100) {
            pageInfo { hasNextPage }
            nodes { id remainingQuantity lineItem { id } }
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
async function fulfilOrder(admin, order) {
  const responseRead = await admin.graphql(ORDER_DETAIL_QUERY, {variables: {id: order.id}});
  const detail = await responseRead.json();
  if (detail.errors?.length || detail.data?.order?.id !== order.id) {
    return {ok: false, reason: 'order_detail_failed', userErrors: detail.errors || []};
  }
  const plan = planLegacyReconciliation(detail.data.order);
  if (!plan.ready) return {ok: true, reason: plan.reason, fulfilledCount: 0};
  const variables = JSON.parse(plan.mutationInput);
  const response = await admin.graphql(FULFILLMENT_CREATE_MUTATION, { variables });
  const body = await response.json();
  const result = body?.data?.fulfillmentCreate;
  if (body?.errors?.length || !result?.fulfillment?.id || result.userErrors?.length) {
    return {ok: false, reason: 'fulfillmentCreate_failed', userErrors: result?.userErrors || body?.errors || []};
  }
  return {ok: true, reason: 'fulfilled', fulfilledCount: variables.fulfillment.lineItemsByFulfillmentOrder.length};
}

async function reconcileShop(shop) {
  const adminCtx = await unauthenticated.admin(shop);
  const admin = adminCtx?.admin;
  if (!admin) {
    return { shop, ok: false, error: "no_admin_client", processed: 0, fulfilled: 0, skipped: 0, errors: 0 };
  }

  const earliest = new Date(Date.now() - RECONCILE_LOOKBACK_MS).toISOString();
  const searchQuery = `created_at:>='${earliest}' source_name:pos status:open financial_status:paid (fulfillment_status:unfulfilled OR fulfillment_status:partial)`;
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
  const orders = listBody?.data?.orders?.nodes;
  if (listBody?.errors?.length || !Array.isArray(orders)) {
    return {shop, ok: false, error: 'order_list_failed', processed: 0, fulfilled: 0, skipped: 0, errors: 1};
  }
  logInfo("ORDER LIST OK", `shop=${shop} count=${orders.length} query=${searchQuery}`);

  let fulfilledCount = 0;
  let skippedCount = 0;
  let errorCount = 0;
  const details = [];

  for (const order of orders) {
    const orderId = order?.id || "unknown";
    const orderName = order?.name || "unknown";

    try {
      const result = await fulfilOrder(admin, order);
      if (result.ok && result.reason === "fulfilled") {
        fulfilledCount += 1;
        details.push({ id: orderId, name: orderName, action: "fulfilled", signal: "verified_line_instructions" });
        logInfo(
          "ORDER FULFILLED",
          `shop=${shop} order_id=${orderId} order_name=${orderName} signal=verified_line_instructions`,
        );
      } else if (result.ok) {
        skippedCount += 1;
        details.push({ id: orderId, name: orderName, action: "skipped", reason: result.reason, signal: "verified_line_instructions" });
      } else {
        errorCount += 1;
        details.push({
          id: orderId,
          name: orderName,
          action: "error",
          reason: result.reason,
          userErrors: result.userErrors || [],
          signal: "verified_line_instructions",
        });
        logError(
          "FULFILLMENT FAILED",
          `shop=${shop} order_id=${orderId} reason=${result.reason} userErrors=${JSON.stringify(result.userErrors || [])}`,
        );
      }
    } catch (fulfilErr) {
      errorCount += 1;
      const message = fulfilErr && fulfilErr.message ? fulfilErr.message : String(fulfilErr);
      details.push({ id: orderId, name: orderName, action: "error", reason: "exception", message, signal: "verified_line_instructions" });
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
