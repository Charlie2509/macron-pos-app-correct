import "@shopify/ui-extensions/preact";
import { render } from "preact";

export default async () => {
  render(<Extension />, document.body);
};

function Extension() {
  return (
    <s-tile
      heading="Gift Cards"
      subheading="Activate physical cards"
      onClick={() => shopify.action.presentModal()}
    />
  );
}
