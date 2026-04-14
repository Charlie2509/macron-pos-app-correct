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

  if (request.method !== "POST") {
    return Response.json({ ok: false, error: "method_not_allowed" }, { status: 405, headers });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "invalid_json" }, { status: 400, headers });
  }

  const shop = normalizeString(body?.shop).toLowerCase();
  const source = normalizeString(body?.source).toLowerCase() || "macron_pos";
  const fulfillmentMode = normalizeMode(body?.fulfillmentMode);
  const takeNow = normalizeTakeNow(body?.takeNow);
  const productTitle = normalizeString(body?.productTitle);
  const variantTitle = normalizeString(body?.variantTitle);
  const normalizedVariantId = normalizeString(body?.normalizedVariantId);
  const quantity = normalizeQuantity(body?.quantity);
  const hasFee = Boolean(body?.hasFee);
  const isBundle = Boolean(body?.isBundle);
  const bundleSummary = normalizeString(body?.bundleSummary);

  if (!shop || !fulfillmentMode || !productTitle) {
    return Response.json({ ok: false, error: "missing_required_fields" }, { status: 400, headers });
  }

  const sessions = await sessionStorage.findSessionsByShop(shop);
  if (!sessions || sessions.length === 0) {
    logDebug("INTENT REJECTED", `reason=no_sessions shop=${shop}`);
    return Response.json({ ok: false, error: "shop_not_installed" }, { status: 403, headers });
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

  const createdIntent = await db.pendingMacronPosIntent.create({
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

  logDebug(
    "INTENT CREATED",
    `id=${createdIntent.id} shop=${shop} mode=${fulfillmentMode} take_now=${takeNow === null ? "null" : String(takeNow)} qty=${quantity} has_fee=${String(hasFee)} is_bundle=${String(isBundle)} product_title=${productTitle} variant_title=${variantTitle || ""} bundle_summary=${bundleSummary || ""}`,
  );

  return Response.json({ ok: true, intentId: createdIntent.id, expiresAt: createdIntent.expiresAt.toISOString() }, { headers });
};
