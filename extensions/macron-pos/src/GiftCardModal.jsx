import "@shopify/ui-extensions/preact";
import {render} from 'preact';
import {useMemo, useState} from 'preact/hooks';

const PRESET_AMOUNTS = ['10.00', '20.00', '25.00', '50.00'];

function toText(value) {
  if (value === null || value === undefined) return '';
  return String(value);
}

function normalizeCode(raw) {
  return toText(raw).trim();
}

function isValidCode(code) {
  return /^\d{13}$/.test(code);
}

function normalizeAmount(raw) {
  const trimmed = toText(raw).trim();
  if (!trimmed) return {ok: false, value: '', cents: 0};
  const asNumber = Number(trimmed);
  if (!Number.isFinite(asNumber) || asNumber <= 0) return {ok: false, value: trimmed, cents: 0};
  const cents = Math.round(asNumber * 100);
  const normalized = (cents / 100).toFixed(2);
  return {ok: true, value: normalized, cents};
}

function makeAttemptId() {
  return 'msh_gc_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
}

export default async function () {
  render(<GiftCardModal />, document.body);
}

function GiftCardModal() {
  const [code, setCode] = useState('');
  const [amountInput, setAmountInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('idle');
  const [statusDetail, setStatusDetail] = useState('');

  const normalizedCode = useMemo(() => normalizeCode(code), [code]);
  const normalizedAmount = useMemo(() => normalizeAmount(amountInput), [amountInput]);

  function toast(message) {
    if (shopify?.toast?.show) {
      shopify.toast.show(message);
    }
  }

  function fillPreset(amount) {
    setAmountInput(amount);
  }

  async function addPendingGiftCardToCart() {
    if (!isValidCode(normalizedCode)) {
      toast('Scan a valid 13-digit card code.');
      setStatus('invalid');
      return;
    }
    if (!normalizedAmount.ok) {
      toast('Enter a valid amount greater than 0.');
      setStatus('invalid');
      return;
    }
    if (!shopify?.cart?.addCustomSale || !shopify?.cart?.addCartProperties) {
      toast('POS cart API missing required methods.');
      setStatus('failed');
      setStatusDetail('Missing addCustomSale/addCartProperties APIs in this POS runtime.');
      return;
    }

    setBusy(true);
    setStatus('saving');
    setStatusDetail('');

    const attemptId = makeAttemptId();
    const saleTitle = `Gift Card Sale (${normalizedCode})`;

    try {
      try {
        await shopify.cart.addCustomSale({
          title: saleTitle,
          quantity: 1,
          price: normalizedAmount.value,
          taxable: false,
        });
      } catch (objectSignatureError) {
        await shopify.cart.addCustomSale(saleTitle, normalizedAmount.value);
      }

      await shopify.cart.addCartProperties({
        _msh_gc_source: 'macron_pos_gift_card_sale',
        _msh_gc_status: 'pending_activation',
        _msh_gc_code: normalizedCode,
        _msh_gc_amount: normalizedAmount.value,
        _msh_gc_currency: 'GBP',
        _msh_gc_attempt_id: attemptId,
      });

      setStatus('ready');
      toast('Gift Card Sale added. Continue to checkout and take payment.');
    } catch (error) {
      const message = error?.message || String(error);
      setStatus('failed');
      setStatusDetail(message);
      toast('Unable to prepare Gift Card Sale.');
    } finally {
      setBusy(false);
    }
  }

  const canContinue = isValidCode(normalizedCode) && normalizedAmount.ok && !busy;

  return (
    <s-page heading="Gift Card Sale">
      <s-scroll-box style="height: 100%;">
        <s-section heading="Scan Macron card">
          <s-stack direction="block" gap="small">
            <s-text size="small" appearance="subdued">
              Use barcode scanner input as keyboard text.
            </s-text>
            <s-text-field
              label="Card code"
              value={code}
              inputMode="numeric"
              placeholder="Scan 13-digit barcode"
              onInput={(event) => setCode(event.target.value)}
            />
            {!isValidCode(normalizedCode) && normalizedCode !== '' ? (
              <s-text appearance="critical">Card code must be exactly 13 digits.</s-text>
            ) : null}
          </s-stack>
        </s-section>

        <s-section heading="Amount">
          <s-stack direction="block" gap="small">
            <s-stack direction="inline" gap="small" wrap="true">
              {PRESET_AMOUNTS.map((preset) => (
                <s-button key={preset} variant={amountInput === preset ? 'primary' : 'secondary'} onClick={() => fillPreset(preset)}>
                  £{preset}
                </s-button>
              ))}
            </s-stack>
            <s-text-field
              label="Custom amount"
              value={amountInput}
              inputMode="decimal"
              placeholder="0.00"
              onInput={(event) => setAmountInput(event.target.value)}
            />
          </s-stack>
        </s-section>

        <s-section heading="Review">
          <s-stack direction="block" gap="small">
            <s-text>Scanned code: {normalizedCode || '—'}</s-text>
            <s-text>Amount: {normalizedAmount.ok ? `£${normalizedAmount.value}` : '—'}</s-text>
            <s-text size="small" appearance="subdued">
              This card will activate automatically after successful payment.
            </s-text>
            <s-text size="small" appearance="subdued">
              If activation fails after payment, an admin can retry safely via POST /api/macron-pos/gift-card-retry with orderId + code.
            </s-text>
            <s-button variant="primary" disabled={!canContinue} onClick={addPendingGiftCardToCart}>
              Add Gift Card Sale to checkout
            </s-button>
            {status === 'ready' ? (
              <s-banner tone="success" heading="Ready for checkout">
                Proceed in Shopify POS checkout and take payment. Activation is automatic after payment.
              </s-banner>
            ) : null}
            {status === 'failed' ? (
              <s-banner tone="critical" heading="Could not prepare sale">
                {statusDetail || 'Unknown error'}
              </s-banner>
            ) : null}
          </s-stack>
        </s-section>
      </s-scroll-box>
    </s-page>
  );
}
