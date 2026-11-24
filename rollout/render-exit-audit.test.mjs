import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync, existsSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {auditRenderBackup} from './render-exit-audit.mjs';

test('only reads MSH aggregate queue states and recognises both timestamp formats', t => {
  const folder = mkdtempSync(join(tmpdir(), 'msh-audit-test-'));
  t.after(() => rmSync(folder, {recursive:true, force:true}));
  const path = join(folder,'backup.sqlite');
  const db = new DatabaseSync(path);
  db.exec(`CREATE TABLE Session(shop TEXT);
    CREATE TABLE PendingMacronPosIntent(shop TEXT, matchedOrderId TEXT, consumedAt, expiresAt);
    CREATE TABLE PendingGiftCardActivation(shop TEXT, status TEXT, giftCardId TEXT, orderId TEXT, orderName TEXT, activationAttempts INTEGER, expiresAt);`);
  const shop = 'y5y3p1-hw.myshopify.com';
  const ownIntent = db.prepare('INSERT INTO PendingMacronPosIntent VALUES(?,?,?,?)');
  ownIntent.run(shop, null, null, Date.now() + 600_000);
  ownIntent.run(shop, null, null, '2000-01-01T10:10:00Z');
  ownIntent.run('another.example', null, null, '2000-01-01T10:10:00Z');
  const card = db.prepare('INSERT INTO PendingGiftCardActivation VALUES(?,?,?,?,?,?,?)');
  card.run(shop, 'activated', 'card-id', null, null, 1, 0);
  card.run(shop, 'pending', null, 'order-id', null, 0, Date.now() - 600_000);
  card.run(shop, 'duplicate_code', null, null, null, 1, Date.now());
  card.run(shop, 'pending', null, null, null, 0, 'unknown');
  card.run(shop, 'failed', 'card-id', null, null, 1, 0);
  db.close();
  const before = readFileSync(path);
  assert.deepEqual(auditRenderBackup(path), {shop, handover:{
    'Unconsumed, checkout window expired':1, 'Unconsumed, within checkout window':1
  }, giftCards:{
    'Activated with Shopify gift card ID':1, 'Pending with an order or activation attempt':1,
    'Duplicate code, check sale and existing card':1, 'Pending without an order, expiry unknown':1,
    'Shopify gift card ID exists, inconsistent status':1
  }});
  assert.deepEqual(readFileSync(path), before);
  const empty = join(folder,'does-not-exist.sqlite');
  assert.throws(() => auditRenderBackup(empty));
  assert.equal(existsSync(empty),false);
});
