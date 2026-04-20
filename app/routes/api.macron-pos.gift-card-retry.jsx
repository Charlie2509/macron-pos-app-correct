import { authenticate } from "../shopify.server";
import db from "../db.server";

const GIFT_CARD_CREATE_MUTATION = `#graphql
  mutation MacronPosGiftCardRetryCreate($input: GiftCardCreateInput!) {
    giftCardCreate(input: $input) {
      giftCard {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
`;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function readText(value) {
  if (value == null) return "";
  return String(value).trim();
}

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const body = await request.json().catch(() => ({}));

  const orderId = readText(body.orderId);
  const code = readText(body.code);

  if (!orderId || !/^\d{13}$/.test(code)) {
    return json({ ok: false, error: "invalid_input" }, 400);
  }

  const record = await db.macronPosGiftCardActivation.findUnique({
    where: {
      shop_order_code: {
        shop: session.shop,
        orderId,
        code,
      },
    },
  });

  if (!record) {
    return json({ ok: false, error: "not_found" }, 404);
  }

  if (record.status === "success") {
    return json({ ok: true, status: "already_success", giftCardId: record.giftCardId });
  }

  await db.macronPosGiftCardActivation.update({
    where: { id: record.id },
    data: {
      status: "processing",
      errorMessage: null,
    },
  });

  const response = await admin.graphql(GIFT_CARD_CREATE_MUTATION, {
    variables: {
      input: {
        code: record.code,
        initialValue: {
          amount: record.amount.toFixed(2),
          currencyCode: record.currencyCode,
        },
        note: `Retry activation from POS order ${record.orderName || record.orderId}`,
      },
    },
  });

  const gqlBody = await response.json();
  const userErrors = gqlBody?.data?.giftCardCreate?.userErrors || [];
  const giftCardId = gqlBody?.data?.giftCardCreate?.giftCard?.id || null;

  if (userErrors.length > 0 || !giftCardId) {
    const errorMessage = userErrors.map((item) => readText(item?.message)).filter(Boolean).join("; ") || "giftCardCreate failed";
    await db.macronPosGiftCardActivation.update({
      where: { id: record.id },
      data: {
        status: "failed",
        errorMessage,
      },
    });
    return json({ ok: false, error: "gift_card_create_failed", detail: errorMessage }, 502);
  }

  await db.macronPosGiftCardActivation.update({
    where: { id: record.id },
    data: {
      status: "success",
      giftCardId,
      activatedAt: new Date(),
      errorMessage: null,
    },
  });

  return json({ ok: true, status: "success", giftCardId });
};
