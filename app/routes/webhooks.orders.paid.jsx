import db from "../db.server";
import { authenticate } from "../shopify.server";

const GIFT_CARD_CREATE_MUTATION = `#graphql
  mutation MacronPosGiftCardCreate($input: GiftCardCreateInput!) {
    giftCardCreate(input: $input) {
      giftCard {
        id
        code
      }
      userErrors {
        field
        message
      }
    }
  }
`;

function normalizeString(value) {
  if (value == null) return "";
  return String(value).trim();
}

function normalizeCode(rawValue) {
  return normalizeString(rawValue);
}

function normalizeAmount(rawValue) {
  const text = normalizeString(rawValue);
  if (!text) return null;
  const parsed = Number(text);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return (Math.round(parsed * 100) / 100).toFixed(2);
}

function noteAttributesToMap(noteAttributes = []) {
  const result = {};
  for (const entry of noteAttributes) {
    if (!entry) continue;
    const key = normalizeString(entry.name ?? entry.key);
    if (!key) continue;
    result[key] = normalizeString(entry.value);
  }
  return result;
}

function parseGiftCardActivationFromPayload(payload = {}) {
  const attributes = noteAttributesToMap(payload.note_attributes || payload.noteAttributes || []);

  const source = normalizeString(attributes._msh_gc_source);
  const status = normalizeString(attributes._msh_gc_status);
  if (source !== "macron_pos_gift_card_sale" || status !== "pending_activation") {
    return { found: false };
  }

  const code = normalizeCode(attributes._msh_gc_code);
  const amount = normalizeAmount(attributes._msh_gc_amount);
  const currencyCode = normalizeString(attributes._msh_gc_currency) || "GBP";
  const activationAttemptId = normalizeString(attributes._msh_gc_attempt_id);

  if (!/^\d{13}$/.test(code) || !amount) {
    return { found: false };
  }

  return {
    found: true,
    code,
    amount,
    currencyCode,
    activationAttemptId,
  };
}

function isPaid(payload = {}) {
  const displayFinancialStatus = normalizeString(payload.display_financial_status || payload.displayFinancialStatus).toLowerCase();
  const financialStatus = normalizeString(payload.financial_status || payload.financialStatus).toLowerCase();
  return displayFinancialStatus === "paid" || financialStatus === "paid";
}

async function activateGiftCard({ admin, orderId, orderName, sourceName, shop, code, amount, currencyCode, activationAttemptId }) {
  const existing = await db.macronPosGiftCardActivation.findUnique({
    where: {
      shop_order_code: {
        shop,
        orderId,
        code,
      },
    },
  });

  if (existing?.status === "success") {
    return { ok: true, deduped: true, giftCardId: existing.giftCardId };
  }

  await db.macronPosGiftCardActivation.upsert({
    where: {
      shop_order_code: {
        shop,
        orderId,
        code,
      },
    },
    create: {
      shop,
      orderId,
      orderName,
      sourceName,
      code,
      amount,
      currencyCode,
      activationAttemptId,
      status: "processing",
    },
    update: {
      orderName,
      sourceName,
      amount,
      currencyCode,
      activationAttemptId,
      status: "processing",
      errorMessage: null,
    },
  });

  const note = `Created from POS order ${orderName || orderId}`;

  const response = await admin.graphql(GIFT_CARD_CREATE_MUTATION, {
    variables: {
      input: {
        code,
        initialValue: {
          amount,
          currencyCode,
        },
        note,
      },
    },
  });

  const body = await response.json();
  const payloadResult = body?.data?.giftCardCreate;
  const userErrors = Array.isArray(payloadResult?.userErrors) ? payloadResult.userErrors : [];

  if (userErrors.length > 0 || !payloadResult?.giftCard?.id) {
    const errorMessage = userErrors.map((error) => normalizeString(error.message)).filter(Boolean).join("; ") || "giftCardCreate failed";
    await db.macronPosGiftCardActivation.update({
      where: {
        shop_order_code: {
          shop,
          orderId,
          code,
        },
      },
      data: {
        status: "failed",
        errorMessage,
      },
    });

    return { ok: false, errorMessage };
  }

  await db.macronPosGiftCardActivation.update({
    where: {
      shop_order_code: {
        shop,
        orderId,
        code,
      },
    },
    data: {
      status: "success",
      giftCardId: payloadResult.giftCard.id,
      activatedAt: new Date(),
      errorMessage: null,
    },
  });

  return { ok: true, deduped: false, giftCardId: payloadResult.giftCard.id };
}

export const action = async ({ request }) => {
  const { payload, shop, topic, admin } = await authenticate.webhook(request);

  console.log(`[MSH-GC] WEBHOOK START topic=${topic} shop=${shop} order_id=${payload?.id || "unknown"}`);

  if (!admin) {
    console.log(`[MSH-GC] SKIP reason=admin_unavailable shop=${shop}`);
    return new Response();
  }

  const orderId = normalizeString(payload?.admin_graphql_api_id || payload?.id);
  const orderName = normalizeString(payload?.name);
  const sourceName = normalizeString(payload?.source_name || payload?.sourceName);

  const candidate = parseGiftCardActivationFromPayload(payload);
  if (!candidate.found) {
    console.log(`[MSH-GC] SKIP reason=no_pending_gift_card_marker shop=${shop} order_id=${orderId || "unknown"}`);
    return new Response();
  }

  if (!isPaid(payload)) {
    console.log(`[MSH-GC] SKIP reason=order_not_paid shop=${shop} order_id=${orderId || "unknown"}`);
    return new Response();
  }

  const result = await activateGiftCard({
    admin,
    orderId,
    orderName,
    sourceName,
    shop,
    code: candidate.code,
    amount: candidate.amount,
    currencyCode: candidate.currencyCode,
    activationAttemptId: candidate.activationAttemptId,
  });

  if (!result.ok) {
    console.log(`[MSH-GC] FAIL shop=${shop} order_id=${orderId || "unknown"} code=${candidate.code} error=${result.errorMessage}`);
  } else if (result.deduped) {
    console.log(`[MSH-GC] DEDUPED shop=${shop} order_id=${orderId || "unknown"} code=${candidate.code}`);
  } else {
    console.log(`[MSH-GC] SUCCESS shop=${shop} order_id=${orderId || "unknown"} code=${candidate.code} gift_card_id=${result.giftCardId}`);
  }

  return new Response();
};
