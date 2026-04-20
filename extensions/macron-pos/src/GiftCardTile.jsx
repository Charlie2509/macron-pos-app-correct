import "@shopify/ui-extensions/preact";
import {render} from 'preact';

export default async function () {
  render(<GiftCardTile />, document.body);
}

function GiftCardTile() {
  return (
    <s-tile
      heading="Gift Cards"
      subheading="Activate physical cards"
      onClick={function () {
        shopify.action.presentModal();
      }}
    />
  );
}
