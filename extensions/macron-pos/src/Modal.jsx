
import {render} from 'preact';
import {useEffect, useState} from 'preact/hooks';

// File with live data debug instrumentation, bundle plumbing, personalisation meta debug, and navigation/cart flows.

// ---------------- Mock helpers ----------------
function mockVariants(prefix) {
  return [
    {id: prefix + '-s', title: 'Small'},
    {id: prefix + '-m', title: 'Medium'},
    {id: prefix + '-l', title: 'Large'},
  ];
}

function mockBundleComponents() {
  return [
    {id: 'comp-tee', title: 'Training Tee', variants: mockVariants('comp-tee')},
    {id: 'comp-shorts', title: 'Training Shorts', variants: mockVariants('comp-shorts')},
    {id: 'comp-socks', title: 'Socks', variants: mockVariants('comp-socks')},
  ];
}

function mockMetaNone() {
  return {
    enablePersonalisation: false,
    personalisationLabel: '',
    personalisationFeeRaw: '',
    personalisationMaxCharsRaw: '',
    personalisationRequired: false,
    extraField1Enabled: false,
    extraField1Label: '',
    extraField1Required: false,
    extraField2Enabled: false,
    extraField2Label: '',
    extraField2Required: false,
    enableFileUpload: false,
    fileUploadLabel: '',
    fileUploadHelpText: '',
    fileUploadRequired: false,
  };
}

function mockMetaPrimary(label, fee, maxChars, required) {
  return {
    enablePersonalisation: true,
    personalisationLabel: label,
    personalisationFeeRaw: fee,
    personalisationMaxCharsRaw: maxChars,
    personalisationRequired: required,
    extraField1Enabled: false,
    extraField1Label: '',
    extraField1Required: false,
    extraField2Enabled: false,
    extraField2Label: '',
    extraField2Required: false,
    enableFileUpload: false,
    fileUploadLabel: '',
    fileUploadHelpText: '',
    fileUploadRequired: false,
  };
}

function mockMetaExtra1(label) {
  return {
    enablePersonalisation: true,
    personalisationLabel: label,
    personalisationFeeRaw: '',
    personalisationMaxCharsRaw: '',
    personalisationRequired: true,
    extraField1Enabled: true,
    extraField1Label: 'Please Enter The Players Name And Age Group',
    extraField1Required: true,
    extraField2Enabled: false,
    extraField2Label: '',
    extraField2Required: false,
    enableFileUpload: false,
    fileUploadLabel: '',
    fileUploadHelpText: '',
    fileUploadRequired: false,
  };
}

function mockMetaFileUpload(label, help) {
  return {
    enablePersonalisation: true,
    personalisationLabel: '',
    personalisationFeeRaw: '',
    personalisationMaxCharsRaw: '',
    personalisationRequired: false,
    extraField1Enabled: false,
    extraField1Label: '',
    extraField1Required: false,
    extraField2Enabled: false,
    extraField2Label: '',
    extraField2Required: false,
    enableFileUpload: true,
    fileUploadLabel: label,
    fileUploadHelpText: help,
    fileUploadRequired: true,
  };
}

function mockBundleMeta(components) {
  return {
    isBundle: true,
    componentHandles: ['comp-tee', 'comp-shorts', 'comp-socks'],
    componentProducts: components,
  };
}

function mockBundleMetaEmpty() {
  return {
    isBundle: false,
    componentHandles: [],
    componentProducts: [],
  };
}

var MOCK_CLUBS = [
  {
    name: 'All Stars Academy',
    type: 'subsections',
    subsections: [
      {
        label: 'Coaches',
        products: [
          {
            id: 'mock-coach-polo',
            title: 'Staff Polo',
            variants: mockVariants('mock-coach-polo'),
            personalisationMeta: mockMetaNone(),
            bundleMeta: mockBundleMetaEmpty(),
          },
          {
            id: 'mock-coach-tee',
            title: 'Training Tee',
            variants: mockVariants('mock-coach-tee'),
            personalisationMeta: mockMetaPrimary('Printed Initials', '2.50', '3', false),
            bundleMeta: mockBundleMetaEmpty(),
          },
        ],
      },
      {
        label: 'Players',
        products: [
          {
            id: 'mock-player-polo',
            title: 'Staff Polo',
            variants: mockVariants('mock-player-polo'),
            personalisationMeta: mockMetaPrimary('Printed Number To Back Of Shirt', '', '', true),
            bundleMeta: mockBundleMetaEmpty(),
          },
          {
            id: 'mock-player-tee',
            title: 'Training Tee',
            variants: mockVariants('mock-player-tee'),
            personalisationMeta: mockMetaExtra1('Name & Number'),
            bundleMeta: mockBundleMetaEmpty(),
          },
        ],
      },
    ],
    products: [],
  },
  {
    name: 'Bexhill United',
    type: 'products',
    subsections: [],
    products: [
      {
        id: 'mock-bexhill-home',
        title: 'Home Shirt',
        variants: mockVariants('mock-bexhill-home'),
        personalisationMeta: mockMetaNone(),
        bundleMeta: mockBundleMetaEmpty(),
      },
      {
        id: 'mock-bexhill-train',
        title: 'Training Top',
        variants: mockVariants('mock-bexhill-train'),
        personalisationMeta: mockMetaPrimary('Printed Initials', '2.50 GBP', '3', false),
        bundleMeta: mockBundleMetaEmpty(),
      },
    ],
  },
  {
    name: 'Eastbourne United AFC',
    type: 'subsections',
    subsections: [
      {
        label: 'Juniors',
        products: [
          {
            id: 'mock-eua-jr-match',
            title: 'Match Shirt',
            variants: mockVariants('mock-eua-jr-match'),
            personalisationMeta: mockMetaFileUpload('Please Upload Your Sponsor Logo Here', 'Logo file (not wired in POS V1)'),
            bundleMeta: mockBundleMetaEmpty(),
          },
          {
            id: 'mock-eua-jr-rain',
            title: 'Rain Jacket',
            variants: mockVariants('mock-eua-jr-rain'),
            personalisationMeta: mockMetaNone(),
            bundleMeta: mockBundleMetaEmpty(),
          },
        ],
      },
      {
        label: 'Seniors',
        products: [
          {
            id: 'mock-eua-sr-match',
            title: 'Match Shirt',
            variants: mockVariants('mock-eua-sr-match'),
            personalisationMeta: mockMetaPrimary('Printed Number To Back Of Shirt', '', '', true),
            bundleMeta: mockBundleMetaEmpty(),
          },
          {
            id: 'mock-eua-sr-rain',
            title: 'Rain Jacket',
            variants: mockVariants('mock-eua-sr-rain'),
            personalisationMeta: mockMetaPrimary('Printed Initials', '2.50', '3', false),
            bundleMeta: mockBundleMeta(mockBundleComponents()),
          },
        ],
      },
    ],
    products: [],
  },
  {
    name: 'Hastings United',
    type: 'products',
    subsections: [],
    products: [
      {
        id: 'mock-hastings-match',
        title: 'Match Shirt',
        variants: mockVariants('mock-hastings-match'),
        personalisationMeta: mockMetaNone(),
        bundleMeta: mockBundleMetaEmpty(),
      },
      {
        id: 'mock-hastings-rain',
        title: 'Rain Jacket',
        variants: mockVariants('mock-hastings-rain'),
        personalisationMeta: mockMetaFileUpload('Please Upload Your Sponsor Logo Here', 'Logo file (not wired in POS V1)'),
        bundleMeta: mockBundleMetaEmpty(),
      },
    ],
  },
];
// ---------------- Normalisation helpers ----------------
function toStr(value) {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value).trim();
}

function toBool(value) {
  if (value === true) {
    return true;
  }
  if (value === false) {
    return false;
  }
  var str = toStr(value).toLowerCase();
  return str === 'true' || str === '1' || str === 'yes';
}

function parseFeeDisplay(raw) {
  var text = toStr(raw);
  if (text === '') {
    return '';
  }
  var cleaned = text.replace(/[^0-9.\-]/g, '');
  var fee = parseFloat(cleaned);
  if (isNaN(fee) || fee <= 0) {
    return '';
  }
  return '+£' + fee.toFixed(2);
}

function parseFeeAmount(raw) {
  if (raw === null || raw === undefined) {
    return null;
  }
  if (typeof raw === 'object') {
    if (raw.amount !== undefined) {
      var numObj = parseFloat(toStr(raw.amount).replace(/[^0-9.\-]/g, ''));
      if (!isNaN(numObj) && numObj > 0) {
        return numObj;
      }
    }
    return null;
  }
  var text = toStr(raw);
  if (text === '') {
    return null;
  }
  var cleaned = text.replace(/[^0-9.\-]/g, '');
  var fee = parseFloat(cleaned);
  if (isNaN(fee) || fee <= 0) {
    return null;
  }
  return fee;
}

function parseMaxChars(raw) {
  var text = toStr(raw);
  if (text === '') {
    return null;
  }
  var cleaned = text.replace(/[^0-9]/g, '');
  if (cleaned === '') {
    return null;
  }
  var num = parseInt(cleaned, 10);
  if (isNaN(num) || num <= 0) {
    return null;
  }
  return num;
}

function hasAnyPersonalisation(meta) {
  if (!meta) {
    return false;
  }
  return (
    meta.enablePersonalisation === true ||
    meta.extraField1Enabled === true ||
    meta.extraField2Enabled === true ||
    meta.enableFileUpload === true
  );
}

function hasEnteredPersonalisationValues(meta, primaryFieldValue, extraField1Value, extraField2Value) {
  if (!meta) {
    return false;
  }
  if (meta.enablePersonalisation === true && toStr(primaryFieldValue) !== '') {
    return true;
  }
  if (meta.extraField1Enabled === true && toStr(extraField1Value) !== '') {
    return true;
  }
  if (meta.extraField2Enabled === true && toStr(extraField2Value) !== '') {
    return true;
  }
  return false;
}

function classifyVariantId(id) {
  if (typeof id === 'number') {
    return 'numeric';
  }
  var text = toStr(id);
  var numericOnly = /^\d+$/.test(text);
  if (numericOnly) {
    return 'numeric';
  }
  return 'gid/string';
}

function normalizeVariantId(id) {
  if (typeof id === 'number') {
    return {valid: true, value: id, type: 'numeric'};
  }
  var text = toStr(id);
  if (text === '') {
    return {valid: false, value: null, type: 'none'};
  }
  var tailMatch = text.match(/(\d+)$/);
  if (tailMatch && tailMatch[1]) {
    var parsed = parseInt(tailMatch[1], 10);
    if (!isNaN(parsed)) {
      return {valid: true, value: parsed, type: classifyVariantId(text)};
    }
  }
  return {valid: false, value: null, type: classifyVariantId(text)};
}

function isMockVariant(id) {
  var text = toStr(id).toLowerCase();
  return text.indexOf('mock') === 0 || text.indexOf('comp-') === 0;
}

function mapPersonalisationMeta(productNode) {
  function val(field) {
    if (!field) {
      return '';
    }
    return toStr(field.value);
  }
  return {
    enablePersonalisation: toBool(productNode && productNode.enablePersonalisation ? productNode.enablePersonalisation.value : ''),
    personalisationLabel: val(productNode ? productNode.personalisationLabel : null),
    personalisationFeeRaw: val(productNode ? productNode.personalisationFee : null),
    personalisationMaxCharsRaw: val(productNode ? productNode.personalisationMaxChars : null),
    personalisationRequired: toBool(productNode && productNode.personalisationRequired ? productNode.personalisationRequired.value : ''),
    extraField1Enabled: toBool(productNode && productNode.extraField1Enabled ? productNode.extraField1Enabled.value : ''),
    extraField1Label: val(productNode ? productNode.extraField1Label : null),
    extraField1Required: toBool(productNode && productNode.extraField1Required ? productNode.extraField1Required.value : ''),
    extraField2Enabled: toBool(productNode && productNode.extraField2Enabled ? productNode.extraField2Enabled.value : ''),
    extraField2Label: val(productNode ? productNode.extraField2Label : null),
    extraField2Required: toBool(productNode && productNode.extraField2Required ? productNode.extraField2Required.value : ''),
    enableFileUpload: toBool(productNode && productNode.enableFileUpload ? productNode.enableFileUpload.value : ''),
    fileUploadLabel: val(productNode ? productNode.fileUploadLabel : null),
    fileUploadHelpText: val(productNode ? productNode.fileUploadHelpText : null),
    fileUploadRequired: toBool(productNode && productNode.fileUploadRequired ? productNode.fileUploadRequired.value : ''),
  };
}

function mapBundleMeta(bundleField) {
  var handles = [];
  var components = [];
  if (bundleField && bundleField.value) {
    var raw = toStr(bundleField.value);
    if (raw !== '') {
      try {
        var parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          for (var i = 0; i < parsed.length; i += 1) {
            var item = parsed[i];
            if (typeof item === 'string') {
              handles.push(toStr(item));
            } else if (item && item.handle) {
              handles.push(toStr(item.handle));
            } else if (item && item.title) {
              handles.push(toStr(item.title));
              if (item.variants && Array.isArray(item.variants)) {
                var mappedVariants = [];
                for (var v = 0; v < item.variants.length; v += 1) {
                  var varItem = item.variants[v];
                  mappedVariants.push({id: varItem.id, title: varItem.title});
                }
                components.push({id: item.id || item.title, title: item.title, variants: mappedVariants});
              }
            }
          }
        }
      } catch (e) {
        // ignore parse error
      }
      if (handles.length === 0) {
        var parts = raw.split(',');
        for (var j = 0; j < parts.length; j += 1) {
          var handle = toStr(parts[j]);
          if (handle !== '') {
            handles.push(handle);
          }
        }
      }
    }
  }
  var isBundle = handles.length > 0 || components.length > 0;
  return {
    isBundle: isBundle,
    componentHandles: handles,
    componentProducts: components,
  };
}

function mapVariants(variantEdges) {
  var list = [];
  if (variantEdges && Array.isArray(variantEdges)) {
    for (var i = 0; i < variantEdges.length; i += 1) {
      var edge = variantEdges[i];
      if (edge && edge.node) {
        list.push({id: edge.node.id, title: edge.node.title});
      }
    }
  }
  return list;
}

function mapProducts(productEdges) {
  var products = [];
  if (!productEdges || !Array.isArray(productEdges)) {
    return products;
  }
  for (var i = 0; i < productEdges.length; i += 1) {
    var edge = productEdges[i];
    if (!edge || !edge.node) {
      continue;
    }
    var node = edge.node;
    products.push({
      id: node.id,
      title: node.title,
      variants: mapVariants(node.variants ? node.variants.edges : []),
      personalisationMeta: mapPersonalisationMeta(node),
      bundleMeta: mapBundleMeta(node.bundleComponents),
    });
  }
  return products;
}

function mapCollections(collectionNodes) {
  var clubs = [];
  var collectionsCount = 0;
  var directClubsCount = 0;
  var subsectionClubsCount = 0;
  var orphanChildIgnored = 0;
  var parents = {};
  var parentNames = [];
  var children = [];

  if (collectionNodes && Array.isArray(collectionNodes)) {
    collectionsCount = collectionNodes.length;
    for (var i = 0; i < collectionNodes.length; i += 1) {
      var node = collectionNodes[i];
      if (!node) {
        continue;
      }
      var title = toStr(node.title);
      var productsCount = node.productsCount && node.productsCount.count ? node.productsCount.count : 0;
      var splitIndex = title.indexOf(' - ');
      if (splitIndex > -1) {
        var parentName = title.substring(0, splitIndex);
        var subsectionLabel = title.substring(splitIndex + 3);
        if (parentName !== '' && subsectionLabel !== '') {
          children.push({
            parentName: parentName,
            label: subsectionLabel,
            collectionId: node.id,
            collectionTitle: title,
            productsCount: productsCount,
          });
        }
      } else {
        if (!parents[title]) {
          parents[title] = {collectionId: node.id, productsCount: productsCount, collectionTitle: title};
          parentNames.push(title);
        } else {
          parents[title].productsCount = productsCount;
          parents[title].collectionId = node.id;
          parents[title].collectionTitle = title;
        }
      }
    }
  }

  parentNames.sort(function (a, b) {
    if (a < b) { return -1; }
    if (a > b) { return 1; }
    return 0;
  });

  for (var p = 0; p < parentNames.length; p += 1) {
    var name = parentNames[p];
    var parentInfo = parents[name];
    var parentProductsCount = parentInfo ? parentInfo.productsCount : 0;
    var matchingChildren = [];
    for (var c = 0; c < children.length; c += 1) {
      if (children[c].parentName === name) {
        matchingChildren.push(children[c]);
      }
    }
    matchingChildren.sort(function (a, b) {
      if (a.label < b.label) { return -1; }
      if (a.label > b.label) { return 1; }
      return 0;
    });

    if (parentProductsCount > 0) {
      clubs.push({
        name: name,
        type: 'products',
        subsections: [],
        products: null,
        collectionId: parentInfo.collectionId,
        collectionTitle: parentInfo.collectionTitle,
      });
      directClubsCount += 1;
      continue;
    }

    if (matchingChildren.length > 0) {
      var subsections = [];
      for (var m = 0; m < matchingChildren.length; m += 1) {
        subsections.push({
          label: matchingChildren[m].label,
          collectionId: matchingChildren[m].collectionId,
          collectionTitle: matchingChildren[m].collectionTitle,
        });
      }
      clubs.push({
        name: name,
        type: 'subsections',
        subsections: subsections,
        products: null,
        collectionId: parentInfo ? parentInfo.collectionId : null,
        collectionTitle: parentInfo ? parentInfo.collectionTitle : name,
      });
      subsectionClubsCount += 1;
    }
  }

  for (var i2 = 0; i2 < children.length; i2 += 1) {
    var child = children[i2];
    if (!parents[child.parentName]) {
      orphanChildIgnored += 1;
    }
  }

  return {
    clubs: clubs,
    collectionsCount: collectionsCount,
    directClubsCount: directClubsCount,
    subsectionClubsCount: subsectionClubsCount,
    orphanChildIgnored: orphanChildIgnored,
  };
}

async function fetchLiveClubs() {
  if (typeof fetch === 'undefined') {
    throw new Error('Admin API fetch unavailable');
  }

  var query = `query Collections($cursor: String) {
    collections(first: 100, after: $cursor) {
      edges {
        cursor
        node {
          id
          title
          productsCount {
            count
          }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }`;

  var allCollections = [];
  var cursor = null;
  var hasNextPage = true;
  var pageSafetyLimit = 20;
  var pagesFetched = 0;
  var errors = [];

  while (hasNextPage && pagesFetched < pageSafetyLimit) {
    pagesFetched += 1;
    var response;
    try {
      response = await fetch('shopify:admin/api/graphql.json', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query: query,
          variables: {cursor: cursor},
        }),
      });
    } catch (err) {
      throw new Error('Admin API fetch failed: ' + (err && err.message ? err.message : String(err)));
    }

    if (!response || !response.ok) {
      var statusCode = response && response.status ? response.status : 'unknown';
      var statusText = response && response.statusText ? response.statusText : 'unknown';
      var bodyText = '';
      try {
        bodyText = await response.text();
      } catch (e) {
        bodyText = '';
      }
      throw new Error('Admin API HTTP error: ' + statusCode + ' ' + statusText + (bodyText ? ' ' + bodyText : ''));
    }

    var json;
    try {
      json = await response.json();
    } catch (err) {
      throw new Error('Failed to parse GraphQL JSON: ' + (err && err.message ? err.message : String(err)));
    }

    if (json && json.errors && Array.isArray(json.errors) && json.errors.length > 0) {
      errors = errors.concat(json.errors);
    }

    if (!json || !json.data || !json.data.collections) {
      errors.push({message: 'Missing data in GraphQL response'});
      break;
    }

    var edges = json.data.collections.edges || [];
    for (var i = 0; i < edges.length; i += 1) {
      if (edges[i] && edges[i].node) {
        allCollections.push(edges[i].node);
      }
    }

    var pageInfo = json.data.collections.pageInfo;
    hasNextPage = pageInfo && pageInfo.hasNextPage === true;
    cursor = hasNextPage ? pageInfo.endCursor : null;
  }

  var mapped = mapCollections(allCollections);
  return {
    clubs: mapped.clubs,
    collectionsCount: mapped.collectionsCount,
    directClubsCount: mapped.directClubsCount,
    subsectionClubsCount: mapped.subsectionClubsCount,
    orphanChildIgnored: mapped.orphanChildIgnored,
    errors: errors,
    rawCollectionsCount: allCollections.length,
    pagesFetched: pagesFetched,
  };
}

async function fetchProductsForCollection(collectionId) {
  if (!collectionId) {
    return [];
  }
  var query = `query ProductsByCollection($id: ID!, $cursor: String) {
    collection(id: $id) {
      id
      title
      products(first: 50, after: $cursor) {
        edges {
          cursor
          node {
            id
            title
            variants(first: 20) {
              edges {
                node { id title }
              }
            }
            enablePersonalisation: metafield(namespace: "custom", key: "enable_personalisation") { value }
            personalisationLabel: metafield(namespace: "custom", key: "personalisation_label") { value }
            personalisationFee: metafield(namespace: "custom", key: "personalisation_fee") { value }
            personalisationMaxChars: metafield(namespace: "custom", key: "personalisation_max_chars") { value }
            personalisationRequired: metafield(namespace: "custom", key: "personalisation_required") { value }
            extraField1Enabled: metafield(namespace: "custom", key: "extra_field_1_enabled") { value }
            extraField1Label: metafield(namespace: "custom", key: "extra_field_1_label") { value }
            extraField1Required: metafield(namespace: "custom", key: "extra_field_1_required") { value }
            extraField2Enabled: metafield(namespace: "custom", key: "extra_field_2_enabled") { value }
            extraField2Label: metafield(namespace: "custom", key: "extra_field_2_label") { value }
            extraField2Required: metafield(namespace: "custom", key: "extra_field_2_required") { value }
            enableFileUpload: metafield(namespace: "custom", key: "enable_file_upload") { value }
            fileUploadLabel: metafield(namespace: "custom", key: "file_upload_label") { value }
            fileUploadHelpText: metafield(namespace: "custom", key: "file_upload_help_text") { value }
            fileUploadRequired: metafield(namespace: "custom", key: "file_upload_required") { value }
            bundleComponents: metafield(namespace: "custom", key: "bundle_components") { value }
          }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  }`;

  var products = [];
  var cursor = null;
  var hasNextPage = true;
  var pageSafetyLimit = 10;
  var pagesFetched = 0;

  while (hasNextPage && pagesFetched < pageSafetyLimit) {
    pagesFetched += 1;
    var response = await fetch('shopify:admin/api/graphql.json', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: query,
        variables: {id: collectionId, cursor: cursor},
      }),
    });
    if (!response || !response.ok) {
      var statusCode = response && response.status ? response.status : 'unknown';
      var statusText = response && response.statusText ? response.statusText : 'unknown';
      var bodyText = '';
      try {
        bodyText = await response.text();
      } catch (e) {
        bodyText = '';
      }
      throw new Error('Product fetch error: ' + statusCode + ' ' + statusText + (bodyText ? ' ' + bodyText : ''));
    }
    var json = await response.json();
    if (!json || !json.data || !json.data.collection || !json.data.collection.products) {
      break;
    }
    var edges = json.data.collection.products.edges || [];
    for (var i = 0; i < edges.length; i += 1) {
      if (edges[i] && edges[i].node) {
        products.push({
          id: edges[i].node.id,
          title: edges[i].node.title,
          variants: mapVariants(edges[i].node.variants ? edges[i].node.variants.edges : []),
          personalisationMeta: mapPersonalisationMeta(edges[i].node),
          bundleMeta: mapBundleMeta(edges[i].node.bundleComponents),
        });
      }
    }
    var pageInfo = json.data.collection.products.pageInfo;
    hasNextPage = pageInfo && pageInfo.hasNextPage === true;
    cursor = hasNextPage ? pageInfo.endCursor : null;
  }

  return products;
}
// ---------------- UI ----------------
export default async function () {
  render(<Modal />, document.body);
}

function ScreenScroll(props) {
  return (
    <s-scroll-box style="height: 100%;">
      {props.children}
    </s-scroll-box>
  );
}

function Modal() {
  var screenState = useState('clubs');
  var screen = screenState[0];
  var setScreen = screenState[1];

  var clubsState = useState(MOCK_CLUBS);
  var clubs = clubsState[0];
  var setClubs = clubsState[1];

  var dataSourceState = useState('Mock data');
  var dataSource = dataSourceState[0];
  var setDataSource = dataSourceState[1];

  var liveFetchStartedState = useState(false);
  var liveFetchStarted = liveFetchStartedState[0];
  var setLiveFetchStarted = liveFetchStartedState[1];

  var liveFetchSucceededState = useState(false);
  var liveFetchSucceeded = liveFetchSucceededState[0];
  var setLiveFetchSucceeded = liveFetchSucceededState[1];

  var liveFetchFailedState = useState(false);
  var liveFetchFailed = liveFetchFailedState[0];
  var setLiveFetchFailed = liveFetchFailedState[1];

  var liveFetchErrorMessageState = useState('');
  var liveFetchErrorMessage = liveFetchErrorMessageState[0];
  var setLiveFetchErrorMessage = liveFetchErrorMessageState[1];

  var liveCollectionsCountState = useState(0);
  var liveCollectionsCount = liveCollectionsCountState[0];
  var setLiveCollectionsCount = liveCollectionsCountState[1];

  var liveUsableClubCountState = useState(0);
  var liveUsableClubCount = liveUsableClubCountState[0];
  var setLiveUsableClubCount = liveUsableClubCountState[1];

  var directClubsCountState = useState(0);
  var directClubsCount = directClubsCountState[0];
  var setDirectClubsCount = directClubsCountState[1];

  var subsectionClubsCountState = useState(0);
  var subsectionClubsCount = subsectionClubsCountState[0];
  var setSubsectionClubsCount = subsectionClubsCountState[1];

  var orphanChildIgnoredState = useState(0);
  var orphanChildIgnored = orphanChildIgnoredState[0];
  var setOrphanChildIgnored = orphanChildIgnoredState[1];

  var pagesFetchedState = useState(0);
  var pagesFetched = pagesFetchedState[0];
  var setPagesFetched = pagesFetchedState[1];

  var rawCollectionsCountState = useState(0);
  var rawCollectionsCount = rawCollectionsCountState[0];
  var setRawCollectionsCount = rawCollectionsCountState[1];

  var liveSourceStageState = useState('idle');
  var liveSourceStage = liveSourceStageState[0];
  var setLiveSourceStage = liveSourceStageState[1];
  var errorState = useState('');
  var errorMessage = errorState[0];
  var setErrorMessage = errorState[1];

  var productListLoadingState = useState(false);
  var productListLoading = productListLoadingState[0];
  var setProductListLoading = productListLoadingState[1];

  var currentProductsState = useState([]);
  var currentProducts = currentProductsState[0];
  var setCurrentProducts = currentProductsState[1];

  var currentProductsCollectionIdState = useState(null);
  var currentProductsCollectionId = currentProductsCollectionIdState[0];
  var setCurrentProductsCollectionId = currentProductsCollectionIdState[1];

  var lastCartActionStatusState = useState('idle');
  var lastCartActionStatus = lastCartActionStatusState[0];
  var setLastCartActionStatus = lastCartActionStatusState[1];

  var lastCartErrorMessageState = useState('');
  var lastCartErrorMessage = lastCartErrorMessageState[0];
  var setLastCartErrorMessage = lastCartErrorMessageState[1];

  var lastCartBeforeCountState = useState(0);
  var lastCartBeforeCount = lastCartBeforeCountState[0];
  var setLastCartBeforeCount = lastCartBeforeCountState[1];

  var lastCartAfterCountState = useState(0);
  var lastCartAfterCount = lastCartAfterCountState[0];
  var setLastCartAfterCount = lastCartAfterCountState[1];

  var lastNormalizedVariantIdState = useState('');
  var lastNormalizedVariantId = lastNormalizedVariantIdState[0];
  var setLastNormalizedVariantId = lastNormalizedVariantIdState[1];

  var lastLineItemPropertiesState = useState({});
  var lastLineItemProperties = lastLineItemPropertiesState[0];
  var setLastLineItemProperties = lastLineItemPropertiesState[1];

  var lastCartLineItemUuidState = useState('');
  var lastCartLineItemUuid = lastCartLineItemUuidState[0];
  var setLastCartLineItemUuid = lastCartLineItemUuidState[1];

  var lastPropertiesAttachStatusState = useState('idle');
  var lastPropertiesAttachStatus = lastPropertiesAttachStatusState[0];
  var setLastPropertiesAttachStatus = lastPropertiesAttachStatusState[1];

  var lastFeeAmountState = useState(null);
  var lastFeeAmount = lastFeeAmountState[0];
  var setLastFeeAmount = lastFeeAmountState[1];

  var lastFeeRequiredState = useState(false);
  var lastFeeRequired = lastFeeRequiredState[0];
  var setLastFeeRequired = lastFeeRequiredState[1];

  var lastFeeVariantIdState = useState('');
  var lastFeeVariantId = lastFeeVariantIdState[0];
  var setLastFeeVariantId = lastFeeVariantIdState[1];

  var lastFeeVariantStatusState = useState('idle');
  var lastFeeVariantStatus = lastFeeVariantStatusState[0];
  var setLastFeeVariantStatus = lastFeeVariantStatusState[1];

  var lastFeeErrorMessageState = useState('');
  var lastFeeErrorMessage = lastFeeErrorMessageState[0];
  var setLastFeeErrorMessage = lastFeeErrorMessageState[1];

  var lastFeeLineItemUuidState = useState('');
  var lastFeeLineItemUuid = lastFeeLineItemUuidState[0];
  var setLastFeeLineItemUuid = lastFeeLineItemUuidState[1];

  var lastFeePropertiesAttachStatusState = useState('idle');
  var lastFeePropertiesAttachStatus = lastFeePropertiesAttachStatusState[0];
  var setLastFeePropertiesAttachStatus = lastFeePropertiesAttachStatusState[1];

  var lastFeeProductTitleTargetState = useState('Personalisation fee (system)');
  var lastFeeProductTitleTarget = lastFeeProductTitleTargetState[0];
  var setLastFeeProductTitleTarget = lastFeeProductTitleTargetState[1];

  var lastFeeProductHandleTargetState = useState('personalisation-fee');
  var lastFeeProductHandleTarget = lastFeeProductHandleTargetState[0];
  var setLastFeeProductHandleTarget = lastFeeProductHandleTargetState[1];

  var lastFeeLookupQueryState = useState('');
  var lastFeeLookupQuery = lastFeeLookupQueryState[0];
  var setLastFeeLookupQuery = lastFeeLookupQueryState[1];

  var lastFeeCandidateCountState = useState(0);
  var lastFeeCandidateCount = lastFeeCandidateCountState[0];
  var setLastFeeCandidateCount = lastFeeCandidateCountState[1];

  var lastFeeVariantScanCountState = useState(0);
  var lastFeeVariantScanCount = lastFeeVariantScanCountState[0];
  var setLastFeeVariantScanCount = lastFeeVariantScanCountState[1];

  var lastFeeMatchMethodState = useState('none');
  var lastFeeMatchMethod = lastFeeMatchMethodState[0];
  var setLastFeeMatchMethod = lastFeeMatchMethodState[1];

  var lastFeeExactTitleValidationPassedState = useState(false);
  var lastFeeExactTitleValidationPassed = lastFeeExactTitleValidationPassedState[0];
  var setLastFeeExactTitleValidationPassed = lastFeeExactTitleValidationPassedState[1];

  var lastFeeProductFoundState = useState(false);
  var lastFeeProductFound = lastFeeProductFoundState[0];
  var setLastFeeProductFound = lastFeeProductFoundState[1];

  var lastFeeProductIdState = useState('');
  var lastFeeProductId = lastFeeProductIdState[0];
  var setLastFeeProductId = lastFeeProductIdState[1];

  var lastFeeVariantTitleMatchedState = useState('');
  var lastFeeVariantTitleMatched = lastFeeVariantTitleMatchedState[0];
  var setLastFeeVariantTitleMatched = lastFeeVariantTitleMatchedState[1];

  var lastFeeLineAddAttemptedState = useState(false);
  var lastFeeLineAddAttempted = lastFeeLineAddAttemptedState[0];
  var setLastFeeLineAddAttempted = lastFeeLineAddAttemptedState[1];

  var lastFeeLineAddStatusState = useState('idle');
  var lastFeeLineAddStatus = lastFeeLineAddStatusState[0];
  var setLastFeeLineAddStatus = lastFeeLineAddStatusState[1];

  var lastFeeVariantAvailableForSaleState = useState(null);
  var lastFeeVariantAvailableForSale = lastFeeVariantAvailableForSaleState[0];
  var setLastFeeVariantAvailableForSale = lastFeeVariantAvailableForSaleState[1];

  var lastEnteredPersonalisationState = useState(false);
  var lastEnteredPersonalisation = lastEnteredPersonalisationState[0];
  var setLastEnteredPersonalisation = lastEnteredPersonalisationState[1];

  var loadingState = useState(false);
  var loading = loadingState[0];
  var setLoading = loadingState[1];

  var clubState = useState(null);
  var selectedClub = clubState[0];
  var setSelectedClub = clubState[1];

  var subsectionState = useState(null);
  var selectedSubsection = subsectionState[0];
  var setSelectedSubsection = subsectionState[1];

  var productState = useState(null);
  var selectedProduct = productState[0];
  var setSelectedProduct = productState[1];

  var variantState = useState(null);
  var selectedVariant = variantState[0];
  var setSelectedVariant = variantState[1];

  var primaryState = useState('');
  var primaryFieldValue = primaryState[0];
  var setPrimaryFieldValue = primaryState[1];

  var extra1State = useState('');
  var extraField1Value = extra1State[0];
  var setExtraField1Value = extra1State[1];

  var extra2State = useState('');
  var extraField2Value = extra2State[0];
  var setExtraField2Value = extra2State[1];

  async function loadProductsForCollection(collectionId) {
    if (!collectionId) {
      return;
    }
    setProductListLoading(true);
    setCurrentProducts([]);
    setCurrentProductsCollectionId(collectionId);
    try {
      var products = await fetchProductsForCollection(collectionId);
      setCurrentProducts(products);
    } catch (err) {
      setErrorMessage(err && err.message ? err.message : String(err));
      setCurrentProducts([]);
    }
    setProductListLoading(false);
  }

  useEffect(function () {
    var cancelled = false;
    async function load() {
      setLiveFetchStarted(true);
      setLiveSourceStage('starting fetch');
      setLoading(true);
      try {
        setLiveSourceStage('sending admin graphql request');
        var liveResult = await fetchLiveClubs();
        if (cancelled) {
          return;
        }
        setLiveSourceStage('parsing graphql response');
        setPagesFetched(liveResult.pagesFetched || 0);
        setRawCollectionsCount(liveResult.rawCollectionsCount || 0);
        setLiveCollectionsCount(liveResult.collectionsCount || 0);
        setDirectClubsCount(liveResult.directClubsCount || 0);
        setSubsectionClubsCount(liveResult.subsectionClubsCount || 0);
        setOrphanChildIgnored(liveResult.orphanChildIgnored || 0);
        if (!liveResult) {
          setLiveFetchFailed(true);
          setLiveFetchSucceeded(false);
          setLiveFetchErrorMessage('No GraphQL result');
          setLiveSourceStage('falling back to mock');
          setPagesFetched(0);
          setRawCollectionsCount(0);
          setLiveCollectionsCount(0);
          setDirectClubsCount(0);
          setSubsectionClubsCount(0);
          setOrphanChildIgnored(0);
          setLiveUsableClubCount(0);
          setClubs(MOCK_CLUBS);
          setDataSource('Mock data');
          setLoading(false);
          return;
        }
        if (liveResult.errors && liveResult.errors.length > 0) {
          var errMsg = 'GraphQL errors returned (' + liveResult.errors.length + ')';
          if (liveResult.errors[0] && liveResult.errors[0].message) {
            errMsg = liveResult.errors[0].message;
          }
          setLiveFetchFailed(true);
          setLiveFetchSucceeded(false);
          setLiveFetchErrorMessage(errMsg);
          setLiveSourceStage('falling back to mock');
          setPagesFetched(0);
          setRawCollectionsCount(0);
          setLiveCollectionsCount(0);
          setDirectClubsCount(0);
          setSubsectionClubsCount(0);
          setOrphanChildIgnored(0);
          setLiveUsableClubCount(0);
          setClubs(MOCK_CLUBS);
          setDataSource('Mock data');
          setLoading(false);
          return;
        }
        setLiveSourceStage('normalizing collections');
        var liveClubs = liveResult.clubs || [];
        setLiveUsableClubCount(liveClubs.length);
        if ((liveResult.collectionsCount || 0) === 0) {
          setLiveFetchFailed(true);
          setLiveFetchSucceeded(false);
          setLiveFetchErrorMessage('Collections query returned 0 collections');
          setLiveSourceStage('falling back to mock');
          setPagesFetched(pagesFetched);
          setRawCollectionsCount(liveResult.rawCollectionsCount || 0);
          setLiveUsableClubCount(0);
          setDirectClubsCount(0);
          setSubsectionClubsCount(0);
          setOrphanChildIgnored(liveResult.orphanChildIgnored || 0);
          setClubs(MOCK_CLUBS);
          setDataSource('Mock data');
          setLoading(false);
          return;
        }
        if (liveClubs.length === 0) {
          setLiveFetchFailed(true);
          setLiveFetchSucceeded(false);
          setLiveFetchErrorMessage('Collections returned but no usable clubs built');
          setLiveSourceStage('falling back to mock');
          setLiveUsableClubCount(0);
          setDirectClubsCount(0);
          setSubsectionClubsCount(0);
          setOrphanChildIgnored(liveResult.orphanChildIgnored || 0);
          setClubs(MOCK_CLUBS);
          setDataSource('Mock data');
          setLoading(false);
          return;
        }
        setLiveSourceStage('using live data');
        setClubs(liveClubs);
        setDataSource('Live data');
        setLiveFetchSucceeded(true);
        setLiveFetchFailed(false);
        setLiveFetchErrorMessage('');
      } catch (err) {
        if (!cancelled) {
          setLiveFetchFailed(true);
          setLiveFetchSucceeded(false);
          setLiveFetchErrorMessage(err && err.message ? err.message : String(err));
          setLiveSourceStage('falling back to mock');
          setPagesFetched(0);
          setRawCollectionsCount(0);
          setLiveCollectionsCount(0);
          setDirectClubsCount(0);
          setSubsectionClubsCount(0);
          setOrphanChildIgnored(0);
          setLiveUsableClubCount(0);
          setClubs(MOCK_CLUBS);
          setDataSource('Mock data');
        }
      }
      if (!cancelled) {
        setLoading(false);
      }
    }
    load();
    return function () {
      cancelled = true;
    };
  }, []);

  function resetToClubs() {
    setSelectedClub(null);
    setSelectedSubsection(null);
    setSelectedProduct(null);
    setSelectedVariant(null);
    setPrimaryFieldValue('');
    setExtraField1Value('');
    setExtraField2Value('');
    setCurrentProducts([]);
    setCurrentProductsCollectionId(null);
    setProductListLoading(false);
    setScreen('clubs');
  }

  async function handleClubPress(club) {
    setSelectedClub(club);
    setSelectedSubsection(null);
    setSelectedProduct(null);
    setSelectedVariant(null);
    if (club.type === 'subsections') {
      setScreen('subsections');
      return;
    }
    if (dataSource === 'Mock data') {
      setProductListLoading(false);
      setCurrentProducts(club.products || []);
      setCurrentProductsCollectionId(club.collectionId ? club.collectionId : club.name);
      setScreen('products');
      return;
    }
    setScreen('products');
    await loadProductsForCollection(club.collectionId);
  }

  async function handleSubsectionPress(subsection) {
    setSelectedSubsection(subsection);
    setSelectedProduct(null);
    setSelectedVariant(null);
    if (dataSource === 'Mock data') {
      setProductListLoading(false);
      setCurrentProducts(subsection.products || []);
      setCurrentProductsCollectionId(subsection.collectionId ? subsection.collectionId : subsection.label);
      setScreen('products');
      return;
    }
    setScreen('products');
    await loadProductsForCollection(subsection.collectionId);
  }

  function handleProductPress(product) {
    setSelectedProduct(product);
    setSelectedVariant(null);
    setScreen('productDetail');
  }

  function handleVariantSelect(variant) {
    setSelectedVariant(variant);
  }

  function toast(msg) {
    if (typeof shopify !== 'undefined' && shopify.toast && shopify.toast.show) {
      shopify.toast.show(msg);
    }
  }

  function cartLineCount() {
    if (typeof shopify === 'undefined') {
      return 0;
    }
    if (!shopify.cart || !shopify.cart.current || !shopify.cart.current.value) {
      return 0;
    }
    var lines = shopify.cart.current.value.lineItems;
    if (!lines || !Array.isArray(lines)) {
      return 0;
    }
    return lines.length;
  }

  async function fetchPersonalisationFeeVariant(feeAmount) {
    var targetProductHandle = 'personalisation-fee';
    var targetProductTitle = 'Personalisation fee (system)';
    setLastFeeProductHandleTarget(targetProductHandle);
    setLastFeeProductTitleTarget(targetProductTitle);
    setLastFeeLookupQuery('');
    setLastFeeCandidateCount(0);
    setLastFeeVariantScanCount(0);
    setLastFeeMatchMethod('none');
    setLastFeeExactTitleValidationPassed(false);
    setLastFeeProductFound(false);
    setLastFeeProductId('');
    setLastFeeVariantTitleMatched('');
    setLastFeeVariantAvailableForSale(null);
    if (feeAmount === null || feeAmount === undefined) {
      return null;
    }
    var numericFee = parseFloat(feeAmount);
    if (isNaN(numericFee) || numericFee <= 0) {
      return null;
    }
    if (typeof fetch === 'undefined') {
      throw new Error('Admin API fetch unavailable for fee lookup');
    }

    setLastFeeLookupQuery('productByHandle(handle: "' + targetProductHandle + '")');
    var gql = 'query FeeVariants($handle: String!) { productByHandle(handle: $handle) { id title variants(first: 100) { edges { node { id title availableForSale selectedOptions { name value } } } } } }';
    var response = await fetch('shopify:admin/api/graphql.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: gql, variables: { handle: targetProductHandle } }),
    });

    if (!response || !response.ok) {
      var statusCode = response && response.status ? response.status : 'unknown';
      var statusText = response && response.statusText ? response.statusText : 'unknown';
      var bodyText = '';
      try {
        bodyText = await response.text();
      } catch (e) {
        bodyText = '';
      }
      throw new Error('Fee variant fetch HTTP error: ' + statusCode + ' ' + statusText + (bodyText ? ' ' + bodyText : ''));
    }

    var json;
    try {
      json = await response.json();
    } catch (err) {
      throw new Error('Fee variant JSON parse error: ' + (err && err.message ? err.message : String(err)));
    }
    if (json && json.errors && Array.isArray(json.errors) && json.errors.length > 0) {
      throw new Error('Fee variant GraphQL error: ' + (json.errors[0] && json.errors[0].message ? json.errors[0].message : 'unknown error'));
    }
    if (!json || !json.data) {
      return null;
    }

    var feeProductNode = json.data.productByHandle ? json.data.productByHandle : null;
    setLastFeeCandidateCount(feeProductNode ? 1 : 0);

    if (!feeProductNode) {
      setLastFeeExactTitleValidationPassed(false);
      return null;
    }

    if (toStr(feeProductNode.title) !== targetProductTitle) {
      setLastFeeExactTitleValidationPassed(false);
      setLastFeeProductFound(false);
      setLastFeeProductId(feeProductNode.id ? String(feeProductNode.id) : '');
      setLastFeeErrorMessage('fee product title mismatch for handle ' + targetProductHandle);
      return null;
    }

    setLastFeeExactTitleValidationPassed(true);
    setLastFeeProductFound(true);
    setLastFeeProductId(feeProductNode.id ? String(feeProductNode.id) : '');

    var variantEdges = feeProductNode.variants && feeProductNode.variants.edges ? feeProductNode.variants.edges : [];
    setLastFeeVariantScanCount(variantEdges.length);
    var feeFixed = numericFee.toFixed(2);
    var foundByExactTitle = null;
    var foundByExactOption = null;
    var foundByNumericText = null;

    for (var v = 0; v < variantEdges.length; v += 1) {
      var variantNode = variantEdges[v] && variantEdges[v].node ? variantEdges[v].node : null;
      if (!variantNode) {
        continue;
      }
      var variantTitle = toStr(variantNode.title);
      if (variantTitle === feeFixed) {
        foundByExactTitle = { id: variantNode.id, matchedText: variantTitle, availableForSale: variantNode.availableForSale === true };
        break;
      }
      if (variantNode.selectedOptions && Array.isArray(variantNode.selectedOptions)) {
        for (var o = 0; o < variantNode.selectedOptions.length; o += 1) {
          var exactOptionValue = toStr(variantNode.selectedOptions[o] ? variantNode.selectedOptions[o].value : '');
          if (exactOptionValue === feeFixed) {
            foundByExactOption = { id: variantNode.id, matchedText: exactOptionValue, availableForSale: variantNode.availableForSale === true };
            break;
          }
        }
      }
      if (foundByExactOption) {
        break;
      }

      var candidateTexts = [];
      if (variantTitle !== '') {
        candidateTexts.push(variantTitle);
      }
      if (variantNode.selectedOptions && Array.isArray(variantNode.selectedOptions)) {
        for (var n = 0; n < variantNode.selectedOptions.length; n += 1) {
          var optionValue = toStr(variantNode.selectedOptions[n] ? variantNode.selectedOptions[n].value : '');
          if (optionValue !== '') {
            candidateTexts.push(optionValue);
          }
        }
      }

      for (var c = 0; c < candidateTexts.length; c += 1) {
        var candidate = toStr(candidateTexts[c]);
        var candidateAmount = parseFeeAmount(candidate);
        if (candidateAmount !== null && Math.abs(candidateAmount - numericFee) < 0.0001) {
          foundByNumericText = { id: variantNode.id, matchedText: candidate, availableForSale: variantNode.availableForSale === true };
          break;
        }
      }
      if (foundByNumericText) {
        break;
      }
    }

    if (foundByExactTitle && foundByExactTitle.id) {
      setLastFeeMatchMethod('exact_title');
      setLastFeeVariantTitleMatched(foundByExactTitle.matchedText ? String(foundByExactTitle.matchedText) : '');
      setLastFeeVariantAvailableForSale(foundByExactTitle.availableForSale ? true : false);
      if (!foundByExactTitle.availableForSale) {
        setLastFeeErrorMessage('matched fee variant is not available for sale');
        throw new Error('matched fee variant is not available for sale');
      }
      return foundByExactTitle.id;
    }

    if (foundByExactOption && foundByExactOption.id) {
      setLastFeeMatchMethod('exact_option');
      setLastFeeVariantTitleMatched(foundByExactOption.matchedText ? String(foundByExactOption.matchedText) : '');
      setLastFeeVariantAvailableForSale(foundByExactOption.availableForSale ? true : false);
      if (!foundByExactOption.availableForSale) {
        setLastFeeErrorMessage('matched fee variant is not available for sale');
        throw new Error('matched fee variant is not available for sale');
      }
      return foundByExactOption.id;
    }

    if (foundByNumericText && foundByNumericText.id) {
      setLastFeeMatchMethod('numeric_text');
      setLastFeeVariantTitleMatched(foundByNumericText.matchedText ? String(foundByNumericText.matchedText) : '');
      setLastFeeVariantAvailableForSale(foundByNumericText.availableForSale ? true : false);
      if (!foundByNumericText.availableForSale) {
        setLastFeeErrorMessage('matched fee variant is not available for sale');
        throw new Error('matched fee variant is not available for sale');
      }
      return foundByNumericText.id;
    }

    setLastFeeMatchMethod('none');
    return null;
  }


  async function addSelectedProductToCart(product, variant, lineItemProperties, feeAmount) {
    setLastCartActionStatus('idle');
    setLastCartErrorMessage('');
    setLastCartLineItemUuid('');
    setLastPropertiesAttachStatus('idle');
    setLastLineItemProperties(lineItemProperties || {});
    setLastFeeAmount(null);
    setLastFeeRequired(false);
    setLastFeeVariantId('');
    setLastFeeVariantStatus('idle');
    setLastFeeErrorMessage('');
    setLastFeeLineItemUuid('');
    setLastFeePropertiesAttachStatus('idle');
    setLastFeeProductHandleTarget('personalisation-fee');
    setLastFeeProductTitleTarget('Personalisation fee (system)');
    setLastFeeLookupQuery('');
    setLastFeeCandidateCount(0);
    setLastFeeVariantScanCount(0);
    setLastFeeMatchMethod('none');
    setLastFeeExactTitleValidationPassed(false);
    setLastFeeProductFound(false);
    setLastFeeProductId('');
    setLastFeeVariantTitleMatched('');
    setLastFeeLineAddAttempted(false);
    setLastFeeLineAddStatus('idle');
    setLastFeeVariantAvailableForSale(null);

    if (!product || !variant) {
      toast('Select a size first');
      setLastCartActionStatus('failed');
      setLastCartErrorMessage('No product or variant selected');
      return false;
    }
    if (isMockVariant(variant.id)) {
      toast('Mock products cannot be added to the POS cart.');
      setLastCartActionStatus('failed');
      setLastCartErrorMessage('Mock product cannot be added');
      return false;
    }
    var normalized = normalizeVariantId(variant.id);
    setLastNormalizedVariantId(normalized.valid ? String(normalized.value) : '');
    if (!normalized.valid || normalized.value === null) {
      toast('Variant ID is invalid for POS cart add.');
      setLastCartActionStatus('failed');
      setLastCartErrorMessage('Invalid normalized variant id');
      return false;
    }
    var cartApiAvailable = typeof shopify !== 'undefined' && shopify.cart && shopify.cart.addLineItem;
    if (!cartApiAvailable) {
      toast('Cart API unavailable.');
      setLastCartActionStatus('failed');
      setLastCartErrorMessage('Cart API unavailable');
      return false;
    }

    var beforeCount = cartLineCount();
    setLastCartBeforeCount(beforeCount);
    setLastCartAfterCount(beforeCount);

    var feeRequired = false;
    var numericFee = null;
    if (feeAmount !== null && feeAmount !== undefined) {
      var parsedFee = parseFloat(feeAmount);
      if (!isNaN(parsedFee) && parsedFee > 0) {
        feeRequired = true;
        numericFee = parsedFee;
      }
    }
    setLastFeeRequired(feeRequired);
    setLastFeeAmount(feeRequired ? numericFee : null);

    var expectedIncrease = 1 + (feeRequired ? 1 : 0);

    try {
      var uuid = await shopify.cart.addLineItem(normalized.value, 1);
      setLastCartLineItemUuid(uuid ? String(uuid) : '');
      if (!uuid) {
        toast('Could not add to cart.');
        setLastCartActionStatus('failed');
        setLastCartErrorMessage('Cart API returned no line item uuid');
        return false;
      }
      if (lineItemProperties && typeof lineItemProperties === 'object' && Object.keys(lineItemProperties).length > 0) {
        if (shopify.cart && shopify.cart.addLineItemProperties) {
          try {
            await shopify.cart.addLineItemProperties(uuid, lineItemProperties);
            setLastPropertiesAttachStatus('success');
          } catch (errProps) {
            setLastPropertiesAttachStatus('failed');
            setLastCartActionStatus('failed');
            setLastCartErrorMessage(errProps && errProps.message ? errProps.message : 'Failed to attach properties');
            return false;
          }
        } else {
          setLastPropertiesAttachStatus('failed');
          setLastCartActionStatus('failed');
          setLastCartErrorMessage('Cart API missing addLineItemProperties');
          return false;
        }
      } else {
        setLastPropertiesAttachStatus('skipped');
      }

      if (feeRequired) {
        var feeVariantId = null;
        try {
          feeVariantId = await fetchPersonalisationFeeVariant(numericFee);
          setLastFeeVariantId(feeVariantId ? String(feeVariantId) : '');
          setLastFeeVariantStatus(feeVariantId ? 'found' : 'not_found');
        } catch (feeErr) {
          var feeLookupError = feeErr && feeErr.message ? feeErr.message : 'unknown lookup error';
          setLastFeeVariantStatus(feeLookupError === 'matched fee variant is not available for sale' ? 'not_saleable' : 'failed');
          setLastFeeErrorMessage(feeLookupError === 'matched fee variant is not available for sale' ? feeLookupError : 'fee lookup failed: ' + feeLookupError);
          setLastCartActionStatus('failed');
          toast('Personalisation fee could not be added.');
          return false;
        }
        if (!feeVariantId) {
          setLastFeeErrorMessage('fee variant not found');
          setLastFeeVariantStatus('not_found');
          setLastCartActionStatus('failed');
          toast('Personalisation fee variant not found.');
          return false;
        }

        var feeNormalized = normalizeVariantId(feeVariantId);
        if (!feeNormalized.valid || feeNormalized.value === null) {
          setLastFeeVariantStatus('failed');
          setLastFeeErrorMessage('fee variant id invalid');
          setLastCartActionStatus('failed');
          toast('Fee variant id invalid.');
          return false;
        }

        var feeUuid = null;
        setLastFeeLineAddAttempted(true);
        setLastFeeLineAddStatus('attempting');
        try {
          feeUuid = await shopify.cart.addLineItem(feeNormalized.value, 1);
          setLastFeeLineItemUuid(feeUuid ? String(feeUuid) : '');
          if (!feeUuid) {
            setLastFeeVariantStatus('failed');
            setLastFeeErrorMessage('fee addLineItem failed: cart add returned no uuid');
            setLastFeeLineAddStatus('failed');
            setLastCartActionStatus('failed');
            toast('Fee line could not be added.');
            return false;
          }
          setLastFeeLineAddStatus('success');
        } catch (feeAddErr) {
          setLastFeeVariantStatus('failed');
          setLastFeeErrorMessage('fee addLineItem failed: ' + (feeAddErr && feeAddErr.message ? feeAddErr.message : 'unknown add error'));
          setLastFeeLineAddStatus('failed');
          setLastCartActionStatus('failed');
          toast('Fee line could not be added.');
          return false;
        }

        var feeProps = {
          'Fee For Product': product.title,
          'Linked Product Variant Id': String(normalized.value),
          'Personalisation Fee': '£' + numericFee.toFixed(2),
        };
        if (shopify.cart && shopify.cart.addLineItemProperties) {
          try {
            await shopify.cart.addLineItemProperties(feeUuid, feeProps);
            setLastFeePropertiesAttachStatus('success');
            setLastFeeVariantStatus('success');
          } catch (feePropErr) {
            setLastFeePropertiesAttachStatus('failed');
            setLastFeeVariantStatus('failed');
            setLastFeeErrorMessage('fee addLineItemProperties failed: ' + (feePropErr && feePropErr.message ? feePropErr.message : 'unknown properties error'));
            setLastCartActionStatus('failed');
            toast('Fee line added without properties.');
            return false;
          }
        } else {
          setLastFeePropertiesAttachStatus('failed');
          setLastFeeVariantStatus('failed');
          setLastFeeErrorMessage('fee addLineItemProperties failed: Cart API missing addLineItemProperties for fee');
          setLastCartActionStatus('failed');
          toast('Fee properties could not be attached.');
          return false;
        }

        if (shopify.cart && shopify.cart.addLineItemProperties) {
          try {
            await shopify.cart.addLineItemProperties(uuid, {
              'Linked Fee Variant Id': String(feeNormalized.value),
            });
          } catch (linkErr) {
            setLastCartActionStatus('failed');
            setLastFeeErrorMessage('fee link-back-to-main failed: ' + (linkErr && linkErr.message ? linkErr.message : 'unknown link error'));
            toast('Fee added but linking failed.');
            return false;
          }
        }
      } else {
        setLastFeeVariantStatus('skipped');
        setLastFeePropertiesAttachStatus('skipped');
      }

      var afterCount = cartLineCount();
      setLastCartAfterCount(afterCount);
      if (afterCount >= beforeCount + expectedIncrease) {
        toast('Added to cart. Cart lines: ' + afterCount);
        setLastCartActionStatus('success');
        setLastCartErrorMessage('');
        return true;
      }
      toast('Cart API returned, but cart did not update');
      setLastCartActionStatus('failed');
      setLastCartErrorMessage('No cart count change');
      return false;
    } catch (err) {
      toast('Could not add to cart.');
      setLastCartActionStatus('failed');
      setLastCartErrorMessage(err && err.message ? err.message : String(err));
      return false;
    }
  }

  function handleBack() {
    if (screen === 'productDetail') {
      setSelectedProduct(null);
      setSelectedVariant(null);
      setPrimaryFieldValue('');
      setExtraField1Value('');
      setExtraField2Value('');
      setScreen('products');
      return;
    }
    if (screen === 'products') {
      setSelectedProduct(null);
      setSelectedVariant(null);
      if (selectedClub && selectedClub.type === 'subsections') {
        setScreen('subsections');
        return;
      }
      resetToClubs();
      return;
    }
    if (screen === 'subsections') {
      resetToClubs();
      return;
    }
    if (screen === 'personalisation') {
      setScreen('productDetail');
      return;
    }
    resetToClubs();
  }

  function renderLiveDebugPanel() {
    return (
      <s-section heading="Live data status">
        <s-stack direction="block" gap="micro">
          <s-text>Live fetch started: {liveFetchStarted ? 'yes' : 'no'}</s-text>
          <s-text>Live fetch succeeded: {liveFetchSucceeded ? 'yes' : 'no'}</s-text>
          <s-text>Live fetch failed: {liveFetchFailed ? 'yes' : 'no'}</s-text>
          <s-text>Live source stage: {liveSourceStage}</s-text>
          <s-text>Pages fetched: {pagesFetched}</s-text>
          <s-text>Raw collections fetched: {rawCollectionsCount}</s-text>
          <s-text>Collections returned: {liveCollectionsCount}</s-text>
          <s-text>Usable clubs built: {liveUsableClubCount}</s-text>
          <s-text>Direct clubs: {directClubsCount}</s-text>
          <s-text>Subsection clubs: {subsectionClubsCount}</s-text>
          <s-text>Orphan child collections ignored: {orphanChildIgnored}</s-text>
          <s-text>Data source in use: {dataSource}</s-text>
          <s-text>Error: {liveFetchErrorMessage === '' ? 'none' : liveFetchErrorMessage}</s-text>
        </s-stack>
      </s-section>
    );
  }
  function renderDebugHeader() {
    return (
      <s-section heading="Debug">
        <s-stack direction="block" gap="micro">
          <s-text appearance="critical">DEBUG VERSION: PRODUCT DETAIL V1</s-text>
          <s-text>Screen: {screen}</s-text>
          <s-text>{dataSource}</s-text>
          {loading ? <s-text>Loading…</s-text> : null}
          {errorMessage ? <s-text appearance="critical">{errorMessage}</s-text> : null}
        </s-stack>
        {renderLiveDebugPanel()}
      </s-section>
    );
  }

  function renderBundleDebug(product) {
    if (!product || !product.bundleMeta) {
      return null;
    }
    var meta = product.bundleMeta;
    var names = [];
    for (var i = 0; i < meta.componentProducts.length; i += 1) {
      names.push(meta.componentProducts[i].title);
    }
    return (
      <s-section heading="Bundle debug">
        <s-stack direction="block" gap="micro">
          <s-text>isBundle: {meta.isBundle ? 'true' : 'false'}</s-text>
          <s-text>component handles: {meta.componentHandles.length}</s-text>
          <s-text>component products: {meta.componentProducts.length}</s-text>
          {names.length > 0 ? <s-text>components: {names.join(', ')}</s-text> : null}
        </s-stack>
      </s-section>
    );
  }

  function renderPersonalisationDebug(product) {
    if (!product || !product.personalisationMeta) {
      return null;
    }
    var meta = product.personalisationMeta;
    var parsedMax = parseMaxChars(meta.personalisationMaxCharsRaw);
    var feeDisplay = parseFeeDisplay(meta.personalisationFeeRaw);
    var summary = hasAnyPersonalisation(meta) ? 'yes' : 'no';
    return (
      <s-section heading="Personalisation debug">
        <s-stack direction="block" gap="micro">
          <s-text>Has personalisation: {summary}</s-text>
          <s-text>Parsed max chars: {parsedMax === null ? 'none' : parsedMax}</s-text>
          <s-text>Parsed fee: {feeDisplay === '' ? 'none' : feeDisplay}</s-text>
          <s-text>enablePersonalisation: {meta.enablePersonalisation ? 'true' : 'false'}</s-text>
          <s-text>personalisationLabel: {meta.personalisationLabel}</s-text>
          <s-text>personalisationFeeRaw: {meta.personalisationFeeRaw}</s-text>
          <s-text>personalisationMaxCharsRaw: {meta.personalisationMaxCharsRaw}</s-text>
          <s-text>personalisationRequired: {meta.personalisationRequired ? 'true' : 'false'}</s-text>
          <s-text>extraField1Enabled: {meta.extraField1Enabled ? 'true' : 'false'}</s-text>
          <s-text>extraField1Label: {meta.extraField1Label}</s-text>
          <s-text>extraField1Required: {meta.extraField1Required ? 'true' : 'false'}</s-text>
          <s-text>extraField2Enabled: {meta.extraField2Enabled ? 'true' : 'false'}</s-text>
          <s-text>extraField2Label: {meta.extraField2Label}</s-text>
          <s-text>extraField2Required: {meta.extraField2Required ? 'true' : 'false'}</s-text>
          <s-text>enableFileUpload: {meta.enableFileUpload ? 'true' : 'false'}</s-text>
          <s-text>fileUploadLabel: {meta.fileUploadLabel}</s-text>
          <s-text>fileUploadHelpText: {meta.fileUploadHelpText}</s-text>
          <s-text>fileUploadRequired: {meta.fileUploadRequired ? 'true' : 'false'}</s-text>
        </s-stack>
      </s-section>
    );
  }

  function renderCartDebug() {
    var variantId = selectedVariant ? selectedVariant.id : '';
    return (
      <s-section heading="Cart debug">
        <s-stack direction="block" gap="micro">
          <s-text>Selected product: {selectedProduct ? selectedProduct.title : ''}</s-text>
          <s-text>Selected variant: {selectedVariant ? selectedVariant.title : ''}</s-text>
          <s-text>Variant id: {variantId}</s-text>
          <s-text>Variant id type: {classifyVariantId(variantId)}</s-text>
          <s-text>Normalized variant id: {lastNormalizedVariantId}</s-text>
          <s-text>Product is mock: {selectedVariant ? (isMockVariant(selectedVariant.id) ? 'yes' : 'no') : ''}</s-text>
          <s-text>Cart API available: {typeof shopify !== 'undefined' && shopify.cart && shopify.cart.addLineItem ? 'yes' : 'no'}</s-text>
          <s-text>Cart line count: {cartLineCount()}</s-text>
          <s-text>Last cart before: {lastCartBeforeCount}</s-text>
          <s-text>Last cart after: {lastCartAfterCount}</s-text>
          <s-text>Last line item uuid: {lastCartLineItemUuid}</s-text>
          <s-text>Properties attach: {lastPropertiesAttachStatus}</s-text>
          <s-text>Fee amount: {lastFeeAmount === null ? 'none' : '£' + Number(lastFeeAmount).toFixed(2)}</s-text>
          <s-text>Entered personalisation: {lastEnteredPersonalisation ? 'yes' : 'no'}</s-text>
          <s-text>Fee required: {lastFeeRequired ? 'yes' : 'no'}</s-text>
          <s-text>Fee product handle targeted: {lastFeeProductHandleTarget}</s-text>
          <s-text>Fee product title targeted: {lastFeeProductTitleTarget}</s-text>
          <s-text>Fee lookup query: {lastFeeLookupQuery === '' ? 'none' : lastFeeLookupQuery}</s-text>
          <s-text>Fee candidate count: {lastFeeCandidateCount}</s-text>
          <s-text>Fee variant scan count: {lastFeeVariantScanCount}</s-text>
          <s-text>Fee exact title validation: {lastFeeExactTitleValidationPassed ? 'passed' : 'failed'}</s-text>
          <s-text>Fee match method: {lastFeeMatchMethod}</s-text>
          <s-text>Fee product found: {lastFeeProductFound ? 'yes' : 'no'}</s-text>
          <s-text>Fee product id: {lastFeeProductId === '' ? 'none' : lastFeeProductId}</s-text>
          <s-text>Fee variant status: {lastFeeVariantStatus}</s-text>
          <s-text>Fee variant id: {lastFeeVariantId}</s-text>
          <s-text>Fee variant title matched: {lastFeeVariantTitleMatched === '' ? 'none' : lastFeeVariantTitleMatched}</s-text>
          <s-text>Fee variant available for sale: {lastFeeVariantAvailableForSale === null ? 'unknown' : (lastFeeVariantAvailableForSale ? 'yes' : 'no')}</s-text>
          <s-text>Fee line add attempted: {lastFeeLineAddAttempted ? 'yes' : 'no'}</s-text>
          <s-text>Fee line add status: {lastFeeLineAddStatus}</s-text>
          <s-text>Fee line uuid: {lastFeeLineItemUuid === '' ? 'none' : lastFeeLineItemUuid}</s-text>
          <s-text>Fee properties attach: {lastFeePropertiesAttachStatus}</s-text>
          <s-text>Last cart status: {lastCartActionStatus}</s-text>
          <s-text>Last cart error: {lastCartErrorMessage === '' ? 'none' : lastCartErrorMessage}</s-text>
          <s-text>Last fee error: {lastFeeErrorMessage === '' ? 'none' : lastFeeErrorMessage}</s-text>
          <s-text>
            Line item properties preview:{' '}
            {lastLineItemProperties && Object.keys(lastLineItemProperties).length > 0
              ? Object.keys(lastLineItemProperties)
                  .map(function (k) {
                    return k + ':' + lastLineItemProperties[k];
                  })
                  .join(', ')
              : 'none'}
          </s-text>
        </s-stack>
      </s-section>
    );
  }

  function renderProductDebug() {
    return (
      <s-section heading="Product debug">
        <s-stack direction="block" gap="micro">
          <s-text>Selected club: {selectedClub ? selectedClub.name : ''}</s-text>
          <s-text>Selected subsection: {selectedSubsection ? selectedSubsection.label : ''}</s-text>
          <s-text>Current collection id: {currentProductsCollectionId ? currentProductsCollectionId : ''}</s-text>
          <s-text>Product list loading: {productListLoading ? 'yes' : 'no'}</s-text>
          <s-text>Current products count: {currentProducts ? currentProducts.length : 0}</s-text>
        </s-stack>
      </s-section>
    );
  }

  function renderClubsScreen() {
    return (
      <s-page heading="Macron POS">
        <ScreenScroll>
          {renderDebugHeader()}
          <s-section heading="Clubs">
            <s-stack direction="block" gap="base">
              <s-text appearance="subdued">Data source: {dataSource === 'Live data' ? 'Live' : 'Mock'}</s-text>
              <s-text>Select a club to begin.</s-text>
              {clubs.map(function (club) {
                return (
                  <s-button key={club.name} variant="secondary" onClick={function () { handleClubPress(club); }}>
                    {club.name}
                  </s-button>
                );
              })}
            </s-stack>
          </s-section>
        </ScreenScroll>
      </s-page>
    );
  }

  function renderSubsectionsScreen() {
    if (!selectedClub || !selectedClub.subsections) {
      return renderClubsScreen();
    }
    return (
      <s-page heading="Macron POS">
        <ScreenScroll>
          {renderDebugHeader()}
          <s-section heading={selectedClub.name + ' - Subsections'}>
            <s-stack direction="block" gap="base">
              <s-text>Select a subsection.</s-text>
              {selectedClub.subsections.map(function (sub) {
                return (
                  <s-button key={sub.label} variant="secondary" onClick={function () { handleSubsectionPress(sub); }}>
                    {sub.label}
                  </s-button>
                );
              })}
              <s-button variant="primary" onClick={handleBack}>Back</s-button>
            </s-stack>
          </s-section>
        </ScreenScroll>
      </s-page>
    );
  }

  function productsForCurrentSelection() {
    return currentProducts || [];
  }

  function renderProductsScreen() {
    var products = productsForCurrentSelection();
    var heading = selectedClub ? selectedClub.name : 'Products';
    if (selectedSubsection) {
      heading = selectedClub ? selectedClub.name + ' - ' + selectedSubsection.label : selectedSubsection.label;
    }
    return (
      <s-page heading="Macron POS">
        <ScreenScroll>
          {renderDebugHeader()}
          <s-section heading={heading}>
            <s-stack direction="block" gap="base">
              {productListLoading ? <s-text>Loading products…</s-text> : null}
              {!productListLoading && products.length === 0 ? <s-text>No products found.</s-text> : null}
              {products.map(function (product) {
                return (
                  <s-button key={product.id} variant="secondary" onClick={function () { handleProductPress(product); }}>
                    View details: {product.title}
                  </s-button>
                );
              })}
              <s-button variant="primary" onClick={handleBack}>Back</s-button>
            </s-stack>
          </s-section>
          {renderProductDebug()}
        </ScreenScroll>
      </s-page>
    );
  }

  function renderBundleNote(product) {
    if (!product || !product.bundleMeta || !product.bundleMeta.isBundle) {
      return null;
    }
    return (
      <s-section heading="Bundle">
        <s-stack direction="block" gap="micro">
          <s-text appearance="subdued">Bundle product detected.</s-text>
          <s-button variant="secondary" onClick={function () { toast('Bundle builder placeholder – coming next.'); }}>
            Continue to bundle builder
          </s-button>
        </s-stack>
      </s-section>
    );
  }

  function renderVariants(product) {
    if (!product || !product.variants) {
      return null;
    }
    return (
      <s-stack direction="inline" wrap="true" gap="small">
        {product.variants.map(function (variant) {
          var active = selectedVariant && selectedVariant.id === variant.id;
          return (
            <s-button key={variant.id} variant={active ? 'primary' : 'secondary'} onClick={function () { handleVariantSelect(variant); }}>
              {variant.title}
            </s-button>
          );
        })}
      </s-stack>
    );
  }

  function renderProductDetailScreen() {
    if (!selectedProduct) {
      return renderProductsScreen();
    }
    var meta = selectedProduct.personalisationMeta || {};
    var hasPersonalisation = hasAnyPersonalisation(meta);
    var showAddToCart = !hasPersonalisation;
    return (
      <s-page heading="Macron POS">
        <ScreenScroll>
          {renderDebugHeader()}
          <s-section heading="PRODUCT DETAIL SCREEN">
            <s-stack direction="block" gap="base">
              <s-text>Product: {selectedProduct.title}</s-text>
              {!selectedProduct.bundleMeta || !selectedProduct.bundleMeta.isBundle ? (
                <s-text appearance="subdued">Testing live cart add for standard products</s-text>
              ) : null}
              {renderVariants(selectedProduct)}
              {renderBundleNote(selectedProduct)}
              {showAddToCart ? (
                <s-button
                  variant="primary"
                  onClick={function () {
                    setLastEnteredPersonalisation(false);
                    addSelectedProductToCart(selectedProduct, selectedVariant, {}, null);
                  }}
                >
                  Add to cart
                </s-button>
              ) : (
                <s-button variant="primary" onClick={function () { setScreen('personalisation'); }}>
                  Continue to personalisation
                </s-button>
              )}
              <s-button variant="secondary" onClick={handleBack}>Back</s-button>
            </s-stack>
          </s-section>
          {renderPersonalisationDebug(selectedProduct)}
          {renderBundleDebug(selectedProduct)}
          {renderCartDebug()}
          {renderProductDebug()}
        </ScreenScroll>
      </s-page>
    );
  }

  function fieldLabel(label, required, feeText) {
    return (
      <s-stack direction="inline" gap="micro" wrap="true">
        <s-text>{label}</s-text>
        {required ? <s-text appearance="critical">*</s-text> : null}
        {feeText ? <s-text appearance="subdued">{feeText}</s-text> : null}
      </s-stack>
    );
  }

  function renderPersonalisationScreen() {
    if (!selectedProduct) {
      return renderProductsScreen();
    }
    var meta = selectedProduct.personalisationMeta || {};
    var feeDisplay = parseFeeDisplay(meta.personalisationFeeRaw);
    var maxChars = parseMaxChars(meta.personalisationMaxCharsRaw);

    function validate() {
      if (meta.enablePersonalisation && meta.personalisationRequired && toStr(primaryFieldValue) === '') {
        toast(meta.personalisationLabel || 'Personalisation is required');
        return false;
      }
      if (meta.extraField1Enabled && meta.extraField1Required && toStr(extraField1Value) === '') {
        toast(meta.extraField1Label || 'Field 1 is required');
        return false;
      }
      if (meta.extraField2Enabled && meta.extraField2Required && toStr(extraField2Value) === '') {
        toast(meta.extraField2Label || 'Field 2 is required');
        return false;
      }
      if (meta.enableFileUpload && meta.fileUploadRequired) {
        toast('This item requires file upload, which is not available in POS V1 yet');
        return false;
      }
      return true;
    }

    function submitPersonalisation() {
      if (!validate()) {
        return;
      }
      var enteredPersonalisation = hasEnteredPersonalisationValues(meta, primaryFieldValue, extraField1Value, extraField2Value);
      setLastEnteredPersonalisation(enteredPersonalisation);
      var parsedFeeAmount = parseFeeAmount(meta.personalisationFeeRaw);
      var feeAmount = null;
      if (enteredPersonalisation && parsedFeeAmount !== null && parsedFeeAmount > 0) {
        feeAmount = parsedFeeAmount;
      }
      var props = {};
      if (meta.enablePersonalisation && toStr(primaryFieldValue) !== '') {
        props[meta.personalisationLabel || 'Personalisation'] = toStr(primaryFieldValue);
      }
      if (meta.extraField1Enabled && toStr(extraField1Value) !== '') {
        props[meta.extraField1Label || 'Additional information'] = toStr(extraField1Value);
      }
      if (meta.extraField2Enabled && toStr(extraField2Value) !== '') {
        props[meta.extraField2Label || 'Additional information 2'] = toStr(extraField2Value);
      }
      if (enteredPersonalisation && feeAmount !== null && feeAmount > 0) {
        props['Personalisation Fee'] = '£' + feeAmount.toFixed(2);
      }
      if (Object.keys(props).length > 0) {
        var summaryParts = [];
        var keys = Object.keys(props);
        for (var i = 0; i < keys.length; i += 1) {
          summaryParts.push(keys[i] + ': ' + props[keys[i]]);
        }
        props['Personalisation Summary'] = summaryParts.join(' | ');
      }
      addSelectedProductToCart(selectedProduct, selectedVariant, props, feeAmount).then(function (ok) {
        if (ok) {
          setPrimaryFieldValue('');
          setExtraField1Value('');
          setExtraField2Value('');
          setScreen('products');
        }
      });
    }

    return (
      <s-page heading="Macron POS">
        <ScreenScroll>
          {renderDebugHeader()}
          <s-section heading="Personalisation">
            <s-stack direction="block" gap="base">
              <s-text>{selectedProduct.title}</s-text>
              <s-text appearance="subdued">Variant: {selectedVariant ? selectedVariant.title : ''}</s-text>

              {meta.enablePersonalisation ? (
                <s-stack direction="block" gap="micro">
                  {fieldLabel(meta.personalisationLabel || 'Personalisation', meta.personalisationRequired, feeDisplay)}
                  <s-text-field
                    value={primaryFieldValue}
                    maxLength={maxChars === null ? undefined : maxChars}
                    onInput={function (event) { setPrimaryFieldValue(event.target.value); }}
                    placeholder="Enter text"
                  />
                </s-stack>
              ) : null}

              {meta.extraField1Enabled ? (
                <s-stack direction="block" gap="micro">
                  {fieldLabel(meta.extraField1Label || 'Additional information', meta.extraField1Required, '')}
                  <s-text-field
                    value={extraField1Value}
                    onInput={function (event) { setExtraField1Value(event.target.value); }}
                    placeholder="Enter text"
                  />
                </s-stack>
              ) : null}

              {meta.extraField2Enabled ? (
                <s-stack direction="block" gap="micro">
                  {fieldLabel(meta.extraField2Label || 'Additional information 2', meta.extraField2Required, '')}
                  <s-text-field
                    value={extraField2Value}
                    onInput={function (event) { setExtraField2Value(event.target.value); }}
                    placeholder="Enter text"
                  />
                </s-stack>
              ) : null}

              {meta.enableFileUpload ? (
                <s-stack direction="block" gap="micro">
                  {fieldLabel(meta.fileUploadLabel || 'Upload file', meta.fileUploadRequired, '')}
                  <s-text appearance="subdued">{meta.fileUploadHelpText || 'File upload not wired in POS V1 yet.'}</s-text>
                </s-stack>
              ) : null}

            <s-button variant="primary" onClick={submitPersonalisation}>
              Add to cart
            </s-button>
            <s-button variant="secondary" onClick={handleBack}>Back</s-button>
          </s-stack>
        </s-section>
        {renderPersonalisationDebug(selectedProduct)}
        {renderCartDebug()}
        {renderProductDebug()}
        </ScreenScroll>
      </s-page>
    );
  }


  if (screen === 'subsections') {
    return renderSubsectionsScreen();
  }
  if (screen === 'products') {
    return renderProductsScreen();
  }
  if (screen === 'productDetail') {
    return renderProductDetailScreen();
  }
  if (screen === 'personalisation') {
    return renderPersonalisationScreen();
  }
  return renderClubsScreen();
}


































