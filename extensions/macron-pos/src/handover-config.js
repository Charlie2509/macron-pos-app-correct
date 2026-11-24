export const pilotShop = 'y5y3p1-hw.myshopify.com';
export const settingsNamespace = 'macron_pos';
export const settingsKey = 'native_handover_v1';

export const handoverSettingQuery = `query MshHandoverSetting {
  shop { myshopifyDomain }
  currentAppInstallation {
    id
    metafield(namespace: "${settingsNamespace}", key: "${settingsKey}") { type value compareDigest }
  }
}`;

export function readHandoverSetting(result) {
  const data = result?.data;
  const installation = data?.currentAppInstallation;
  if (result?.errors?.length || data?.shop?.myshopifyDomain !== pilotShop || !installation?.id ||
      !Object.prototype.hasOwnProperty.call(installation, 'metafield')) return null;
  const setting = installation.metafield;
  if (setting !== null && (setting.type !== 'boolean' || !['true', 'false'].includes(setting.value) || !setting.compareDigest)) return null;
  return {owner: installation.id, enabled: setting?.value === 'true', digest: setting?.compareDigest ?? null};
}
