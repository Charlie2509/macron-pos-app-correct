
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

function mapCollections(data) {
  var clubs = [];
  var collectionsCount = 0;
  if (data && data.collections && data.collections.edges && Array.isArray(data.collections.edges)) {
    collectionsCount = data.collections.edges.length;
    var edges = data.collections.edges;
    for (var i = 0; i < edges.length; i += 1) {
      var edge = edges[i];
      if (!edge || !edge.node) {
        continue;
      }
      var node = edge.node;
      var products = mapProducts(node.products ? node.products.edges : []);
      clubs.push({
        name: node.title,
        type: 'products',
        subsections: [],
        products: products,
      });
    }
  }
  return {clubs: clubs, collectionsCount: collectionsCount};
}

async function fetchLiveClubs() {
  if (typeof shopify === 'undefined' || !shopify.graphql) {
    throw new Error('Shopify GraphQL unavailable');
  }
  var query = `#graphql
    {
      collections(first: 20) {
        edges {
          node {
            id
            title
            products(first: 50) {
              edges {
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
            }
          }
        }
      }
    }
  `;
  var result = await shopify.graphql(query);
  var mapped = mapCollections(result);
  var errors = [];
  if (result && result.errors && Array.isArray(result.errors)) {
    errors = result.errors;
  }
  return {clubs: mapped.clubs, collectionsCount: mapped.collectionsCount, errors: errors, raw: result};
}
// ---------------- UI ----------------
export default async function () {
  render(<Modal />, document.body);
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

  var liveSourceStageState = useState('idle');
  var liveSourceStage = liveSourceStageState[0];
  var setLiveSourceStage = liveSourceStageState[1];

  var errorState = useState('');
  var errorMessage = errorState[0];
  var setErrorMessage = errorState[1];

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

  useEffect(function () {
    var cancelled = false;
    async function load() {
      setLiveFetchStarted(true);
      setLiveSourceStage('starting fetch');
      setLoading(true);
      try {
        setLiveSourceStage('fetching');
        var liveResult = await fetchLiveClubs();
        if (cancelled) {
          return;
        }
        setLiveSourceStage('graphql returned');
        setLiveCollectionsCount(liveResult.collectionsCount || 0);
        if (!liveResult) {
          setLiveFetchFailed(true);
          setLiveFetchSucceeded(false);
          setLiveFetchErrorMessage('No GraphQL result');
          setLiveSourceStage('falling back to mock');
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
    setScreen('clubs');
  }

  function handleClubPress(club) {
    setSelectedClub(club);
    setSelectedSubsection(null);
    setSelectedProduct(null);
    setSelectedVariant(null);
    setScreen(club.type === 'subsections' ? 'subsections' : 'products');
  }

  function handleSubsectionPress(subsection) {
    setSelectedSubsection(subsection);
    setSelectedProduct(null);
    setSelectedVariant(null);
    setScreen('products');
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

  async function addVariantToCart(product, variant) {
    if (!product || !variant) {
      toast('Select a size first');
      return false;
    }
    if (isMockVariant(variant.id)) {
      toast('Mock products cannot be added to the POS cart.');
      return false;
    }
    var normalized = normalizeVariantId(variant.id);
    if (!normalized.valid || normalized.value === null) {
      toast('Variant ID is invalid for POS cart add.');
      return false;
    }
    if (typeof shopify === 'undefined' || !shopify.cart || !shopify.cart.addLineItem) {
      toast('Cart API unavailable.');
      return false;
    }
    try {
      var result = await shopify.cart.addLineItem({
        variantId: normalized.value,
        quantity: 1,
      });
      if (!result) {
        toast('Could not add to cart.');
        return false;
      }
      var count = cartLineCount();
      toast('Added to cart. Cart lines: ' + count);
      return true;
    } catch (err) {
      toast('Could not add to cart.');
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
          <s-text>Collections returned: {liveCollectionsCount}</s-text>
          <s-text>Usable clubs built: {liveUsableClubCount}</s-text>
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
          <s-text>Cart line count: {cartLineCount()}</s-text>
        </s-stack>
      </s-section>
    );
  }

  function renderClubsScreen() {
    return (
      <s-page heading="Macron POS">
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
      </s-page>
    );
  }

  function renderSubsectionsScreen() {
    if (!selectedClub || !selectedClub.subsections) {
      return renderClubsScreen();
    }
    return (
      <s-page heading="Macron POS">
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
      </s-page>
    );
  }

  function productsForCurrentSelection() {
    if (!selectedClub) {
      return [];
    }
    if (selectedClub.type === 'subsections' && selectedSubsection) {
      return selectedSubsection.products || [];
    }
    return selectedClub.products || [];
  }

  function renderProductsScreen() {
    var products = productsForCurrentSelection();
    return (
      <s-page heading="Macron POS">
        {renderDebugHeader()}
        <s-section heading={selectedClub ? selectedClub.name : 'Products'}>
          <s-stack direction="block" gap="base">
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
        {renderDebugHeader()}
        <s-section heading="PRODUCT DETAIL SCREEN">
          <s-stack direction="block" gap="base">
            <s-text>Product: {selectedProduct.title}</s-text>
            {renderVariants(selectedProduct)}
            {renderBundleNote(selectedProduct)}
            {showAddToCart ? (
              <s-button variant="primary" onClick={function () { addVariantToCart(selectedProduct, selectedVariant); }}>
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
      toast(
        'Personalisation saved: ' +
          toStr(primaryFieldValue) +
          ' ' +
          toStr(extraField1Value) +
          ' ' +
          toStr(extraField2Value)
      );
    }

    return (
      <s-page heading="Macron POS">
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
              Save personalisation (toast only)
            </s-button>
            <s-button variant="secondary" onClick={handleBack}>Back</s-button>
          </s-stack>
        </s-section>
        {renderPersonalisationDebug(selectedProduct)}
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
