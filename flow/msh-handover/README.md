# Automatic handover for the MSH till

The MSH till records what leaves the shop at checkout. Shopify Flow checks the paid order and the exact lines routed to the selling location. A confirmed Take today line is fulfilled. Order in stays open. A kit sold as one unit stays open while any of its numbered components are owed. The Admin order block records later collections and closes the kit after the final piece. A separately charged personalisation fee on a new item follows its verified garment or kit.

## Set up the two workflows

Use the [one-iPad rollout guide](../../rollout/START-HERE.md) for the order of installation, release and old-service retirement. On the shop PC, open `setup.cmd` in this directory to review the MSH Flow pair. It finds the connected store’s installed tasks, checks for existing workflows and asks before activating drafts. The matching app version needs the order update permission for later collections.

If a workflow with the same name has different saved steps, open the existing workflow in the MSH Flow editor. Review the differences before changing it. Use the current Run code files below on the same workflow and preserve access to its version history. Keep only one active payment workflow and one active routing workflow for the new till.

| Name | Trigger | Before Run code | Run code input file |
| --- | --- | --- | --- |
| MSH POS - Take today after payment | Order paid | Wait 10 seconds | input.graphql |
| MSH POS - Take today after order routing | Fulfillment order ready to fulfill | Directly to Run code | input-routed.graphql |

For manual setup, use the contents of `plan.mjs` for **Code** and `output.graphql` for **Output**. Add the condition **Run code → ready equals True**. Connect the True branch to **Send Admin API request**, choose **fulfillmentCreate**, and set the entire **Mutation inputs** field to `{{ runCode.mutationInput }}`. Activate both checked workflows before the first new sale.

## At the counter

Check the whole-cart **Mark as fulfilled** option is off for mixed handovers on the MSH iPad. For a kit, choose a size and handover for each garment. The summary lists the pieces physically taken and those owed. A customer can pay for the whole kit in one transaction. Two identical garments use separate component positions.

In Shopify Admin, add and pin **MSH kit handover** on the order. At a later collection select just the garments being handed to the customer and choose **Record collection**. Previously collected items stay recorded. If the last collection saves but native fulfilment is delayed, refresh and use **Complete kit fulfilment**. An edited order, a merged line, a refund or ambiguous evidence needs a staff check.

For an ordinary personalised Order in item, select the garment and its identified printing fee together in Shopify's native fulfilment controls at collection. Use [MSH Order Printer](../../printing/README.md) to see individual kit pieces on invoices and packing lists.

## One-iPad acceptance check

Use one controlled paid sale with an item taken today and a kit partly owed. Confirm the correct line and quantities in Admin. Collect the outstanding garments on two visits and check the kit and its linked printing fee after each. Preview both MSH printouts. Separately check the native physical gift card with a shop-approved transaction before retiring the old service.
