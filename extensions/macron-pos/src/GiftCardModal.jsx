import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { useState } from "preact/hooks";

const APP_BASE_URL = "https://macron-pos-app-correct.onrender.com";
const CODE_MIN = 8;
const CODE_MAX = 20;

function normalizeString(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function validateCode(code) {
  if (!code) return "Enter a gift card code.";
  if (code.length < CODE_MIN || code.length > CODE_MAX) return "Code must be between 8 and 20 characters.";
  if (!/^[A-Za-z0-9]+$/.test(code)) return "Code can only contain letters and numbers.";
  return "";
}

function normalizeAmountInput(value) {
  return normalizeString(value).replace(/,/g, "");
}

function validateAmount(value) {
  const amount = normalizeAmountInput(value);
  if (!amount) return "Enter an amount in GBP.";
  if (!/^\d+(\.\d{1,2})?$/.test(amount)) return "Amount must be a valid GBP value.";
  const parsed = Number(amount);
  if (!Number.isFinite(parsed) || parsed <= 0) return "Amount must be greater than 0.";
  return "";
}

function formatAmount(value) {
  const parsed = Number(normalizeAmountInput(value));
  if (!Number.isFinite(parsed) || parsed <= 0) return "";
  return parsed.toFixed(2);
}

export default async () => {
  render(<GiftCardModal />, document.body);
};

function GiftCardModal() {
  const [code, setCode] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [codeError, setCodeError] = useState("");
  const [amountError, setAmountError] = useState("");
  const [apiError, setApiError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [success, setSuccess] = useState(null);

  function onCodeChange(event) {
    const next = normalizeString(event.currentTarget.value);
    setCode(next);
    if (codeError) {
      setCodeError(validateCode(next));
    }
  }

  function onAmountChange(event) {
    const next = event.currentTarget.value;
    setAmount(next);
    if (amountError) {
      setAmountError(validateAmount(next));
    }
  }

  function onNoteChange(event) {
    setNote(event.currentTarget.value);
  }

  function closeModal() {
    if (shopify && shopify.modal && typeof shopify.modal.close === "function") {
      shopify.modal.close();
      return;
    }
    if (shopify && shopify.action && typeof shopify.action.closeModal === "function") {
      shopify.action.closeModal();
    }
  }

  function resetForm() {
    setCode("");
    setAmount("");
    setNote("");
    setCodeError("");
    setAmountError("");
    setApiError("");
    setConfirming(false);
    setSuccess(null);
    setIsSubmitting(false);
  }

  function validateBeforeConfirm() {
    const nextCodeError = validateCode(code);
    const nextAmountError = validateAmount(amount);
    setCodeError(nextCodeError);
    setAmountError(nextAmountError);

    if (nextCodeError || nextAmountError) {
      return false;
    }

    setApiError("");
    return true;
  }

  async function activateGiftCard() {
    if (isSubmitting) return;

    setIsSubmitting(true);
    setApiError("");

    const sanitizedCode = normalizeString(code);
    const formattedAmount = formatAmount(amount);
    const shopDomain = shopify && shopify.session && shopify.session.shopDomain ? shopify.session.shopDomain : "";

    let response;
    try {
      response = await fetch(APP_BASE_URL + "/api/macron-pos/gift-card", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          shop: shopDomain,
          code: sanitizedCode,
          amount: formattedAmount,
          note: normalizeString(note),
        }),
      });
    } catch (error) {
      setIsSubmitting(false);
      setApiError("Network error. Please check connection and try again.");
      return;
    }

    let payload;
    try {
      payload = await response.json();
    } catch (error) {
      setIsSubmitting(false);
      setApiError("Unexpected server response. Please try again.");
      return;
    }

    if (!response.ok || !payload || !payload.ok) {
      const nextCodeError = payload && payload.fieldErrors && payload.fieldErrors.code ? payload.fieldErrors.code : "";
      const nextAmountError = payload && payload.fieldErrors && payload.fieldErrors.amount ? payload.fieldErrors.amount : "";

      setCodeError(nextCodeError);
      setAmountError(nextAmountError);
      setApiError(payload && payload.error ? payload.error : "Gift card activation failed.");
      setIsSubmitting(false);
      setConfirming(false);
      return;
    }

    setSuccess({
      code: sanitizedCode,
      amount: payload.amount || formattedAmount,
      codeLast4: payload.codeLast4 || "",
    });
    setIsSubmitting(false);
    setConfirming(false);
  }

  if (success) {
    return (
      <s-screen title="Gift Cards">
        <s-scroll-box style="height: 100%;">
          <s-section heading="Gift card activated">
            <s-stack direction="block" gap="base">
              <s-box padding="base" border="base" cornerRadius="large">
                <s-stack direction="block" gap="small">
                  <s-text emphasis="bold">Code: {success.code}</s-text>
                  <s-text>Value loaded: £{success.amount}</s-text>
                  <s-text size="small" appearance="subdued">Last 4: {success.codeLast4 || "Hidden"}</s-text>
                </s-stack>
              </s-box>
              <s-stack direction="inline" gap="small">
                <s-button kind="secondary" onPress={resetForm}>Activate another</s-button>
                <s-button kind="primary" onPress={closeModal}>Close</s-button>
              </s-stack>
            </s-stack>
          </s-section>
        </s-scroll-box>
      </s-screen>
    );
  }

  return (
    <s-screen title="Gift Cards">
      <s-scroll-box style="height: 100%;">
        <s-section heading="Activate Gift Card">
          <s-stack direction="block" gap="base">
            <s-text-field
              label="Card code"
              value={code}
              onInput={onCodeChange}
              error={codeError}
              placeholder="Scan or type code"
              autofocus
            />

            <s-text-field
              label="Amount (GBP)"
              value={amount}
              onInput={onAmountChange}
              error={amountError}
              type="number"
              inputMode="decimal"
              placeholder="0.00"
            />

            <s-text-field
              label="Notes (optional)"
              value={note}
              onInput={onNoteChange}
              placeholder="Internal note"
            />

            {apiError ? <s-banner tone="critical">{apiError}</s-banner> : null}

            {confirming ? (
              <s-box padding="base" border="base" cornerRadius="large">
                <s-stack direction="block" gap="small">
                  <s-text emphasis="bold">Have you taken payment for this gift card?</s-text>
                  <s-stack direction="inline" gap="small">
                    <s-button kind="primary" onPress={activateGiftCard} loading={isSubmitting} disabled={isSubmitting}>
                      Yes, activate now
                    </s-button>
                    <s-button kind="secondary" onPress={() => setConfirming(false)} disabled={isSubmitting}>
                      No, go back
                    </s-button>
                  </s-stack>
                </s-stack>
              </s-box>
            ) : (
              <s-stack direction="inline" gap="small">
                <s-button
                  kind="primary"
                  loading={isSubmitting}
                  disabled={isSubmitting}
                  onPress={() => {
                    if (validateBeforeConfirm()) {
                      setConfirming(true);
                    }
                  }}
                >
                  Activate gift card
                </s-button>
                <s-button kind="secondary" onPress={closeModal} disabled={isSubmitting}>Cancel</s-button>
              </s-stack>
            )}
          </s-stack>
        </s-section>
      </s-scroll-box>
    </s-screen>
  );
}
