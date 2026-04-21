import db from "../db.server";
import { authenticate, unauthenticated } from "../shopify.server";

const GIFT_CARD_LOOKUP_QUERY = `#graphql
  query GiftCardLookupByCode($query: String!) {
    giftCards(first: 1, query: $query) {
      nodes {
        id
      }
    }
  }
`;

function responseHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

function jsonResponse(body, status = 200) {
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
  if (match?.[1]) return text(match[1]).toLowerCase();
  return source.toLowerCase();
}

function sanitizeCode(rawCode) {
  return text(rawCode).replace(/\D+/g, "").slice(0, 13);
}

async function codeExistsInShopify(admin, code) {
  const queryValue = `code:${code}`;
  const response = await admin.graphql(GIFT_CARD_LOOKUP_QUERY, {
    variables: { query: queryValue },
  });
  const body = await response.json();
  if (Array.isArray(body?.errors) && body.errors.length > 0) {
    const message = String(body.errors[0]?.message || "gift card lookup failed");
    throw new Error(message);
  }
  return Boolean(body?.data?.giftCards?.nodes?.length);
}

export const loader = async ({ request }) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: responseHeaders() });
  }
  return new Response("Not Found", { status: 404 });
};

export const action = async ({ request }) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: responseHeaders() });
  }
  if (request.method !== "POST") {
    return jsonResponse({ valid: false, reason: "invalid_code" }, 405);
  }

  let posContext;
  try {
    posContext = await authenticate.pos(request);
  } catch {
    return jsonResponse({ valid: false, reason: "invalid_code" }, 401);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ valid: false, reason: "invalid_code" }, 400);
  }

  const code = sanitizeCode(body?.code);
  if (!/^\d{13}$/.test(code)) {
    return jsonResponse({ valid: false, reason: "invalid_code" }, 200);
  }

  const shop = extractShopDomain(posContext?.sessionToken?.dest);
  if (!shop) {
    return jsonResponse({ valid: false, reason: "invalid_code" }, 400);
  }

  const pendingIntent = await db.pendingGiftCardActivation.findFirst({
    where: {
      shop,
      code,
      status: { in: ["pending", "processing"] },
      expiresAt: { gt: new Date() },
    },
    select: { id: true },
  });

  if (pendingIntent) {
    return jsonResponse({ valid: false, reason: "pending_code" }, 200);
  }

  let adminContext;
  try {
    adminContext = await unauthenticated.admin(shop);
  } catch {
    return jsonResponse({ valid: false, reason: "invalid_code" }, 403);
  }

  const admin = adminContext?.admin;
  if (!admin) {
    return jsonResponse({ valid: false, reason: "invalid_code" }, 500);
  }

  try {
    const duplicateInShopify = await codeExistsInShopify(admin, code);
    if (duplicateInShopify) {
      return jsonResponse({ valid: false, reason: "duplicate_code" }, 200);
    }
  } catch (error) {
    console.error("[gift-card-validate] Shopify lookup failed", {
      shop,
      message: error?.message || String(error),
    });
    return jsonResponse({ valid: false, reason: "invalid_code" }, 502);
  }

  return jsonResponse({ valid: true }, 200);
};
