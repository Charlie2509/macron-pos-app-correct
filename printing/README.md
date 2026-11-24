# MSH kit print templates

The MSH invoice and packing list use Shopify Order Printer. Each kit piece prints with its position, garment, selected size, quantity at sale and handover. Two sizes of the same garment stay on separate rows.

## Install in the MSH shop

1. In Shopify Admin, open **Apps → Order Printer → Templates**. Open your current invoice and packing list. Copy the entire contents of each **Edit code** box to separate text files so you have the current versions.
2. The two ready-to-paste files supplied privately are based on the MSH templates saved on 19 September 2026. If the store's templates changed since then, update the copies you just saved using the commands below to keep your current wording, branding, VAT and layout.
3. In **Templates**, choose **Create a template**. Name it **MSH Invoice – kit test** and paste the entire updated invoice into **Edit code**. Click **Preview**, then **Save**. Repeat for **MSH Packing List – kit test** with the packing-list file. Both templates are for the app's order-level documents. Shopify's native shipment packing-slip editor has a different set of variables.
4. In **Orders**, open a paid test order containing the same garment in two sizes with different handovers. Use **More actions → Print with Order Printer**, select the two test templates, and preview both. Check the garment, size and handover on each row. Record a later collection in the MSH order action and reopen the previews to check that piece. Preview an ordinary order as well.
5. Once the samples are right, select the new templates when printing, or copy the tested code into the two current templates. Keep the earlier copies as backups.

## Read the handover column

- **Taken at sale** means the paid sale recorded take today for that piece.
- **Collected later** means this order line, numbered piece and original garment/size match the MSH collection record.
- **Still owed** means the paid, open, unrefunded single kit has a readable collection record and this piece is outstanding.
- **Owed at sale** gives the original order-in instruction when the template cannot establish the current balance. Shopify's native fulfilment is for the parent kit. **Check in Shopify** flags missing or conflicting details.
- An older kit with only a grouped summary shows its original handover choices. An unpaid sale shows the instruction staff selected.

## Apply to a copy of a customised template

The updater needs Node.js 20 or later. From the repository root, run the following commands with the two files you saved from your current shop.

```sh
node printing/update-templates.mjs current-invoice.txt updated-invoice.txt
node printing/update-templates.mjs current-packing.txt updated-packing.txt
```

The private ZIP includes the same updater and fragment in its `printing` folder. Run the commands from the extracted ZIP folder. Each output path must be new. The updater checks for the MSH template's kit table and wraps the old display for legacy orders. The new display takes the place of the original kit status badges and component table on verified MSH kits. Preview any custom wording added in those areas. If the expected layout is missing, the updater reports the first unmatched section and leaves the input file intact. For a substantially different template, use `printing/kit-handover.liquid` inside a `for line_item in order.line_items` loop in a draft copy and replace its existing kit table to avoid duplicate rows.

## Verify locally

```sh
npm ci --prefix printing
npm test --prefix printing
node printing/verify-template.mjs current-invoice.txt
node printing/verify-template.mjs current-packing.txt
```

The full-template check uses synthetic orders. It compares ordinary-item output, checks three sized pieces and their handovers, and redraws the document after native fulfilment. A Shopify Order Printer preview checks the app's actual Liquid runtime and metafield exposure.

[Shopify Order Printer template setup](https://help.shopify.com/en/manual/fulfillment/managing-orders/printing-orders/shopify-order-printer/creating-templates) · [Supported fields](https://help.shopify.com/en/manual/fulfillment/managing-orders/printing-orders/liquid-variables-and-filters-reference)
