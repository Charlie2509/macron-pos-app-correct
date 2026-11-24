# Check the old MSH Render database

Use a private, consistent SQLite backup of the old MSH service. The old application normally uses `/var/data/macron-pos/prisma/dev.sqlite`. Its deployment can override that path with `SQLITE_DB_PATH` or `DATABASE_URL`. Make a SQLite online backup or a consistent disk snapshot. Copying a live database file alone can omit recent transactions in its write-ahead log. Keep the backup in restricted storage because it contains Shopify access tokens and card codes.

On a computer with Node.js 24, run the following in the directory containing the script. Replace the example path with the location of your local backup.

```sh
node render-exit-audit.mjs "/path/to/private-backup.sqlite"
```

The script opens the existing file read-only. It prints category counts for Macron Sports Hub Hastings. An empty object means that table contains no matching records. A missing or unrelated database reports an error.

- Match unconsumed merchandise against outstanding old till sales. An expired checkout can be an abandoned basket. Expiry alone cannot establish that a paid order was handed over.
- For cards marked failed, processing, duplicate or inconsistent, or with an order or activation attempt, compare the associated sale with the existing Shopify gift card in your restricted records. Confirm that any paid card was issued correctly before retirement. Keep expired pending gifts separate until any corresponding payment is ruled out.
- Cards recorded as activated with a Shopify gift card ID already have a Shopify record. Their current balances stay in Shopify. Reissuing those balances can give a customer credit twice.

Run this check again on the final backup after the old till has stopped accepting sales. Compare it with the open Shopify orders. Separately verify the specific Render service, its persistent disk and any associated jobs or workspace charges before cancellation.
