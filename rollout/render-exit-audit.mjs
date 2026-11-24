import {DatabaseSync} from 'node:sqlite';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const shop = 'y5y3p1-hw.myshopify.com';

// Older Prisma databases can store times as ISO text or as Unix milliseconds.
const expiry = `CASE WHEN typeof(expiresAt) IN ('integer','real')
  THEN CASE WHEN expiresAt >= 100000000000 THEN expiresAt / 1000 ELSE expiresAt END
  ELSE unixepoch(expiresAt) END`;

export function auditRenderBackup(filename) {
  const db = new DatabaseSync(filename, {readOnly: true});
  try {
    db.exec('PRAGMA query_only = ON; BEGIN;');
    const seen = db.prepare(`SELECT
      EXISTS(SELECT 1 FROM Session WHERE shop = ?) OR
      EXISTS(SELECT 1 FROM PendingMacronPosIntent WHERE shop = ?) OR
      EXISTS(SELECT 1 FROM PendingGiftCardActivation WHERE shop = ?) AS seen`).get(shop, shop, shop);
    if (!seen.seen) throw new Error('No records confirm this database belongs to MSH.');
    const countGroups = (sql) => Object.fromEntries(db.prepare(sql).all(shop).map(row => [row.reason, row.count]));
    const handover = countGroups(`SELECT CASE
      WHEN consumedAt IS NOT NULL THEN 'Previously consumed'
      WHEN NULLIF(TRIM(matchedOrderId), '') IS NOT NULL THEN 'Order linked, intent unconsumed'
      WHEN ${expiry} IS NULL THEN 'Unconsumed, expiry unknown'
      WHEN ${expiry} > unixepoch('now') THEN 'Unconsumed, within checkout window'
      ELSE 'Unconsumed, checkout window expired'
      END AS reason, COUNT(*) AS count
      FROM PendingMacronPosIntent WHERE shop = ? GROUP BY reason ORDER BY reason`);

    const giftCards = countGroups(`SELECT CASE
      WHEN NULLIF(TRIM(giftCardId), '') IS NOT NULL AND status = 'activated' THEN 'Activated with Shopify gift card ID'
      WHEN NULLIF(TRIM(giftCardId), '') IS NOT NULL THEN 'Shopify gift card ID exists, inconsistent status'
      WHEN status = 'activated' THEN 'Activated status without Shopify gift card ID'
      WHEN status = 'duplicate_code' THEN 'Duplicate code, check sale and existing card'
      WHEN status = 'failed' THEN 'Activation failed'
      WHEN status = 'processing' THEN 'Activation in progress or interrupted'
      WHEN status <> 'pending' OR status IS NULL THEN 'Unknown activation status'
      WHEN NULLIF(TRIM(orderId), '') IS NOT NULL OR NULLIF(TRIM(orderName), '') IS NOT NULL OR activationAttempts > 0
        THEN 'Pending with an order or activation attempt'
      WHEN ${expiry} IS NULL THEN 'Pending without an order, expiry unknown'
      WHEN ${expiry} > unixepoch('now') THEN 'Pending without an order, within checkout window'
      ELSE 'Pending without an order, checkout window expired'
      END AS reason, COUNT(*) AS count
      FROM PendingGiftCardActivation WHERE shop = ? GROUP BY reason ORDER BY reason`);
    return {shop, handover, giftCards};
  } finally {
    db.close();
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.length !== 3) {
    console.error('Usage: node render-exit-audit.mjs /path/to/private-backup.sqlite');
    process.exitCode = 2;
  } else {
    try {
      console.log(JSON.stringify(auditRenderBackup(resolve(process.argv[2])), null, 2));
    } catch (error) {
      console.error(error.message === 'No records confirm this database belongs to MSH.' ? error.message :
        'Could not read all MSH tables. Check the private backup path, SQLite snapshot and schema.');
      process.exitCode = 1;
    }
  }
}
