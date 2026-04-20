import db from "../db.server";
import { authenticate } from "../shopify.server";

const INTENT_TTL_MS = 1000 * 60 * 90;

function responseHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

function jsonResponse(body, status) {
  return Response.json(body, {
    status,
    headers: responseHeaders(),
  });
}

function text(value) {
  return String(value == null ? "" : value).trim();
}

function extractShopDomain(dest) {
  const source = text(dest);
  if (!source) return "";
  const match = source.match(/^https?:\/\/([^/]+)/i);
  if (match && match[1]) return text(match[1]).toLowerCase();
  return source.toLowerCase();
}

function validateCode(rawCode) {
  const code = text(rawCode);
  if (code === "") {
    return { ok: false, error: "Enter a card code" };
  }
  if (!/^\d{13}$/.test(code)) {
    return { ok: false, error: "Code must be exactly 13 digits" };
  }
  return { ok: true, code };
}

function validateAmount(rawAmount) {
  let value = text(rawAmount).replace(/,/g, "");
  if (/^GBP\s*/i.test(value)) {
    value = text(value.replace(/^GBP\s*/i, ""));
  }
  if (value === "") {
    return { ok: false, error: "Enter an amount" };
  }
  if (!/^\d+(\.\d{1,2})?$/.test(value)) {
    return { ok: false, error: "Enter a valid GBP amount" };
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return { ok: false, error: "Amount must be greater than 0" };
  }
  return { ok: true, amount: parsed.toFixed(2) };
}

export const action = async ({ request }) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: responseHeaders() });
  }

  if (request.method !== "POST") {
    return jsonResponse({ ok: false, error: "method_not_allowed" }, 405);
  }

  let posContext;
  try {
    posContext = await authenticate.pos(request);
  } catch (error) {
    return jsonResponse({ ok: false, error: "Unauthorized POS request" }, 401);
  }

  let body;
  try {
    body = await request.json();
  } catch (error) {
    return jsonResponse({ ok: false, error: "invalid_json" }, 400);
  }

  const codeValidation = validateCode(body?.code);
  const amountValidation = validateAmount(body?.amount);
  const note = text(body?.note);
  const lineItemUuid = text(body?.lineItemUuid);
  const lineItemTitle = text(body?.lineItemTitle);
  const currency = text(body?.currency || "GBP").toUpperCase() || "GBP";
  const fieldErrors = {};

  if (!codeValidation.ok) fieldErrors.code = codeValidation.error;
  if (!amountValidation.ok) fieldErrors.amount = amountValidation.error;
  if (!lineItemUuid) fieldErrors.form = "Unable to attach gift card sale to checkout line.";

  if (Object.keys(fieldErrors).length > 0) {
    return jsonResponse({ ok: false, error: "validation_failed", fieldErrors }, 400);
  }

  const shop = extractShopDomain(posContext?.sessionToken?.dest);
  if (!shop) {
    return jsonResponse({ ok: false, error: "shop_resolution_failed" }, 400);
  }

  const intentToken = `gc_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + INTENT_TTL_MS);

  const created = await db.pendingGiftCardActivation.create({
    data: {
      shop,
      intentToken,
      code: codeValidation.code,
      amount: amountValidation.amount,
      currency,
      note: note || null,
      lineItemUuid,
      lineItemTitle: lineItemTitle || null,
      status: "pending",
      expiresAt,
    },
  });

  return jsonResponse(
    {
      ok: true,
      intentId: created.id,
      intentToken: created.intentToken,
      expiresAt: created.expiresAt.toISOString(),
    },
    200,
  );
};
