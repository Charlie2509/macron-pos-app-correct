import { sessionStorage, unauthenticated } from "../shopify.server";

const DEFAULT_NOTE = "Activated via Macron POS gift card tool";
const CODE_MIN = 8;
const CODE_MAX = 20;

function normalizeString(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function sanitizeCode(value) {
  return normalizeString(value);
}

function normalizeAmount(value) {
  const raw = normalizeString(value).replace(/,/g, "");
  if (!raw) return "";
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) return "";
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return "";
  return parsed.toFixed(2);
}

function buildValidation(code, amount) {
  const fieldErrors = {};

  if (!code) {
    fieldErrors.code = "Enter a gift card code.";
  } else if (code.length < CODE_MIN || code.length > CODE_MAX) {
    fieldErrors.code = "Code must be between 8 and 20 characters.";
  } else if (!/^[A-Za-z0-9]+$/.test(code)) {
    fieldErrors.code = "Code can only contain letters and numbers.";
  }

  if (!amount) {
    fieldErrors.amount = "Enter a valid amount greater than 0.";
  }

  return fieldErrors;
}

function withCorsHeaders(status, body) {
  return Response.json(body, {
    status,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}

export const action = async ({ request }) => {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }

  if (request.method !== "POST") {
    return withCorsHeaders(405, { ok: false, error: "method_not_allowed" });
  }

  let body;
  try {
    body = await request.json();
  } catch (error) {
    return withCorsHeaders(400, { ok: false, error: "Invalid JSON body." });
  }

  const code = sanitizeCode(body && body.code);
  const amount = normalizeAmount(body && body.amount);
  const noteInput = normalizeString(body && body.note);
  const note = noteInput || DEFAULT_NOTE;

  const fieldErrors = buildValidation(code, amount);
  if (Object.keys(fieldErrors).length > 0) {
    return withCorsHeaders(400, {
      ok: false,
      error: "Please correct the highlighted fields.",
      fieldErrors,
    });
  }

  const shop = normalizeString(body && body.shop).toLowerCase();
  if (!shop) {
    return withCorsHeaders(400, {
      ok: false,
      error: "Missing shop domain for gift card activation.",
    });
  }

  let sessions;
  try {
    sessions = await sessionStorage.findSessionsByShop(shop);
  } catch (error) {
    return withCorsHeaders(500, {
      ok: false,
      error: "Could not verify shop session.",
    });
  }

  if (!sessions || sessions.length === 0) {
    return withCorsHeaders(403, {
      ok: false,
      error: "Shop is not authenticated for this app.",
    });
  }

  let adminContext;
  try {
    adminContext = await unauthenticated.admin(shop);
  } catch (error) {
    return withCorsHeaders(500, {
      ok: false,
      error: "Unable to open Shopify Admin session.",
    });
  }

  const admin = adminContext && adminContext.admin ? adminContext.admin : null;
  if (!admin) {
    return withCorsHeaders(500, {
      ok: false,
      error: "Unable to initialize Shopify Admin client.",
    });
  }

  const mutation = `#graphql
    mutation MacronGiftCardCreate($input: GiftCardCreateInput!) {
      giftCardCreate(input: $input) {
        giftCard {
          id
          lastCharacters
          initialValue {
            amount
          }
        }
        giftCardCode
        userErrors {
          field
          message
          code
        }
      }
    }
  `;

  let response;
  try {
    response = await admin.graphql(mutation, {
      variables: {
        input: {
          code,
          initialValue: amount,
          note,
        },
      },
    });
  } catch (error) {
    return withCorsHeaders(502, {
      ok: false,
      error: "Shopify gift card activation request failed.",
    });
  }

  let payload;
  try {
    payload = await response.json();
  } catch (error) {
    return withCorsHeaders(502, {
      ok: false,
      error: "Invalid response from Shopify gift card service.",
    });
  }

  const createData = payload && payload.data ? payload.data.giftCardCreate : null;
  const userErrors = createData && Array.isArray(createData.userErrors) ? createData.userErrors : [];

  if (userErrors.length > 0) {
    let duplicate = false;
    for (let i = 0; i < userErrors.length; i += 1) {
      const item = userErrors[i];
      const message = normalizeString(item && item.message).toLowerCase();
      const codeValue = normalizeString(item && item.code).toLowerCase();
      if (message.indexOf("already") >= 0 || message.indexOf("taken") >= 0 || codeValue === "taken") {
        duplicate = true;
        break;
      }
    }

    return withCorsHeaders(400, {
      ok: false,
      error: duplicate ? "This gift card code is already active." : normalizeString(userErrors[0] && userErrors[0].message) || "Shopify could not create the gift card.",
      fieldErrors: duplicate ? { code: "This gift card code is already active." } : undefined,
    });
  }

  const giftCard = createData && createData.giftCard ? createData.giftCard : null;
  if (!giftCard || !giftCard.id) {
    return withCorsHeaders(500, {
      ok: false,
      error: "Gift card activation succeeded with an unexpected payload.",
    });
  }

  const amountFromShopify = giftCard.initialValue && giftCard.initialValue.amount ? giftCard.initialValue.amount : amount;

  return withCorsHeaders(200, {
    ok: true,
    giftCardId: giftCard.id,
    codeLast4: normalizeString(giftCard.lastCharacters),
    amount: amountFromShopify,
  });
};
