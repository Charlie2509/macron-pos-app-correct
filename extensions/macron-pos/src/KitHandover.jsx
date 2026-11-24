import '@shopify/ui-extensions/preact';
import {render} from 'preact';
import {useEffect, useRef, useState} from 'preact/hooks';
import {readKitLine, safeKitOrder} from '../../../app/kit-collections.js';
import {finishCollectedKit, loadKitOrder, recordKitPieces} from './kit-handover-api.js';

export default async () => {
  render(<KitHandover />, document.body);
};

const statusText = {taken: 'Taken at sale', collected: 'Collected later', owed: 'Still owed', unknown: 'Check handover'};
const query = (document, options) => shopify.query(document, options);

function KitHandover() {
  const id = shopify.data.selected?.[0]?.id;
  const [snapshot, setSnapshot] = useState(null);
  const [checked, setChecked] = useState({});
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(true);
  const lock = useRef(false);

  async function reload() {
    setSnapshot(null);
    setChecked({});
    setSnapshot(await loadKitOrder(query, id));
  }

  async function run(task) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setMessage('');
    try {
      await task();
    } catch (error) {
      setMessage(error?.message || 'Refresh the order to check the latest handover.');
    } finally {
      try { await reload(); }
      catch (error) { setMessage(error?.message || 'The latest order could not be loaded.'); }
      lock.current = false;
      setBusy(false);
    }
  }

  useEffect(() => {
    let active = true;
    loadKitOrder(query, id)
      .then(value => { if (active) setSnapshot(value); })
      .catch(error => { if (active) setMessage(error?.message || 'Could not open this order.'); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [id]);

  const kits = (snapshot?.lines || []).map(line => ({line, kit: readKitLine(line, snapshot.ledger)})).filter(row => row.kit);
  if (snapshot && (snapshot.order.sourceName !== 'pos' || (!kits.length && !message))) return null;
  return <s-admin-block heading="MSH kit handover">
    <s-stack gap="base">
      {message && <s-text>{message}</s-text>}
      {busy && <s-text>Checking the order…</s-text>}
      {kits.length > 0 && !safeKitOrder(snapshot.order) && <s-text>The component record is read-only. Check the order’s payment, returns and edits before handover.</s-text>}
      {kits.map(({line, kit}) => {
        const editable = safeKitOrder(snapshot.order) && kit.canRecord;
        const selected = checked[line.id] || [];
        const owes = kit.components.filter(piece => piece.status === 'owed').length;
        const finishPending = editable && kit.complete && line.unfulfilledQuantity === 1 && kit.components.some(piece => piece.status === 'collected');
        const sameTitle = kits.filter(row => row.line.title === line.title);
        const heading = sameTitle.length > 1 ? line.title + ' · Kit ' + (sameTitle.findIndex(row => row.line.id === line.id) + 1) + ' of ' + sameTitle.length : line.title;
        return <s-section key={line.id} heading={heading}>
          <s-stack gap="small">
            <s-text>{kit.components.length} components · {kit.problem ? 'Check component record' : owes + ' still owed'}</s-text>
            {kit.problem && <s-text>{kit.problem}</s-text>}
            {kit.components.map(piece => <s-box key={piece.index}>
              {editable && piece.status === 'owed'
                ? <s-checkbox label={piece.index + '. ' + piece.label + ' · Still owed'} checked={selected.includes(piece.index)} disabled={busy}
                    onChange={event => {
                      const on = event.currentTarget.checked;
                      setChecked(previous => {
                        const rows = previous[line.id] || [];
                        return {...previous, [line.id]: on ? [...new Set([...rows, piece.index])] : rows.filter(index => index !== piece.index)};
                      });
                    }} />
                : <s-text>{piece.index}. {piece.label} · {statusText[piece.status]}</s-text>}
            </s-box>)}
            {editable && owes > 0 && <>
              <s-text>Select the pieces the customer is collecting now.</s-text>
              <s-button disabled={busy || !selected.length} onClick={() => run(async () => {
                const complete = await recordKitPieces(query, id, line.id, selected, snapshot.digest, kit.components);
                setMessage('Collection saved.');
                if (complete) {
                  try { await finishCollectedKit(query, id, line.id); }
                  catch { throw new Error('Collection saved. Check the kit’s Shopify fulfilment below.'); }
                  setMessage('Collection saved and kit fulfilled.');
                }
              })}>Record collection</s-button>
            </>}
            {finishPending && <>
              <s-text>All pieces collected. The kit is still open in Shopify.</s-text>
              <s-button disabled={busy} onClick={() => run(async () => {
                await finishCollectedKit(query, id, line.id);
                setMessage('Shopify fulfilment confirmed.');
              })}>Complete kit fulfilment</s-button>
            </>}
          </s-stack>
        </s-section>;
      })}
      {!busy && <s-button onClick={() => run(async () => {})}>Refresh handover</s-button>}
    </s-stack>
  </s-admin-block>;
}
