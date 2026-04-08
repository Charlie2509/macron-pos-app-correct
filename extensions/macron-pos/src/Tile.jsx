import "@shopify/ui-extensions/preact";
import {render} from 'preact';

export default async () => {
  render(<Extension />, document.body);
}

function Extension() {
  return (
    <s-tile
      heading="Macron POS"
      subheading="Club order flow"
      onClick={() => shopify.action.presentModal()}
    />
  );
}
