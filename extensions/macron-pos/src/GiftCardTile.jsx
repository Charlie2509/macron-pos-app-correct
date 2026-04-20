import "@shopify/ui-extensions/preact";
import {render} from 'preact';

export default async () => {
  render(<Extension />, document.body);
}

function Extension() {
  return (
    <s-tile
      heading="Gift Card Sale"
      subheading="Scan card and checkout"
      onClick={() => shopify.action.presentModal()}
    />
  );
}
