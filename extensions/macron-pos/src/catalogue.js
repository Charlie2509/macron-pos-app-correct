const rangeCacheLimit = 16;
const rangeFreshFor = 5 * 60 * 1000;

export function createRangeLoader(fetchProducts, now = Date.now) {
  const cache = new Map();
  const pending = new Map();
  let selection = 0;

  function load(id) {
    if (!pending.has(id)) {
      const request = fetchProducts(id).then(products => {
        cache.delete(id);
        cache.set(id, {products, savedAt: now()});
        if (cache.size > rangeCacheLimit) cache.delete(cache.keys().next().value);
        return products;
      }).finally(() => pending.delete(id));
      pending.set(id, request);
    }
    return pending.get(id);
  }

  return {
    leave() { selection += 1; },
    async select(id, publish) {
      const current = ++selection;
      const cached = cache.get(id);
      if (cached && now() - cached.savedAt < rangeFreshFor) {
        cache.delete(id);
        cache.set(id, cached);
        publish({id, products: cached.products, loading: false, error: ''});
        return;
      }
      publish({id, products: [], loading: true, error: ''});
      try {
        const products = await load(id);
        if (selection === current) publish({id, products, loading: false, error: ''});
      } catch (error) {
        if (selection === current) {
          publish({id, products: [], loading: false, error: error?.message || 'Could not load this range.'});
        }
      }
    },
  };
}

export function nextCatalogueCursor(page, seen) {
  if (!page || typeof page.hasNextPage !== 'boolean') throw new Error('Shopify returned an incomplete catalogue page.');
  if (!page.hasNextPage) return null;
  const cursor = page.endCursor;
  if (typeof cursor !== 'string' || !cursor || seen.has(cursor)) throw new Error('Shopify returned an invalid catalogue cursor.');
  seen.add(cursor);
  return cursor;
}

export async function readCatalogue(query, variables) {
  const response = await fetch('shopify:admin/api/graphql.json', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({query, variables}),
  });
  if (!response.ok) throw new Error('Shopify catalogue request failed (' + response.status + ').');
  const json = await response.json();
  if (json.errors?.length) throw new Error(json.errors[0].message);
  if (!json.data) throw new Error('Shopify returned no catalogue data.');
  return json.data;
}

const moreVariants = `query RemainingCatalogueVariants($id: ID!, $cursor: String!) {
  product(id: $id) {
    variants(first: 100, after: $cursor) {
      edges { node { id title sku inventoryItem { requiresShipping } selectedOptions { name value } } }
      pageInfo { hasNextPage endCursor }
    }
  }
}`;

export async function allVariantEdges(id, firstPage, read = readCatalogue) {
  const edges = [];
  const seen = new Set();
  let page = firstPage;
  let cursor;
  do {
    if (!Array.isArray(page?.edges)) throw new Error('Shopify returned incomplete size options.');
    edges.push(...page.edges);
    cursor = nextCatalogueCursor(page.pageInfo, seen);
    if (cursor) page = (await read(moreVariants, {id, cursor})).product?.variants;
  } while (cursor);
  return edges;
}
