import { authenticate, sessionStorage } from "../shopify.server";

const ORDER_WITH_FULFILLMENT_ORDERS_QUERY = `#graphql
  query MacronOrderForFulfillment($orderId: ID!) {
    order(id: $orderId) {
      id
      name
      note
      customAttributes {
        key
        value
      }
      displayFulfillmentStatus
      lineItems(first: 250) {
        nodes {
          id
          title
          sku
          quantity
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

async function diagnoseAdminUnavailable(shop) {
  const details = {
    offlineSessionLookupAttempted: false,
    foundSessions: 0,
    foundOfflineSessions: 0,
    lookupError: "",
  };

  if (!shop) return details;

  try {
    details.offlineSessionLookupAttempted = true;
    const sessions = await sessionStorage.findSessionsByShop(shop);
    details.foundSessions = sessions.length;
    details.foundOfflineSessions = sessions.filter((session) => !session?.isOnline).length;
  } catch (error) {
    details.lookupError = error?.message || String(error);
  }

  return details;
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
    const { payload, topic, shop, admin } = await authenticate.webhook(request);
    logDebug(
      "WEBHOOK START",
      `topic=${topic} shop=${shop} payload_order_id=${payload?.id || "unknown"}`,
    );

    if (!admin) {
      const adminDiag = await diagnoseAdminUnavailable(shop);
      logDebugError(
        "EARLY EXIT",
        `reason=admin client unavailable shop=${shop} order_id=${payload?.id || "unknown"} offline_lookup_attempted=${
          adminDiag.offlineSessionLookupAttempted
        } found_sessions=${adminDiag.foundSessions} found_offline_sessions=${adminDiag.foundOfflineSessions} lookup_error=${
          adminDiag.lookupError || "none"
        }`,
      );
      logDebug(
        "FINAL RESULT: failed",
        `reason=admin client unavailable shop=${shop} order_id=${payload?.id || "unknown"} offline_lookup_attempted=${
          adminDiag.offlineSessionLookupAttempted
        }`,
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

    logDebug(
      "MARKER DETECTION RAW PAYLOAD",
      `order_id=${payload?.id || "unknown"} expected_marker=${expectedMarkerKey}:${expectedMarkerValue} found_in_raw_payload=${String(
        markerFoundInRawPayload,
      )} marked_line_count=${markedPayloadLines.length} fallback_marker=${expectedFallbackMarkerKey}:${expectedMarkerValue} fallback_found_in_raw_payload=${String(
        fallbackMarkerFoundInRawPayload,
      )} fallback_marked_line_count=${fallbackMarkedPayloadLines.length} order_fallback_marker=${expectedOrderFallbackMarkerKey}:${expectedMarkerValue} order_fallback_found_in_raw_payload=${String(
        payloadOrderFallback.markerFound,
      )} note_token_found_in_raw_payload=${String(payloadDurableNote.tokenFound)} note_marker_found_in_raw_payload=${String(
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

    const markerFoundAfterFetch = hasMacronPosMarkerInOrderLineAttributes(order.lineItems?.nodes || []);
    const fallbackMarkerFoundAfterFetch = hasMacronPosFallbackMarkerInOrderLineAttributes(order.lineItems?.nodes || []);
    const fetchedOrderAttributes = attributeMap(order.customAttributes || []);
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
    const markerRecognitionPath = recognizedByLineMarker
      ? "line_item_marker"
      : recognizedByFallbackMarker
        ? "fallback_marker"
        : recognizedByOrderFallbackMarker
          ? "order_level_fallback_marker"
          : recognizedByDurableNoteMarker
            ? "durable_note_marker"
            : "none";
    logDebug(
      "MARKER DETECTION POST FETCH",
      `order_id=${order.id} expected_marker=${expectedMarkerKey}:${expectedMarkerValue} used_fallback_fetch=${String(
        usedFallbackOrderFetchForMarkerDetection,
      )} marker_found_after_fetch=${String(markerFoundAfterFetch)} fallback_marker=${expectedFallbackMarkerKey}:${expectedMarkerValue} fallback_marker_found_after_fetch=${String(
        fallbackMarkerFoundAfterFetch,
      )} order_fallback_marker=${expectedOrderFallbackMarkerKey}:${expectedMarkerValue} order_fallback_found_after_fetch=${String(
        orderFallbackAfterFetch.markerFound,
      )} note_token_found_after_fetch=${String(fetchedOrderDurableNote.tokenFound)} note_marker_found_after_fetch=${String(
        fetchedOrderDurableNote.markerFound,
      )} note_source=${fetchedOrderDurableNote.source || "missing"} note_mode=${fetchedOrderDurableNote.mode || "missing"} note_take_now=${
        fetchedOrderDurableNote.takeNow === null ? "null" : String(fetchedOrderDurableNote.takeNow)
      } marker_recognition_path=${markerRecognitionPath}`,
    );

    const resolvedOrderFallback = orderFallbackAfterFetch.markerFound ? orderFallbackAfterFetch : payloadOrderFallback;
    const resolvedDurableNoteFallback = fetchedOrderDurableNote.markerFound ? fetchedOrderDurableNote : payloadDurableNote;
    const resolvedIntentFallback = resolvedOrderFallback.markerFound ? resolvedOrderFallback : resolvedDurableNoteFallback;
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

    if (!recognizedByLineMarker && !recognizedByFallbackMarker && !recognizedByOrderFallbackMarker && !recognizedByDurableNoteMarker) {
      logDebugError(
        "EARLY EXIT",
        `reason=no Macron POS marker in payload_or_fetched_order order_id=${order.id} expected_marker=${expectedMarkerKey}:${expectedMarkerValue} fallback_marker=${expectedFallbackMarkerKey}:${expectedMarkerValue} order_fallback_marker=${expectedOrderFallbackMarkerKey}:${expectedMarkerValue} durable_note_marker=[MSH_POS] source=macron_pos source_name=${
          payloadSourceName || "unknown"
        }`,
      );
      logDebug("FINAL RESULT: skipped", "reason=no Macron POS marker in payload or fetched order");
      return new Response();
    }
    logDebug(
      "MARKER DETECTION DECISION",
      `order_id=${order.id} line_marker_found=${String(recognizedByLineMarker)} fallback_marker_found=${String(
        recognizedByFallbackMarker,
      )} order_fallback_marker_found=${String(recognizedByOrderFallbackMarker)} note_marker_found=${String(
        recognizedByDurableNoteMarker,
      )} recognition_path=${markerRecognitionPath}`,
    );
    if (!recognizedByLineMarker && recognizedByFallbackMarker) {
      logDebug(
        "MARKER FALLBACK RECOVERY",
        `order_id=${order.id} likely_live_pos_property_stripping=true line_marker_found=false fallback_marker_found=true`,
      );
    }
    if (!recognizedByLineMarker && !recognizedByFallbackMarker && recognizedByOrderFallbackMarker) {
      logDebug(
        "MARKER FALLBACK RECOVERY",
        `order_id=${order.id} likely_live_pos_property_stripping=true line_marker_found=false fallback_marker_found=false order_fallback_marker_found=true`,
      );
    }
    if (
      !recognizedByLineMarker &&
      !recognizedByFallbackMarker &&
      !recognizedByOrderFallbackMarker &&
      recognizedByDurableNoteMarker
    ) {
      logDebug(
        "MARKER FALLBACK RECOVERY",
        `order_id=${order.id} likely_live_pos_property_stripping=true line_marker_found=false fallback_marker_found=false order_fallback_marker_found=false note_marker_found=true`,
      );
    }

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
    const orderLevelFallbackOnly =
      !recognizedByLineMarker &&
      !recognizedByFallbackMarker &&
      (recognizedByOrderFallbackMarker || recognizedByDurableNoteMarker);

    const allOrderLines = [];
    const bundleParents = [];

    for (const orderLine of order.lineItems?.nodes || []) {
      const attributes = attributeMap(orderLine.customAttributes);
      const { source, rawMode, mode, rawTakeNow, takeNow, eligible, feeOrSystem, feeOrSystemReason } =
        evaluateLineEligibility({
          attributes,
          title: orderLine?.title || "",
          sku: orderLine?.sku || "",
        });
      const recoveredSource = orderLevelFallbackOnly && !feeOrSystem && source !== "macron_pos" ? "macron_pos" : source;
      const recoveredMode =
        orderLevelFallbackOnly && !feeOrSystem && mode === "" ? resolvedIntentFallback.mode : mode;
      const recoveredTakeNow =
        orderLevelFallbackOnly && !feeOrSystem && takeNow === null ? resolvedIntentFallback.takeNow : takeNow;
      const recoveredEligible =
        recoveredSource === "macron_pos" &&
        !feeOrSystem &&
        shouldFulfillNowForMode(recoveredMode, recoveredTakeNow);
      const intentRecoverySource =
        recoveredEligible && !eligible
          ? resolvedOrderFallback.markerFound
            ? "order_level_fallback"
            : "durable_note_fallback"
          : "line_level";
      const orderLineGid = String(orderLine?.id || "");
      const orderLineNumericId = parseNumericId(orderLineGid);
      const parsedBundleComponents = parseBundleComponentsFromAttributes(
        attributes,
        recoveredMode,
        recoveredTakeNow,
      );
      const isBundleParent = Array.isArray(parsedBundleComponents) && parsedBundleComponents.length > 0;
      const effectiveEligible = recoveredEligible;

      if (feeOrSystem) feeSystemCount += 1;
      if (recoveredMode === "order_in") orderInCount += 1;
      if (recoveredMode === "take_today" && recoveredSource === "macron_pos" && !feeOrSystem) takeTodayEligibleCount += 1;
      if (recoveredMode === "split" && recoveredSource === "macron_pos" && !feeOrSystem && recoveredTakeNow === true)
        splitEligibleCount += 1;

      if (isBundleParent) {
        logDebug(
          "BUNDLE PARENT EVALUATION",
          `order_line_id=${orderLineGid} title=${orderLine?.title || ""} mode=${mode || "missing"} take_now=${
            takeNow === null ? "null" : String(takeNow)
          } recovered_mode=${recoveredMode || "missing"} recovered_take_now=${
            recoveredTakeNow === null ? "null" : String(recoveredTakeNow)
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
        source: recoveredSource,
        rawMode,
        parsedMode: recoveredMode,
        rawTakeNow,
        parsedTakeNow: recoveredTakeNow,
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
          source: recoveredSource,
          mode: recoveredMode,
          takeNow: recoveredTakeNow,
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
        source: recoveredSource,
        mode: recoveredMode,
        takeNow: recoveredTakeNow,
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
          mode: recoveredMode,
          takeNow: recoveredTakeNow,
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
