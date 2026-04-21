import db from "../db.server";
import { authenticate, sessionStorage, unauthenticated } from "../shopify.server";

const ORDER_WITH_FULFILLMENT_ORDERS_QUERY = `#graphql
  query MacronOrderForFulfillment($orderId: ID!) {
    order(id: $orderId) {
      id
      name
      sourceName
      createdAt
      processedAt
      updatedAt
      note
      customAttributes {
        key
        value
      }
      displayFulfillmentStatus
      lineItems(first: 250) {
        nodes {
          id
          name
          title
          variantTitle
          sku
          quantity
          variant {
            id
            title
          }
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
const PENDING_INTENT_MATCH_WINDOW_MS = 1000 * 60 * 10;
const GIFT_CARD_MARKER_KEY = "_msh_gc_sale";
const GIFT_CARD_MARKER_VALUE = "true";
const GIFT_CARD_PROCESSING_TTL_MS = 1000 * 60 * 30;

const GIFT_CARD_CREATE_MUTATION = `#graphql
  mutation GiftCardCreateFromPosOrder($input: GiftCardCreateInput!) {
    giftCardCreate(input: $input) {
      giftCard {
        id
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

function normalizeShopDomain(rawShop) {
  const value = String(rawShop == null ? "" : rawShop).trim().toLowerCase();
  if (!value) return "";
  const urlMatch = value.match(/^https?:\/\/([^/?#]+)/i);
  if (urlMatch && urlMatch[1]) return String(urlMatch[1]).trim().toLowerCase();
  return value.replace(/\/$/, "");
}

async function findOfflineSessionsForShop(shop) {
  const normalizedShop = normalizeShopDomain(shop);
  if (!normalizedShop) {
    return { normalizedShop, sessions: [], lookupError: "" };
  }

  const sessionsById = new Map();
  let lookupError = "";

  try {
    const direct = await sessionStorage.findSessionsByShop(normalizedShop);
    for (const session of direct || []) {
      if (session?.id) sessionsById.set(session.id, session);
    }
  } catch (error) {
    lookupError = error?.message || String(error);
  }

  try {
    const allSessions = await db.session.findMany({
      select: { id: true, shop: true, isOnline: true, accessToken: true, expires: true },
      take: 200,
      orderBy: { id: "desc" },
    });

    for (const session of allSessions || []) {
      const sessionShop = normalizeShopDomain(session?.shop);
      if (!sessionShop || sessionShop !== normalizedShop) continue;
      if (session?.id) sessionsById.set(session.id, session);
    }
  } catch (error) {
    const message = error?.message || String(error);
    lookupError = lookupError ? `${lookupError}; ${message}` : message;
  }

  return {
    normalizedShop,
    sessions: Array.from(sessionsById.values()),
    lookupError,
  };
}

function pickBestOfflineSession(sessions = []) {
  const offline = (sessions || []).filter((session) => !session?.isOnline && String(session?.accessToken || "").trim());
  if (offline.length === 0) return null;

  const preferred = offline.find((session) => String(session?.id || "").toLowerCase().includes("offline"));
  return preferred || offline[0];
}

async function resolveWebhookAdminClient({ shop, adminFromWebhook }) {
  const details = {
    shopInput: String(shop || ""),
    normalizedShop: normalizeShopDomain(shop),
    offlineSessionLookupAttempted: false,
    foundSessions: 0,
    foundOfflineSessions: 0,
    selectedOfflineSessionId: "",
    adminClientSource: "",
    adminClientReady: false,
    lookupError: "",
    adminClientError: "",
  };

  if (adminFromWebhook) {
    details.adminClientSource = "authenticate.webhook";
    details.adminClientReady = true;
    return { admin: adminFromWebhook, details };
  }

  details.offlineSessionLookupAttempted = true;
  const lookup = await findOfflineSessionsForShop(shop);
  details.normalizedShop = lookup.normalizedShop;
  details.lookupError = lookup.lookupError;
  details.foundSessions = lookup.sessions.length;
  details.foundOfflineSessions = lookup.sessions.filter((session) => !session?.isOnline).length;

  const selectedOfflineSession = pickBestOfflineSession(lookup.sessions);
  if (selectedOfflineSession?.id) {
    details.selectedOfflineSessionId = String(selectedOfflineSession.id);
  }

  if (!details.normalizedShop) {
    details.adminClientError = "missing normalized shop";
    return { admin: null, details };
  }

  try {
    const adminContext = await unauthenticated.admin(details.normalizedShop);
    if (adminContext?.admin) {
      details.adminClientSource = "unauthenticated.admin";
      details.adminClientReady = true;
      return { admin: adminContext.admin, details };
    }
    details.adminClientError = "unauthenticated.admin returned no admin client";
  } catch (error) {
    details.adminClientError = error?.message || String(error);
  }

  return { admin: null, details };
}

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

function hasTruthyValue(value) {
  const normalized = normalizeStringValue(value);
  return normalized === "true" || normalized === "1" || normalized === "yes";
}

function classifyFeeOrSystemLine({ attributes = {}, title = "", sku = "" } = {}) {
  const normalizedTitle = normalizeStringValue(title);
  const normalizedSku = normalizeStringValue(sku);

  if (attributes["Fee For Product"]) {
    return { feeOrSystem: true, reason: "fee_for_product_attribute" };
  }

  if ("_MSH_PersoFee" in attributes && hasTruthyValue(attributes._MSH_PersoFee)) {
    return { feeOrSystem: true, reason: "_msh_persofee_attribute" };
  }

  if (
    normalizedTitle.includes("personalisation fee") ||
    normalizedTitle.includes("personalization fee")
  ) {
    return { feeOrSystem: true, reason: "title_personalisation_fee" };
  }

  if (
    normalizedSku.includes("_msh_persofee") ||
    normalizedSku.includes("persofee") ||
    normalizedSku.includes("personalisation-fee") ||
    normalizedSku.includes("personalization-fee")
  ) {
    return { feeOrSystem: true, reason: "sku_fee_marker" };
  }

  return { feeOrSystem: false, reason: "not_fee_or_system" };
}

function normalizeStringValue(value) {
  return String(value == null ? "" : value).trim().toLowerCase();
}

function normalizeBooleanString(value) {
  const normalized = normalizeStringValue(value);
  return normalized === "true" || normalized === "1" || normalized === "yes";
}

function normalizeMoneyString(value) {
  const raw = String(value == null ? "" : value).trim().replace(/,/g, "");
  const match = raw.match(/\d+(\.\d{1,2})?/);
  if (!match || !match[0]) return "";
  const parsed = Number(match[0]);
  if (!Number.isFinite(parsed) || parsed <= 0) return "";
  return parsed.toFixed(2);
}

function normalizeComparableText(value) {
  return normalizeStringValue(value)
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeVariantIdValue(value) {
  const raw = String(value == null ? "" : value).trim();
  if (!raw) return "";
  const match = raw.match(/(\d+)(?:\?.*)?$/);
  return match ? match[1] : raw;
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

function evaluateLineEligibility({ attributes = {}, title = "", sku = "" } = {}) {
  const rawSource = attributes._msh_source || attributes._msh_fallback_source;
  const source = normalizeSource(rawSource);
  const rawMode =
    attributes._msh_fulfillment_mode ||
    attributes._msh_fulfilment_mode ||
    attributes._msh_fallback_fulfillment_mode ||
    attributes._msh_fallback_fulfilment_mode;
  const mode = normalizeMode(rawMode);
  const rawTakeNow = attributes._msh_take_now || attributes._msh_fallback_take_now;
  const takeNow = normalizeTakeNow(rawTakeNow);
  const feeClassification = classifyFeeOrSystemLine({ attributes, title, sku });
  const feeOrSystem = feeClassification.feeOrSystem;
  const feeOrSystemReason = feeClassification.reason;
  const eligible = source === "macron_pos" && !feeOrSystem && shouldFulfillNowForMode(mode, takeNow);

  return {
    source,
    rawMode: rawMode == null ? "" : String(rawMode),
    mode,
    rawTakeNow: rawTakeNow == null ? "" : String(rawTakeNow),
    takeNow,
    feeOrSystem,
    feeOrSystemReason,
    eligible,
  };
}

function summarizeAttributes(attributes = {}) {
  return Object.fromEntries(
    Object.entries(attributes).filter(([key]) =>
      [
        "_msh_source",
        "_msh_fallback_source",
        "_msh_fulfillment_mode",
        "_msh_fulfilment_mode",
        "_msh_fallback_fulfillment_mode",
        "_msh_fallback_fulfilment_mode",
        "_msh_take_now",
        "_msh_fallback_take_now",
        "_msh_fallback_bundle_summary",
        "Fee For Product",
        "Linked Product Variant Id",
        "Linked Fee Variant Id",
        "_MSH_PersoFee",
      ].includes(key),
    ),
  );
}

function payloadLinePropertiesMap(payloadLineItems = []) {
  return payloadLineItems.map((line) => {
    const properties = {};
    for (const property of line?.properties || []) {
      if (!property || typeof property.name !== "string") continue;
      properties[property.name] = property.value == null ? "" : String(property.value);
    }
    return {
      id: line?.id,
      properties,
    };
  });
}

function payloadNoteAttributesMap(payloadNoteAttributes = []) {
  const attributes = {};
  for (const attribute of payloadNoteAttributes || []) {
    if (!attribute) continue;
    const key =
      typeof attribute.name === "string"
        ? attribute.name
        : typeof attribute.key === "string"
          ? attribute.key
          : "";
    if (!key) continue;
    attributes[key] = attribute.value == null ? "" : String(attribute.value);
  }
  return attributes;
}

function hasMacronPosMarkerInOrderLineAttributes(orderLineNodes = []) {
  return orderLineNodes.some((orderLine) => {
    const attributes = attributeMap(orderLine?.customAttributes);
    return normalizeSource(attributes._msh_source) === "macron_pos";
  });
}

function hasMacronPosFallbackMarkerInOrderLineAttributes(orderLineNodes = []) {
  return orderLineNodes.some((orderLine) => {
    const attributes = attributeMap(orderLine?.customAttributes);
    return normalizeSource(attributes._msh_fallback_source) === "macron_pos";
  });
}

function isGiftCardSaleMarker(value) {
  return normalizeBooleanString(value) || normalizeStringValue(value) === GIFT_CARD_MARKER_VALUE;
}

function extractGiftCardCandidatesFromOrder(orderLineNodes = [], orderAttributes = {}) {
  const candidates = [];
  for (const line of orderLineNodes || []) {
    const attributes = attributeMap(line?.customAttributes);
    if (!isGiftCardSaleMarker(attributes[GIFT_CARD_MARKER_KEY])) continue;
    candidates.push({
      lineItemId: String(line?.id || ""),
      lineTitle: String(line?.title || line?.name || "").trim(),
      intentId: String(attributes._msh_gc_intent_id || "").trim(),
      intentToken: String(attributes._msh_gc_intent_token || "").trim(),
      code: String(attributes._msh_gc_code || "").trim(),
      amount: normalizeMoneyString(attributes._msh_gc_amount || ""),
      currency: String(attributes._msh_gc_currency || "GBP").trim().toUpperCase() || "GBP",
      note: String(attributes._msh_gc_note || "").trim(),
    });
  }

  if (candidates.length === 0 && isGiftCardSaleMarker(orderAttributes[GIFT_CARD_MARKER_KEY])) {
    candidates.push({
      lineItemId: "",
      lineTitle: "",
      intentId: String(orderAttributes._msh_gc_pending_intent_id || "").trim(),
      intentToken: String(orderAttributes._msh_gc_pending_intent_token || "").trim(),
      code: String(orderAttributes._msh_gc_pending_code || "").trim(),
      amount: normalizeMoneyString(orderAttributes._msh_gc_pending_amount || ""),
      currency: "GBP",
      note: "",
    });
  }

  return candidates;
}

function firstGraphQlError(errors) {
  if (!Array.isArray(errors) || errors.length === 0) return "";
  return String(errors[0]?.message || "").trim() || "GraphQL request failed";
}

function isDuplicateCodeErrorMessage(errorMessage) {
  const normalized = normalizeStringValue(errorMessage);
  if (!normalized) return false;
  return (
    normalized.includes("duplicate") ||
    normalized.includes("already exists") ||
    normalized.includes("already been taken") ||
    (normalized.includes("gift card") && normalized.includes("code") && normalized.includes("exists"))
  );
}

function logGiftCardFinalResult(result, details = "") {
  const message = details ? `result=${result} ${details}` : `result=${result}`;
  logDebug("GIFT CARD FINAL RESULT", message);
}

function buildGiftCardNote(baseNote, orderName, orderId, intentId) {
  const parts = [];
  const normalizedBase = String(baseNote || "").trim();
  if (normalizedBase) parts.push(normalizedBase);
  parts.push(`POS gift card sale order ${orderName || "unknown"} (${orderId || "unknown"})`);
  if (intentId) parts.push(`intent ${intentId}`);
  return parts.join(" | ");
}

async function attemptGiftCardActivation({ admin, intentRecord, orderId, orderName, shop }) {
  const mutationInput = {
    code: intentRecord.code,
    initialValue: intentRecord.amount,
    note: buildGiftCardNote(intentRecord.note, orderName, orderId, intentRecord.id),
  };

  logDebug("GIFT CARD CREATE REQUEST", `shop=${shop || "unknown"} order_id=${orderId} intent_id=${intentRecord.id} code_suffix=${String(intentRecord.code || "").slice(-4)} amount=${intentRecord.amount}`);

  const response = await admin.graphql(GIFT_CARD_CREATE_MUTATION, {
    variables: { input: mutationInput },
  });
  const body = await response.json();

  if (body?.errors?.length > 0) {
    const gqlError = firstGraphQlError(body.errors);
    const duplicateCode = isDuplicateCodeErrorMessage(gqlError);
    logDebugError("GIFT CARD CREATE GRAPHQL ERROR", `shop=${shop || "unknown"} order_id=${orderId} intent_id=${intentRecord.id} duplicate_code=${String(duplicateCode)} error=${gqlError}`);
    return { ok: false, error: gqlError, duplicateCode };
  }

  const createPayload = body?.data?.giftCardCreate;
  if (!createPayload) {
    logDebugError("GIFT CARD CREATE PAYLOAD MISSING", `shop=${shop || "unknown"} order_id=${orderId} intent_id=${intentRecord.id}`);
    return { ok: false, error: "Gift card creation payload missing" };
  }
  if (Array.isArray(createPayload.userErrors) && createPayload.userErrors.length > 0) {
    const userError = String(createPayload.userErrors[0]?.message || "Gift card create user error");
    const duplicateCode = isDuplicateCodeErrorMessage(userError);
    logDebugError("GIFT CARD CREATE USER ERROR", `shop=${shop || "unknown"} order_id=${orderId} intent_id=${intentRecord.id} duplicate_code=${String(duplicateCode)} error=${userError}`);
    return { ok: false, error: userError, duplicateCode };
  }
  if (!createPayload.giftCard?.id) {
    logDebugError("GIFT CARD CREATE MISSING ID", `shop=${shop || "unknown"} order_id=${orderId} intent_id=${intentRecord.id}`);
    return { ok: false, error: "Gift card create returned no id" };
  }
  logDebug("GIFT CARD CREATE SUCCESS", `shop=${shop || "unknown"} order_id=${orderId} intent_id=${intentRecord.id} gift_card_id=${String(createPayload.giftCard.id)}`);
  return { ok: true, giftCardId: String(createPayload.giftCard.id) };
}

async function processGiftCardActivationsForOrder({ shop, admin, order }) {
  const orderId = parseNumericId(order?.id) || String(order?.id || "");
  if (!orderId) return;

  const orderAttributes = attributeMap(order?.customAttributes || []);
  const candidates = extractGiftCardCandidatesFromOrder(order?.lineItems?.nodes || [], orderAttributes);
  if (candidates.length === 0) {
    return;
  }

  logDebug(
    "GIFT CARD CANDIDATES",
    `order_id=${orderId} count=${candidates.length} data=${JSON.stringify(candidates)}`,
  );

  for (const candidate of candidates) {
    let intentRecord = null;
    const hasDirectIntentId = Boolean(candidate.intentId);

    if (hasDirectIntentId) {
      intentRecord = await db.pendingGiftCardActivation.findFirst({
        where: {
          id: candidate.intentId,
          shop,
        },
      });
    } else if (candidate.intentToken) {
      intentRecord = await db.pendingGiftCardActivation.findFirst({
        where: {
          shop,
          intentToken: candidate.intentToken,
        },
      });
    }

    if (!intentRecord && !hasDirectIntentId && candidate.code && candidate.amount) {
      intentRecord = await db.pendingGiftCardActivation.findFirst({
        where: {
          shop,
          code: candidate.code,
          amount: candidate.amount,
          status: { in: ["pending", "failed", "processing"] },
          expiresAt: { gt: new Date(Date.now() - GIFT_CARD_PROCESSING_TTL_MS) },
        },
        orderBy: { createdAt: "desc" },
      });
    }

    if (!intentRecord) {
      logDebugError("GIFT CARD INTENT MISSING", `order_id=${orderId} candidate=${JSON.stringify(candidate)}`);
      logGiftCardFinalResult("skipped_missing_intent", `order_id=${orderId} intent_id=${candidate.intentId || "none"}`);
      continue;
    }

    if (intentRecord.status === "activated" || Boolean(intentRecord.giftCardId)) {
      logDebug("GIFT CARD SKIP ALREADY ACTIVATED", `order_id=${orderId} intent_id=${intentRecord.id}`);
      logGiftCardFinalResult("skipped_already_processed", `order_id=${orderId} intent_id=${intentRecord.id} status=${intentRecord.status}`);
      continue;
    }

    if (intentRecord.status === "duplicate_code") {
      logGiftCardFinalResult("skipped_duplicate_code", `order_id=${orderId} intent_id=${intentRecord.id}`);
      continue;
    }

    if (intentRecord.orderId && intentRecord.orderId !== orderId) {
      logDebugError(
        "GIFT CARD ORDER CONFLICT",
        `intent_id=${intentRecord.id} existing_order=${intentRecord.orderId} incoming_order=${orderId}`,
      );
      logGiftCardFinalResult("skipped_already_processed", `order_id=${orderId} intent_id=${intentRecord.id} conflict_order=${intentRecord.orderId}`);
      continue;
    }

    const claimResult = await db.pendingGiftCardActivation.updateMany({
      where: {
        id: intentRecord.id,
        shop,
        status: { in: ["pending", "failed"] },
      },
      data: {
        status: "processing",
        orderId,
        orderName: String(order?.name || ""),
        lastError: null,
        activationAttempts: { increment: 1 },
      },
    });
    if (claimResult.count === 0) {
      const current = await db.pendingGiftCardActivation.findFirst({
        where: { id: intentRecord.id, shop },
      });
      if (current?.status === "activated" || current?.giftCardId) {
        logGiftCardFinalResult("skipped_already_processed", `order_id=${orderId} intent_id=${intentRecord.id} status=${current?.status || "unknown"}`);
      } else if (current?.status === "duplicate_code") {
        logGiftCardFinalResult("skipped_duplicate_code", `order_id=${orderId} intent_id=${intentRecord.id}`);
      }
      continue;
    }

    const activationResult = await attemptGiftCardActivation({
      admin,
      intentRecord,
      orderId,
      orderName: String(order?.name || ""),
      shop,
    });

    if (!activationResult.ok) {
      if (activationResult.duplicateCode) {
        await db.pendingGiftCardActivation.update({
          where: { id: intentRecord.id },
          data: {
            status: "duplicate_code",
            lastError: activationResult.error || "duplicate_code",
          },
        });
        logGiftCardFinalResult(
          "skipped_duplicate_code",
          `order_id=${orderId} intent_id=${intentRecord.id} error=${activationResult.error || "duplicate_code"}`,
        );
        continue;
      }

      await db.pendingGiftCardActivation.update({
        where: { id: intentRecord.id },
        data: {
          status: "failed",
          lastError: activationResult.error || "activation_failed",
        },
      });
      logDebugError(
        "GIFT CARD ACTIVATION FAILED",
        `order_id=${orderId} intent_id=${intentRecord.id} error=${activationResult.error || "unknown"}`,
      );
      logGiftCardFinalResult("error_shopify_create", `order_id=${orderId} intent_id=${intentRecord.id}`);
      continue;
    }

    await db.pendingGiftCardActivation.update({
      where: { id: intentRecord.id },
      data: {
        status: "activated",
        activatedAt: new Date(),
        giftCardId: intentRecord.giftCardId || activationResult.giftCardId,
        lastError: null,
      },
    });
    logDebug(
      "GIFT CARD ACTIVATION SUCCESS",
      `order_id=${orderId} intent_id=${intentRecord.id} gift_card_id=${activationResult.giftCardId}`,
    );
    logGiftCardFinalResult("success_created", `order_id=${orderId} intent_id=${intentRecord.id} gift_card_id=${activationResult.giftCardId}`);
  }
}

function parseLineItemIntentFromAttributes(attributes = {}) {
  const source = normalizeSource(
    attributes._msh_source || attributes._msh_intent_source || attributes._msh_fallback_source,
  );
  const mode = normalizeMode(
    attributes._msh_intent_fulfillment_mode ||
      attributes._msh_intent_fulfilment_mode ||
      attributes._msh_fulfillment_mode ||
      attributes._msh_fulfilment_mode,
  );
  const takeNow = normalizeTakeNow(attributes._msh_intent_take_now || attributes._msh_take_now);
  const productTitle = String(attributes._msh_intent_product_title || "").trim();
  const variantTitle = String(attributes._msh_intent_variant_title || "").trim();
  const variantId = normalizeVariantIdValue(attributes._msh_intent_variant_id || "");
  const quantity = String(attributes._msh_intent_quantity || "").trim();
  const hasFee = normalizeTakeNow(attributes._msh_intent_has_fee);
  const isBundle = normalizeTakeNow(attributes._msh_intent_is_bundle);
  const bundleSummary = String(attributes._msh_intent_bundle_summary || "").trim();
  const createdAt = String(attributes._msh_intent_created_at || "").trim();
  const hasIntentField =
    productTitle !== "" ||
    variantTitle !== "" ||
    variantId !== "" ||
    quantity !== "" ||
    hasFee !== null ||
    isBundle !== null ||
    bundleSummary !== "" ||
    createdAt !== "" ||
    mode !== "" ||
    takeNow !== null;
  const found = source === "macron_pos" && hasIntentField;

  return {
    found,
    source,
    mode,
    takeNow,
    productTitle,
    variantTitle,
    variantId,
    quantity,
    hasFee,
    isBundle,
    bundleSummary,
    createdAt,
  };
}

function findMacronLineItemIntent(orderLineNodes = []) {
  for (const orderLine of orderLineNodes || []) {
    const attributes = attributeMap(orderLine?.customAttributes);
    const parsedIntent = parseLineItemIntentFromAttributes(attributes);
    if (!parsedIntent.found) continue;
    return {
      found: true,
      orderLineId: String(orderLine?.id || ""),
      ...parsedIntent,
    };
  }
  return {
    found: false,
    orderLineId: "",
    source: "",
    mode: "",
    takeNow: null,
    productTitle: "",
    variantTitle: "",
    variantId: "",
    quantity: "",
    hasFee: null,
    isBundle: null,
    bundleSummary: "",
    createdAt: "",
  };
}

function parseOrderLevelFallbackMarker(attributes = {}) {
  const source = normalizeSource(attributes._msh_order_source);
  const mode = normalizeMode(
    attributes._msh_order_fulfillment_mode || attributes._msh_order_fulfilment_mode,
  );
  const takeNow = normalizeTakeNow(attributes._msh_order_take_now);
  const bundleSummary = String(attributes._msh_order_bundle_summary || "").trim();
  return {
    source,
    mode,
    takeNow,
    bundleSummary,
    markerFound: source === "macron_pos",
  };
}

function parseOrderLevelIntentProperties(attributes = {}) {
  const source = normalizeSource(
    attributes._msh_order_source || attributes._msh_source || attributes._msh_intent_source,
  );
  const mode = normalizeMode(
    attributes._msh_intent_fulfillment_mode ||
      attributes._msh_intent_fulfilment_mode ||
      attributes._msh_order_fulfillment_mode ||
      attributes._msh_order_fulfilment_mode,
  );
  const takeNow = normalizeTakeNow(attributes._msh_intent_take_now || attributes._msh_order_take_now);
  const found = source === "macron_pos" && (mode !== "" || takeNow !== null);
  return { found, source, mode, takeNow };
}

function parseDurableNoteTokenFromText(rawText) {
  const text = String(rawText == null ? "" : rawText);
  const tokenMatch = text.match(/\[MSH_POS\]\s*([^\n\r]+)/i);
  if (!tokenMatch) {
    return {
      tokenFound: false,
      token: "",
      source: "",
      mode: "",
      takeNow: null,
      bundleSummary: "",
      markerFound: false,
    };
  }
  const token = `[MSH_POS] ${String(tokenMatch[1] || "").trim()}`.trim();
  const body = String(tokenMatch[1] || "");
  const parts = body.split(";");
  const parsed = {};
  for (const part of parts) {
    const entry = String(part || "").trim();
    if (!entry) continue;
    const eqIndex = entry.indexOf("=");
    if (eqIndex <= 0) continue;
    const key = normalizeStringValue(entry.slice(0, eqIndex));
    const value = String(entry.slice(eqIndex + 1) || "").trim();
    if (!key) continue;
    parsed[key] = value;
  }

  const source = normalizeSource(parsed.source);
  const mode = normalizeMode(parsed.mode);
  const takeNow = normalizeTakeNow(parsed.take_now);
  const bundleSummary = String(parsed.bundle || "").trim();

  return {
    tokenFound: true,
    token,
    source,
    mode,
    takeNow,
    bundleSummary,
    markerFound: source === "macron_pos",
  };
}

function parseDurableNoteTokenFromSources(...sources) {
  for (const source of sources) {
    const parsed = parseDurableNoteTokenFromText(source);
    if (parsed.tokenFound) return parsed;
  }
  return parseDurableNoteTokenFromText("");
}

function splitBundleItemValue(rawValue) {
  const text = String(rawValue == null ? "" : rawValue).trim();
  if (!text) return { componentTitle: "", variantTitle: "" };
  if (text.includes(" — ")) {
    const [componentTitle, ...variantParts] = text.split(" — ");
    return {
      componentTitle: String(componentTitle || "").trim(),
      variantTitle: String(variantParts.join(" — ") || "").trim(),
    };
  }
  if (text.includes(" - ")) {
    const [componentTitle, ...variantParts] = text.split(" - ");
    return {
      componentTitle: String(componentTitle || "").trim(),
      variantTitle: String(variantParts.join(" - ") || "").trim(),
    };
  }
  return { componentTitle: text, variantTitle: "" };
}

function parseBundleComponentFulfillment(rawValue, defaultTakeNow) {
  const normalized = normalizeStringValue(rawValue);
  if (normalized === "take_now" || normalized === "take now") return true;
  if (normalized === "order_later" || normalized === "order later") return false;
  return defaultTakeNow;
}

function parseBundleComponentsFromAttributes(attributes = {}, mode = "", takeNow = null) {
  if (!attributes.Bundle) return null;
  const defaultTakeNow = shouldFulfillNowForMode(mode, takeNow);
  const componentRows = {};
  const readabilityOnlyKeys = new Set(["Bundle Summary", "Bundle Take Now", "Bundle Order Later"]);

  for (const [key, value] of Object.entries(attributes)) {
    if (readabilityOnlyKeys.has(key)) {
      continue;
    }
    const itemMatch = key.match(/^Item\s+(\d+)$/i);
    if (itemMatch) {
      const index = Number(itemMatch[1]);
      componentRows[index] = componentRows[index] || {};
      componentRows[index].itemRaw = value;
      continue;
    }
    const fulfilmentMatch = key.match(/^Bundle Component\s+(\d+)\s+Fulfi(?:l|ll)ment$/i);
    if (fulfilmentMatch) {
      const index = Number(fulfilmentMatch[1]);
      componentRows[index] = componentRows[index] || {};
      componentRows[index].fulfilmentRaw = value;
    }
  }

  const indexes = Object.keys(componentRows).map((k) => Number(k)).filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (indexes.length === 0) return null;

  return indexes.map((index) => {
    const row = componentRows[index] || {};
    const { componentTitle, variantTitle } = splitBundleItemValue(row.itemRaw);
    return {
      index,
      componentTitle,
      variantTitle,
      fulfillNow: parseBundleComponentFulfillment(row.fulfilmentRaw, defaultTakeNow),
      itemRaw: row.itemRaw == null ? "" : String(row.itemRaw),
      fulfilmentRaw: row.fulfilmentRaw == null ? "" : String(row.fulfilmentRaw),
    };
  });
}

function scoreBundleComponentCandidate(orderLineTitle, componentTitle, variantTitle) {
  const title = normalizeStringValue(orderLineTitle);
  const component = normalizeStringValue(componentTitle);
  const variant = normalizeStringValue(variantTitle);
  if (!title || !component) return 0;
  if (variant && (title === `${component} - ${variant}` || title === `${component} / ${variant}`)) return 5;
  if (variant && title.includes(component) && title.includes(variant)) return 4;
  if (title.startsWith(component)) return 3;
  if (title.includes(component)) return 2;
  return 0;
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

function isLikelyPosSourceName(sourceName) {
  const normalized = normalizeStringValue(sourceName);
  return normalized === "pos" || normalized.includes("pos");
}

function getOrderLineTitleQuantitySummary(orderLineNodes = []) {
  return (orderLineNodes || [])
    .map((line) => ({
      title: String(line?.title || "").trim(),
      name: String(line?.name || "").trim(),
      variantTitle: String(line?.variantTitle || line?.variant?.title || "").trim(),
      normalizedVariantId: normalizeVariantIdValue(line?.variant?.id),
      quantity: Number(line?.quantity || 0),
      sku: String(line?.sku || "").trim(),
      attributes: attributeMap(line?.customAttributes),
    }))
    .filter((line) => {
      if (!line.title || line.quantity <= 0) return false;
      const feeClassification = classifyFeeOrSystemLine({
        attributes: line.attributes,
        title: line.title,
        sku: line.sku,
      });
      return !feeClassification.feeOrSystem;
    });
}

function getOrderBundleSummaryHints(orderLineSummary = []) {
  const summaries = [];
  for (const line of orderLineSummary) {
    const attrs = line.attributes || {};
    const values = [
      attrs._msh_fallback_bundle_summary,
      attrs["Bundle Summary"],
      attrs["Bundle Take Now Summary"],
      attrs["Bundle Order Later Summary"],
    ];
    for (const value of values) {
      const normalized = normalizeComparableText(value);
      if (normalized) summaries.push(normalized);
    }
  }
  return summaries;
}

function evaluatePendingIntentCandidateMatch(intent, orderLineSummary = [], orderBundleHints = []) {
  const normalizedIntentProductTitle = normalizeStringValue(intent.productTitle);
  const comparableIntentProductTitle = normalizeComparableText(intent.productTitle);
  const comparableIntentVariantTitle = normalizeComparableText(intent.variantTitle);
  const normalizedIntentVariantId = normalizeVariantIdValue(intent.normalizedVariantId);
  const intentQty = Number(intent.quantity || 0);
  const comparableIntentBundleSummary = normalizeComparableText(intent.bundleSummary);
  const reasons = [];
  const lineRejectionReasons = [];
  let matchedLineIndex = -1;

  for (let index = 0; index < orderLineSummary.length; index += 1) {
    const line = orderLineSummary[index];
    const normalizedLineTitle = normalizeStringValue(line.title);
    const comparableLineTitle = normalizeComparableText(line.title);
    const lineReasons = [];

    if (
      normalizedLineTitle !== normalizedIntentProductTitle &&
      comparableLineTitle !== comparableIntentProductTitle
    ) {
      lineReasons.push("title_mismatch");
    }
    if (intentQty > 0 && intentQty !== Number(line.quantity || 0)) {
      lineReasons.push("quantity_mismatch");
    }
    if (normalizedIntentVariantId && line.normalizedVariantId && line.normalizedVariantId !== normalizedIntentVariantId) {
      lineReasons.push("variant_id_mismatch");
    }
    if (comparableIntentVariantTitle) {
      const comparableLineVariantTitle = normalizeComparableText(line.variantTitle);
      if (
        comparableLineVariantTitle &&
        comparableLineVariantTitle !== comparableIntentVariantTitle &&
        !comparableLineTitle.includes(comparableIntentVariantTitle)
      ) {
        lineReasons.push("variant_title_mismatch");
      }
    }

    if (lineReasons.length > 0) {
      lineRejectionReasons.push({
        line_index: index,
        line_title: line.title,
        line_qty: Number(line.quantity || 0),
        reasons: lineReasons,
      });
      continue;
    }

    matchedLineIndex = index;
    reasons.push("title+quantity_match");
    if (normalizedIntentVariantId && line.normalizedVariantId === normalizedIntentVariantId) {
      reasons.push("variant_id_match");
    }
    break;
  }

  if (matchedLineIndex < 0) {
    return {
      matched: false,
      reasons: ["no_line_match"],
      score: 0,
      lineRejectionReasons,
    };
  }

  let score = 2;
  if (comparableIntentVariantTitle) {
    const variantFound = orderLineSummary.some((line) => {
      const comparableLineTitle = normalizeComparableText(line.title);
      const comparableLineVariantTitle = normalizeComparableText(line.variantTitle);
      return (
        comparableLineVariantTitle === comparableIntentVariantTitle ||
        comparableLineTitle.includes(comparableIntentVariantTitle)
      );
    });
    if (variantFound) {
      reasons.push("variant_title_hint");
      score += 1;
    } else {
      reasons.push("variant_title_missing_in_order");
    }
  }

  if (intent.isBundle) {
    if (!comparableIntentBundleSummary) {
      reasons.push("bundle_summary_missing_on_intent");
      return { matched: false, reasons, score: 0, lineRejectionReasons };
    }
    const bundleSummaryMatched = orderBundleHints.some((summary) => summary === comparableIntentBundleSummary);
    if (!bundleSummaryMatched) {
      reasons.push("bundle_summary_mismatch");
      return { matched: false, reasons, score: 0, lineRejectionReasons };
    }
    reasons.push("bundle_summary_match");
    score += 1;
  }

  return { matched: true, reasons, score, lineRejectionReasons };
}

async function tryMatchPendingIntent({ shop, payloadSourceName, order }) {
  const shouldAttempt = isLikelyPosSourceName(payloadSourceName);
  if (!shouldAttempt) {
    return {
      attempted: false,
      reason: "source_name_not_pos",
      candidates: [],
      matchedIntent: null,
    };
  }

  const now = new Date();
  const earliest = new Date(now.getTime() - PENDING_INTENT_MATCH_WINDOW_MS);
  const orderLineSummary = getOrderLineTitleQuantitySummary(order?.lineItems?.nodes || []);
  const orderBundleHints = getOrderBundleSummaryHints(orderLineSummary);
  logDebug(
    "PENDING INTENT ORDER MATCH FIELDS",
    `order_id=${order?.id || "unknown"} order_name=${order?.name || "unknown"} source_name=${normalizeStringValue(
      order?.sourceName,
    ) || "unknown"} created_at=${order?.createdAt || "unknown"} processed_at=${order?.processedAt || "unknown"} updated_at=${
      order?.updatedAt || "unknown"
    } line_summary=${JSON.stringify(
      orderLineSummary.map((line) => ({
        title: line.title,
        name: line.name,
        quantity: line.quantity,
        sku: line.sku,
        variant_title: line.variantTitle,
        normalized_variant_id: line.normalizedVariantId,
      })),
    )} bundle_hints=${JSON.stringify(orderBundleHints)}`,
  );
  const pendingIntents = await db.pendingMacronPosIntent.findMany({
    where: {
      shop,
      source: "macron_pos",
      consumedAt: null,
      expiresAt: { gt: now },
      createdAt: { gte: earliest },
    },
    orderBy: { createdAt: "desc" },
    take: 25,
  });

  const evaluatedCandidates = pendingIntents.map((intent) => {
    const evaluation = evaluatePendingIntentCandidateMatch(intent, orderLineSummary, orderBundleHints);
    return {
      intent,
      matched: evaluation.matched,
      reasons: evaluation.reasons,
      score: evaluation.score,
      lineRejectionReasons: evaluation.lineRejectionReasons || [],
    };
  });
  logDebug(
    "PENDING INTENT CANDIDATE LIST",
    `order_id=${order?.id || "unknown"} shop=${shop} now=${now.toISOString()} window_start=${earliest.toISOString()} source_name=${
      payloadSourceName || "unknown"
    } candidates=${JSON.stringify(
      pendingIntents.map((intent) => ({
        id: intent.id,
        shop: intent.shop,
        created_at: intent.createdAt,
        expires_at: intent.expiresAt,
        product_title: intent.productTitle,
        variant_title: intent.variantTitle,
        normalized_variant_id: intent.normalizedVariantId,
        quantity: intent.quantity,
        has_fee: intent.hasFee,
        is_bundle: intent.isBundle,
        bundle_summary: intent.bundleSummary,
      })),
    )}`,
  );
  for (const candidate of evaluatedCandidates) {
    if (!candidate.matched) {
      logDebug(
        "PENDING INTENT CANDIDATE REJECTED",
        `order_id=${order?.id || "unknown"} intent_id=${candidate.intent.id} reasons=${JSON.stringify(
          candidate.reasons,
        )} line_rejections=${JSON.stringify(candidate.lineRejectionReasons)}`,
      );
    }
  }

  const matchedCandidates = evaluatedCandidates.filter((candidate) => candidate.matched);
  if (matchedCandidates.length !== 1) {
    return {
      attempted: true,
      reason: matchedCandidates.length === 0 ? "no_candidate_match" : "ambiguous_matches",
      candidates: evaluatedCandidates.map((candidate) => ({
        id: candidate.intent.id,
        matched: candidate.matched,
        score: candidate.score,
        reasons: candidate.reasons,
        lineRejectionReasons: candidate.lineRejectionReasons,
      })),
      matchedIntent: null,
    };
  }

  const matchedIntent = matchedCandidates[0].intent;
  await db.pendingMacronPosIntent.update({
    where: { id: matchedIntent.id },
    data: {
      consumedAt: now,
      matchedOrderId: String(order?.id || ""),
    },
  });

  return {
    attempted: true,
    reason: "single_match",
    candidates: evaluatedCandidates.map((candidate) => ({
      id: candidate.intent.id,
        matched: candidate.matched,
        score: candidate.score,
        reasons: candidate.reasons,
        lineRejectionReasons: candidate.lineRejectionReasons,
      })),
    matchedIntent,
  };
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
    const { payload, topic, shop, admin: webhookAdmin } = await authenticate.webhook(request);
    logDebug(
      "WEBHOOK START",
      `topic=${topic} shop=${shop} payload_order_id=${payload?.id || "unknown"}`,
    );

    const { admin, details: adminDiag } = await resolveWebhookAdminClient({
      shop,
      adminFromWebhook: webhookAdmin,
    });

    logDebug(
      "ADMIN CLIENT RESOLUTION",
      `shop=${shop} normalized_shop=${adminDiag.normalizedShop || "missing"} offline_lookup_attempted=${adminDiag.offlineSessionLookupAttempted} found_sessions=${adminDiag.foundSessions} found_offline_sessions=${adminDiag.foundOfflineSessions} selected_offline_session_id=${adminDiag.selectedOfflineSessionId || "none"} admin_client_source=${adminDiag.adminClientSource || "none"} admin_client_ready=${adminDiag.adminClientReady} lookup_error=${adminDiag.lookupError || "none"} admin_client_error=${adminDiag.adminClientError || "none"}`,
    );

    if (!admin) {
      logDebugError(
        "EARLY EXIT",
        `reason=admin client unavailable shop=${shop} normalized_shop=${adminDiag.normalizedShop || "missing"} order_id=${payload?.id || "unknown"} offline_lookup_attempted=${adminDiag.offlineSessionLookupAttempted} found_sessions=${adminDiag.foundSessions} found_offline_sessions=${adminDiag.foundOfflineSessions} selected_offline_session_id=${adminDiag.selectedOfflineSessionId || "none"} lookup_error=${adminDiag.lookupError || "none"} admin_client_error=${adminDiag.adminClientError || "none"}`,
      );
      logDebug(
        "FINAL RESULT: failed",
        `reason=admin client unavailable shop=${shop} order_id=${payload?.id || "unknown"} offline_lookup_attempted=${adminDiag.offlineSessionLookupAttempted} found_offline_sessions=${adminDiag.foundOfflineSessions}`,
      );
      return new Response();
    }

    const expectedMarkerKey = "_msh_source";
    const expectedMarkerValue = "macron_pos";
    const expectedFallbackMarkerKey = "_msh_fallback_source";
    const expectedOrderFallbackMarkerKey = "_msh_order_source";
    const payloadLineItems = Array.isArray(payload?.line_items) ? payload.line_items : [];
    const payloadLineProperties = payloadLinePropertiesMap(payloadLineItems);
    const payloadNoteAttributes = payloadNoteAttributesMap(payload?.note_attributes || []);
    const payloadOrderIntent = parseOrderLevelIntentProperties(payloadNoteAttributes);
    const payloadOrderFallback = parseOrderLevelFallbackMarker(payloadNoteAttributes);
    const payloadDurableNote = parseDurableNoteTokenFromSources(
      payload?.note,
      payloadNoteAttributes._msh_pos_note_token,
      ...Object.values(payloadNoteAttributes),
    );
    const markedPayloadLines = payloadLineProperties.filter(
      (line) => normalizeSource(line.properties[expectedMarkerKey]) === expectedMarkerValue,
    );
    const fallbackMarkedPayloadLines = payloadLineProperties.filter(
      (line) => normalizeSource(line.properties[expectedFallbackMarkerKey]) === expectedMarkerValue,
    );
    const markerFoundInRawPayload = markedPayloadLines.length > 0;
    const fallbackMarkerFoundInRawPayload = fallbackMarkedPayloadLines.length > 0;
    const payloadSourceName = normalizeStringValue(payload?.source_name);

    for (const payloadLine of payloadLineItems) {
      const rawProperties = Array.isArray(payloadLine?.properties) ? payloadLine.properties : [];
      const rawPropertyMap = {};
      for (const property of rawProperties) {
        if (!property || typeof property.name !== "string") continue;
        rawPropertyMap[property.name] = property.value == null ? "" : String(property.value);
      }
      const hasMshSource = normalizeSource(rawPropertyMap._msh_source) === expectedMarkerValue;
      const hasIntentKeys = Object.keys(rawPropertyMap).some((key) => key.startsWith("_msh_intent_"));
      logDebug(
        "LINE ITEM RAW PROPERTIES",
        `line_title=${String(payloadLine?.title || payloadLine?.name || "")} quantity=${String(payloadLine?.quantity || "")} variant_id=${String(
          payloadLine?.variant_id || "",
        )} raw_properties=${JSON.stringify(rawProperties)} has_msh_source=${String(hasMshSource)} has_msh_intent_keys=${String(hasIntentKeys)}`,
      );
      logDebug(
        hasMshSource && hasIntentKeys ? "LINE ITEM INTENT FOUND" : "LINE ITEM INTENT NOT FOUND",
        `line_title=${String(payloadLine?.title || payloadLine?.name || "")} quantity=${String(payloadLine?.quantity || "")} variant_id=${String(
          payloadLine?.variant_id || "",
        )} has_msh_source=${String(hasMshSource)} has_msh_intent_keys=${String(hasIntentKeys)}`,
      );
    }

    logDebug(
      "MARKER DETECTION RAW PAYLOAD",
      `order_id=${payload?.id || "unknown"} expected_marker=${expectedMarkerKey}:${expectedMarkerValue} found_in_raw_payload=${String(
        markerFoundInRawPayload,
      )} marked_line_count=${markedPayloadLines.length} fallback_marker=${expectedFallbackMarkerKey}:${expectedMarkerValue} fallback_found_in_raw_payload=${String(
        fallbackMarkerFoundInRawPayload,
      )} fallback_marked_line_count=${fallbackMarkedPayloadLines.length} order_fallback_marker=${expectedOrderFallbackMarkerKey}:${expectedMarkerValue} order_fallback_found_in_raw_payload=${String(
        payloadOrderFallback.markerFound,
      )} order_intent_found_in_raw_payload=${String(payloadOrderIntent.found)} order_intent_mode=${
        payloadOrderIntent.mode || "missing"
      } order_intent_take_now=${payloadOrderIntent.takeNow === null ? "null" : String(payloadOrderIntent.takeNow)} note_token_found_in_raw_payload=${String(payloadDurableNote.tokenFound)} note_marker_found_in_raw_payload=${String(
        payloadDurableNote.markerFound,
      )} note_source=${payloadDurableNote.source || "missing"} note_mode=${payloadDurableNote.mode || "missing"} note_take_now=${
        payloadDurableNote.takeNow === null ? "null" : String(payloadDurableNote.takeNow)
      } payload_line_count=${payloadLineItems.length} payload_note_attribute_count=${Object.keys(payloadNoteAttributes).length} source_name=${
        payloadSourceName || "unknown"
      }`,
    );

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

    await processGiftCardActivationsForOrder({
      shop,
      admin,
      order,
    });

    const markerFoundAfterFetch = hasMacronPosMarkerInOrderLineAttributes(order.lineItems?.nodes || []);
    const fallbackMarkerFoundAfterFetch = hasMacronPosFallbackMarkerInOrderLineAttributes(order.lineItems?.nodes || []);
    const lineItemIntentAfterFetch = findMacronLineItemIntent(order.lineItems?.nodes || []);
    const fetchedOrderAttributes = attributeMap(order.customAttributes || []);
    const fetchedOrderIntent = parseOrderLevelIntentProperties(fetchedOrderAttributes);
    const orderFallbackAfterFetch = parseOrderLevelFallbackMarker(fetchedOrderAttributes);
    const fetchedOrderDurableNote = parseDurableNoteTokenFromSources(
      order?.note,
      fetchedOrderAttributes._msh_pos_note_token,
      ...Object.values(fetchedOrderAttributes),
    );
    const usedFallbackOrderFetchForMarkerDetection = !markerFoundInRawPayload;
    const recognizedByLineMarker = markerFoundInRawPayload || markerFoundAfterFetch;
    const recognizedByFallbackMarker = fallbackMarkerFoundInRawPayload || fallbackMarkerFoundAfterFetch;
    const recognizedByOrderFallbackMarker = payloadOrderFallback.markerFound || orderFallbackAfterFetch.markerFound;
    const recognizedByDurableNoteMarker = payloadDurableNote.markerFound || fetchedOrderDurableNote.markerFound;
    const recognizedByLineItemIntent = lineItemIntentAfterFetch.found;
    let markerRecognitionPath = recognizedByLineItemIntent
      ? "line_item_intent_properties"
      : recognizedByLineMarker
        ? "line_item_marker"
        : recognizedByFallbackMarker
          ? "fallback_marker"
          : recognizedByOrderFallbackMarker
            ? "order_level_fallback_marker"
            : recognizedByDurableNoteMarker
              ? "durable_note_marker"
              : "none";
    logDebug(
      recognizedByLineItemIntent ? "LINE ITEM INTENT FOUND" : "LINE ITEM INTENT NOT FOUND",
      `order_id=${order.id} line_item_id=${lineItemIntentAfterFetch.orderLineId || "none"} resolved_fulfillment_mode=${
        lineItemIntentAfterFetch.mode || "missing"
      } resolved_take_now=${
        lineItemIntentAfterFetch.takeNow === null ? "null" : String(lineItemIntentAfterFetch.takeNow)
      } recognition_path=${recognizedByLineItemIntent ? "line_item_intent_properties" : "none"}`,
    );
    logDebug(
      "LINE ITEM INTENT RESOLVED",
      `order_id=${order.id} resolved_fulfillment_mode=${
        lineItemIntentAfterFetch.mode || "missing"
      } resolved_take_now=${
        lineItemIntentAfterFetch.takeNow === null ? "null" : String(lineItemIntentAfterFetch.takeNow)
      }`,
    );
    logDebug(
      "MARKER DETECTION POST FETCH",
      `order_id=${order.id} expected_marker=${expectedMarkerKey}:${expectedMarkerValue} used_fallback_fetch=${String(
        usedFallbackOrderFetchForMarkerDetection,
      )} marker_found_after_fetch=${String(markerFoundAfterFetch)} fallback_marker=${expectedFallbackMarkerKey}:${expectedMarkerValue} fallback_marker_found_after_fetch=${String(
        fallbackMarkerFoundAfterFetch,
      )} order_fallback_marker=${expectedOrderFallbackMarkerKey}:${expectedMarkerValue} order_fallback_found_after_fetch=${String(
        orderFallbackAfterFetch.markerFound,
      )} line_item_intent_found=${String(recognizedByLineItemIntent)} order_intent_found_after_fetch=${String(
        fetchedOrderIntent.found,
      )} order_intent_mode=${fetchedOrderIntent.mode || "missing"} order_intent_take_now=${
        fetchedOrderIntent.takeNow === null ? "null" : String(fetchedOrderIntent.takeNow)
      } note_token_found_after_fetch=${String(
        fetchedOrderDurableNote.tokenFound,
      )} note_marker_found_after_fetch=${String(fetchedOrderDurableNote.markerFound)} note_source=${
        fetchedOrderDurableNote.source || "missing"
      } note_mode=${fetchedOrderDurableNote.mode || "missing"} note_take_now=${
        fetchedOrderDurableNote.takeNow === null ? "null" : String(fetchedOrderDurableNote.takeNow)
      } marker_recognition_path=${markerRecognitionPath}`,
    );

    const resolvedOrderFallback = orderFallbackAfterFetch.markerFound ? orderFallbackAfterFetch : payloadOrderFallback;
    const resolvedDurableNoteFallback = fetchedOrderDurableNote.markerFound ? fetchedOrderDurableNote : payloadDurableNote;
    const resolvedIntentFallback = resolvedOrderFallback.markerFound ? resolvedOrderFallback : resolvedDurableNoteFallback;

    const shouldTryPendingIntent =
      !recognizedByLineItemIntent &&
      !recognizedByLineMarker &&
      !recognizedByFallbackMarker &&
      !recognizedByOrderFallbackMarker &&
      !recognizedByDurableNoteMarker;
    const pendingIntentMatch = shouldTryPendingIntent
      ? await tryMatchPendingIntent({
          shop,
          payloadSourceName,
          order,
        })
      : { attempted: false, reason: "skipped_due_to_order_properties", candidates: [], matchedIntent: null };
    const recognizedByPendingIntent = Boolean(pendingIntentMatch.matchedIntent);
    if (shouldTryPendingIntent && recognizedByPendingIntent) {
      markerRecognitionPath = "pending_intent";
    }
    logDebug(
      "PENDING INTENT MATCH",
      `order_id=${order.id} attempted=${String(pendingIntentMatch.attempted)} reason=${pendingIntentMatch.reason} candidate_count=${
        pendingIntentMatch.candidates.length
      } matched_intent_id=${pendingIntentMatch.matchedIntent?.id || "none"} candidates=${JSON.stringify(pendingIntentMatch.candidates)} final_recognition_path=${markerRecognitionPath}`,
    );

    if (
      !recognizedByLineItemIntent &&
      !recognizedByLineMarker &&
      !recognizedByFallbackMarker &&
      !recognizedByOrderFallbackMarker &&
      !recognizedByDurableNoteMarker &&
      !recognizedByPendingIntent
    ) {
      logDebugError(
        "EARLY EXIT",
        `reason=no Macron POS marker or pending_intent_match order_id=${order.id} expected_marker=${expectedMarkerKey}:${expectedMarkerValue} fallback_marker=${expectedFallbackMarkerKey}:${expectedMarkerValue} order_fallback_marker=${expectedOrderFallbackMarkerKey}:${expectedMarkerValue} durable_note_marker=[MSH_POS] source=macron_pos source_name=${
          payloadSourceName || "unknown"
        } pending_intent_attempted=${String(pendingIntentMatch.attempted)} pending_intent_reason=${pendingIntentMatch.reason}`,
      );
      logDebug("FINAL RESULT: skipped", "reason=no Macron POS marker or pending intent match");
      return new Response();
    }

    logDebug(
      "MARKER DETECTION DECISION",
      `order_id=${order.id} line_item_intent_found=${String(recognizedByLineItemIntent)} line_marker_found=${String(
        recognizedByLineMarker,
      )} fallback_marker_found=${String(recognizedByFallbackMarker)} order_fallback_marker_found=${String(
        recognizedByOrderFallbackMarker,
      )} note_marker_found=${String(recognizedByDurableNoteMarker)} pending_intent_found=${String(
        recognizedByPendingIntent,
      )} pending_intent_id=${pendingIntentMatch.matchedIntent?.id || "none"} recognition_path=${markerRecognitionPath}`,
    );
    if (!recognizedByLineItemIntent && !recognizedByLineMarker && recognizedByFallbackMarker) {
      logDebug(
        "MARKER FALLBACK RECOVERY",
        `order_id=${order.id} likely_live_pos_property_stripping=true line_item_intent_found=false line_marker_found=false fallback_marker_found=true`,
      );
    }
    if (!recognizedByLineItemIntent && !recognizedByLineMarker && !recognizedByFallbackMarker && recognizedByOrderFallbackMarker) {
      logDebug(
        "MARKER FALLBACK RECOVERY",
        `order_id=${order.id} likely_live_pos_property_stripping=true line_item_intent_found=false line_marker_found=false fallback_marker_found=false order_fallback_marker_found=true`,
      );
    }
    if (
      !recognizedByLineItemIntent &&
      !recognizedByLineMarker &&
      !recognizedByFallbackMarker &&
      !recognizedByOrderFallbackMarker &&
      recognizedByDurableNoteMarker
    ) {
      logDebug(
        "MARKER FALLBACK RECOVERY",
        `order_id=${order.id} likely_live_pos_property_stripping=true line_item_intent_found=false line_marker_found=false fallback_marker_found=false order_fallback_marker_found=false note_marker_found=true`,
      );
    }
    logDebug(
      "ORDER-LEVEL FALLBACK INTENT",
      `order_id=${order.id} found=${String(resolvedOrderFallback.markerFound)} source=${resolvedOrderFallback.source || "missing"} mode=${
        resolvedOrderFallback.mode || "missing"
      } take_now=${
        resolvedOrderFallback.takeNow === null ? "null" : String(resolvedOrderFallback.takeNow)
      } bundle_summary_present=${String(Boolean(resolvedOrderFallback.bundleSummary))}`,
    );
    logDebug(
      "DURABLE NOTE FALLBACK INTENT",
      `order_id=${order.id} found=${String(resolvedDurableNoteFallback.markerFound)} source=${resolvedDurableNoteFallback.source || "missing"} mode=${
        resolvedDurableNoteFallback.mode || "missing"
      } take_now=${
        resolvedDurableNoteFallback.takeNow === null ? "null" : String(resolvedDurableNoteFallback.takeNow)
      } bundle_summary_present=${String(Boolean(resolvedDurableNoteFallback.bundleSummary))}`,
    );


    const foNodes = order.fulfillmentOrders?.nodes || [];
    logDebug("FULFILLMENT ORDER COUNT", `order_id=${order.id} count=${foNodes.length}`);

    const eligibleOrderLineGids = new Set();
    const eligibleOrderLineNumericIds = new Set();
    const eligibleOrderLines = [];
    const lineDecisions = [];
    const simplifiedOrderLines = [];

    let takeTodayEligibleCount = 0;
    let splitEligibleCount = 0;
    let orderInCount = 0;
    let feeSystemCount = 0;
    const pendingIntentFallbackOnly =
      !recognizedByLineItemIntent &&
      !recognizedByLineMarker &&
      !recognizedByFallbackMarker &&
      !recognizedByOrderFallbackMarker &&
      !recognizedByDurableNoteMarker &&
      recognizedByPendingIntent;
    const orderLevelFallbackOnly =
      !recognizedByLineItemIntent &&
      !recognizedByLineMarker &&
      !recognizedByFallbackMarker &&
      (recognizedByOrderFallbackMarker || recognizedByDurableNoteMarker);

    const allOrderLines = [];
    const bundleParents = [];

    for (const orderLine of order.lineItems?.nodes || []) {
      const rawCustomAttributes = Array.isArray(orderLine?.customAttributes) ? orderLine.customAttributes : [];
      const attributes = attributeMap(orderLine.customAttributes);
      const hasMshSource = normalizeSource(attributes._msh_source) === expectedMarkerValue;
      const hasIntentKeys = Object.keys(attributes).some((key) => key.startsWith("_msh_intent_"));
      logDebug(
        "LINE ITEM RAW PROPERTIES",
        `line_title=${String(orderLine?.title || "")} quantity=${String(orderLine?.quantity || "")} variant_id=${String(
          orderLine?.variant?.id || "",
        )} raw_properties=${JSON.stringify(rawCustomAttributes)} has_msh_source=${String(hasMshSource)} has_msh_intent_keys=${String(hasIntentKeys)}`,
      );
      logDebug(
        hasMshSource && hasIntentKeys ? "LINE ITEM INTENT FOUND" : "LINE ITEM INTENT NOT FOUND",
        `line_title=${String(orderLine?.title || "")} quantity=${String(orderLine?.quantity || "")} variant_id=${String(
          orderLine?.variant?.id || "",
        )} has_msh_source=${String(hasMshSource)} has_msh_intent_keys=${String(hasIntentKeys)}`,
      );
      const { source, rawMode, mode, rawTakeNow, takeNow, eligible, feeOrSystem, feeOrSystemReason } =
        evaluateLineEligibility({
          attributes,
          title: orderLine?.title || "",
          sku: orderLine?.sku || "",
        });
      const lineItemIntent = parseLineItemIntentFromAttributes(attributes);
      const lineIntentMode = lineItemIntent.found ? lineItemIntent.mode : "";
      const lineIntentTakeNow = lineItemIntent.found ? lineItemIntent.takeNow : null;
      const lineIntentSource = lineItemIntent.found ? lineItemIntent.source : "";
      const recoveredSource = orderLevelFallbackOnly && !feeOrSystem && source !== "macron_pos" ? "macron_pos" : source;
      const recoveredMode =
        orderLevelFallbackOnly && !feeOrSystem && mode === "" ? resolvedIntentFallback.mode : mode;
      const recoveredTakeNow =
        orderLevelFallbackOnly && !feeOrSystem && takeNow === null ? resolvedIntentFallback.takeNow : takeNow;
      const effectiveSource =
        pendingIntentFallbackOnly && !feeOrSystem && recoveredSource !== "macron_pos" ? "macron_pos" : recoveredSource;
      const effectiveMode =
        pendingIntentFallbackOnly && !feeOrSystem && recoveredMode === ""
          ? normalizeMode(pendingIntentMatch.matchedIntent?.fulfillmentMode)
          : recoveredMode;
      const effectiveTakeNow =
        pendingIntentFallbackOnly && !feeOrSystem && recoveredTakeNow === null
          ? pendingIntentMatch.matchedIntent?.takeNow
          : recoveredTakeNow;
      const intentAuthoritativeSource = lineItemIntent.found ? lineIntentSource : effectiveSource;
      const intentAuthoritativeMode = lineItemIntent.found && lineIntentMode !== "" ? lineIntentMode : effectiveMode;
      const intentAuthoritativeTakeNow =
        lineItemIntent.found && lineIntentTakeNow !== null ? lineIntentTakeNow : effectiveTakeNow;
      const recoveredEligible =
        intentAuthoritativeSource === "macron_pos" &&
        !feeOrSystem &&
        shouldFulfillNowForMode(intentAuthoritativeMode, intentAuthoritativeTakeNow);
      const intentRecoverySource =
        recoveredEligible && !eligible
          ? lineItemIntent.found
            ? "line_item_intent_properties"
            : resolvedOrderFallback.markerFound
            ? "order_level_fallback"
            : pendingIntentFallbackOnly
              ? "pending_intent_fallback"
              : "durable_note_fallback"
          : "line_level";
      const orderLineGid = String(orderLine?.id || "");
      const orderLineNumericId = parseNumericId(orderLineGid);
      const parsedBundleComponents = parseBundleComponentsFromAttributes(
        attributes,
        intentAuthoritativeMode,
        intentAuthoritativeTakeNow,
      );
      const isBundleParent = Array.isArray(parsedBundleComponents) && parsedBundleComponents.length > 0;
      const effectiveEligible = recoveredEligible;

      if (feeOrSystem) feeSystemCount += 1;
      if (intentAuthoritativeMode === "order_in") orderInCount += 1;
      if (intentAuthoritativeMode === "take_today" && intentAuthoritativeSource === "macron_pos" && !feeOrSystem) takeTodayEligibleCount += 1;
      if (intentAuthoritativeMode === "split" && intentAuthoritativeSource === "macron_pos" && !feeOrSystem && intentAuthoritativeTakeNow === true)
        splitEligibleCount += 1;

      if (isBundleParent) {
        logDebug(
          "BUNDLE PARENT EVALUATION",
          `order_line_id=${orderLineGid} title=${orderLine?.title || ""} mode=${mode || "missing"} take_now=${
            takeNow === null ? "null" : String(takeNow)
          } recovered_mode=${effectiveMode || "missing"} recovered_take_now=${
            effectiveTakeNow === null ? "null" : String(effectiveTakeNow)
          } fee_or_system=${String(feeOrSystem)} fee_reason=${feeOrSystemReason} eligible=${String(
            effectiveEligible,
          )} fallback_parent_line_used=${String(effectiveEligible)} intent_recovery_source=${intentRecoverySource}`,
        );
      }

      const decision = {
        orderLineGid,
        title: orderLine?.title || "",
        sku: orderLine?.sku || "",
        quantity: Number(orderLine?.quantity || 0),
        source: intentAuthoritativeSource,
        rawMode,
        parsedMode: intentAuthoritativeMode,
        rawTakeNow,
        parsedTakeNow: intentAuthoritativeTakeNow,
        feeOrSystem,
        feeOrSystemReason,
        isBundleParent,
        bundleComponents: parsedBundleComponents || [],
        eligible: effectiveEligible,
        intentRecoverySource,
        attributes: summarizeAttributes(attributes),
      };

      lineDecisions.push(decision);
      simplifiedOrderLines.push({
        id: orderLineGid,
        numericId: orderLineNumericId,
        title: orderLine?.title || "",
        sku: orderLine?.sku || "",
        quantity: Number(orderLine?.quantity || 0),
        attributes: summarizeAttributes(attributes),
        eligibility: {
          source: intentAuthoritativeSource,
          mode: intentAuthoritativeMode,
          takeNow: intentAuthoritativeTakeNow,
          feeOrSystem,
          feeOrSystemReason,
          isBundleParent,
          eligible: effectiveEligible,
          intentRecoverySource,
        },
      });

      allOrderLines.push({
        orderLineGid,
        orderLineNumericId,
        title: orderLine?.title || "",
        sku: orderLine?.sku || "",
        quantity: Number(orderLine?.quantity || 0),
        source: effectiveSource,
        mode: effectiveMode,
        takeNow: effectiveTakeNow,
        feeOrSystem,
        isBundleParent,
        attributes,
      });

      if (isBundleParent) {
        bundleParents.push({
          orderLineGid,
          orderLineNumericId,
          title: orderLine?.title || "",
          parsedBundleComponents,
        });
      }

      if (effectiveEligible) {
        if (orderLineGid) eligibleOrderLineGids.add(orderLineGid);
        if (orderLineNumericId) eligibleOrderLineNumericIds.add(orderLineNumericId);
        eligibleOrderLines.push({
          orderLineGid,
          orderLineNumericId,
          title: orderLine?.title || "",
          quantity: Number(orderLine?.quantity || 0),
          mode: effectiveMode,
          takeNow: effectiveTakeNow,
        });
      }
    }

    logDebug(
      "ELIGIBLE ORDER LINE COUNT",
      `order_id=${order.id} eligible_count=${eligibleOrderLines.length} take_today_eligible_count=${takeTodayEligibleCount} split_eligible_count=${splitEligibleCount} order_in_count=${orderInCount} fee_system_count=${feeSystemCount}`,
    );
    if (bundleParents.length > 0) {
      const unmatchedBundleComponents = [];
      const alreadyMatchedLineIds = new Set([...eligibleOrderLineGids]);
      const candidateLines = allOrderLines.filter((line) => !line.feeOrSystem && !line.isBundleParent);
      const bundleMappings = [];

      for (const parent of bundleParents) {
        for (const component of parent.parsedBundleComponents || []) {
          if (!component.fulfillNow) {
            bundleMappings.push({
              parentLineId: parent.orderLineGid,
              parentTitle: parent.title,
              componentIndex: component.index,
              componentTitle: component.componentTitle,
              variantTitle: component.variantTitle,
              fulfillNow: false,
              matchedOrderLineId: "",
              matchScore: 0,
              skipped: "order_later",
            });
            continue;
          }
          let bestLine = null;
          let bestScore = 0;
          for (const candidate of candidateLines) {
            if (!candidate.orderLineGid || alreadyMatchedLineIds.has(candidate.orderLineGid)) continue;
            const score = scoreBundleComponentCandidate(candidate.title, component.componentTitle, component.variantTitle);
            if (score > bestScore) {
              bestLine = candidate;
              bestScore = score;
            }
          }
          if (bestLine && bestScore > 0) {
            eligibleOrderLineGids.add(bestLine.orderLineGid);
            if (bestLine.orderLineNumericId) eligibleOrderLineNumericIds.add(bestLine.orderLineNumericId);
            eligibleOrderLines.push({
              orderLineGid: bestLine.orderLineGid,
              orderLineNumericId: bestLine.orderLineNumericId,
              title: bestLine.title,
              quantity: bestLine.quantity,
              mode: "bundle_component",
              takeNow: true,
            });
            alreadyMatchedLineIds.add(bestLine.orderLineGid);
            bundleMappings.push({
              parentLineId: parent.orderLineGid,
              parentTitle: parent.title,
              componentIndex: component.index,
              componentTitle: component.componentTitle,
              variantTitle: component.variantTitle,
              fulfillNow: true,
              matchedOrderLineId: bestLine.orderLineGid,
              matchedOrderLineTitle: bestLine.title,
              matchScore: bestScore,
            });
          } else {
            unmatchedBundleComponents.push({
              parentLineId: parent.orderLineGid,
              parentTitle: parent.title,
              componentIndex: component.index,
              componentTitle: component.componentTitle,
              variantTitle: component.variantTitle,
              fulfillNow: true,
            });
            bundleMappings.push({
              parentLineId: parent.orderLineGid,
              parentTitle: parent.title,
              componentIndex: component.index,
              componentTitle: component.componentTitle,
              variantTitle: component.variantTitle,
              fulfillNow: true,
              matchedOrderLineId: "",
              matchScore: 0,
            });
          }
        }
      }

      logDebug("BUNDLE COMPONENT MAPPING JSON", `order_id=${order.id} data=${JSON.stringify(bundleMappings)}`);
      if (unmatchedBundleComponents.length > 0) {
        logDebug(
          "BUNDLE COMPONENTS UNMATCHED",
          `order_id=${order.id} unmatched_count=${unmatchedBundleComponents.length} bypassed_for_parent_line_fulfillment=true data=${JSON.stringify(
            unmatchedBundleComponents,
          )}`,
        );
      }
      logDebug(
        "BUNDLE COMPONENT MATCHING STATUS",
        `order_id=${order.id} candidate_child_lines=${candidateLines.length} parent_fallback_mode=enabled`,
      );
    }
    logDebug("ORDER LINE DECISIONS JSON", `order_id=${order.id} data=${JSON.stringify(lineDecisions)}`);
    logDebug("SIMPLIFIED ORDER LINES JSON", `order_id=${order.id} data=${JSON.stringify(simplifiedOrderLines)}`);
    logDebug(
      "RECOVERED FULFILMENT INTENT",
      `order_id=${order.id} eligible_lines=${eligibleOrderLines.length} take_today_lines=${takeTodayEligibleCount} split_take_now_lines=${splitEligibleCount} order_in_lines=${orderInCount} fee_or_system_lines=${feeSystemCount}`,
    );

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
        const foLineId = String(foLineItem.id || "");
        const quantity = Number(foLineItem.remainingQuantity || 0);

        const matchedByGid = Boolean(orderLineGid && eligibleOrderLineGids.has(orderLineGid));
        const matchedByNumericId = Boolean(
          !matchedByGid && orderLineNumericId && eligibleOrderLineNumericIds.has(orderLineNumericId),
        );
        const matched = matchedByGid || matchedByNumericId;
        const validFoLineId = foLineId.startsWith("gid://shopify/FulfillmentOrderLineItem/");

        const foDecision = {
          fulfillmentOrderId: fulfillmentOrder.id,
          fulfillmentOrderStatus: fulfillmentOrder.status,
          fulfillmentOrderLineId: foLineId,
          linkedOrderLineId: orderLineGid,
          linkedOrderLineNumericId: orderLineNumericId,
          linkedOrderLineTitle: linkedOrderLine?.title || "",
          remainingQuantity: quantity,
          matchedByGid,
          matchedByNumericId,
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
            title: linkedOrderLine?.title || "",
          },
          matchedBy: {
            gid: matchedByGid,
            numericId: matchedByNumericId,
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
