import "@shopify/ui-extensions/preact";
import {render} from 'preact';
import {useState} from 'preact/hooks';

var ABSOLUTE_ENDPOINT = 'https://macron-pos-app-correct.onrender.com/api/macron-pos/gift-card/activate';
var RELATIVE_ENDPOINT = '/api/macron-pos/gift-card/activate';

export default async function () {
  render(<GiftCardModal />, document.body);
}

function toText(value) {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value);
}

function trimEdgeWhitespace(value) {
  return toText(value).replace(/^\s+|\s+$/g, '');
}

function normalizeCodeInput(value) {
  return trimEdgeWhitespace(value);
}

function parseAmountInput(value) {
  var text = trimEdgeWhitespace(value);
  text = text.replace(/,/g, '');
  if (/^GBP\s*/i.test(text)) {
    text = trimEdgeWhitespace(text.replace(/^GBP\s*/i, ''));
  }
  if (text === '') {
    return {ok: false, error: 'Enter an amount'};
  }
  if (!/^\d+(\.\d{1,2})?$/.test(text)) {
    return {ok: false, error: 'Enter a valid GBP amount'};
  }
  var amountNumber = Number(text);
  if (!isFinite(amountNumber) || amountNumber <= 0) {
    return {ok: false, error: 'Amount must be greater than 0'};
  }
  return {ok: true, amount: amountNumber.toFixed(2)};
}

function validateCodeInput(value) {
  var code = normalizeCodeInput(value);
  if (code === '') {
    return {ok: false, error: 'Enter a card code'};
  }
  if (code.length < 8 || code.length > 20) {
    return {ok: false, error: 'Code must be between 8 and 20 characters'};
  }
  if (!/^[A-Za-z0-9]+$/.test(code)) {
    return {ok: false, error: 'Code can only contain letters and numbers'};
  }
  return {ok: true, code: code};
}

function formatAmountForDisplay(amount) {
  var amountNumber = Number(amount);
  if (!isFinite(amountNumber) || amountNumber <= 0) {
    return '';
  }
  return 'GBP ' + amountNumber.toFixed(2);
}

async function postGiftCardActivation(payload, token) {
  var endpoints = [RELATIVE_ENDPOINT, ABSOLUTE_ENDPOINT];
  var lastError = '';

  for (var i = 0; i < endpoints.length; i += 1) {
    var endpoint = endpoints[i];
    try {
      var headers = {
        'Content-Type': 'application/json',
      };
      if (token !== '') {
        headers.Authorization = 'Bearer ' + token;
      }
      var response = await fetch(endpoint, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(payload),
      });

      var json = null;
      try {
        json = await response.json();
      } catch (parseError) {
        json = null;
      }

      if (response.ok && json && json.ok === true) {
        return {
          ok: true,
          giftCardId: toText(json.giftCardId),
          codeLast4: toText(json.codeLast4),
          amount: toText(json.amount),
        };
      }

      if (json && json.ok === false) {
        lastError = toText(json.error);
        if (lastError === '') {
          lastError = 'Activation failed';
        }
        if (i === endpoints.length - 1) {
          return {
            ok: false,
            error: lastError,
            fieldErrors: json.fieldErrors || {},
          };
        }
        continue;
      }

      var statusText = response.status ? String(response.status) : 'unknown';
      lastError = 'Activation failed (' + statusText + ')';
      if (i === endpoints.length - 1) {
        return {
          ok: false,
          error: lastError,
          fieldErrors: {},
        };
      }
    } catch (error) {
      lastError = error && error.message ? error.message : String(error);
    }
  }

  return {
    ok: false,
    error: lastError === '' ? 'Network request failed' : lastError,
    fieldErrors: {},
  };
}

function GiftCardModal() {
  var codeState = useState('');
  var codeInput = codeState[0];
  var setCodeInput = codeState[1];

  var amountState = useState('');
  var amountInput = amountState[0];
  var setAmountInput = amountState[1];

  var noteState = useState('');
  var noteInput = noteState[0];
  var setNoteInput = noteState[1];

  var codeErrorState = useState('');
  var codeError = codeErrorState[0];
  var setCodeError = codeErrorState[1];

  var amountErrorState = useState('');
  var amountError = amountErrorState[0];
  var setAmountError = amountErrorState[1];

  var formErrorState = useState('');
  var formError = formErrorState[0];
  var setFormError = formErrorState[1];

  var confirmState = useState(false);
  var confirmingActivation = confirmState[0];
  var setConfirmingActivation = confirmState[1];

  var submittingState = useState(false);
  var submitting = submittingState[0];
  var setSubmitting = submittingState[1];

  var successState = useState(null);
  var successData = successState[0];
  var setSuccessData = successState[1];

  function closeModal() {
    if (typeof window !== 'undefined' && window && typeof window.close === 'function') {
      window.close();
    }
  }

  function resetErrors() {
    setCodeError('');
    setAmountError('');
    setFormError('');
  }

  function validateForm() {
    resetErrors();
    var codeValidation = validateCodeInput(codeInput);
    var amountValidation = parseAmountInput(amountInput);
    var valid = true;

    if (!codeValidation.ok) {
      valid = false;
      setCodeError(codeValidation.error);
    }
    if (!amountValidation.ok) {
      valid = false;
      setAmountError(amountValidation.error);
    }

    if (!valid) {
      return {ok: false};
    }

    return {
      ok: true,
      code: codeValidation.code,
      amount: amountValidation.amount,
    };
  }

  function beginActivationFlow() {
    if (submitting) {
      return;
    }
    var validation = validateForm();
    if (!validation.ok) {
      return;
    }
    setConfirmingActivation(true);
  }

  async function confirmActivation() {
    if (submitting) {
      return;
    }
    var validation = validateForm();
    if (!validation.ok) {
      setConfirmingActivation(false);
      return;
    }

    setSubmitting(true);
    setFormError('');
    setConfirmingActivation(false);

    var shopDomain = '';
    var currency = 'GBP';
    if (shopify && shopify.session && shopify.session.currentSession) {
      if (shopify.session.currentSession.shopDomain) {
        shopDomain = toText(shopify.session.currentSession.shopDomain);
      }
      if (shopify.session.currentSession.currency) {
        currency = toText(shopify.session.currentSession.currency);
      }
    }

    var noteText = trimEdgeWhitespace(noteInput);
    if (noteText === '') {
      noteText = 'Activated via Macron POS gift card tool';
    }

    var token = '';
    if (shopify && shopify.session && typeof shopify.session.getSessionToken === 'function') {
      try {
        var sessionToken = await shopify.session.getSessionToken();
        token = sessionToken ? toText(sessionToken) : '';
      } catch (tokenError) {
        token = '';
      }
    }

    var payload = {
      code: validation.code,
      amount: validation.amount,
      currency: currency,
      note: noteText,
      shop: shopDomain,
    };

    var result = await postGiftCardActivation(payload, token);

    if (result.ok) {
      setSuccessData({
        code: validation.code,
        amount: validation.amount,
        codeLast4: result.codeLast4,
        giftCardId: result.giftCardId,
      });
      setCodeInput('');
      setAmountInput('');
      setNoteInput('');
      resetErrors();
      setSubmitting(false);
      return;
    }

    if (result.fieldErrors && typeof result.fieldErrors === 'object') {
      if (result.fieldErrors.code) {
        setCodeError(toText(result.fieldErrors.code));
      }
      if (result.fieldErrors.amount) {
        setAmountError(toText(result.fieldErrors.amount));
      }
    }

    setFormError(toText(result.error) || 'Could not activate gift card');
    setSubmitting(false);
  }

  function activateAnother() {
    setSuccessData(null);
    setConfirmingActivation(false);
    setSubmitting(false);
    resetErrors();
  }

  if (successData) {
    return (
      <s-page heading="Activate Gift Card">
        <s-scroll-box style="height: 100%;">
          <s-stack direction="block" gap="base">
            <s-section heading="Gift card activated">
              <s-stack direction="block" gap="base">
                <s-text>Code: {successData.code}</s-text>
                <s-text>Value loaded: {formatAmountForDisplay(successData.amount)}</s-text>
                <s-text appearance="subdued">Last 4: {successData.codeLast4}</s-text>
                <s-stack direction="block" gap="small">
                  <s-button variant="primary" onClick={activateAnother}>
                    Activate another
                  </s-button>
                  <s-button variant="secondary" onClick={closeModal}>
                    Close
                  </s-button>
                </s-stack>
              </s-stack>
            </s-section>
          </s-stack>
        </s-scroll-box>
      </s-page>
    );
  }

  return (
    <s-page heading="Activate Gift Card">
      <s-scroll-box style="height: 100%;">
        <s-stack direction="block" gap="base">
          <s-section heading="Gift card details">
            <s-stack direction="block" gap="base">
              <s-text appearance="subdued">
                Scan or type the physical card code, then confirm payment before activation.
              </s-text>
              <s-stack direction="block" gap="small">
                <s-text emphasis="bold">Card code</s-text>
                <s-text-field
                  value={codeInput}
                  placeholder="e.g. MSHGC00123"
                  onInput={function (event) {
                    setCodeInput(normalizeCodeInput(event.target.value));
                  }}
                />
                {codeError !== '' ? <s-text appearance="critical">{codeError}</s-text> : null}
              </s-stack>
              <s-stack direction="block" gap="small">
                <s-text emphasis="bold">Amount (GBP)</s-text>
                <s-text-field
                  value={amountInput}
                  placeholder="e.g. 25.00"
                  onInput={function (event) {
                    setAmountInput(trimEdgeWhitespace(event.target.value));
                  }}
                />
                {amountError !== '' ? <s-text appearance="critical">{amountError}</s-text> : null}
              </s-stack>
              <s-stack direction="block" gap="small">
                <s-text emphasis="bold">Internal note (optional)</s-text>
                <s-text-area
                  value={noteInput}
                  placeholder="Optional internal note"
                  onInput={function (event) {
                    setNoteInput(event.target.value);
                  }}
                />
              </s-stack>
              {formError !== '' ? <s-text appearance="critical">{formError}</s-text> : null}
            </s-stack>
          </s-section>

          {confirmingActivation ? (
            <s-section heading="Confirm payment">
              <s-stack direction="block" gap="base">
                <s-text>Have you taken payment for this gift card?</s-text>
                <s-stack direction="block" gap="small">
                  <s-button variant="primary" onClick={confirmActivation} disabled={submitting}>
                    Yes, activate now
                  </s-button>
                  <s-button
                    variant="secondary"
                    onClick={function () {
                      setConfirmingActivation(false);
                    }}
                    disabled={submitting}
                  >
                    No, go back
                  </s-button>
                </s-stack>
              </s-stack>
            </s-section>
          ) : null}

          <s-section heading="Actions">
            <s-stack direction="block" gap="small">
              {submitting ? <s-text>Activating gift card...</s-text> : null}
              <s-button variant="primary" onClick={beginActivationFlow} disabled={submitting}>
                Activate gift card
              </s-button>
              <s-button variant="secondary" onClick={closeModal} disabled={submitting}>
                Cancel
              </s-button>
            </s-stack>
          </s-section>
        </s-stack>
      </s-scroll-box>
    </s-page>
  );
}
