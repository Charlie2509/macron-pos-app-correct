import {authenticate, unauthenticated} from "../shopify.server";

function responseHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

function jsonResponse(body, status) {
  return Response.json(body, {
    status: status,
    headers: responseHeaders(),
  });
}

function toText(value) {
  if (value === null || value === undefined) {
    return "";
  }
  return String(value);
}

function trimEdgeWhitespace(value) {
  return toText(value).replace(/^\s+|\s+$/g, "");
}

function normalizeCurrency(value) {
  var text = trimEdgeWhitespace(value).toUpperCase();
  if (/^[A-Z]{3}$/.test(text)) {
    return text;
  }
  return "GBP";
}

function validateCode(rawCode) {
  var code = trimEdgeWhitespace(rawCode);
  if (code === "") {
    return {ok: false, error: "Enter a card code"};
  }
  if (code.length < 8 || code.length > 20) {
    return {ok: false, error: "Code must be between 8 and 20 characters"};
  }
  if (!/^[A-Za-z0-9]+$/.test(code)) {
    return {ok: false, error: "Code can only contain letters and numbers"};
  }
  return {ok: true, code: code};
}

function validateAmount(rawAmount) {
  var value = trimEdgeWhitespace(rawAmount).replace(/,/g, "");
  if (/^GBP\s*/i.test(value)) {
    value = trimEdgeWhitespace(value.replace(/^GBP\s*/i, ""));
  }
  if (value === "") {
    return {ok: false, error: "Enter an amount"};
  }
  if (!/^\d+(\.\d{1,2})?$/.test(value)) {
    return {ok: false, error: "Enter a valid GBP amount"};
  }
  var parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return {ok: false, error: "Amount must be greater than 0"};
  }
  return {ok: true, amount: parsed.toFixed(2)};
}

function extractShopDomain(dest) {
  var source = trimEdgeWhitespace(dest);
  if (source === "") {
    return "";
  }
  var match = source.match(/^https?:\/\/([^/]+)/i);
  if (match && match[1]) {
    return trimEdgeWhitespace(match[1]).toLowerCase();
  }
  return trimEdgeWhitespace(source).toLowerCase();
}

function firstGraphQlError(errors) {
  if (!errors || !Array.isArray(errors) || errors.length === 0) {
    return "";
  }
  var first = errors[0];
  if (first && first.message) {
    return toText(first.message);
  }
  return "GraphQL request failed";
}

function isDuplicateCodeUserError(userError) {
  if (!userError) {
    return false;
  }
  var message = trimEdgeWhitespace(userError.message).toLowerCase();
  var code = trimEdgeWhitespace(userError.code).toLowerCase();
  var field = "";
  if (userError.field && Array.isArray(userError.field)) {
    field = userError.field.join(".").toLowerCase();
  }
  if (code.indexOf("taken") > -1 || code.indexOf("duplicate") > -1 || code.indexOf("already") > -1) {
    return true;
  }
  if (field.indexOf("code") > -1 && (message.indexOf("already") > -1 || message.indexOf("taken") > -1 || message.indexOf("exists") > -1)) {
    return true;
  }
  return false;
}

function firstUserError(userErrors) {
  if (!userErrors || !Array.isArray(userErrors) || userErrors.length === 0) {
    return null;
  }
  return userErrors[0];
}

const GIFT_CARD_CREATE_MUTATION = `#graphql
  mutation GiftCardCreateFromPos($input: GiftCardCreateInput!) {
    giftCardCreate(input: $input) {
      giftCard {
        id
        lastCharacters
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

export const action = async ({request}) => {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: responseHeaders(),
    });
  }

  if (request.method !== "POST") {
    return jsonResponse({ok: false, error: "method_not_allowed"}, 405);
  }

  var posContext = null;
  try {
    posContext = await authenticate.pos(request);
  } catch (authError) {
    return jsonResponse({ok: false, error: "Unauthorized POS request"}, 401);
  }

  var body = null;
  try {
    body = await request.json();
  } catch (jsonError) {
    return jsonResponse({ok: false, error: "Invalid JSON payload"}, 400);
  }

  var codeValidation = validateCode(body && body.code ? body.code : "");
  var amountValidation = validateAmount(body && body.amount ? body.amount : "");
  var note = trimEdgeWhitespace(body && body.note ? body.note : "");
  var currency = normalizeCurrency(body && body.currency ? body.currency : "GBP");
  var shopFromBody = trimEdgeWhitespace(body && body.shop ? body.shop : "");
  var fieldErrors = {};

  if (!codeValidation.ok) {
    fieldErrors.code = codeValidation.error;
  }
  if (!amountValidation.ok) {
    fieldErrors.amount = amountValidation.error;
  }
  if (Object.keys(fieldErrors).length > 0) {
    return jsonResponse({
      ok: false,
      error: "Please correct the highlighted fields.",
      fieldErrors: fieldErrors,
    }, 400);
  }

  var sessionToken = posContext && posContext.sessionToken ? posContext.sessionToken : null;
  var shopFromToken = "";
  if (sessionToken && sessionToken.dest) {
    shopFromToken = extractShopDomain(sessionToken.dest);
  }

  var shopDomain = "";
  if (shopFromBody !== "") {
    shopDomain = extractShopDomain(shopFromBody);
  }
  if (shopDomain === "") {
    shopDomain = shopFromToken;
  }
  if (shopDomain === "") {
    return jsonResponse({ok: false, error: "Could not resolve shop for activation."}, 400);
  }

  if (note === "") {
    note = "Activated via Macron POS gift card tool";
  }

  var adminContext = null;
  try {
    adminContext = await unauthenticated.admin(shopDomain);
  } catch (contextError) {
    return jsonResponse({ok: false, error: "Shop is not installed or session is unavailable."}, 403);
  }

  var admin = adminContext && adminContext.admin ? adminContext.admin : null;
  if (!admin) {
    return jsonResponse({ok: false, error: "Admin API client unavailable."}, 500);
  }

  var mutationInput = {
    code: codeValidation.code,
    initialValue: amountValidation.amount,
    note: note,
  };

  var response;
  try {
    response = await admin.graphql(GIFT_CARD_CREATE_MUTATION, {
      variables: {
        input: mutationInput,
      },
    });
  } catch (mutationError) {
    return jsonResponse({
      ok: false,
      error: "Could not reach Shopify Admin API.",
    }, 502);
  }

  var responseJson = null;
  try {
    responseJson = await response.json();
  } catch (responseParseError) {
    return jsonResponse({
      ok: false,
      error: "Unexpected Admin API response.",
    }, 502);
  }

  if (responseJson && responseJson.errors && responseJson.errors.length > 0) {
    return jsonResponse({
      ok: false,
      error: firstGraphQlError(responseJson.errors),
    }, 400);
  }

  var createPayload = null;
  if (responseJson && responseJson.data && responseJson.data.giftCardCreate) {
    createPayload = responseJson.data.giftCardCreate;
  }

  if (!createPayload) {
    return jsonResponse({
      ok: false,
      error: "Gift card creation payload missing.",
    }, 502);
  }

  var userErrors = createPayload.userErrors;
  if (userErrors && Array.isArray(userErrors) && userErrors.length > 0) {
    var duplicate = false;
    for (var i = 0; i < userErrors.length; i += 1) {
      if (isDuplicateCodeUserError(userErrors[i])) {
        duplicate = true;
        break;
      }
    }

    if (duplicate) {
      return jsonResponse({
        ok: false,
        error: "This gift card code is already active.",
        fieldErrors: {
          code: "This gift card code is already active.",
        },
      }, 409);
    }

    var firstError = firstUserError(userErrors);
    var message = firstError && firstError.message ? toText(firstError.message) : "Gift card could not be created.";
    var mappedFieldErrors = {};
    if (firstError && firstError.field && Array.isArray(firstError.field)) {
      var fieldPath = firstError.field.join(".").toLowerCase();
      if (fieldPath.indexOf("code") > -1) {
        mappedFieldErrors.code = message;
      }
      if (fieldPath.indexOf("initial") > -1 || fieldPath.indexOf("amount") > -1) {
        mappedFieldErrors.amount = message;
      }
    }
    return jsonResponse({
      ok: false,
      error: message,
      fieldErrors: mappedFieldErrors,
    }, 400);
  }

  var giftCard = createPayload.giftCard;
  if (!giftCard || !giftCard.id) {
    return jsonResponse({
      ok: false,
      error: "Gift card was not created.",
    }, 502);
  }

  var codeLast4 = "";
  if (giftCard.lastCharacters) {
    codeLast4 = toText(giftCard.lastCharacters);
  } else {
    codeLast4 = codeValidation.code.slice(-4);
  }

  return jsonResponse({
    ok: true,
    giftCardId: toText(giftCard.id),
    codeLast4: codeLast4,
    amount: amountValidation.amount,
    currency: currency,
  }, 200);
};
