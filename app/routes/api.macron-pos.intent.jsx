import db from "../db.server";
import { sessionStorage } from "../shopify.server";

const DEBUG_MARKER = "[MSH-PENDING-INTENT]";
const INTENT_TTL_MS = 1000 * 60 * 10;

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

function normalizeString(value) {
  return String(value == null ? "" : value).trim();
}

function normalizeMode(value) {
  const mode = normalizeString(value).toLowerCase();
  if (mode === "take_today" || mode === "order_in" || mode === "split") return mode;
  return "";
}

function normalizeTakeNow(value) {
  const normalized = normalizeString(value).toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  return null;
}

function normalizeQuantity(value) {
  const qty = Number(value);
  if (!Number.isFinite(qty) || qty <= 0) return 1;
  return Math.floor(qty);
}

function normalizeVariantId(value) {
  const raw = normalizeString(value);
  if (!raw) return "";
  const match = raw.match(/(\d+)(?:\?.*)?$/);
  return match ? match[1] : raw;
}

function fingerprintForIntent(intent) {
  return [
    normalizeString(intent.productTitle).toLowerCase(),
    normalizeString(intent.variantTitle).toLowerCase(),
    String(normalizeQuantity(intent.quantity)),
    intent.hasFee ? "fee" : "no_fee",
    intent.isBundle ? "bundle" : "single",
    normalizeString(intent.bundleSummary).toLowerCase(),
  ].join("|");
}

export const action = async ({ request }) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }

  logDebug(
    "PENDING_INTENT_CREATE ROUTE HIT",
    `method=${request.method} content_type=${normalizeString(request.headers.get("content-type")) || "missing"} origin=${normalizeString(request.headers.get("origin")) || "missing"} referer=${normalizeString(request.headers.get("referer")) || "missing"} user_agent_present=${String(Boolean(normalizeString(request.headers.get("user-agent"))))}`,
  );

  function respondJson(body, status = 200) {
    logDebug("PENDING_INTENT_CREATE ROUTE RESPONSE", `status=${status} body=${JSON.stringify(body)}`);
    return Response.json(body, { status, headers });
  }

  if (request.method !== "POST") {
    return respondJson({ ok: false, error: "method_not_allowed" }, 405);
  }

  let body;
  try {
    body = await request.json();
  } catch (jsonError) {
    logDebugError("PENDING_INTENT_CREATE INVALID JSON", jsonError && jsonError.message ? jsonError.message : String(jsonError));
    return respondJson({ ok: false, error: "invalid_json" }, 400);
  }

  let shop = normalizeString(body?.shop).toLowerCase();
  const source = normalizeString(body?.source).toLowerCase() || "macron_pos";
  const fulfillmentMode = normalizeMode(body?.fulfillmentMode);
  const takeNow = normalizeTakeNow(body?.takeNow);
  const productTitle = normalizeString(body?.productTitle);
  const variantTitle = normalizeString(body?.variantTitle);
  const normalizedVariantId = normalizeVariantId(body?.normalizedVariantId);
  const quantity = normalizeQuantity(body?.quantity);
  const hasFee = Boolean(body?.hasFee);
  const isBundle = Boolean(body?.isBundle);
  const bundleSummary = normalizeString(body?.bundleSummary);
  const createdAtClient = normalizeString(body?.createdAtClient);

  logDebug(
    "PENDING_INTENT_CREATE PARSED PAYLOAD",
    `shop=${shop || "missing"} source=${source} mode=${fulfillmentMode || "missing"} take_now=${takeNow === null ? "null" : String(takeNow)} product_title=${productTitle || "missing"} variant_title=${
      variantTitle || ""
    } normalized_variant_id=${normalizedVariantId || ""} quantity=${quantity} has_fee=${String(hasFee)} is_bundle=${String(
      isBundle,
    )} bundle_summary_present=${String(Boolean(bundleSummary))} created_at_client=${createdAtClient || "missing"}`,
  );

  if (!shop) {
    try {
      const recentSessions = await db.session.findMany({
        select: { shop: true },
        orderBy: { id: "desc" },
        take: 20,
      });
      const distinctShops = Array.from(
        new Set(
          (recentSessions || [])
            .map((session) => normalizeString(session?.shop).toLowerCase())
            .filter(Boolean),
        ),
      );
      if (distinctShops.length === 1) {
        shop = distinctShops[0];
        logDebug("PENDING_INTENT_CREATE SHOP FALLBACK", `resolved_shop=${shop} strategy=single_known_shop`);
      } else {
        logDebugError(
          "PENDING_INTENT_CREATE SHOP FALLBACK FAILED",
          `distinct_shop_count=${distinctShops.length} shops=${JSON.stringify(distinctShops)}`,
        );
      }
    } catch (fallbackShopError) {
      logDebugError(
        "PENDING_INTENT_CREATE SHOP FALLBACK ERROR",
        fallbackShopError && fallbackShopError.message ? fallbackShopError.message : String(fallbackShopError),
      );
    }
  }

  if (!shop || !fulfillmentMode || !productTitle) {
    return respondJson({ ok: false, error: "missing_required_fields", shopResolved: Boolean(shop) }, 400);
  }

  let sessions = [];
  try {
    sessions = await sessionStorage.findSessionsByShop(shop);
  } catch (sessionLookupError) {
    logDebugError(
      "PENDING_INTENT_CREATE SHOP AUTH LOOKUP ERROR",
      `shop=${shop} error=${sessionLookupError && sessionLookupError.message ? sessionLookupError.message : String(sessionLookupError)}`,
    );
    return respondJson({ ok: false, error: "shop_session_lookup_failed" }, 500);
  }
  logDebug(
    "PENDING_INTENT_CREATE SHOP AUTH RESOLUTION",
    `shop=${shop} sessions_found=${Array.isArray(sessions) ? sessions.length : 0}`,
  );
  if (!sessions || sessions.length === 0) {
    logDebugError("INTENT REJECTED", `reason=no_sessions shop=${shop}`);
    return respondJson({ ok: false, error: "shop_not_installed" }, 403);
  }

  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + INTENT_TTL_MS);
  const fingerprint = fingerprintForIntent({
    productTitle,
    variantTitle,
    quantity,
    hasFee,
    isBundle,
    bundleSummary,
  });

  logDebug(
    "INTENT PAYLOAD SUMMARY",
    `shop=${shop} source=${source} mode=${fulfillmentMode} take_now=${takeNow === null ? "null" : String(takeNow)} product_title=${productTitle} variant_title=${
      variantTitle || ""
    } normalized_variant_id=${normalizedVariantId || ""} quantity=${quantity} has_fee=${String(hasFee)} is_bundle=${String(
      isBundle,
    )} bundle_summary_present=${String(Boolean(bundleSummary))} created_at_client=${createdAtClient || "missing"} ttl_ms=${INTENT_TTL_MS}`,
  );

  let createdIntent;
  try {
    createdIntent = await db.pendingMacronPosIntent.create({
      data: {
        shop,
        source,
        fulfillmentMode,
        takeNow,
        productTitle,
        variantTitle: variantTitle || null,
        normalizedVariantId: normalizedVariantId || null,
        quantity,
        hasFee,
        isBundle,
        bundleSummary: bundleSummary || null,
        fingerprint,
        createdAt,
        expiresAt,
      },
    });
  } catch (createError) {
    logDebugError(
      "PENDING_INTENT_CREATE PRISMA CREATE FAILURE",
      createError && createError.stack ? createError.stack : createError && createError.message ? createError.message : String(createError),
    );
    return respondJson({ ok: false, error: "intent_create_failed" }, 500);
  }

  logDebug(
    "PENDING_INTENT_CREATE PRISMA CREATE SUCCESS",
    `id=${createdIntent.id} shop=${shop} source=${source} mode=${fulfillmentMode} take_now=${
      takeNow === null ? "null" : String(takeNow)
    } qty=${quantity} has_fee=${String(hasFee)} is_bundle=${String(isBundle)} product_title=${productTitle} variant_title=${
      variantTitle || ""
    } normalized_variant_id=${normalizedVariantId || ""} bundle_summary=${bundleSummary || ""} created_at_server=${createdAt.toISOString()} expires_at=${
      expiresAt.toISOString()
    }`,
  );

  try {
    const recentIntentCount = await db.pendingMacronPosIntent.count({
      where: {
        shop,
        createdAt: {
          gte: new Date(Date.now() - INTENT_TTL_MS),
        },
      },
    });
    logDebug("PENDING_INTENT_CREATE RECENT COUNT", `shop=${shop} recent_count=${recentIntentCount} window_ms=${INTENT_TTL_MS}`);
  } catch (countError) {
    logDebugError(
      "PENDING_INTENT_CREATE RECENT COUNT FAILURE",
      countError && countError.message ? countError.message : String(countError),
    );
  }

  return respondJson({ ok: true, intentId: createdIntent.id, expiresAt: createdIntent.expiresAt.toISOString() }, 200);
};
