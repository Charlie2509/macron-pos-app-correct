# MSH till on Shopify

This update is for **Macron Sports Hub Hastings** and its **one MSH iPad**. Keep **Macron POS** installed. The launcher uploads an unreleased version of that same app and can save the two MSH handover workflows as drafts. Prepare it on the shop PC, then choose a quiet time to switch the till over.

## Prepare on the shop PC

1. Download the ZIP, choose **Extract all**, then open **Setup-Windows.cmd** inside the extracted folder. Install Node.js 24 LTS if the launcher asks.
2. Complete Shopify's sign-in in your own browser. The app is locked to the existing Macron POS client ID, and Flow uses the MSH store at `y5y3p1-hw.myshopify.com`.
3. When asked **Save the drafts?**, enter **Y**. The launcher checks for versions and workflows already saved. Copy the version name beginning `msh-shopify-` from the terminal. If interrupted, reopen the same launcher from the same folder.
4. In [Shopify Dev Dashboard](https://dev.shopify.com/dashboard), open **Macron POS → Versions** and check that exact unreleased version. It should contain the Macron POS sales tile and the MSH kit handover block. In [MSH Shopify Flow](https://admin.shopify.com/store/y5y3p1-hw/apps/flow), check **MSH POS - Take today after payment** and **MSH POS - Take today after order routing**. If Shopify does not permit automatic creation, use the Flow editor instructions in `flow/msh-handover/README.md`.

## Switch the one iPad over between sales

1. On MSH, finish or clear any old cart. Match outstanding old sales and paid physical gift cards to Shopify. Take a private, consistent backup of the old MSH Render disk and check it using `rollout/render-exit-audit.md`. Keep the backup private; it contains card codes and access credentials. Note the previously released Macron POS version.
2. With the iPad idle, stop the **MSH fulfilment reconciliation schedule**, including any external job calling the Render reconcile endpoint, and turn off any other MSH automation that fulfils these same orders. Check for legacy webhook deliveries and pending sales. Keep the old data available throughout this gap.
3. In **MSH Shopify Flow**, turn on the two verified workflows. In **Dev Dashboard → Macron POS → Versions**, release the version shown by the launcher. Approve the MSH app's updated permissions if Shopify asks. The app release removes its configured Render order webhooks and custom gift-card tile. Check for any separate shop-specific webhooks still pointing to Render before taking a new sale. Reopen Shopify POS on the MSH iPad and open the **Macron POS** sales tile. Check that whole-cart **Mark as fulfilled** is off before a mixed sale.
4. On a Shopify Admin order, add and pin **MSH kit handover** for the back office. The download's **Paperwork** folder contains the MSH invoice and packing-list updates. The ready-to-paste copies are based on the saved September templates. Use the included updater on copies of newer shop templates to keep any subsequent edits. Preview both on the same order before making them the shop defaults.
5. For physical gift cards, open **Point of Sale → Edit for POS app → Settings → Gift cards** in MSH Admin and choose **Digital or physical**. Add Shopify's **Add gift card** tile to the MSH iPad, enable gift-card payments and check a spare printed card. For the existing supplier-printed 13-digit cards choose **Physical gift card → Enter gift card code**. Confirm a new sale issues a single Shopify gift card for the paid amount. Existing issued cards retain their balances in Shopify.

## Check a paid sale before cancelling Render

Use an authorised MSH sale on this iPad. Take payment for one item the customer takes and one item ordered in. In Admin confirm the exact taken line is fulfilled and the owed line remains open. For a kit, choose **Split by item**, record its garments and sizes and check them in the order block and on a printout. Record a later collection and verify that only the completed kit closes. Look at each Flow run and check that an order-in-only sale stays open.

Once these pass and the old sale and gift-card queues are accounted for, check the service, disk, jobs and billing in the MSH Render account. Cancel the specific MSH hosting resources and verify the billing page afterwards. Keep the private rollback backup. If a test fails, pause sales on the new app while reviewing that order and its Flow runs. Keep unfulfilled newer orders identifiable if you return to the earlier app version.
