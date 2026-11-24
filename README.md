# Macron POS

The Macron Sports Hub Hastings till runs inside Shopify POS on the shop’s iPad. Shopify hosts the sales tile and the Admin kit handover block. Two Shopify Flow workflows record the physical handover after payment. Physical gift cards use the native Shopify POS gift-card tile.

For the shop-PC download and cutover, start with [the rollout guide](rollout/START-HERE.md). [Flow setup](flow/msh-handover/README.md) also covers installing the workflows in the Flow editor. Use [the printer instructions](printing/README.md) for the MSH invoice and packing list. The [old-service audit](rollout/render-exit-audit.md) checks historical queues on a private database backup.

## Development

Install Node.js 24 LTS and run:

```sh
npm ci
npm test
npm run typecheck
npm run build
```

For the template rendering checks, use `npm ci --prefix printing` and `npm test --prefix printing`. The Shopify CLI builds the POS and Admin extensions. The Flow installer is separate because workflows belong to the store. Keep the existing Macron POS client ID and extension UIDs when preparing an app version.
