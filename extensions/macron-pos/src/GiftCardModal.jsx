import "@shopify/ui-extensions/preact";
import {render} from 'preact';
import {useEffect, useRef, useState} from 'preact/hooks';

var RELATIVE_INTENT_ENDPOINT = '/api/macron-pos/gift-card/intent';
var ABSOLUTE_INTENT_ENDPOINT = 'https://macron-pos-app-correct.onrender.com/api/macron-pos/gift-card/intent';
var GIFT_CARD_SALE_TITLE = 'Macron Physical Gift Card';

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
  if (!/^\d{13}$/.test(code)) {
    return {ok: false, error: 'Code must be exactly 13 digits'};
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

function isCartApiReady() {
  return (
    typeof shopify !== 'undefined' &&
    shopify &&
    shopify.cart &&
    typeof shopify.cart.addCustomSale === 'function' &&
    typeof shopify.cart.addLineItemProperties === 'function'
  );
}

async function createIntent(payload, token) {
  var endpoints = [RELATIVE_INTENT_ENDPOINT, ABSOLUTE_INTENT_ENDPOINT];
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
          intentId: toText(json.intentId),
          intentToken: toText(json.intentToken),
          expiresAt: toText(json.expiresAt),
        };
      }

      if (json && json.ok === false) {
        return {
          ok: false,
          error: toText(json.error) || 'Intent create failed',
          fieldErrors: json.fieldErrors || {},
        };
      }

      lastError = 'Intent create failed (' + (response.status ? String(response.status) : 'unknown') + ')';
    } catch (error) {
      lastError = error && error.message ? error.message : String(error);
    }
  }

  return {
    ok: false,
    error: lastError || 'Network request failed',
    fieldErrors: {},
  };
}

function GiftCardModal() {
  var codeFieldRef = useRef(null);

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

  var preparedSaleState = useState(null);
  var preparedSale = preparedSaleState[0];
  var setPreparedSale = preparedSaleState[1];

  var isSubmittingState = useState(false);
  var isSubmitting = isSubmittingState[0];
  var setIsSubmitting = isSubmittingState[1];

  useEffect(function () {
    if (!isSubmitting && codeFieldRef.current && typeof codeFieldRef.current.focus === 'function') {
      codeFieldRef.current.focus();
    }
  }, [isSubmitting]);

  function closeModal() {
    if (typeof window !== 'undefined' && window && typeof window.close === 'function') {
      window.close();
    }
  }

  function toast(message) {
    if (typeof shopify !== 'undefined' && shopify && shopify.toast && typeof shopify.toast.show === 'function') {
      shopify.toast.show(message);
    }
  }

  function buildStepErrorMessage(stepMessage, error) {
    var errorMessage = error && error.message ? trimEdgeWhitespace(error.message) : '';
    if (errorMessage === '') {
      return stepMessage;
    }
    return stepMessage + ': ' + errorMessage;
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

  async function continueToCheckout() {
    if (isSubmitting) {
      return;
    }

    var validation = validateForm();
    if (!validation.ok) {
      return;
    }

    if (!isCartApiReady()) {
      setFormError('POS cart API is unavailable. Please update Shopify POS and try again.');
      return;
    }

    var noteText = trimEdgeWhitespace(noteInput);
    var lineUuid = '';

    setIsSubmitting(true);
    setFormError('');

    try {
      var intentResult = null;
      var markerProperties = null;

      try {
        lineUuid = await shopify.cart.addCustomSale({
          title: GIFT_CARD_SALE_TITLE,
          quantity: 1,
          price: validation.amount,
          taxable: false,
        });
      } catch (error) {
        setFormError(buildStepErrorMessage('Failed to add custom sale to cart', error));
        return;
      }

      if (trimEdgeWhitespace(lineUuid) === '') {
        setFormError('Gift card sale was not added to cart.');
        return;
      }
      toast('Custom sale added');

      var sessionToken = '';
      if (shopify.session && typeof shopify.session.getSessionToken === 'function') {
        var maybeToken = await shopify.session.getSessionToken();
        sessionToken = trimEdgeWhitespace(maybeToken);
      }

      try {
        intentResult = await createIntent({
          code: validation.code,
          amount: validation.amount,
          note: noteText,
          currency: 'GBP',
          lineItemUuid: lineUuid,
          lineItemTitle: GIFT_CARD_SALE_TITLE,
        }, sessionToken);
      } catch (error) {
        if (shopify.cart && typeof shopify.cart.removeLineItem === 'function') {
          await shopify.cart.removeLineItem(lineUuid);
        }
        setFormError(buildStepErrorMessage('Failed to create gift card intent', error));
        return;
      }

      if (!intentResult.ok) {
        if (shopify.cart && typeof shopify.cart.removeLineItem === 'function') {
          await shopify.cart.removeLineItem(lineUuid);
        }
        if (intentResult.fieldErrors && intentResult.fieldErrors.code) {
          setCodeError(intentResult.fieldErrors.code);
        }
        if (intentResult.fieldErrors && intentResult.fieldErrors.amount) {
          setAmountError(intentResult.fieldErrors.amount);
        }
        setFormError(buildStepErrorMessage('Failed to create gift card intent', {message: intentResult.error || 'Could not prepare gift card sale.'}));
        return;
      }
      toast('Intent created');

      markerProperties = {
        _msh_gc_sale: 'true',
        _msh_gc_intent_id: intentResult.intentId,
        _msh_gc_intent_token: intentResult.intentToken,
        _msh_gc_code: validation.code,
        _msh_gc_amount: validation.amount,
        _msh_gc_currency: 'GBP',
      };
      if (noteText !== '') {
        markerProperties._msh_gc_note = noteText;
      }

      try {
        await shopify.cart.addLineItemProperties(lineUuid, markerProperties);
      } catch (error) {
        if (shopify.cart && typeof shopify.cart.removeLineItem === 'function') {
          await shopify.cart.removeLineItem(lineUuid);
        }
        setFormError(buildStepErrorMessage('Failed to attach line item properties', error));
        return;
      }
      toast('Line item properties added');

      if (shopify.cart && typeof shopify.cart.addCartProperties === 'function') {
        try {
          await shopify.cart.addCartProperties({
            _msh_gc_sale: 'true',
            _msh_gc_pending_intent_id: intentResult.intentId,
            _msh_gc_pending_intent_token: intentResult.intentToken,
            _msh_gc_pending_code: validation.code,
            _msh_gc_pending_amount: validation.amount,
          });
        } catch (error) {
          if (lineUuid !== '' && shopify.cart && typeof shopify.cart.removeLineItem === 'function') {
            await shopify.cart.removeLineItem(lineUuid);
          }
          setFormError(buildStepErrorMessage('Failed to attach cart properties', error));
          return;
        }
        toast('Cart properties added');
      }

      setPreparedSale({
        code: validation.code,
        amount: validation.amount,
        note: noteText,
        intentId: intentResult.intentId,
      });

      toast('Gift card sale added to cart. Complete checkout to activate card.');
      closeModal();
    } catch (error) {
      if (lineUuid !== '' && shopify.cart && typeof shopify.cart.removeLineItem === 'function') {
        try {
          await shopify.cart.removeLineItem(lineUuid);
        } catch (rollbackError) {
          // noop
        }
      }
      setFormError(error && error.message ? error.message : 'Could not prepare checkout.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <s-page heading="Activate Gift Card">
      <s-scroll-box style="height: 100%;">
        <s-stack direction="block" gap="base">
          <s-section heading="Gift card details">
            <s-stack direction="block" gap="base">
              <s-text appearance="subdued">
                Scan or type the 13-digit physical card code, then complete checkout to activate it.
              </s-text>
              <s-stack direction="block" gap="small">
                <s-text emphasis="bold">Card code</s-text>
                <s-text-field
                  ref={codeFieldRef}
                  value={codeInput}
                  placeholder="e.g. 1234567890123"
                  inputMode="numeric"
                  autocomplete="off"
                  autocorrect="off"
                  spellcheck="false"
                  enterKeyHint="next"
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
              {preparedSale ? (
                <s-text>
                  Prepared {preparedSale.code} for {formatAmountForDisplay(preparedSale.amount)}. Finish checkout to activate.
                </s-text>
              ) : null}
              <s-button variant="primary" onClick={continueToCheckout} disabled={isSubmitting}>
                {isSubmitting ? 'Preparing checkout…' : 'Continue to checkout'}
              </s-button>
              <s-button variant="secondary" onClick={closeModal} disabled={isSubmitting}>
                Cancel
              </s-button>
            </s-stack>
          </s-section>
        </s-stack>
      </s-scroll-box>
    </s-page>
  );
}
