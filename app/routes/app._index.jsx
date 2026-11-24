import {useFetcher, useLoaderData} from 'react-router';
import {boundary} from '@shopify/shopify-app-react-router/server';
import {authenticate} from '../shopify.server';
import {getSetting, saveSetting} from '../handover-setting.server.js';

export async function loader({request}) {
  const {admin} = await authenticate.admin(request);
  const setting = await getSetting(admin);
  return {enabled: setting?.enabled ?? null, digest: setting?.digest ?? null};
}

export async function action({request}) {
  const {admin} = await authenticate.admin(request);
  return saveSetting(admin, await request.formData());
}

export default function Index() {
  const {enabled, digest} = useLoaderData();
  const fetcher = useFetcher();
  return (
    <s-page heading="Macron POS">
      <s-section heading="Paid till handover">
        <s-stack gap="base">
          <s-paragraph>Shopify Flow records eligible Take today items after payment. Each kit lists its garments and sizes. If any are owed, the kit stays open until staff record the final collection in MSH kit handover on the order. Personalisation fees and physical gift cards use the existing service.</s-paragraph>
          {enabled == null ? <s-paragraph>The MSH handover setting is unavailable for this installation.</s-paragraph> : <>
            <s-text type="strong">Flow pilot {enabled ? 'on' : 'off'}</s-text>
            <s-paragraph>{enabled
              ? 'Switching off sends new items through the existing service. Keep Flow active for previously marked sales.'
              : 'Before enabling, confirm both MSH handover workflows are active and the matching Render update is deployed.'} Reopen the sales tile on each iPad after changing this setting.</s-paragraph>
            <s-button variant={enabled ? 'secondary' : 'primary'} disabled={fetcher.state !== 'idle'}
              onClick={() => fetcher.submit({enabled: String(!enabled), digest: digest || ''}, {method: 'POST'})}>
              {enabled ? 'Turn off Flow pilot' : 'Enable Flow pilot'}
            </s-button>
            {fetcher.data?.error && <s-paragraph>{fetcher.data.error}</s-paragraph>}
          </>}
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers = args => boundary.headers(args);
