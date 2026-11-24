# MSH paid till handover

The pilot lets Shopify record which merchandise was handed over after a POS sale is paid in full. It uses two store-wide Shopify Flow workflows. Staff choose Take today or Order in in the MSH till as usual. The gift-card service and sales already in progress still need Render.

The pilot covers plain, unpersonalised single products and new kits whose numbered component choices have been verified on the MSH sales tile. Add each unit separately when it has a different handover. A kit sold as one Shopify line stays open if any component is owed. Its component record tells staff what the customer took. The existing MSH service continues to handle physical gift cards, separate personalisation fees and legacy sales.

## Before enabling the pilot

1. Deploy the matching Render changes first. The order webhook and reconciliation service must recognise Flow-owned lines before any till can create one. Release the app configuration with both `orders/create` and `orders/paid` subscriptions. The paid event covers merchandise on sales paid later. Keep the existing Render database and gift-card service.
2. Set up the two workflows on **Macron Sports Hub Hastings**. On a Windows PC, open this directory from an extracted copy of the repository and run `setup.cmd`. On a computer with Node.js 22.12 or newer, the same installer can run with `npm exec --yes --package=@shopify/cli@5.0.1 -- node setup.mjs` from this directory. The installer checks the store domain, finds existing workflows, offers to save missing drafts, then asks before activation.
3. In Shopify Admin, open **Apps → Flow**. Check that **MSH POS - Take today after payment** and **MSH POS - Take today after order routing** are active. The first checks the order after a 10-second wait. The second covers orders Shopify makes ready for fulfilment after that check.
4. Release the matching pilot POS extension. In **Apps → Macron POS → Paid till handover**, select **Enable Flow pilot** once, then reopen the sales tile on both iPads. A new installation defaults to off. For mixed sales, keep Shopify POS's whole-cart **Mark as fulfilled** switch off. Check this on both tills before the pilot.

## Kit components and later collection

The till saves each named garment and its chosen size against the kit sold. For a split handover, record the pieces the customer actually takes. For example, a shirt and shorts can be taken today while the socks are still owed. Shopify sells this as one unit. The kit line stays unfulfilled until the last piece has been handed over. Other complete lines on the same order can be fulfilled separately.

Release **MSH kit handover** with the app. Approve its `write_orders` permission for recording collections, then add and pin the block on a Shopify Admin order details page. The block reads the numbered kit pieces already stored by the MSH till, including earlier orders with compatible properties. Staff can see **Taken at sale**, **Still owed** and **Collected later**. Missing or conflicting information is flagged for a manual check.

When the customer returns, select just the pieces being handed over and choose **Record collection**. Each kit on the order has its own record. Once its last piece is collected, the block completes that kit's remaining fulfilment at the selling location. If Shopify cannot complete it, the collection remains saved and the block offers a retry after refresh. On edited, refunded or merged orders use the displayed details to review the handover manually.

## Shopify Flow editor setup

If Shopify limits workflow API access, you can build or review each workflow directly in Flow. Search for the two names before creating any drafts.

| Workflow | Trigger | Before Run code | Run code input |
| --- | --- | --- | --- |
| MSH POS - Take today after payment | Order paid | Wait 10 seconds | Contents of `input.graphql` |
| MSH POS - Take today after order routing | Fulfillment order ready to fulfill | Connect directly | Contents of `input-routed.graphql` |

In **Run code**, paste `plan.mjs` into **Code** and `output.graphql` into **Output**. Add a condition where **Run code → ready** equals **True**. Connect only the True branch to **Send Admin API request**. Choose the mutation `fulfillmentCreate` and set the whole **Mutation inputs** field to `{{ runCode.mutationInput }}`. This specifies the individual fulfilment line IDs and quantities. Turn on each reviewed workflow.

## Check the handover

Use an authorised pilot transaction on each physical till. On each separate order, mark one eligible physical line Take today and another Order in, take payment for both, and check that Admin shows **Paid · Partially fulfilled**. Check the item names and quantities in each fulfilment. A repeated workflow run after a successful handover should leave the Order in line open. Test a mixed kit on its own, a whole kit taken today, a kit with a separate fee, and a physical gift card. Record a mixed kit's remaining pieces in two visits and check the paperwork and native status after each.

Repeat on both tills simultaneously with two units of the **same size and SKU** on each sale. Add one as Take today and one as Order in. Check the quantities on the till before payment and again in Admin afterwards. Each paid order should have one fulfilled unit and one outstanding unit. If the till warns that Shopify has combined the lines, inspect the cart before taking payment. If the paid order shows a merged line or an incorrect split, pause this part of the pilot and review that order manually.

To stop creating new Flow-owned lines, select **Turn off Flow pilot** in Macron POS and reopen both sales tiles. Keep both workflows and the Render exclusions in place for existing marked orders through payment and routing. If a paid marked sale remains open, use the order number in Flow's recent runs to inspect the decision and the order's remaining quantities before recording any manual handover.
