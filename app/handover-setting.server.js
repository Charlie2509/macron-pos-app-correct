import {handoverSettingQuery, readHandoverSetting, settingsKey, settingsNamespace} from '../extensions/macron-pos/src/handover-config.js';

export async function getSetting(admin) {
  const response = await admin.graphql(handoverSettingQuery);
  return readHandoverSetting(await response.json());
}

export async function saveSetting(admin, form) {
  const requested = form.get('enabled');
  if (!['true', 'false'].includes(requested)) return {error: 'Choose a handover setting.'};
  const setting = await getSetting(admin);
  if (!setting) return {error: 'The MSH handover setting could not be read.'};
  if (setting.enabled === (requested === 'true')) return {saved: true};
  if ((form.get('digest') || null) !== setting.digest) return {error: 'The setting has changed. Check the current value and try again.'};
  const response = await admin.graphql(`#graphql
    mutation SaveMshHandoverSetting($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) { metafields { value } userErrors { message } }
    }`, {variables: {metafields: [{
      ownerId: setting.owner, namespace: settingsNamespace, key: settingsKey,
      type: 'boolean', value: requested, compareDigest: setting.digest,
    }]}});
  const result = await response.json();
  const saved = result?.data?.metafieldsSet;
  if (result?.errors?.length || saved?.userErrors?.length || saved?.metafields?.[0]?.value !== requested) {
    return {error: 'Shopify could not save the setting. Check the current value and try again.'};
  }
  return {saved: true};
}
