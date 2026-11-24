import "@shopify/ui-extensions/preact";
import {NATIVE_HANDOVER_OWNER, isNativeHandoverBundle, isNativeHandoverProduct} from "./flow-pilot.js";
import {verifiedKitHandover} from "../../../flow/msh-handover/plan.mjs";
import {render} from 'preact';
import {CatalogueGrid, OptionButtons, RangeSearch, catalogueLabel, matchesSaleSearch} from './SaleControls';
import {useEffect, useRef, useState} from 'preact/hooks';
import {allVariantEdges, createRangeLoader, nextCatalogueCursor, readCatalogue} from './catalogue.js';
import {buildBundleComponents, prepareBundleComponents} from './bundle-components.js';
import {addHandoverToCart} from './cart-properties.js';
import {findFeeVariant} from './fee-variant.js';

const pendingCartAdds = new WeakSet();

function safeReadShopDomain() {
  try {
    if (typeof shopify === 'undefined' || !shopify) return '';
    if (shopify.session) {
      if (shopify.session.currentSession && shopify.session.currentSession.shopDomain) {
        return String(shopify.session.currentSession.shopDomain);
      }
      if (shopify.session.shopDomain) {
        return String(shopify.session.shopDomain);
      }
    }
    if (shopify.config && shopify.config.shop && shopify.config.shop.domain) {
      return String(shopify.config.shop.domain);
    }
    if (shopify.config && shopify.config.shopDomain) {
      return String(shopify.config.shopDomain);
    }
  } catch (err) {
    // ignore -- best-effort discovery
  }
  return '';
}

function toStr(value) {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value).trim();
}

function sanitizeLineItemProperties(rawProperties) {
  var sanitized = {};
  if (!rawProperties || typeof rawProperties !== 'object' || Array.isArray(rawProperties)) {
    return sanitized;
  }
  var keys = Object.keys(rawProperties);
  for (var i = 0; i < keys.length; i += 1) {
    var rawKey = keys[i];
    var trimmedKey = toStr(rawKey).trim();
    if (trimmedKey === '') {
      continue;
    }
    var value = rawProperties[rawKey];
    if (value === null || value === undefined) {
      continue;
    }
    var converted = '';
    if (typeof value === 'boolean') {
      converted = value ? 'true' : 'false';
    } else if (typeof value === 'number') {
      converted = String(value);
    } else if (Array.isArray(value)) {
      converted = value.join(' | ');
    } else if (typeof value === 'object') {
      try {
        converted = JSON.stringify(value);
      } catch (jsonErr) {
        converted = String(value);
      }
    } else {
      converted = String(value);
    }
    var trimmedValue = toStr(converted).trim();
    if (trimmedValue === '') {
      continue;
    }
    sanitized[trimmedKey] = trimmedValue;
  }
  return sanitized;
}

function normalizeBundleComponentReference(rawReference) {
  var raw = toStr(rawReference);
  if (raw === '') {
    return {raw: raw, type: 'unknown', value: ''};
  }
  if (raw.indexOf('gid://shopify/Product/') === 0) {
    return {raw: raw, type: 'product_gid', value: raw};
  }
  var handleSlug = /^[a-z0-9][a-z0-9-_]*$/;
  if (handleSlug.test(raw)) {
    return {raw: raw, type: 'handle', value: raw};
  }
  return {raw: raw, type: 'unknown', value: raw};
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


function buildMshIntentProperties(mode, takeNowInSplit) {
  var normalizedMode = mode === 'order_in' || mode === 'split' ? mode : 'take_today';
  var takeNow = normalizedMode === 'take_today';
  if (normalizedMode === 'order_in') {
    takeNow = false;
  }
  if (normalizedMode === 'split') {
    takeNow = takeNowInSplit ? true : false;
  }
  return {
    _msh_source: 'macron_pos',
    _msh_fulfilment_mode: normalizedMode,
    _msh_take_now: takeNow ? 'true' : 'false',
  };
}

function buildMshLineItemIntentProperties(options) {
  var config = options || {};
  var mode = config.mode;
  var takeNowInSplit = config.takeNowInSplit;
  var productTitle = toStr(config.productTitle);
  var variantTitle = toStr(config.variantTitle);
  var normalizedVariantId = toStr(config.normalizedVariantId);
  var hasFee = config.hasFee ? true : false;
  var isBundle = config.isBundle ? true : false;
  var bundleSummary = toStr(config.bundleSummary);
  var quantity = toStr(config.quantity || '1');
  var baseIntent = buildMshIntentProperties(mode, takeNowInSplit);
  var nowIso = new Date().toISOString();
  var properties = {
    _msh_source: baseIntent._msh_source,
    _msh_fulfilment_mode: baseIntent._msh_fulfilment_mode,
    _msh_fulfillment_mode: baseIntent._msh_fulfilment_mode,
    _msh_take_now: baseIntent._msh_take_now,
    _msh_intent_product_title: productTitle,
    _msh_intent_variant_title: variantTitle,
    _msh_intent_variant_id: normalizedVariantId,
    _msh_intent_quantity: quantity,
    _msh_intent_has_fee: hasFee ? 'true' : 'false',
    _msh_intent_is_bundle: isBundle ? 'true' : 'false',
    _msh_intent_created_at: nowIso,
    _msh_intent_source: 'macron_pos',
    _msh_intent_fulfilment_mode: baseIntent._msh_fulfilment_mode,
    _msh_intent_fulfillment_mode: baseIntent._msh_fulfilment_mode,
    _msh_intent_take_now: baseIntent._msh_take_now,
    _msh_fallback_source: baseIntent._msh_source,
    _msh_fallback_fulfilment_mode: baseIntent._msh_fulfilment_mode,
    _msh_fallback_fulfillment_mode: baseIntent._msh_fulfilment_mode,
    _msh_fallback_take_now: baseIntent._msh_take_now,
  };
  properties._msh_intent_bundle_summary = bundleSummary;
  return properties;
}

function defaultBundleComponentFulfilment(mode) {
  if (mode === 'order_in') {
    return 'order_later';
  }
  return 'take_now';
}

function buildBundleMshIntentProperties(mode) {
  return buildMshIntentProperties(mode, false);
}

function buildBundleGroupedSummaryValue(lines) {
  if (!lines || lines.length === 0) {
    return '';
  }
  return '- ' + lines.join('\n- ');
}

function buildBundlePersonalisationSummaryValue(personalisationProps) {
  if (!personalisationProps || typeof personalisationProps !== 'object') {
    return '';
  }
  var keys = Object.keys(personalisationProps);
  var lines = [];
  for (var i = 0; i < keys.length; i += 1) {
    var key = keys[i];
    if (key === 'Personalisation Fee') {
      continue;
    }
    lines.push(key + ': ' + personalisationProps[key]);
  }
  return buildBundleGroupedSummaryValue(lines);
}

function buildBundleReadableProperties(bundleTitle, components, selections, fulfilmentByComponent, fulfilmentMode, personalisationProps) {
  const props = buildBundleComponents(bundleTitle, components, selections, fulfilmentByComponent, fulfilmentMode);
  if (personalisationProps && typeof personalisationProps === 'object') {
    var personalisationKeys = Object.keys(personalisationProps);
    for (var p = 0; p < personalisationKeys.length; p += 1) {
      var personalisationKey = personalisationKeys[p];
      // A shop-defined personalisation label must never overwrite a kit item.
      const label = toStr(personalisationKey);
      const reserved = /^(?:_msh_|Item \d+$|Bundle(?: |$)|Fee For Product$|Linked (?:Fee|Product) Variant Id$)/i.test(label);
      const key = reserved ? 'Personalisation · ' + label : label;
      props[key] = personalisationProps[personalisationKey];
    }
    if (personalisationKeys.length > 0) {
      var summaryParts = [];
      for (var s = 0; s < personalisationKeys.length; s += 1) {
        var summaryKey = personalisationKeys[s];
        summaryParts.push(summaryKey + ': ' + personalisationProps[summaryKey]);
      }
      props['Personalisation Summary'] = summaryParts.join(' | ');
      var groupedPersonalisationSummary = buildBundlePersonalisationSummaryValue(personalisationProps);
      if (groupedPersonalisationSummary !== '') {
        props['Bundle Personalisation Summary'] = groupedPersonalisationSummary;
      }
    }
  }
  return props;
}

function parseFeeDisplay(raw) {
  var text = toStr(raw);
  if (text === '') {
    return '';
  }
  var cleaned = text.replace(/[^0-9.-]/g, '');
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
      var numObj = parseFloat(toStr(raw.amount).replace(/[^0-9.-]/g, ''));
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
  var cleaned = text.replace(/[^0-9.-]/g, '');
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

function validatePersonalisationInputs(meta, primaryFieldValue, extraField1Value, extraField2Value, toast) {
  if (!meta) {
    return {valid: true, error: ''};
  }
  if (meta.enablePersonalisation && meta.personalisationRequired && toStr(primaryFieldValue) === '') {
    var primaryMessage = meta.personalisationLabel || 'Personalisation is required';
    if (toast) {
      toast(primaryMessage);
    }
    return {valid: false, error: primaryMessage};
  }
  if (meta.extraField1Enabled && meta.extraField1Required && toStr(extraField1Value) === '') {
    var extra1Message = meta.extraField1Label || 'Field 1 is required';
    if (toast) {
      toast(extra1Message);
    }
    return {valid: false, error: extra1Message};
  }
  if (meta.extraField2Enabled && meta.extraField2Required && toStr(extraField2Value) === '') {
    var extra2Message = meta.extraField2Label || 'Field 2 is required';
    if (toast) {
      toast(extra2Message);
    }
    return {valid: false, error: extra2Message};
  }
  if (meta.enableFileUpload && meta.fileUploadRequired) {
    var fileUploadMessage = 'This item requires file upload, which is not available in POS V1 yet';
    if (toast) {
      toast(fileUploadMessage);
    }
    return {valid: false, error: fileUploadMessage};
  }
  return {valid: true, error: ''};
}

function buildPersonalisationProperties(meta, primaryFieldValue, extraField1Value, extraField2Value, includeFeeValue) {
  var props = {};
  if (!meta) {
    return props;
  }
  function safeLabel(label) {
    const key = toStr(label);
    return /^(?:_msh_|Bundle(?: |$)|Item \d+$|Fee For Product$|Personalisation (?:Fee|Summary)$|Linked (?:Fee|Product) Variant Id$|__proto__$|constructor$|prototype$)/i.test(key)
      ? 'Personalisation · ' + key : key;
  }
  if (meta.enablePersonalisation && toStr(primaryFieldValue) !== '') {
    props[safeLabel(meta.personalisationLabel || 'Personalisation')] = toStr(primaryFieldValue);
  }
  if (meta.extraField1Enabled && toStr(extraField1Value) !== '') {
    props[safeLabel(meta.extraField1Label || 'Additional information')] = toStr(extraField1Value);
  }
  if (meta.extraField2Enabled && toStr(extraField2Value) !== '') {
    props[safeLabel(meta.extraField2Label || 'Additional information 2')] = toStr(extraField2Value);
  }
  if (includeFeeValue !== null && includeFeeValue !== undefined) {
    var feeNumber = parseFloat(includeFeeValue);
    if (!isNaN(feeNumber) && feeNumber > 0) {
      props['Personalisation Fee'] = '£' + feeNumber.toFixed(2);
    }
  }
  return props;
}

function normalizeVariantId(id) {
  const match = /^(?:gid:\/\/shopify\/ProductVariant\/)?([1-9]\d*)$/.exec(toStr(id));
  const value = match ? Number(match[1]) : null;
  return {valid: Number.isSafeInteger(value), value};
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
                components.push({id: item.id || item.title, handle: item.handle ? toStr(item.handle) : '', title: item.title, variants: mappedVariants});
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
        var selectedOptions = [];
        var optionMap = {};
        if (edge.node.selectedOptions && Array.isArray(edge.node.selectedOptions)) {
          for (var s = 0; s < edge.node.selectedOptions.length; s += 1) {
            var optionNode = edge.node.selectedOptions[s];
            var optionName = toStr(optionNode && optionNode.name ? optionNode.name : '');
            var optionValue = toStr(optionNode && optionNode.value ? optionNode.value : '');
            if (optionName !== '') {
              selectedOptions.push({name: optionName, value: optionValue});
              optionMap[optionName] = optionValue;
            }
          }
        }
        list.push({id: edge.node.id, title: edge.node.title, sku: edge.node.sku, requiresShipping: edge.node.inventoryItem?.requiresShipping, selectedOptions: selectedOptions, optionMap: optionMap});
      }
    }
  }
  return list;
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
            imageUrl: node.image && node.image.url ? node.image.url : '',
          });
        }
      } else {
        if (!parents[title]) {
          parents[title] = {collectionId: node.id, productsCount: productsCount, collectionTitle: title, imageUrl: node.image && node.image.url ? node.image.url : ''};
          parentNames.push(title);
        } else {
          parents[title].productsCount = productsCount;
          parents[title].collectionId = node.id;
          parents[title].collectionTitle = title;
          parents[title].imageUrl = node.image && node.image.url ? node.image.url : parents[title].imageUrl;
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
        imageUrl: parentInfo.imageUrl || '',
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
          imageUrl: matchingChildren[m].imageUrl || '',
        });
      }
      clubs.push({
        name: name,
        type: 'subsections',
        subsections: subsections,
        products: null,
        collectionId: parentInfo ? parentInfo.collectionId : null,
        collectionTitle: parentInfo ? parentInfo.collectionTitle : name,
        imageUrl: parentInfo && parentInfo.imageUrl ? parentInfo.imageUrl : '',
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
          image {
            url(transform: {maxWidth: 240, maxHeight: 240})
          }
          productsCount {
            count
          }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }`;

  const allCollections = [];
  const seen = new Set();
  let cursor = null;
  let pagesFetched = 0;
  do {
    const data = await readCatalogue(query, {cursor});
    const page = data.collections;
    if (!Array.isArray(page?.edges)) throw new Error('Could not read the club directory.');
    for (const edge of page.edges) {
      if (edge.node) allCollections.push(edge.node);
    }
    pagesFetched += 1;
    cursor = nextCatalogueCursor(page.pageInfo, seen);
  } while (cursor);

  var mapped = mapCollections(allCollections);
  return {
    clubs: mapped.clubs,
    collectionsCount: mapped.collectionsCount,
    directClubsCount: mapped.directClubsCount,
    subsectionClubsCount: mapped.subsectionClubsCount,
    orphanChildIgnored: mapped.orphanChildIgnored,
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
            isGiftCard
            featuredMedia {
              preview { image { url(transform: {maxWidth: 240, maxHeight: 240}) } }
            }
            variants(first: 20) {
              pageInfo { hasNextPage endCursor }
              edges {
                node {
                  id
                  title
                  sku inventoryItem { requiresShipping }
                  selectedOptions {
                    name
                    value
                  }
                }
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

  const products = [];
  const seen = new Set();
  let cursor = null;
  do {
    const data = await readCatalogue(query, {id: collectionId, cursor});
    const page = data.collection?.products;
    if (!Array.isArray(page?.edges)) throw new Error('Could not read this range.');
    for (const edge of page.edges) {
      const node = edge.node;
      if (!node) continue;
      products.push({
        id: node.id,
        title: node.title,
        isGiftCard: node.isGiftCard,
        imageUrl: node.featuredMedia?.preview?.image?.url || '',
        variants: mapVariants(await allVariantEdges(node.id, node.variants)),
        personalisationMeta: mapPersonalisationMeta(node),
        bundleMeta: mapBundleMeta(node.bundleComponents),
      });
    }
    cursor = nextCatalogueCursor(page.pageInfo, seen);
  } while (cursor);

  return products;
}

async function fetchBundleComponentsByReferences(componentRefs) {
  var result = {
    productsByReference: {},
    unresolvedRefs: [],
    errors: [],
    resolvedByHandleCount: 0,
    resolvedByGidCount: 0,
    unknownRefCount: 0,
  };
  if (!componentRefs || !Array.isArray(componentRefs) || componentRefs.length === 0) {
    return result;
  }
  var normalizedRefs = [];
  for (var r = 0; r < componentRefs.length; r += 1) {
    normalizedRefs.push(normalizeBundleComponentReference(componentRefs[r]));
  }
  if (typeof fetch === 'undefined') {
    for (var i = 0; i < normalizedRefs.length; i += 1) {
      if (normalizedRefs[i].type === 'unknown') {
        result.unknownRefCount += 1;
      }
      result.unresolvedRefs.push(normalizedRefs[i].raw);
    }
    result.errors.push('Admin API fetch unavailable for bundle components');
    return result;
  }

  const componentQuery = `query BundleComponent($identifier: ProductIdentifierInput!) {
    productByIdentifier(identifier: $identifier) {
      id title handle
      variants(first: 50) {
        edges { node { id title selectedOptions { name value } } }
        pageInfo { hasNextPage endCursor }
      }
    }
  }`;
  for (var h = 0; h < normalizedRefs.length; h += 1) {
    var normalized = normalizedRefs[h];
    var ref = normalized.raw;
    if (ref === '') {
      continue;
    }
    if (normalized.type === 'unknown') {
      result.unknownRefCount += 1;
      result.unresolvedRefs.push(ref);
      continue;
    }
    try {
      const identifier = normalized.type === 'product_gid' ? {id: normalized.value} : {handle: normalized.value};
      const {productByIdentifier: productNode} = await readCatalogue(componentQuery, {identifier});
      if (!productNode) {
        result.unresolvedRefs.push(ref);
        continue;
      }
      result.productsByReference[ref] = {
        id: productNode.id,
        handle: toStr(productNode.handle),
        title: productNode.title,
        variants: mapVariants(await allVariantEdges(productNode.id, productNode.variants)),
      };
      if (normalized.type === 'product_gid') {
        result.resolvedByGidCount += 1;
      } else {
        result.resolvedByHandleCount += 1;
      }
    } catch (err) {
      result.unresolvedRefs.push(ref);
      result.errors.push('Bundle component fetch failed for ref "' + ref + '": ' + (err && err.message ? err.message : String(err)));
    }
  }
  return result;
}
// ---------------- UI ----------------
export default async function () {
  render(<Modal />, document.body);
}

function Modal() {
  const [clubQuery, setClubQuery] = useState('');
  const [productFilter, setProductFilter] = useState({collectionId: null, value: ''});
  const [catalogueColumns, setCatalogueColumns] = useState(2);
  useEffect(() => {
    let mounted = true;
    const device = typeof shopify === 'undefined' ? null : shopify.device;
    if (device?.isTablet) {
      device.isTablet().then(tablet => {
        if (mounted && tablet) setCatalogueColumns(3);
      }).catch(() => {});
    }
    return () => { mounted = false; };
  }, []);

  const [cartAddPending, setCartAddPending] = useState(false);
  var screenState = useState('clubs');
  var screen = screenState[0];
  var setScreen = screenState[1];

  var clubsState = useState([]);
  var clubs = clubsState[0];
  var setClubs = clubsState[1];

  var dataSourceState = useState('Shopify');
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
  const [rangeLoader] = useState(() => createRangeLoader(fetchProductsForCollection));
  const [range, setRange] = useState({id: null, products: [], loading: false, error: ''});
  const {id: currentProductsCollectionId, products: currentProducts, loading: productListLoading, error: productListError} = range;
  const errorMessage = productListError;
  const [catalogueAttempt, setCatalogueAttempt] = useState(0);
  const bundleRequest = useRef(0);

  const [cartResult, setCartResult] = useState(null);

  var loadingState = useState(true);
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

  var selectedOptionValuesState = useState({});
  var selectedOptionValues = selectedOptionValuesState[0];
  var setSelectedOptionValues = selectedOptionValuesState[1];

  var primaryState = useState('');
  var primaryFieldValue = primaryState[0];
  var setPrimaryFieldValue = primaryState[1];

  var extra1State = useState('');
  var extraField1Value = extra1State[0];
  var setExtraField1Value = extra1State[1];

  var extra2State = useState('');
  var extraField2Value = extra2State[0];
  var setExtraField2Value = extra2State[1];

  var fulfilmentModeState = useState('take_today');
  var fulfilmentMode = fulfilmentModeState[0];
  var setFulfilmentMode = fulfilmentModeState[1];

  var splitTakeNowState = useState(true);
  var splitTakeNow = splitTakeNowState[0];
  var setSplitTakeNow = splitTakeNowState[1];

  var bundleComponentsState = useState([]);
  var bundleComponents = bundleComponentsState[0];
  var setBundleComponents = bundleComponentsState[1];

  var bundleSelectionsState = useState({});
  var bundleSelections = bundleSelectionsState[0];
  var setBundleSelections = bundleSelectionsState[1];

  var bundleComponentFulfilmentState = useState({});
  var bundleComponentFulfilment = bundleComponentFulfilmentState[0];
  var setBundleComponentFulfilment = bundleComponentFulfilmentState[1];

  var bundleLoadingState = useState(false);
  var bundleLoading = bundleLoadingState[0];
  var setBundleLoading = bundleLoadingState[1];

  var bundleErrorState = useState('');
  var bundleError = bundleErrorState[0];
  var setBundleError = bundleErrorState[1];

  var bundleDebugUnresolvedRefsState = useState([]);
  var bundleDebugUnresolvedRefs = bundleDebugUnresolvedRefsState[0];
  var setBundleDebugUnresolvedRefs = bundleDebugUnresolvedRefsState[1];

  var bundleDebugRawRefsCountState = useState(0);
  var bundleDebugRawRefsCount = bundleDebugRawRefsCountState[0];
  var setBundleDebugRawRefsCount = bundleDebugRawRefsCountState[1];

  var bundleDebugResolvedByHandleCountState = useState(0);
  var bundleDebugResolvedByHandleCount = bundleDebugResolvedByHandleCountState[0];
  var setBundleDebugResolvedByHandleCount = bundleDebugResolvedByHandleCountState[1];

  var bundleDebugResolvedByGidCountState = useState(0);
  var bundleDebugResolvedByGidCount = bundleDebugResolvedByGidCountState[0];
  var setBundleDebugResolvedByGidCount = bundleDebugResolvedByGidCountState[1];

  var bundleDebugUnknownRefCountState = useState(0);
  var bundleDebugUnknownRefCount = bundleDebugUnknownRefCountState[0];
  var setBundleDebugUnknownRefCount = bundleDebugUnknownRefCountState[1];

  var bundleDebugFetchErrorsState = useState([]);
  var bundleDebugFetchErrors = bundleDebugFetchErrorsState[0];
  var setBundleDebugFetchErrors = bundleDebugFetchErrorsState[1];

  var bundleAddStatusState = useState('idle');
  var bundleAddStatus = bundleAddStatusState[0];
  var setBundleAddStatus = bundleAddStatusState[1];

  var bundleAddErrorState = useState('');
  var bundleAddError = bundleAddErrorState[0];
  var setBundleAddError = bundleAddErrorState[1];

  var bundleParentLineAddedState = useState(false);
  var bundleParentLineAdded = bundleParentLineAddedState[0];
  var setBundleParentLineAdded = bundleParentLineAddedState[1];

  var bundleParentLineUuidState = useState('');
  var bundleParentLineUuid = bundleParentLineUuidState[0];
  var setBundleParentLineUuid = bundleParentLineUuidState[1];

  var bundleReadablePropertyCountState = useState(0);
  var bundleReadablePropertyCount = bundleReadablePropertyCountState[0];
  var setBundleReadablePropertyCount = bundleReadablePropertyCountState[1];

  var bundleReadableAttachAttemptedState = useState(false);
  var bundleReadableAttachAttempted = bundleReadableAttachAttemptedState[0];
  var setBundleReadableAttachAttempted = bundleReadableAttachAttemptedState[1];

  var bundleReadableAttachStatusState = useState('idle');
  var bundleReadableAttachStatus = bundleReadableAttachStatusState[0];
  var setBundleReadableAttachStatus = bundleReadableAttachStatusState[1];

  var bundleReadableAttachErrorState = useState('');
  var bundleReadableAttachError = bundleReadableAttachErrorState[0];
  var setBundleReadableAttachError = bundleReadableAttachErrorState[1];

  var bundleFinalParentPropertiesCountState = useState(0);
  var bundleFinalParentPropertiesCount = bundleFinalParentPropertiesCountState[0];
  var setBundleFinalParentPropertiesCount = bundleFinalParentPropertiesCountState[1];

  var showDebugState = useState(false);
  var showDebug = showDebugState[0];
  var setShowDebug = showDebugState[1];

  function loadProductsForCollection(collectionId) {
    return rangeLoader.select(collectionId, setRange);
  }

  function retryClubs() {
    setCatalogueAttempt(attempt => attempt + 1);
  }

  useEffect(() => () => {
    rangeLoader.leave();
    bundleRequest.current += 1;
  }, [rangeLoader]);

  useEffect(function () {
    let cancelled = false;
    async function load() {
      setLiveFetchStarted(true);
      setLiveFetchFailed(false);
      setLiveFetchErrorMessage('');
      setLiveSourceStage('loading collections');
      setLoading(true);
      try {
        const result = await fetchLiveClubs();
        if (cancelled) return;
        if (!result.clubs.length) throw new Error('Shopify returned no club shops.');
        setPagesFetched(result.pagesFetched);
        setRawCollectionsCount(result.rawCollectionsCount);
        setLiveCollectionsCount(result.collectionsCount);
        setDirectClubsCount(result.directClubsCount);
        setSubsectionClubsCount(result.subsectionClubsCount);
        setOrphanChildIgnored(result.orphanChildIgnored);
        setLiveUsableClubCount(result.clubs.length);
        setClubs(result.clubs);
        setDataSource('Live data');
        setLiveFetchSucceeded(true);
        setLiveSourceStage('using live data');
      } catch (error) {
        if (cancelled) return;
        setLiveFetchFailed(true);
        setLiveFetchSucceeded(false);
        setLiveFetchErrorMessage(error.message || 'Could not load club shops.');
        setLiveSourceStage('could not load live data');
        setDataSource('Shopify unavailable');
        setClubs([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [catalogueAttempt]);

  function resetToClubs() {
    setSelectedClub(null);
    setSelectedSubsection(null);
    setSelectedProduct(null);
    setSelectedVariant(null);
    setSelectedOptionValues({});
    setPrimaryFieldValue('');
    setExtraField1Value('');
    setExtraField2Value('');
    rangeLoader.leave();
    setRange({id: null, products: [], loading: false, error: ''});
    bundleRequest.current += 1;
    setBundleComponents([]);
    setBundleSelections({});
    setBundleComponentFulfilment({});
    setBundleLoading(false);
    setBundleError('');
    setBundleDebugUnresolvedRefs([]);
    setBundleDebugRawRefsCount(0);
    setBundleDebugResolvedByHandleCount(0);
    setBundleDebugResolvedByGidCount(0);
    setBundleDebugUnknownRefCount(0);
    setBundleDebugFetchErrors([]);
    setBundleAddStatus('idle');
    setBundleAddError('');
    setScreen('clubs');
  }

  function resetBundleBuilderState() {
    bundleRequest.current += 1;
    setBundleComponents([]);
    setBundleSelections({});
    setBundleComponentFulfilment({});
    setBundleLoading(false);
    setBundleError('');
    setBundleDebugUnresolvedRefs([]);
    setBundleDebugRawRefsCount(0);
    setBundleDebugResolvedByHandleCount(0);
    setBundleDebugResolvedByGidCount(0);
    setBundleDebugUnknownRefCount(0);
    setBundleDebugFetchErrors([]);
    setBundleAddStatus('idle');
    setBundleAddError('');
  }

  async function loadBundleComponentsForProduct(product) {
    const currentRequest = ++bundleRequest.current;
    if (!product || !product.bundleMeta || !product.bundleMeta.isBundle) {
      setBundleComponents([]);
      return;
    }
    var meta = product.bundleMeta;
    var componentRefs = meta.componentHandles || [];
    var fallbackMap = {};
    var fallbackByIdMap = {};
    var i = 0;
    for (i = 0; i < meta.componentProducts.length; i += 1) {
      var fallbackComp = meta.componentProducts[i];
      var fallbackHandle = fallbackComp && fallbackComp.handle ? toStr(fallbackComp.handle) : '';
      var fallbackId = fallbackComp && fallbackComp.id ? toStr(fallbackComp.id) : '';
      if (fallbackHandle !== '') {
        fallbackMap[fallbackHandle] = fallbackComp;
      }
      if (fallbackId !== '') {
        fallbackByIdMap[fallbackId] = fallbackComp;
      }
    }
    var classifiedHandleCount = 0;
    var classifiedGidCount = 0;
    var classifiedUnknownCount = 0;
    for (i = 0; i < componentRefs.length; i += 1) {
      var normalized = normalizeBundleComponentReference(componentRefs[i]);
      if (normalized.type === 'handle') {
        classifiedHandleCount += 1;
      } else if (normalized.type === 'product_gid') {
        classifiedGidCount += 1;
      } else {
        classifiedUnknownCount += 1;
      }
    }

    setBundleLoading(true);
    setBundleComponentFulfilment({});
    setBundleError('');
    setBundleComponents([]);
    setBundleSelections({});
    setBundleDebugUnresolvedRefs([]);
    setBundleDebugRawRefsCount(componentRefs.length);
    setBundleDebugResolvedByHandleCount(0);
    setBundleDebugResolvedByGidCount(0);
    setBundleDebugUnknownRefCount(classifiedUnknownCount);
    setBundleDebugFetchErrors([]);

    var loaded = [];
    var unresolvedRefs = [];
    var debugErrors = [];
    var resolvedByHandleCount = 0;
    var resolvedByGidCount = 0;
    var unknownRefCount = classifiedUnknownCount;

    if (dataSource === 'Live data' && componentRefs.length > 0) {
      var fetched = await fetchBundleComponentsByReferences(componentRefs);
      if (bundleRequest.current !== currentRequest) return;
      debugErrors = fetched.errors || [];
      resolvedByHandleCount = fetched.resolvedByHandleCount || 0;
      resolvedByGidCount = fetched.resolvedByGidCount || 0;
      unknownRefCount = fetched.unknownRefCount || 0;
      for (i = 0; i < componentRefs.length; i += 1) {
        var rawRef = toStr(componentRefs[i]);
        var found = fetched.productsByReference[rawRef];
        var normalizedRef = normalizeBundleComponentReference(rawRef);
        var fallbackByHandle = normalizedRef.type === 'handle' ? fallbackMap[normalizedRef.value] : null;
        var fallbackById = normalizedRef.type === 'product_gid' ? fallbackByIdMap[normalizedRef.value] : null;
        var fallbackAny = fallbackByHandle ? fallbackByHandle : fallbackById;
        if (found) {
          loaded.push({
            id: found.id,
            handle: found.handle,
            title: found.title,
            variants: found.variants || [],
          });
        } else if (fallbackAny) {
          var fallbackAnyHandle = fallbackAny && fallbackAny.handle ? toStr(fallbackAny.handle) : '';
          loaded.push({
            id: fallbackAny.id,
            handle: fallbackAnyHandle,
            title: fallbackAny.title,
            variants: fallbackAny.variants || [],
          });
          unresolvedRefs.push(rawRef);
        } else {
          unresolvedRefs.push(rawRef);
        }
      }
    } else {
      for (i = 0; i < meta.componentProducts.length; i += 1) {
        var component = meta.componentProducts[i];
        var componentHandle = component && component.handle ? toStr(component.handle) : '';
        loaded.push({
          id: component.id,
          handle: componentHandle,
          title: component.title,
          variants: component.variants || [],
        });
      }
      if (loaded.length === 0) {
        for (i = 0; i < componentRefs.length; i += 1) {
          unresolvedRefs.push(toStr(componentRefs[i]));
        }
      }
      resolvedByHandleCount = classifiedHandleCount;
      resolvedByGidCount = classifiedGidCount;
    }

    const expectedCount = componentRefs.length || meta.componentProducts.length;
    const allItemsAvailable = loaded.length > 0 && loaded.length === expectedCount &&
      loaded.every(item => item.id && item.title && item.variants?.length > 0);
    if (!allItemsAvailable) setBundleError('Some bundle items or sizes could not be loaded.');
    const recipe = prepareBundleComponents(allItemsAvailable ? loaded : []);
    setBundleSelections(recipe.selections);
    setBundleComponents(recipe.components);
    setBundleDebugUnresolvedRefs(unresolvedRefs);
    setBundleDebugResolvedByHandleCount(resolvedByHandleCount);
    setBundleDebugResolvedByGidCount(resolvedByGidCount);
    setBundleDebugUnknownRefCount(unknownRefCount);
    setBundleDebugFetchErrors(debugErrors);
    setBundleLoading(false);
  }

  function handleBundleBuilderOpen() {
    if (!selectedProduct || !selectedProduct.bundleMeta || !selectedProduct.bundleMeta.isBundle) {
      toast('Bundle data unavailable');
      return;
    }
    setBundleAddStatus('idle');
    setBundleAddError('');
    setScreen('bundleBuilder');
    loadBundleComponentsForProduct(selectedProduct);
  }

  function handleBundleVariantSelect(componentKey, variant) {
    setBundleSelections(function (previousState) {
      var previous = previousState || {};
      var next = {};
      var keys = Object.keys(previous);
      for (var i = 0; i < keys.length; i += 1) {
        next[keys[i]] = previous[keys[i]];
      }
      next[componentKey] = variant;
      return next;
    });
  }

  function handleBundleComponentFulfilmentSelect(componentKey, nextValue) {
    setBundleComponentFulfilment(function (previousState) {
      var previous = previousState || {};
      var next = {};
      var keys = Object.keys(previous);
      for (var i = 0; i < keys.length; i += 1) {
        next[keys[i]] = previous[keys[i]];
      }
      next[componentKey] = nextValue;
      return next;
    });
  }

  useEffect(function () {
    if (!bundleComponents || bundleComponents.length === 0) {
      return;
    }
    setBundleComponentFulfilment(function (previousState) {
      var previous = previousState || {};
      var next = {};
      var modeDefault = defaultBundleComponentFulfilment(fulfilmentMode);
      var hasChanged = false;
      for (var i = 0; i < bundleComponents.length; i += 1) {
        var componentKey = bundleComponents[i].key;
        var existing = previous[componentKey];
        var resolved = existing;
        if (fulfilmentMode === 'take_today' || fulfilmentMode === 'order_in') {
          resolved = modeDefault;
        } else if (resolved !== 'take_now' && resolved !== 'order_later') {
          resolved = modeDefault;
        }
        next[componentKey] = resolved;
        if (previous[componentKey] !== resolved) {
          hasChanged = true;
        }
      }
      var previousKeys = Object.keys(previous);
      if (previousKeys.length !== bundleComponents.length) {
        hasChanged = true;
      }
      if (!hasChanged) {
        return previousState;
      }
      return next;
    });
  }, [bundleComponents, fulfilmentMode, splitTakeNow]);

  async function addBundleParentToCart() {
    if (typeof shopify !== 'undefined' && pendingCartAdds.has(shopify.cart)) return;
    if (!selectedProduct || !selectedProduct.bundleMeta || !selectedProduct.bundleMeta.isBundle) {
      toast('No bundle selected');
      return;
    }
    var parentVariant = selectedVariant;
    if (!parentVariant && selectedProduct && Array.isArray(selectedProduct.variants) && selectedProduct.variants.length > 0) {
      parentVariant = selectedProduct.variants[0];
      setSelectedVariant(parentVariant);
    }
    if (!parentVariant) {
      toast('Select a size first');
      setBundleAddStatus('failed');
      setBundleAddError('No parent variant selected');
      return;
    }
    if (isMockVariant(parentVariant.id)) {
      toast('Mock products cannot be added to the POS cart.');
      setBundleAddStatus('failed');
      setBundleAddError('Mock parent variant id');
      return;
    }
    var normalizedParentVariant = normalizeVariantId(parentVariant.id);
    if (!normalizedParentVariant.valid || normalizedParentVariant.value === null) {
      toast('Variant ID is invalid for POS cart add.');
      setBundleAddStatus('failed');
      setBundleAddError('Invalid normalized parent variant id');
      return;
    }
    if (bundleLoading || bundleError || !bundleComponents || bundleComponents.length === 0) {
      toast('Bundle components not loaded');
      setBundleAddStatus('failed');
      setBundleAddError('No bundle components loaded');
      return;
    }

    var missing = [];
    for (var i = 0; i < bundleComponents.length; i += 1) {
      var comp = bundleComponents[i];
      if (!bundleSelections[comp.key]) {
        missing.push(comp.title);
      }
    }
    if (missing.length > 0) {
      toast('Select one option for each bundle item');
      setBundleAddStatus('failed');
      setBundleAddError('Missing selections: ' + missing.join(', '));
      return;
    }

    var personalisationMeta = selectedProduct.personalisationMeta || {};
    var validation = validatePersonalisationInputs(
      personalisationMeta,
      primaryFieldValue,
      extraField1Value,
      extraField2Value,
      toast
    );
    if (!validation.valid) {
      setBundleAddStatus('failed');
      setBundleAddError(validation.error);
      return;
    }

    var enteredPersonalisation = hasEnteredPersonalisationValues(
      personalisationMeta,
      primaryFieldValue,
      extraField1Value,
      extraField2Value
    );

    var parsedBundleFee = parseFeeAmount(personalisationMeta.personalisationFeeRaw);
    var bundleFeeAmount = null;
    if (enteredPersonalisation && parsedBundleFee !== null && parsedBundleFee > 0) {
      bundleFeeAmount = parsedBundleFee;
    }

    setBundleParentLineAdded(false);
    setBundleParentLineUuid('');
    setBundleReadablePropertyCount(0);
    setBundleReadableAttachAttempted(false);
    setBundleReadableAttachStatus('idle');
    setBundleReadableAttachError('');
    setBundleFinalParentPropertiesCount(0);

    if (fulfilmentMode === 'split') {
      const missingMode = bundleComponents.find(item => !['take_now','order_later'].includes(bundleComponentFulfilment[item.key]));
      if (missingMode) {
        toast('Select fulfilment for each bundle component');
        setBundleAddStatus('failed');
        setBundleAddError('Missing split fulfilment for component: ' + missingMode.title);
        return;
      }
    }

    var personalisationProps = buildPersonalisationProperties(
      personalisationMeta,
      primaryFieldValue,
      extraField1Value,
      extraField2Value,
      bundleFeeAmount
    );
    let bundleProps;
    try {
      bundleProps = buildBundleReadableProperties(selectedProduct.title, bundleComponents, bundleSelections,
        bundleComponentFulfilment, fulfilmentMode, personalisationProps);
    } catch (error) {
      setBundleAddStatus('failed');
      setBundleAddError(error.message);
      toast(error.message);
      return;
    }
    var mshIntentProps = buildBundleMshIntentProperties(fulfilmentMode);
    var mshKeys = Object.keys(mshIntentProps);
    for (var mk = 0; mk < mshKeys.length; mk += 1) {
      bundleProps[mshKeys[mk]] = mshIntentProps[mshKeys[mk]];
    }
    var sanitizedBundleProps = sanitizeLineItemProperties(bundleProps);
    const attributes = Object.entries(sanitizedBundleProps).map(([key, value]) => ({key, value}));
    if (!verifiedKitHandover(attributes, selectedProduct.title)) {
      setBundleAddStatus('failed');
      setBundleAddError('Kit items or handover choices could not be verified.');
      toast('Check the size and handover for each kit item before adding it.');
      return;
    }

    setBundleAddStatus(bundleFeeAmount !== null ? 'resolving_fee' : 'adding_parent');
    setBundleAddError('');
    var ok = await addSelectedProductToCart(selectedProduct, parentVariant, sanitizedBundleProps, bundleFeeAmount, {
      enabled: true,
      readableProperties: sanitizedBundleProps,
    });
    if (!ok) {
      setBundleAddStatus('failed');
      setBundleAddError('Bundle add failed. See cart debug for detail.');
      return;
    }
    setBundleAddStatus('success');
    setBundleAddError('');
    setPrimaryFieldValue('');
    setExtraField1Value('');
    setExtraField2Value('');
    setScreen('products');
  }

  async function handleClubPress(club) {
    setSelectedClub(club);
    setSelectedSubsection(null);
    setSelectedProduct(null);
    setSelectedVariant(null);
    setSelectedOptionValues({});
    resetBundleBuilderState();
    if (club.type === 'subsections') {
      setScreen('subsections');
      return;
    }
    setScreen('products');
    await loadProductsForCollection(club.collectionId);
  }

  async function handleSubsectionPress(subsection) {
    setSelectedSubsection(subsection);
    setSelectedProduct(null);
    setSelectedVariant(null);
    setSelectedOptionValues({});
    resetBundleBuilderState();
    setScreen('products');
    await loadProductsForCollection(subsection.collectionId);
  }

  function handleProductPress(product) {
    setFulfilmentMode('take_today');
    setSplitTakeNow(true);
    setPrimaryFieldValue('');
    setExtraField1Value('');
    setExtraField2Value('');
    setSelectedProduct(product);
    var defaultVariant = null;
    if (product?.variants?.length === 1 || (product?.bundleMeta?.isBundle && product?.variants?.length)) {
      defaultVariant = product.variants[0];
    }
    setSelectedVariant(defaultVariant);
    if (defaultVariant && defaultVariant.optionMap) {
      var initialOptionValues = {};
      var defaultKeys = Object.keys(defaultVariant.optionMap);
      for (var dk = 0; dk < defaultKeys.length; dk += 1) {
        initialOptionValues[defaultKeys[dk]] = defaultVariant.optionMap[defaultKeys[dk]];
      }
      setSelectedOptionValues(initialOptionValues);
    } else {
      setSelectedOptionValues({});
    }
    resetBundleBuilderState();
    if (product && product.bundleMeta && product.bundleMeta.isBundle) {
      setBundleAddStatus('idle');
      setBundleAddError('');
      setScreen('bundleBuilder');
      loadBundleComponentsForProduct(product);
      return;
    }
    setScreen('productDetail');
  }

  function handleVariantSelect(variant) {
    setSelectedVariant(variant);
    if (variant && variant.optionMap) {
      var nextOptionValues = {};
      var optionKeys = Object.keys(variant.optionMap);
      for (var i = 0; i < optionKeys.length; i += 1) {
        nextOptionValues[optionKeys[i]] = variant.optionMap[optionKeys[i]];
      }
      setSelectedOptionValues(nextOptionValues);
    }
  }

  function toast(msg) {
    if (typeof shopify !== 'undefined' && shopify.toast && shopify.toast.show) {
      shopify.toast.show(msg);
    }
  }

  async function addSelectedProductToCart(product, variant, lineItemProperties, feeAmount, bundleAttachConfig) {
    const cart = typeof shopify !== 'undefined' ? shopify.cart : null;
    if (!cart) {
      toast('Shopify POS cart is unavailable.');
      return false;
    }
    if (pendingCartAdds.has(cart)) return false;
    pendingCartAdds.add(cart);
    setCartAddPending(true);
    setCartResult(null);
    const kit = bundleAttachConfig?.enabled === true;
    try {
      const id = normalizeVariantId(variant?.id);
      if (!id.valid || !toStr(product?.title) || !toStr(variant?.title)) throw new Error('Select a valid product and size.');
      const properties = sanitizeLineItemProperties(lineItemProperties);
      const mode = properties._msh_fulfilment_mode;
      const take = properties._msh_take_now;
      if (!['take_today','order_in','split'].includes(mode) || !['true','false'].includes(take) ||
          (mode !== 'split' && (mode === 'take_today') !== (take === 'true'))) {
        throw new Error('Choose a handover for this item.');
      }
      const hasFee = feeAmount != null;
      const shop = safeReadShopDomain();
      const supported = kit ? isNativeHandoverBundle(shop, product, variant, properties)
        : isNativeHandoverProduct(shop, product, variant, false, hasFee, properties);
      if (!supported) throw new Error('This item could not be verified for MSH handover. Check the product and its size before adding it.');
      let fee = null;
      if (hasFee) {
        if (!Number.isFinite(feeAmount) || feeAmount <= 0) throw new Error('The personalisation fee is invalid.');
        if (properties['Personalisation Fee'] !== '£' + feeAmount.toFixed(2)) throw new Error('The personalisation fee does not match the amount on the item.');
        const {match} = await findFeeVariant(feeAmount);
        const feeId = normalizeVariantId(match?.id);
        if (!feeId.valid) throw new Error('No matching personalisation fee is available.');
        fee = {variantId: feeId.value, label: '£' + feeAmount.toFixed(2)};
      }
      const metadata = buildMshLineItemIntentProperties({
        mode, takeNowInSplit: take === 'true', productTitle: product.title, variantTitle: variant.title,
        normalizedVariantId: String(id.value), quantity: '1', hasFee, isBundle: kit,
        bundleSummary: properties['Bundle Take Now Summary'] || properties['Bundle Order Later Summary'],
      });
      const record = sanitizeLineItemProperties({
        ...properties, ...metadata, _msh_handover_owner: NATIVE_HANDOVER_OWNER, _msh_handover_role: kit ? 'kit' : 'merchandise',
      });
      const result = await addHandoverToCart(cart, {variantId: id.value, properties: record, fee});
      setCartResult({status: 'Added and verified', mainUuid: result.mainUuid, feeUuid: result.feeUuid});
      if (kit) {
        setBundleParentLineAdded(true);
        setBundleParentLineUuid(result.mainUuid);
        setBundleReadablePropertyCount(Object.keys(properties).length);
        setBundleReadableAttachAttempted(true);
        setBundleReadableAttachStatus('success');
        setBundleReadableAttachError('');
        setBundleFinalParentPropertiesCount(Object.keys(result.properties).length);
      }
      toast('Added to cart.');
      return true;
    } catch (error) {
      const message = error?.message || 'Shopify could not confirm the add. Check the POS cart before retrying.';
      setCartResult({status: message});
      if (kit) {
        setBundleReadableAttachStatus('failed');
        setBundleReadableAttachError(message);
      }
      toast(message);
      return false;
    } finally {
      pendingCartAdds.delete(cart);
      setCartAddPending(false);
    }
  }

  function handleBack() {
    if (screen === 'bundleBuilder') {
      bundleRequest.current += 1;
      setBundleLoading(false);
      setScreen('productDetail');
      return;
    }
    if (screen === 'productDetail') {
      setSelectedProduct(null);
      setSelectedVariant(null);
      setSelectedOptionValues({});
      setPrimaryFieldValue('');
      setExtraField1Value('');
      setExtraField2Value('');
      resetBundleBuilderState();
      setScreen('products');
      return;
    }
    if (screen === 'products') {
      rangeLoader.leave();
      setSelectedProduct(null);
      setSelectedVariant(null);
      setSelectedOptionValues({});
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
      <s-section>
        <s-stack direction="block" gap="micro">
          <s-text size="small" appearance="subdued">Live fetch started: {liveFetchStarted ? 'yes' : 'no'}</s-text>
          <s-text size="small" appearance="subdued">Live fetch succeeded: {liveFetchSucceeded ? 'yes' : 'no'}</s-text>
          <s-text size="small" appearance="subdued">Live fetch failed: {liveFetchFailed ? 'yes' : 'no'}</s-text>
          <s-text size="small" appearance="subdued">Live source stage: {liveSourceStage}</s-text>
          <s-text size="small" appearance="subdued">Pages fetched: {pagesFetched}</s-text>
          <s-text size="small" appearance="subdued">Raw collections fetched: {rawCollectionsCount}</s-text>
          <s-text size="small" appearance="subdued">Collections returned: {liveCollectionsCount}</s-text>
          <s-text size="small" appearance="subdued">Usable clubs built: {liveUsableClubCount}</s-text>
          <s-text size="small" appearance="subdued">Direct clubs: {directClubsCount}</s-text>
          <s-text size="small" appearance="subdued">Subsection clubs: {subsectionClubsCount}</s-text>
          <s-text size="small" appearance="subdued">Orphan child collections ignored: {orphanChildIgnored}</s-text>
          <s-text size="small" appearance="subdued">Data source in use: {dataSource}</s-text>
          <s-text size="small" appearance={liveFetchErrorMessage === '' ? 'subdued' : 'critical'}>Error: {liveFetchErrorMessage === '' ? 'none' : liveFetchErrorMessage}</s-text>
        </s-stack>
      </s-section>
    );
  }

  function renderDebugHeader() {
    return (
      <s-section heading="Diagnostics">
        <s-stack direction="block" gap="micro">
          <s-text size="small" appearance="subdued">{screen} · {dataSource}</s-text>
          {errorMessage ? <s-text size="small" appearance="critical">{errorMessage}</s-text> : null}
          {renderLiveDebugPanel()}
        </s-stack>
      </s-section>
    );
  }

  function renderDiagnosticsToggle() {
    return (
      <s-section>
        <s-stack direction="inline" gap="small" alignItems="center">
          <s-button
            variant="secondary"
            onClick={function () {
              setShowDebug(!showDebug);
            }}
          >
            {showDebug ? 'Hide Diagnostics' : 'Diagnostics'}
          </s-button>
          {errorMessage && !showDebug ? <s-text size="small" appearance="critical">Issue</s-text> : null}
        </s-stack>
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
    var selectedSummary = [];
    var selectionKeys = Object.keys(bundleSelections || {});
    for (var s = 0; s < selectionKeys.length; s += 1) {
      var sel = bundleSelections[selectionKeys[s]];
      if (sel && sel.title) {
        selectedSummary.push(selectionKeys[s] + ':' + sel.title);
      }
    }
    var bundlePreview = [];
    for (var p = 0; p < bundleComponents.length; p += 1) {
      var component = bundleComponents[p];
      var chosen = bundleSelections[component.key];
      var chosenFulfilment = bundleComponentFulfilment[component.key];
      if (chosenFulfilment !== 'take_now' && chosenFulfilment !== 'order_later') {
        chosenFulfilment = defaultBundleComponentFulfilment(fulfilmentMode);
      }
      if (chosen && chosen.title) {
        bundlePreview.push('Item ' + String(p + 1) + ': ' + component.title + ' — ' + chosen.title);
      }
      bundlePreview.push('Bundle Component ' + String(p + 1) + ' Fulfilment: ' + chosenFulfilment);
    }
    var bundlePersonalisationProps = buildPersonalisationProperties(
      product.personalisationMeta || {},
      primaryFieldValue,
      extraField1Value,
      extraField2Value,
      null
    );
    var personalisationPreviewKeys = Object.keys(bundlePersonalisationProps);
    for (var bp = 0; bp < personalisationPreviewKeys.length; bp += 1) {
      var previewKey = personalisationPreviewKeys[bp];
      bundlePreview.push(previewKey + ': ' + bundlePersonalisationProps[previewKey]);
    }
    return (
      <s-section heading="Bundle diagnostics">
        <s-box border="base" cornerRadius="base" padding="small">
          <s-stack direction="block" gap="micro">
            <s-text size="small">bundle parent: {product.title}</s-text>
            <s-text size="small">parent variant: {selectedVariant ? selectedVariant.title : 'none'}</s-text>
            <s-text size="small">isBundle: {meta.isBundle ? 'true' : 'false'}</s-text>
            <s-text size="small">raw component refs: {bundleDebugRawRefsCount}</s-text>
            <s-text size="small">resolved by handle: {bundleDebugResolvedByHandleCount}</s-text>
            <s-text size="small">resolved by gid: {bundleDebugResolvedByGidCount}</s-text>
            <s-text size="small">unknown refs: {bundleDebugUnknownRefCount}</s-text>
            <s-text size="small">component products: {meta.componentProducts.length}</s-text>
            <s-text size="small">loaded components: {bundleComponents.length}</s-text>
            <s-text size="small">bundle loading: {bundleLoading ? 'yes' : 'no'}</s-text>
            <s-text size="small">unresolved refs: {bundleDebugUnresolvedRefs.length === 0 ? 'none' : bundleDebugUnresolvedRefs.join(', ')}</s-text>
            <s-text size="small">selected variants: {selectedSummary.length === 0 ? 'none' : selectedSummary.join(' | ')}</s-text>
            <s-text size="small">bundle add status: {bundleAddStatus}</s-text>
            <s-text size="small">bundle add error: {bundleAddError === '' ? 'none' : bundleAddError}</s-text>
            <s-text size="small">parent line added: {bundleParentLineAdded ? 'yes' : 'no'}</s-text>
            <s-text size="small">parent line uuid: {bundleParentLineUuid === '' ? 'none' : bundleParentLineUuid}</s-text>
            <s-text size="small">readable property count: {bundleReadablePropertyCount}</s-text>
            <s-text size="small">readable property attach attempted: {bundleReadableAttachAttempted ? 'yes' : 'no'}</s-text>
            <s-text size="small">readable property attach status: {bundleReadableAttachStatus}</s-text>
            <s-text size="small">readable property attach error: {bundleReadableAttachError === '' ? 'none' : bundleReadableAttachError}</s-text>
            <s-text size="small">final cart line properties count: {bundleFinalParentPropertiesCount}</s-text>
            <s-text size="small">bundle properties preview: {bundlePreview.length === 0 ? 'none' : ('Bundle:' + product.title + ' | ' + bundlePreview.join(' | '))}</s-text>
            <s-text size="small">bundle fetch errors: {bundleDebugFetchErrors.length === 0 ? 'none' : bundleDebugFetchErrors.join(' | ')}</s-text>
            {names.length > 0 ? <s-text size="small">components: {names.join(', ')}</s-text> : null}
          </s-stack>
        </s-box>
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
      <s-section heading="Personalisation diagnostics">
        <s-box border="base" cornerRadius="base" padding="small">
          <s-stack direction="block" gap="micro">
            <s-text size="small">Product supports personalisation: {summary}</s-text>
            <s-text size="small">Parsed max chars: {parsedMax === null ? 'none' : parsedMax}</s-text>
            <s-text size="small">Parsed fee: {feeDisplay === '' ? 'none' : feeDisplay}</s-text>
            <s-text size="small">enablePersonalisation: {meta.enablePersonalisation ? 'true' : 'false'}</s-text>
            <s-text size="small">personalisationLabel: {meta.personalisationLabel}</s-text>
            <s-text size="small">personalisationFeeRaw: {meta.personalisationFeeRaw}</s-text>
            <s-text size="small">personalisationMaxCharsRaw: {meta.personalisationMaxCharsRaw}</s-text>
            <s-text size="small">personalisationRequired: {meta.personalisationRequired ? 'true' : 'false'}</s-text>
            <s-text size="small">extraField1Enabled: {meta.extraField1Enabled ? 'true' : 'false'}</s-text>
            <s-text size="small">extraField1Label: {meta.extraField1Label}</s-text>
            <s-text size="small">extraField1Required: {meta.extraField1Required ? 'true' : 'false'}</s-text>
            <s-text size="small">extraField2Enabled: {meta.extraField2Enabled ? 'true' : 'false'}</s-text>
            <s-text size="small">extraField2Label: {meta.extraField2Label}</s-text>
            <s-text size="small">extraField2Required: {meta.extraField2Required ? 'true' : 'false'}</s-text>
            <s-text size="small">enableFileUpload: {meta.enableFileUpload ? 'true' : 'false'}</s-text>
            <s-text size="small">fileUploadLabel: {meta.fileUploadLabel}</s-text>
            <s-text size="small">fileUploadHelpText: {meta.fileUploadHelpText}</s-text>
            <s-text size="small">fileUploadRequired: {meta.fileUploadRequired ? 'true' : 'false'}</s-text>
          </s-stack>
        </s-box>
      </s-section>
    );
  }

  function renderCartDebug() {
    if (!cartResult) return null;
    return <s-section heading="Last cart add">
      <s-stack gap="small">
        <s-text>{cartResult.status}</s-text>
        {cartResult.mainUuid && <s-text>Product line: {cartResult.mainUuid}</s-text>}
        {cartResult.feeUuid && <s-text>Personalisation fee line: {cartResult.feeUuid}</s-text>}
      </s-stack>
    </s-section>;
  }

  function renderProductDebug() {
    return (
      <s-section heading="Product diagnostics">
        <s-box border="base" cornerRadius="base" padding="small">
          <s-stack direction="block" gap="micro">
            <s-text size="small">Selected club: {selectedClub ? selectedClub.name : ''}</s-text>
            <s-text size="small">Selected subsection: {selectedSubsection ? selectedSubsection.label : ''}</s-text>
            <s-text size="small">Current collection id: {currentProductsCollectionId ? currentProductsCollectionId : ''}</s-text>
            <s-text size="small">Product list loading: {productListLoading ? 'yes' : 'no'}</s-text>
            <s-text size="small">Current products count: {currentProducts ? currentProducts.length : 0}</s-text>
          </s-stack>
        </s-box>
      </s-section>
    );
  }

  function renderBack(label) {
    return <s-stack direction="inline"><s-button variant="secondary" disabled={cartAddPending} onClick={handleBack}>{label}</s-button></s-stack>;
  }

  function deriveVariantOptionNames(product) {
    var variants = product && product.variants ? product.variants : [];
    var optionNames = [];
    for (var i = 0; i < variants.length; i += 1) {
      var selectedOptions = variants[i] && variants[i].selectedOptions ? variants[i].selectedOptions : [];
      for (var s = 0; s < selectedOptions.length; s += 1) {
        var optionName = toStr(selectedOptions[s] && selectedOptions[s].name ? selectedOptions[s].name : '');
        if (optionName === '' || optionName === 'Title') {
          continue;
        }
        if (optionNames.indexOf(optionName) === -1) {
          optionNames.push(optionName);
        }
      }
    }
    return optionNames;
  }

  function productUsesSeparateOptions(product) {
    if (!product || !product.variants || !Array.isArray(product.variants)) {
      return false;
    }
    if (product.bundleMeta && product.bundleMeta.isBundle) {
      return false;
    }
    return deriveVariantOptionNames(product).length > 1;
  }

  function handleVariantOptionValueSelect(product, name, value) {
    const names = deriveVariantOptionNames(product);
    const next = {};
    let candidates = product.variants;
    for (const option of names) {
      const choice = option === name ? value : selectedOptionValues[option];
      if (!choice) continue;
      const matching = candidates.filter(variant => variant.optionMap?.[option] === choice);
      if (matching.length) {
        next[option] = choice;
        candidates = matching;
      }
    }
    setSelectedOptionValues(next);
    setSelectedVariant(names.every(option => next[option]) && candidates.length === 1 ? candidates[0] : null);
  }

  function renderVariantSelectors(product) {
    const variants = product.variants || [];
    if (!variants.length) return <s-text tone="critical">No sizes available</s-text>;
    if (!productUsesSeparateOptions(product)) {
      return <OptionButtons items={variants} columns={catalogueColumns === 3 ? 4 : 2} selected={selectedVariant?.id}
        onPick={handleVariantSelect} disabled={cartAddPending} />;
    }
    const names = deriveVariantOptionNames(product);
    return <s-stack gap="base">
      {names.map((name, index) => {
        const prefix = names.slice(0, index);
        const compatible = variants.filter(variant => prefix.every(option =>
          !selectedOptionValues[option] || variant.optionMap?.[option] === selectedOptionValues[option]));
        const available = new Set(compatible.map(variant => variant.optionMap?.[name]));
        const values = [...new Set(variants.map(variant => variant.optionMap?.[name]).filter(Boolean))];
        return <s-stack key={name} gap="small">
          <s-text type="strong">{name}</s-text>
          <OptionButtons items={values.map(value => ({id: value, title: value}))}
            columns={catalogueColumns === 3 ? 4 : 2} selected={selectedOptionValues[name]} disabled={cartAddPending}
            isAvailable={item => available.has(item.id)}
            onPick={item => handleVariantOptionValueSelect(product, name, item.id)} />
        </s-stack>;
      })}
    </s-stack>;
  }

  function renderClubsScreen() {
    const visible = (clubs || []).filter(club => matchesSaleSearch(club.name, clubQuery));
    return <s-page heading="Club shops">
      <s-scroll-box>
        <s-stack padding="base" gap="base">
          <RangeSearch label="Search clubs" value={clubQuery} onChange={setClubQuery} />
          {loading ? <s-text>Loading clubs…</s-text> : liveFetchFailed ? (
            <s-stack gap="small">
              <s-text tone="critical">Couldn’t load club shops.</s-text>
              <s-button onClick={retryClubs}>Retry</s-button>
            </s-stack>
          ) : visible.length ? <CatalogueGrid items={visible} columns={catalogueColumns} onPick={handleClubPress} />
            : <s-text>{clubQuery.trim() ? 'No matching clubs.' : 'No club shops available.'}</s-text>}
          {renderDiagnosticsToggle()}
          {showDebug && renderDebugHeader()}
        </s-stack>
      </s-scroll-box>
    </s-page>;
  }

  function renderSubsectionsScreen() {
    if (!selectedClub?.subsections) return renderClubsScreen();
    return <s-page heading={catalogueLabel(selectedClub.name)}>
      <s-scroll-box>
        <s-stack padding="base" gap="base">
          {renderBack('Back to clubs')}
          <CatalogueGrid items={selectedClub.subsections} columns={catalogueColumns} onPick={handleSubsectionPress} />
          {renderDiagnosticsToggle()}
          {showDebug && renderDebugHeader()}
        </s-stack>
      </s-scroll-box>
    </s-page>;
  }

  function renderProductsScreen() {
    const heading = [selectedClub?.name, selectedSubsection?.label].filter(Boolean).join(' · ') || 'Products';
    const query = productFilter.collectionId === currentProductsCollectionId ? productFilter.value : '';
    const visible = (currentProducts || []).filter(product => matchesSaleSearch(product.title, query));
    return <s-page heading={catalogueLabel(heading)}>
      <s-scroll-box>
        <s-stack padding="base" gap="base">
          {renderBack(selectedClub?.type === 'subsections' ? 'Back to ranges' : 'Back to clubs')}
          <RangeSearch label="Search this range" value={query}
            onChange={value => setProductFilter({collectionId: currentProductsCollectionId, value})} />
          {productListLoading ? <s-text>Loading products…</s-text> : productListError ? (
            <s-stack gap="small">
              <s-text tone="critical">Couldn’t load this range.</s-text>
              <s-button onClick={() => loadProductsForCollection(currentProductsCollectionId)}>Retry</s-button>
            </s-stack>
          ) : visible.length ? <CatalogueGrid items={visible} columns={catalogueColumns} onPick={handleProductPress} />
            : <s-text>{query.trim() ? 'No matching products.' : 'This range has no products.'}</s-text>}
          {renderDiagnosticsToggle()}
          {showDebug && renderProductDebug()}
          {showDebug && renderDebugHeader()}
        </s-stack>
      </s-scroll-box>
    </s-page>;
  }

  function renderFulfilmentControls() {
    return <s-section heading="Handover">
      <OptionButtons columns={catalogueColumns === 3 ? 3 : 2}
        items={[{id: 'take_today', title: 'Take today'}, {id: 'order_in', title: 'Order in'}, {id: 'split', title: 'Split sale'}]}
        selected={fulfilmentMode} disabled={cartAddPending} onPick={item => setFulfilmentMode(item.id)} />
      {fulfilmentMode === 'split' && <s-stack gap="small" paddingBlockStart="small">
        <s-text>For this item</s-text>
        <OptionButtons columns={2} items={[{id:'take', title:'Take today'}, {id:'order', title:'Order in'}]}
          selected={splitTakeNow ? 'take' : 'order'} disabled={cartAddPending} onPick={item => setSplitTakeNow(item.id === 'take')} />
      </s-stack>}
    </s-section>;
  }

  function renderBundleFulfilmentControls() {
    return <s-section heading="Bundle handover">
      <OptionButtons columns={catalogueColumns === 3 ? 3 : 2}
        items={[{id:'take_today', title:'Take all today'}, {id:'order_in', title:'Order all in'}, {id:'split', title:'Split by item'}]}
        selected={fulfilmentMode} disabled={cartAddPending} onPick={item => setFulfilmentMode(item.id)} />
    </s-section>;
  }

  function checkoutReminder() {
    return <s-text type="small" color="subdued">Choose delivery or pickup at Shopify checkout.</s-text>;
  }

  function renderProductDetailScreen() {
    if (!selectedProduct) return renderProductsScreen();
    const isBundle = selectedProduct.bundleMeta?.isBundle;
    const personalised = hasAnyPersonalisation(selectedProduct.personalisationMeta || {});
    return <s-page heading={catalogueLabel(selectedProduct.title)}>
      <s-scroll-box>
        <s-stack padding="base" gap="base">
          {renderBack('Back to products')}
          {selectedProduct.imageUrl && <s-box inlineSize="88px" blockSize="88px">
            <s-image src={selectedProduct.imageUrl} alt="" objectFit="contain" />
          </s-box>}
          <s-section heading={productUsesSeparateOptions(selectedProduct) ? 'Choose options' : 'Choose size'}>
            {renderVariantSelectors(selectedProduct)}
          </s-section>
          {isBundle ? <s-button variant="primary" disabled={!selectedVariant || cartAddPending} onClick={handleBundleBuilderOpen}>Choose bundle items</s-button>
            : personalised ? <s-button variant="primary" disabled={!selectedVariant || cartAddPending}
              onClick={() => setScreen('personalisation')}>Continue to personalisation</s-button>
            : selectedVariant && <s-stack gap="small">
              {renderFulfilmentControls()}
              <s-button variant="primary" loading={cartAddPending} onClick={() => {
                addSelectedProductToCart(selectedProduct, selectedVariant, buildMshIntentProperties(fulfilmentMode, splitTakeNow), null);
              }}>Add to cart</s-button>
              {checkoutReminder()}
            </s-stack>}
          {renderDiagnosticsToggle()}
          {showDebug && renderPersonalisationDebug(selectedProduct)}
          {showDebug && renderBundleDebug(selectedProduct)}
          {showDebug && renderCartDebug()}
          {showDebug && renderProductDebug()}
          {showDebug && renderDebugHeader()}
        </s-stack>
      </s-scroll-box>
    </s-page>;
  }

  function personalisationFields(meta) {
    const label = (raw, fallback) => {
      const original = toStr(raw);
      return ({
        'Please Enter The Players Name And Age Group': 'Player name and age group',
        'Please Upload Your Sponsor Logo Here': 'Sponsor logo',
        'Printed Number To Back Of Shirt': 'Printed number on back of shirt',
      })[original] || original || fallback;
    };
    const fields = [
      {enabled:meta.enablePersonalisation, label:label(meta.personalisationLabel, 'Personalisation'),
        required:meta.personalisationRequired, value:primaryFieldValue, set:setPrimaryFieldValue,
        fee:parseFeeDisplay(meta.personalisationFeeRaw), maxLength:parseMaxChars(meta.personalisationMaxCharsRaw)},
      {enabled:meta.extraField1Enabled, label:label(meta.extraField1Label, 'Additional information'),
        required:meta.extraField1Required, value:extraField1Value, set:setExtraField1Value},
      {enabled:meta.extraField2Enabled, label:label(meta.extraField2Label, 'Additional information 2'),
        required:meta.extraField2Required, value:extraField2Value, set:setExtraField2Value},
    ];
    return <s-section heading="Personalisation">
      <s-stack gap="base">
        {fields.map((field, index) => field.enabled && <s-text-field key={index}
          label={[field.label, field.required ? 'Required' : 'Optional', field.fee].filter(Boolean).join(' · ')}
          maxLength={field.maxLength ?? undefined} disabled={cartAddPending} value={field.value}
          onInput={event => field.set(event.currentTarget.value)} />)}
        {meta.enableFileUpload && <s-stack gap="small">
          <s-text type="strong">{label(meta.fileUploadLabel, 'File upload')}{meta.fileUploadRequired ? ' · Required' : ''}</s-text>
          <s-text>Files can’t be uploaded at this till.</s-text>
          {meta.fileUploadHelpText && <s-text type="small" color="subdued">{meta.fileUploadHelpText}</s-text>}
        </s-stack>}
      </s-stack>
    </s-section>;
  }

  function renderBundleBuilderScreen() {
    if (!selectedProduct) return renderProductsScreen();
    const meta = selectedProduct.personalisationMeta || {};
    const titles = bundleComponents.map(component => catalogueLabel(component.title));
    const titleCounts = new Map();
    for (const title of titles) titleCounts.set(title, (titleCounts.get(title) || 0) + 1);
    const rows = bundleComponents.map((component, index) => ({
      component,
      label: titleCounts.get(titles[index]) > 1 ? titles[index] + ' (item ' + (index + 1) + ')' : titles[index],
      variant: bundleSelections[component.key],
      handover: fulfilmentMode === 'split' ? bundleComponentFulfilment[component.key] : defaultBundleComponentFulfilment(fulfilmentMode),
    }));
    const missingSizes = rows.filter(row => !row.variant).length;
    const ready = rows.length > 0 && missingSizes === 0 && rows.every(row => row.handover) && !bundleError;
    const handoverOptions = [{id: 'take_now', title: 'Taken today'}, {id: 'order_later', title: 'Owed for collection'}];
    return <s-page heading={catalogueLabel(selectedProduct.title)}>
      <s-scroll-box>
        <s-stack padding="base" gap="base">
          {renderBack('Back to products')}
          {selectedProduct.variants?.length > 1 && <s-section heading="Bundle option">
            {renderVariantSelectors(selectedProduct)}
          </s-section>}
          {bundleLoading && <s-text>Loading bundle items…</s-text>}
          {bundleError && <s-stack gap="small">
            <s-text tone="critical">{bundleError}</s-text>
            <s-button disabled={bundleLoading || cartAddPending} onClick={() => loadBundleComponentsForProduct(selectedProduct)}>Retry bundle items</s-button>
          </s-stack>}
          {bundleComponents.length > 0 && renderBundleFulfilmentControls()}
          {rows.map(({component, label, variant, handover}) => <s-section key={component.key} heading={label}>
            <s-stack gap="small">
              {component.variants?.length === 1 && variant
                ? <s-text type="strong">{variant.title === 'Default Title' ? 'Single option' : catalogueLabel(variant.title)}</s-text>
                : component.variants?.length ? <OptionButtons items={component.variants}
                columns={catalogueColumns === 3 ? 4 : 2} selected={variant?.id} disabled={cartAddPending}
                onPick={variant => handleBundleVariantSelect(component.key, variant)} />
                : <s-text tone="critical">No sizes available for this item.</s-text>}
              {fulfilmentMode === 'split'
                ? <OptionButtons columns={2} items={handoverOptions} selected={handover} disabled={cartAddPending}
                    onPick={item => handleBundleComponentFulfilmentSelect(component.key, item.id)} />
                : <s-stack alignItems="start"><s-badge tone={handover === 'take_now' ? 'success' : 'caution'}>
                    {handover === 'take_now' ? 'Taken today' : 'Owed for collection'}
                  </s-badge></s-stack>}
            </s-stack>
          </s-section>)}
          {hasAnyPersonalisation(meta) && personalisationFields(meta)}
          {ready && <s-section heading="Kit handover">
            <s-stack gap="base">
              {handoverOptions.map(option => {
                const group = rows.filter(row => row.handover === option.id);
                if (!group.length) return null;
                return <s-stack key={option.id} gap="small">
                  <s-stack direction="inline" gap="small" alignItems="center">
                    <s-badge tone={option.id === 'take_now' ? 'success' : 'caution'}>{option.title}</s-badge>
                    <s-text type="small">{group.length} {group.length === 1 ? 'item' : 'items'}</s-text>
                  </s-stack>
                  {group.map(row => <s-text key={row.component.key}>{row.label}{
                    row.variant.title === 'Default Title' ? '' : ' — ' + catalogueLabel(row.variant.title)}</s-text>)}
                </s-stack>;
              })}
            </s-stack>
          </s-section>}
          {missingSizes > 0 && <s-text>{missingSizes === 1 ? 'Choose a size for 1 more item.' : 'Choose sizes for ' + missingSizes + ' more items.'}</s-text>}
          <s-button variant="primary" disabled={!ready || bundleLoading} loading={cartAddPending}
            onClick={addBundleParentToCart}>Add bundle to cart</s-button>
          {checkoutReminder()}
          {renderDiagnosticsToggle()}
          {showDebug && renderBundleDebug(selectedProduct)}
          {showDebug && renderCartDebug()}
          {showDebug && renderProductDebug()}
          {showDebug && renderDebugHeader()}
        </s-stack>
      </s-scroll-box>
    </s-page>;
  }

  function renderPersonalisationScreen() {
    if (!selectedProduct || !selectedVariant) return renderProductDetailScreen();
    const meta = selectedProduct.personalisationMeta || {};

    function submitPersonalisation() {
      var validation = validatePersonalisationInputs(
        meta,
        primaryFieldValue,
        extraField1Value,
        extraField2Value,
        toast
      );
      if (!validation.valid) {
        return;
      }
      var enteredPersonalisation = hasEnteredPersonalisationValues(meta, primaryFieldValue, extraField1Value, extraField2Value);
      var parsedFeeAmount = parseFeeAmount(meta.personalisationFeeRaw);
      var feeAmount = null;
      if (enteredPersonalisation && parsedFeeAmount !== null && parsedFeeAmount > 0) {
        feeAmount = parsedFeeAmount;
      }
      const props = buildPersonalisationProperties(meta, primaryFieldValue, extraField1Value, extraField2Value, feeAmount);
      const summary = Object.entries(props).filter(([label]) => label !== 'Personalisation Fee');
      if (summary.length) props['Personalisation Summary'] = summary.map(([label, value]) => label + ': ' + value).join(' | ');
      Object.assign(props, buildMshIntentProperties(fulfilmentMode, splitTakeNow));
      addSelectedProductToCart(selectedProduct, selectedVariant, props, feeAmount).then(function (ok) {
        if (ok) {
          setPrimaryFieldValue('');
          setExtraField1Value('');
          setExtraField2Value('');
          setScreen('products');
        }
      });
    }

    return <s-page heading={catalogueLabel(selectedProduct.title)}>
      <s-scroll-box>
        <s-stack padding="base" gap="base">
          {renderBack('Back to sizes')}
          <s-text type="strong">{catalogueLabel(selectedVariant.title)}</s-text>
          {personalisationFields(meta)}
          {renderFulfilmentControls()}
          <s-button variant="primary" loading={cartAddPending} onClick={submitPersonalisation}>Add to cart</s-button>
          {checkoutReminder()}
          {renderDiagnosticsToggle()}
          {showDebug && renderPersonalisationDebug(selectedProduct)}
          {showDebug && renderCartDebug()}
          {showDebug && renderProductDebug()}
          {showDebug && renderDebugHeader()}
        </s-stack>
      </s-scroll-box>
    </s-page>;
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
  if (screen === 'bundleBuilder') {
    return renderBundleBuilderScreen();
  }
  return renderClubsScreen();
}
