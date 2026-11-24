export function catalogueLabel(title?: string) {
  return (title || '').replace(/&amp;/gi, '&');
}

export function matchesSaleSearch(title: string, query: string) {
  const words = query.trim().toLocaleLowerCase().split(/\s+/);
  const name = catalogueLabel(title).toLocaleLowerCase();
  return words.every(word => name.includes(word));
}

type CatalogueItem = {
  id?: string;
  collectionId?: string;
  name?: string;
  title?: string;
  label?: string;
  imageUrl?: string | null;
};

export function CatalogueGrid<T extends CatalogueItem>({items, columns, onPick}: {
  items: T[];
  columns: number;
  onPick: (item: T) => void;
}) {
  const rows = [];
  for (let index = 0; index < items.length; index += columns) {
    rows.push(items.slice(index, index + columns));
  }
  return <s-stack gap="small">
    {rows.map(row => <s-stack key={row[0].id || row[0].collectionId || row[0].name || row[0].label}
      direction="inline" gap="small" alignItems="stretch">
      {row.map(item => {
        const title = catalogueLabel(item.title || item.name || item.label);
        return <s-box key={item.id || item.collectionId || title} inlineSize={columns === 3 ? '31%' : '48%'} minInlineSize="0px">
          <s-clickable onClick={() => onPick(item)}>
            <s-stack gap="none" alignItems="stretch">
              <s-divider />
              <s-stack direction="inline" alignItems="stretch" justifyContent="space-between">
                <s-divider direction="block" />
                <s-stack inlineSize="94%" minBlockSize="136px" padding="small" gap="small" alignItems="center" justifyContent="center">
                  <s-stack inlineSize="64px" blockSize="64px" alignItems="center" justifyContent="center">
                    {item.imageUrl
                      ? <s-image src={item.imageUrl} alt="" objectFit="contain" />
                      : <s-icon type={item.title ? 'product' : 'collection'} size="base" />}
                  </s-stack>
                  <s-text type="strong">{title}</s-text>
                </s-stack>
                <s-divider direction="block" />
              </s-stack>
              <s-divider />
            </s-stack>
          </s-clickable>
        </s-box>;
      })}
    </s-stack>)}
  </s-stack>;
}

export function OptionButtons<T extends {id: string; title: string}>({items, columns, selected, onPick, disabled, isAvailable}: {
  items: T[];
  columns: 2 | 3 | 4;
  selected?: string;
  onPick: (item: T) => void;
  disabled: boolean;
  isAvailable?: (item: T) => boolean;
}) {
  const rows = [];
  for (let index = 0; index < items.length; index += columns) rows.push(items.slice(index, index + columns));
  const widths = {2: '48%', 3: '31%', 4: '23%'} as const;
  return <s-stack gap="small">
    {rows.map(row => <s-stack key={row[0].id} direction="inline" gap="small">
      {row.map(item => <s-box key={item.id} inlineSize={widths[columns]} minInlineSize="0px">
        <s-button variant={item.id === selected ? 'primary' : 'secondary'}
          disabled={disabled || (isAvailable != null && !isAvailable(item))}
          onClick={() => onPick(item)}>{item.id === selected ? '✓ ' : ''}{catalogueLabel(item.title)}</s-button>
      </s-box>)}
    </s-stack>)}
  </s-stack>;
}

export function RangeSearch({value, onChange, label}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
}) {
  return <s-search-field placeholder={label} value={value} onInput={event => onChange(event.currentTarget.value ?? '')} />;
}
