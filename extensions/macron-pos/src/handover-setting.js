import {useEffect, useState} from 'preact/hooks';
import {handoverSettingQuery, readHandoverSetting} from './handover-config.js';

export function useNativeHandoverSetting() {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    let open = true;
    async function load() {
      try {
        const response = await fetch('shopify:admin/api/graphql.json', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({query: handoverSettingQuery}),
        });
        const setting = response.ok && readHandoverSetting(await response.json());
        if (open) setEnabled(setting?.enabled === true);
      } catch {
        // The existing till path remains available if the setting cannot be read.
      }
    }
    load();
    return () => { open = false; };
  }, []);
  return enabled;
}
