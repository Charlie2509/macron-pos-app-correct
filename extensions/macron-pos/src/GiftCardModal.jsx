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

  var activationQueuedState = useState(null);
  var activationQueued = activationQueuedState[0];
  var setActivationQueued = activationQueuedState[1];

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

  function continueToCheckout() {
    var validation = validateForm();
    if (!validation.ok) {
      return;
    }

    var noteText = trimEdgeWhitespace(noteInput);
    setActivationQueued({
      code: validation.code,
      amount: validation.amount,
      note: noteText,
    });
    setFormError('');
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

          <s-section heading="Actions">
            <s-stack direction="block" gap="small">
              {activationQueued ? (
                <s-text>
                  This gift card will be activated after successful payment.
                </s-text>
              ) : null}
              <s-button variant="primary" onClick={continueToCheckout}>
                Continue to checkout
              </s-button>
              <s-button variant="secondary" onClick={closeModal}>
                Cancel
              </s-button>
            </s-stack>
          </s-section>
        </s-stack>
      </s-scroll-box>
    </s-page>
  );
}
