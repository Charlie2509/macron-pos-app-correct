import "@shopify/ui-extensions/preact";
import {isNativeHandoverBundle, isNativeHandoverProduct} from "./flow-pilot.js";
import {verifiedKitHandover} from "../../../flow/msh-handover/plan.mjs";
import {useNativeHandoverSetting} from "./handover-setting.js";
import {render} from 'preact';
import {CatalogueGrid, OptionButtons, RangeSearch, catalogueLabel, matchesSaleSearch} from './SaleControls';
import {useEffect, useRef, useState} from 'preact/hooks';
import {allVariantEdges, createRangeLoader, nextCatalogueCursor, readCatalogue} from './catalogue.js';
import {buildBundleComponents, prepareBundleComponents} from './bundle-components.js';
import {confirmCartState, hasProperties, writeOrderMarkers} from './cart-properties.js';
import {feeProductHandle, feeProductTitle, findFeeVariant} from './fee-variant.js';

const pendingCartAdds = new WeakSet();

// File with live data debug instrumentation, bundle plumbing, personalisation meta debug, and navigation/cart flows.

// ---------------- Macron POS backend (Render) ----------------
// MUST be absolute. POS UI extensions do not resolve relative URLs to the app
// host reliably -- relative URLs can be silently dropped after the OPTIONS
// preflight, which is exactly the failure mode that caused take_today orders
// to never auto-fulfil. Always use this constant for backend POSTs.
var MACRON_POS_BACKEND_URL = 'https://macron-pos-app-correct.onrender.com';
var MACRON_POS_INTENT_ENDPOINT = MACRON_POS_BACKEND_URL + '/api/macron-pos/intent';

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

var REQUIRED_NORMAL_PRODUCT_METADATA_KEYS = [
  '_msh_source',
  '_msh_fulfilment_mode',
  '_msh_fulfillment_mode',
  '_msh_take_now',
  '_msh_intent_product_title',
  '_msh_intent_variant_title',
  '_msh_intent_variant_id',
  '_msh_intent_quantity',
  '_msh_intent_source',
  '_msh_intent_fulfilment_mode',
  '_msh_intent_fulfillment_mode',
  '_msh_intent_take_now',
  '_msh_intent_created_at',
  '_msh_fallback_source',
  '_msh_fallback_fulfilment_mode',
  '_msh_fallback_fulfillment_mode',
  '_msh_fallback_take_now',
];

function findMissingNormalProductMetadataKeys(rawProperties) {
  var properties = sanitizeLineItemProperties(rawProperties);
  var missing = [];
  for (var i = 0; i < REQUIRED_NORMAL_PRODUCT_METADATA_KEYS.length; i += 1) {
    var key = REQUIRED_NORMAL_PRODUCT_METADATA_KEYS[i];
    if (toStr(properties[key]) === '') {
      missing.push(key);
    }
  }
  return missing;
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

function buildMshFallbackMarkerProperties(rawProperties) {
  var properties = sanitizeLineItemProperties(rawProperties);
  var source = toStr(properties._msh_source);
  var mode = toStr(properties._msh_fulfilment_mode || properties._msh_fulfillment_mode);
  var takeNow = toStr(properties._msh_take_now);
  var fallback = {};
  if (source !== '') {
    fallback._msh_fallback_source = source;
  }
  if (mode !== '') {
    fallback._msh_fallback_fulfilment_mode = mode;
  }
  if (takeNow !== '') {
    fallback._msh_fallback_take_now = takeNow;
  }
  var bundleSummary = toStr(properties['Bundle Take Now Summary'] || properties['Bundle Order Later Summary'] || properties['Bundle Summary']);
  if (bundleSummary !== '') {
    fallback._msh_fallback_bundle_summary = bundleSummary;
  }
  return fallback;
}

function buildMshOrderFallbackProperties(rawProperties, bundleAttachConfig) {
  var properties = sanitizeLineItemProperties(rawProperties);
  var source = toStr(properties._msh_source);
  var mode = toStr(properties._msh_fulfilment_mode || properties._msh_fulfillment_mode);
  var takeNow = toStr(properties._msh_take_now);
  var orderFallback = {};
  if (properties._msh_handover_owner === 'flow_v1') orderFallback._msh_handover_pilot_seen = 'flow_v1';

  if (source !== '') {
    orderFallback._msh_order_source = source;
  }
  if (mode !== '') {
    orderFallback._msh_order_fulfilment_mode = mode;
    orderFallback._msh_order_fulfillment_mode = mode;
  }
  if (takeNow !== '') {
    orderFallback._msh_order_take_now = takeNow;
  }

  var bundleSummary = '';
  if (bundleAttachConfig && bundleAttachConfig.enabled && bundleAttachConfig.readableProperties) {
    var readableProps = sanitizeLineItemProperties(bundleAttachConfig.readableProperties);
    bundleSummary = toStr(readableProps['Bundle Take Now Summary'] || readableProps['Bundle Summary'] || readableProps['Bundle Order Later Summary']);
  }
  if (bundleSummary === '') {
    bundleSummary = toStr(properties['Bundle Take Now Summary'] || properties['Bundle Summary'] || properties['Bundle Order Later Summary']);
  }
  if (bundleSummary !== '') {
    orderFallback._msh_order_bundle_summary = bundleSummary;
  }

  return orderFallback;
}

function sanitizeDurableTokenValue(value) {
  var text = toStr(value);
  if (text === '') {
    return '';
  }
  var compact = text.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
  compact = compact.replace(/[;[\]]+/g, '');
  if (compact.length > 80) {
    compact = compact.slice(0, 80);
  }
  return compact;
}

function buildMshDurableNoteToken(rawProperties, bundleAttachConfig) {
  var properties = sanitizeLineItemProperties(rawProperties);
  var source = sanitizeDurableTokenValue(properties._msh_source || 'macron_pos');
  var mode = sanitizeDurableTokenValue(properties._msh_fulfilment_mode || properties._msh_fulfillment_mode || 'take_today');
  var takeNow = sanitizeDurableTokenValue(properties._msh_take_now);
  var bundleSummary = '';
  if (bundleAttachConfig && bundleAttachConfig.enabled && bundleAttachConfig.readableProperties) {
    var readableProps = sanitizeLineItemProperties(bundleAttachConfig.readableProperties);
    bundleSummary = sanitizeDurableTokenValue(
      readableProps['Bundle Take Now Summary'] || readableProps['Bundle Summary'] || readableProps['Bundle Order Later Summary'],
    );
  }
  if (bundleSummary === '') {
    bundleSummary = sanitizeDurableTokenValue(
      properties['Bundle Take Now Summary'] || properties['Bundle Summary'] || properties['Bundle Order Later Summary'],
    );
  }

  var tokenParts = [
    'source=' + (source || 'macron_pos'),
    'mode=' + (mode || 'take_today'),
  ];
  if (takeNow !== '') {
    tokenParts.push('take_now=' + takeNow);
  }
  if (bundleSummary !== '') {
    tokenParts.push('bundle=' + bundleSummary);
  }
  return '[MSH_POS] ' + tokenParts.join(';');
}

function buildMshDurableNoteProperties(token) {
  var cleanToken = toStr(token);
  if (cleanToken === '') {
    return {};
  }
  return {
    note: cleanToken,
    _msh_pos_note_token: cleanToken,
  };
}

function buildPendingIntentBundleSummary(rawProperties, bundleAttachConfig) {
  var properties = sanitizeLineItemProperties(rawProperties);
  var summary = '';
  if (bundleAttachConfig && bundleAttachConfig.enabled && bundleAttachConfig.readableProperties) {
    var readableProps = sanitizeLineItemProperties(bundleAttachConfig.readableProperties);
    summary = toStr(
      readableProps['Bundle Take Now Summary'] || readableProps['Bundle Summary'] || readableProps['Bundle Order Later Summary'],
    );
  }
  if (summary === '') {
    summary = toStr(properties['Bundle Take Now Summary'] || properties['Bundle Summary'] || properties['Bundle Order Later Summary']);
  }
  return summary;
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
  if (meta.enablePersonalisation && toStr(primaryFieldValue) !== '') {
    props[meta.personalisationLabel || 'Personalisation'] = toStr(primaryFieldValue);
  }
  if (meta.extraField1Enabled && toStr(extraField1Value) !== '') {
    props[meta.extraField1Label || 'Additional information'] = toStr(extraField1Value);
  }
  if (meta.extraField2Enabled && toStr(extraField2Value) !== '') {
    props[meta.extraField2Label || 'Additional information 2'] = toStr(extraField2Value);
  }
  if (includeFeeValue !== null && includeFeeValue !== undefined) {
    var feeNumber = parseFloat(includeFeeValue);
    if (!isNaN(feeNumber) && feeNumber > 0) {
      props['Personalisation Fee'] = '£' + feeNumber.toFixed(2);
    }
  }
  return props;
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
  const nativeHandoverEnabled = useNativeHandoverSetting();
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

  var lastMainLineAddStatusState = useState('idle');
  var lastMainLineAddStatus = lastMainLineAddStatusState[0];
  var setLastMainLineAddStatus = lastMainLineAddStatusState[1];

  var lastPropertiesAttachAttemptedState = useState(false);
  var lastPropertiesAttachAttempted = lastPropertiesAttachAttemptedState[0];
  var setLastPropertiesAttachAttempted = lastPropertiesAttachAttemptedState[1];

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

  var lastRollbackAttemptedState = useState(false);
  var lastRollbackAttempted = lastRollbackAttemptedState[0];
  var setLastRollbackAttempted = lastRollbackAttemptedState[1];

  var lastRollbackStatusState = useState('idle');
  var lastRollbackStatus = lastRollbackStatusState[0];
  var setLastRollbackStatus = lastRollbackStatusState[1];

  var lastRollbackDetailState = useState('');
  var lastRollbackDetail = lastRollbackDetailState[0];
  var setLastRollbackDetail = lastRollbackDetailState[1];

  var lastRollbackMainLineRemovedState = useState(false);
  var lastRollbackMainLineRemoved = lastRollbackMainLineRemovedState[0];
  var setLastRollbackMainLineRemoved = lastRollbackMainLineRemovedState[1];

  var lastRollbackFeeLineRemovedState = useState(false);
  var lastRollbackFeeLineRemoved = lastRollbackFeeLineRemovedState[0];
  var setLastRollbackFeeLineRemoved = lastRollbackFeeLineRemovedState[1];

  var lastPingAttemptedState = useState(false);
  var lastPingAttempted = lastPingAttemptedState[0];
  var setLastPingAttempted = lastPingAttemptedState[1];

  var lastPingStatusState = useState('');
  var lastPingStatus = lastPingStatusState[0];
  var setLastPingStatus = lastPingStatusState[1];

  var lastPingErrorState = useState('');
  var lastPingError = lastPingErrorState[0];
  var setLastPingError = lastPingErrorState[1];

  var lastIntentRequestAttemptedState = useState(false);
  var lastIntentRequestAttempted = lastIntentRequestAttemptedState[0];
  var setLastIntentRequestAttempted = lastIntentRequestAttemptedState[1];

  var lastIntentRequestStatusState = useState('');
  var lastIntentRequestStatus = lastIntentRequestStatusState[0];
  var setLastIntentRequestStatus = lastIntentRequestStatusState[1];

  var lastIntentRequestErrorState = useState('');
  var lastIntentRequestError = lastIntentRequestErrorState[0];
  var setLastIntentRequestError = lastIntentRequestErrorState[1];

  var lastEnteredPersonalisationState = useState(false);
  var lastEnteredPersonalisation = lastEnteredPersonalisationState[0];
  var setLastEnteredPersonalisation = lastEnteredPersonalisationState[1];

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
    setLastEnteredPersonalisation(enteredPersonalisation);

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

  function getCartLineItemsSnapshot() {
    if (typeof shopify === 'undefined') {
      return [];
    }
    if (!shopify.cart || !shopify.cart.current || !shopify.cart.current.value) {
      return [];
    }
    var lines = shopify.cart.current.value.lineItems;
    if (!lines || !Array.isArray(lines)) {
      return [];
    }
    return lines;
  }

  function findCartLineByUuid(lineUuid) {
    var target = toStr(lineUuid);
    if (target === '') {
      return null;
    }
    var lines = getCartLineItemsSnapshot();
    for (var i = 0; i < lines.length; i += 1) {
      var line = lines[i];
      var candidate = toStr(line && (line.uuid || line.id || line.lineItemUuid));
      if (candidate === target) {
        return line;
      }
    }
    return null;
  }

  function countLineProperties(line) {
    if (!line) {
      return 0;
    }
    if (Array.isArray(line.properties)) {
      return line.properties.length;
    }
    if (line.properties && typeof line.properties === 'object') {
      return Object.keys(line.properties).length;
    }
    return 0;
  }

  function linePropertiesToObject(line) {
    if (!line) {
      return {};
    }
    if (line.properties && typeof line.properties === 'object' && !Array.isArray(line.properties)) {
      return sanitizeLineItemProperties(line.properties);
    }
    if (Array.isArray(line.properties)) {
      var mapped = {};
      for (var i = 0; i < line.properties.length; i += 1) {
        var entry = line.properties[i];
        if (!entry) continue;
        var key = toStr(entry.name || entry.key);
        var value = toStr(entry.value);
        if (key !== '' && value !== '') {
          mapped[key] = value;
        }
      }
      return sanitizeLineItemProperties(mapped);
    }
    if (Array.isArray(line.customAttributes)) {
      var customMapped = {};
      for (var c = 0; c < line.customAttributes.length; c += 1) {
        var attr = line.customAttributes[c];
        if (!attr) continue;
        var attrKey = toStr(attr.key || attr.name);
        var attrValue = toStr(attr.value);
        if (attrKey !== '' && attrValue !== '') {
          customMapped[attrKey] = attrValue;
        }
      }
      return sanitizeLineItemProperties(customMapped);
    }
    return {};
  }

  async function createPendingMacronPosIntent(payload) {
    if (typeof fetch === 'undefined') {
      console.error('[MSH-POS-INTENT][ERROR] pending intent failed | reason=fetch_unavailable');
      return {ok: false, error: 'fetch_unavailable'};
    }

    // Always send shop when we can discover it; backend will fall back to
    // single-known-shop if missing, but explicit is safer in multi-store envs.
    var enrichedPayload = {};
    var srcKeys = Object.keys(payload || {});
    for (var k = 0; k < srcKeys.length; k += 1) {
      enrichedPayload[srcKeys[k]] = payload[srcKeys[k]];
    }
    if (!enrichedPayload.shop) {
      var discoveredShop = safeReadShopDomain();
      if (discoveredShop) {
        enrichedPayload.shop = discoveredShop;
      }
    }
    if (!enrichedPayload.source) {
      enrichedPayload.source = 'macron_pos';
    }

    var endpoint = MACRON_POS_INTENT_ENDPOINT;

    var response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify(enrichedPayload),
      });
    } catch (requestErr) {
      var networkMessage = requestErr && requestErr.message ? requestErr.message : String(requestErr);
      console.error('[MSH-POS-INTENT][ERROR] pending intent failed | network_error', {
        endpoint: endpoint,
        message: networkMessage,
      });
      return {ok: false, error: 'network_error: ' + networkMessage};
    }

    var status = response && typeof response.status === 'number' ? response.status : 0;
    var json = null;
    try {
      json = await response.json();
    } catch (parseErr) {
      console.error('[MSH-POS-INTENT][ERROR] pending intent failed | invalid_json_response', {
        endpoint: endpoint,
        status: status,
        message: parseErr && parseErr.message ? parseErr.message : String(parseErr),
      });
      return {ok: false, status: status, error: 'invalid_json_response'};
    }

    if (!response.ok || !json || json.ok !== true) {
      var errCode = json && json.error ? String(json.error) : 'pending_intent_failed';
      console.error('[MSH-POS-INTENT][ERROR] pending intent failed', {
        endpoint: endpoint,
        status: status,
        error: errCode,
      });
      return {
        ok: false,
        status: status,
        error: errCode,
      };
    }

    return {
      ok: true,
      intentId: toStr(json.intentId),
      expiresAt: toStr(json.expiresAt),
    };
  }

  async function fetchPersonalisationFeeVariant(feeAmount) {
    setLastFeeProductHandleTarget(feeProductHandle);
    setLastFeeProductTitleTarget(feeProductTitle);
    setLastFeeLookupQuery('FeeVariants: ' + feeProductHandle);
    const {productId, scanned, match} = await findFeeVariant(feeAmount);
    setLastFeeProductFound(Boolean(productId));
    setLastFeeProductId(productId || '');
    setLastFeeCandidateCount(productId ? 1 : 0);
    setLastFeeExactTitleValidationPassed(Boolean(productId));
    setLastFeeVariantScanCount(scanned);
    setLastFeeMatchMethod(match?.method || 'none');
    setLastFeeVariantTitleMatched(match?.text || '');
    setLastFeeVariantAvailableForSale(match ? true : null);
    return match?.id || null;
  }

  async function addSelectedProductToCart(product, variant, lineItemProperties, feeAmount, bundleAttachConfig) {
    const cart = typeof shopify !== 'undefined' ? shopify.cart : null;
    if (!cart) {
      toast('Cart API unavailable.');
      return false;
    }
    if (pendingCartAdds.has(cart)) return false;
    pendingCartAdds.add(cart);
    setCartAddPending(true);
    try {
      return await writeSelectedProduct(product, variant, lineItemProperties, feeAmount, bundleAttachConfig);
    } finally {
      pendingCartAdds.delete(cart);
      setCartAddPending(false);
    }
  }

  async function writeSelectedProduct(product, variant, lineItemProperties, feeAmount, bundleAttachConfig) {
    setLastCartActionStatus('idle');
    setLastCartErrorMessage('');
    setLastCartLineItemUuid('');
    setLastMainLineAddStatus('idle');
    setLastPropertiesAttachAttempted(false);
    setLastPropertiesAttachStatus('idle');
    setLastLineItemProperties({});
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
    setLastRollbackAttempted(false);
    setLastRollbackStatus('idle');
    setLastRollbackDetail('');
    setLastRollbackMainLineRemoved(false);
    setLastRollbackFeeLineRemoved(false);
    setLastPingAttempted(false);
    setLastPingStatus('skipped_direct_fetch');
    setLastPingError('');
    setLastIntentRequestAttempted(false);
    setLastIntentRequestStatus('skipped_direct_fetch');
    setLastIntentRequestError('');
    if (!bundleAttachConfig || !bundleAttachConfig.enabled) {
      setBundleParentLineAdded(false);
      setBundleParentLineUuid('');
      setBundleReadablePropertyCount(0);
      setBundleReadableAttachAttempted(false);
      setBundleReadableAttachStatus('idle');
      setBundleReadableAttachError('');
      setBundleFinalParentPropertiesCount(0);
    }

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

    var propertiesObject = sanitizeLineItemProperties(lineItemProperties);

    var expectedIncrease = 1 + (feeRequired ? 1 : 0);
    var mainUuid = '';
    var feeUuid = '';
    var feeNormalized = null;

    async function rollbackAddedLines(reason) {
      setLastRollbackAttempted(true);
      setLastRollbackStatus('attempting');
      setLastRollbackDetail(reason);
      var canRemove = shopify.cart && typeof shopify.cart.removeLineItem === 'function';
      if (!canRemove) {
        setLastRollbackStatus('failed');
        setLastRollbackDetail(reason + ' | rollback failed: Cart API missing removeLineItem');
        return false;
      }
      var rollbackErrors = [];
      if (feeUuid) {
        try {
          await shopify.cart.removeLineItem(feeUuid);
          setLastRollbackFeeLineRemoved(true);
        } catch (feeRemoveErr) {
          rollbackErrors.push('fee remove failed: ' + (feeRemoveErr && feeRemoveErr.message ? feeRemoveErr.message : 'unknown'));
        }
      }
      if (mainUuid) {
        try {
          await shopify.cart.removeLineItem(mainUuid);
          setLastRollbackMainLineRemoved(true);
        } catch (mainRemoveErr) {
          rollbackErrors.push('main remove failed: ' + (mainRemoveErr && mainRemoveErr.message ? mainRemoveErr.message : 'unknown'));
        }
      }
      if (rollbackErrors.length > 0) {
        setLastRollbackStatus('failed');
        setLastRollbackDetail(reason + ' | ' + rollbackErrors.join(' | '));
        return false;
      }
      setLastRollbackStatus('success');
      setLastRollbackDetail(reason + ' | rollback completed');
      return true;
    }

    try {
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

        feeNormalized = normalizeVariantId(feeVariantId);
        if (!feeNormalized.valid || feeNormalized.value === null) {
          setLastFeeVariantStatus('failed');
          setLastFeeErrorMessage('fee variant id invalid');
          setLastCartActionStatus('failed');
          toast('Fee variant id invalid.');
          return false;
        }
      } else {
        setLastFeeVariantStatus('skipped');
        setLastFeePropertiesAttachStatus('skipped');
      }

      var pendingIntentMode = toStr(propertiesObject._msh_fulfilment_mode || propertiesObject._msh_fulfillment_mode || 'take_today');
      var pendingIntentTakeNow = toStr(propertiesObject._msh_take_now);
      var pendingIntentBundleSummary = buildPendingIntentBundleSummary(propertiesObject, bundleAttachConfig);
      var derivedSplitTakeNow = pendingIntentTakeNow === 'true';
      var mainLineQuantity = 1;
      var explicitLineItemIntentProps = buildMshLineItemIntentProperties({
        mode: pendingIntentMode,
        takeNowInSplit: derivedSplitTakeNow,
        productTitle: product && product.title ? String(product.title) : 'Unknown product',
        variantTitle: variant && variant.title ? String(variant.title) : 'Unknown variant',
        normalizedVariantId: String(normalized.value),
        quantity: String(mainLineQuantity),
        hasFee: feeRequired,
        isBundle: Boolean(bundleAttachConfig && bundleAttachConfig.enabled),
        bundleSummary: pendingIntentBundleSummary || '',
      });
      const isNormalProductFlow = !bundleAttachConfig?.enabled;
      const pilotHandover = nativeHandoverEnabled && (isNormalProductFlow
        ? isNativeHandoverProduct(safeReadShopDomain(), product, variant, false, feeRequired, propertiesObject)
        : isNativeHandoverBundle(safeReadShopDomain(), product, variant, propertiesObject));
      if (pilotHandover) explicitLineItemIntentProps._msh_handover_owner = 'flow_v1';
      else delete propertiesObject._msh_handover_owner;
      var explicitIntentKeys = Object.keys(explicitLineItemIntentProps);
      for (var i = 0; i < explicitIntentKeys.length; i += 1) {
        var explicitKey = explicitIntentKeys[i];
        propertiesObject[explicitKey] = explicitLineItemIntentProps[explicitKey];
      }
      var mainLineProperties = sanitizeLineItemProperties(propertiesObject);
      if (!isNormalProductFlow && feeRequired) mainLineProperties['Linked Fee Variant Id'] = String(feeNormalized.value);
      if (isNormalProductFlow) {
        var missingNormalMetadata = findMissingNormalProductMetadataKeys(mainLineProperties);
        if (missingNormalMetadata.length > 0) {
          console.error('[MSH-POS-PRODUCT-DEBUG] CART LINE ADD RESULT', {
            ok: false,
            reason: 'missing_required_metadata',
            missingKeys: missingNormalMetadata,
          });
          toast('Macron POS product metadata missing — item not added.');
          setLastCartActionStatus('failed');
          setLastCartErrorMessage('Missing required Macron POS metadata: ' + missingNormalMetadata.join(', '));
          return false;
        }
      }
      var fallbackMarkerProperties = buildMshFallbackMarkerProperties(mainLineProperties);
      Object.assign(mainLineProperties, fallbackMarkerProperties);
      setLastLineItemProperties(mainLineProperties);
      var orderFallbackProperties = buildMshOrderFallbackProperties(mainLineProperties, bundleAttachConfig);
      var durableNoteToken = buildMshDurableNoteToken(mainLineProperties, bundleAttachConfig);
      var durableNoteProperties = buildMshDurableNoteProperties(durableNoteToken);
      var fallbackMarkerKeyCount = Object.keys(fallbackMarkerProperties).length;
      setLastPingAttempted(false);
      setLastPingStatus('skipped_direct_fetch');
      setLastPingError('');
      // Legacy orders keep their Render intent as a fallback if Shopify drops
      // line properties. Pilot items proceed only after their exact Shopify
      // line and cart ownership markers have both been confirmed.
      var pendingIntentResult = {ok: false, status: 'not_attempted'};
      var pendingIntentIsBundleFlow = !isNormalProductFlow;
      var pendingIntentPayload = {
        source: 'macron_pos',
        fulfillmentMode: pendingIntentMode,
        takeNow: pendingIntentTakeNow,
        productTitle: product && product.title ? String(product.title) : 'Unknown product',
        variantTitle: variant && variant.title ? String(variant.title) : 'Unknown variant',
        normalizedVariantId: String(normalized.value),
        quantity: String(mainLineQuantity),
        hasFee: feeRequired,
        isBundle: pendingIntentIsBundleFlow,
        bundleSummary: pendingIntentIsBundleFlow ? (pendingIntentBundleSummary || '') : '',
        createdAtClient: new Date().toISOString(),
      };
      const savePendingIntent = async () => {
        setLastIntentRequestAttempted(true);
        setLastIntentRequestStatus('attempting');
        setLastIntentRequestError('');
        pendingIntentResult = await createPendingMacronPosIntent(pendingIntentPayload);
        if (pendingIntentResult.ok) {
          setLastIntentRequestStatus('success');
        } else {
          setLastIntentRequestStatus('failed');
          setLastIntentRequestError(pendingIntentResult.error ? String(pendingIntentResult.error) : 'pending_intent_failed');
          console.error('[MSH POS] Pending handover could not be saved.');

          // Hard-fail visibly for take_today orders. Silent failure on the
          // intent save is exactly the bug that caused unfulfilled orders --
          // the POS extension MUST surface it instead of swallowing.
          var isTakeTodayIntent = pendingIntentMode === 'take_today' || pendingIntentTakeNow === 'true';
          if (isTakeTodayIntent) {
            toast('Macron POS: take-today intent could not be saved. Auto-fulfilment may fail.');
          }
        }
      };

      if (pilotHandover) {
        setLastIntentRequestStatus('shopify_flow');
      } else if (isNormalProductFlow) {
        await savePendingIntent();
      }

      const requiresNewLine = pilotHandover || !isNormalProductFlow;
      const linesAtAdd = shopify.cart.current?.value?.lineItems;
      const existingLineIds = new Set(Array.isArray(linesAtAdd) ? linesAtAdd.map(line => line?.uuid) : []);
      if (requiresNewLine && (!Array.isArray(linesAtAdd) || linesAtAdd.some(line => !line?.uuid))) {
        toast('Cart is still updating. Check the POS cart before adding this item.');
        setLastCartActionStatus('failed');
        return false;
      }
      if (requiresNewLine && linesAtAdd.some(line => {
        if (Number(line.variantId) !== normalized.value) return false;
        const labels = linePropertiesToObject(line);
        return labels._msh_source !== 'macron_pos' || !['take_today','order_in','split'].includes(labels._msh_fulfilment_mode);
      })) {
        toast('This size is already in the cart without a handover choice. Review that line before adding another.');
        setLastCartActionStatus('failed');
        setLastCartErrorMessage('Existing unlabelled variant; no item added');
        return false;
      }
      setLastMainLineAddStatus('attempting');
      try {
        mainUuid = await shopify.cart.addLineItem(normalized.value, mainLineQuantity);
        setLastMainLineAddStatus('success');
      } catch (mainAddErr) {
        setLastMainLineAddStatus('failed');
        console.error('[BundleAdd] main addLineItem error message=', mainAddErr && mainAddErr.message ? mainAddErr.message : String(mainAddErr));
        throw mainAddErr;
      }
      setLastCartLineItemUuid(mainUuid ? String(mainUuid) : '');
      if (!mainUuid) {
        toast('Could not add to cart.');
        setLastCartActionStatus('failed');
        setLastCartErrorMessage('Cart API returned no line item uuid');
        return false;
      }

      if (existingLineIds.has(mainUuid) && (requiresNewLine || linePropertiesToObject(findCartLineByUuid(mainUuid)).Bundle)) {
        // Shopify merged this addition. Re-labelling or deleting the returned
        // UUID here would also change the customer's earlier units.
        toast('This line’s quantity may have increased. Check its quantity and handover in the cart before checkout or adding it again.');
        setLastCartActionStatus('failed');
        setLastCartErrorMessage('Existing cart line returned; handover needs review');
        return false;
      }

      setLastPropertiesAttachAttempted(true);
      var linePropertyAttachOk = false;
      if (shopify.cart && typeof shopify.cart.addLineItemProperties === 'function') {
        try {
          await shopify.cart.addLineItemProperties(mainUuid, mainLineProperties);
          linePropertyAttachOk = true;
          setLastPropertiesAttachStatus('success');
        } catch (mainPropsErr) {
          setLastPropertiesAttachStatus('failed');
          console.error('[MSH POS DEBUG] LINE ITEM PROPERTIES ATTACH FAILURE', mainPropsErr && mainPropsErr.message ? mainPropsErr.message : String(mainPropsErr));
          if (isNormalProductFlow) {
            console.error('[MSH-POS-PRODUCT-DEBUG] LINE PROPERTIES ATTACH RESULT', {
              ok: false,
              reason: 'attach_properties_failed',
              message: mainPropsErr && mainPropsErr.message ? mainPropsErr.message : String(mainPropsErr),
            });
          }
          if (isNormalProductFlow && !pendingIntentResult.ok) {
            await rollbackAddedLines('normal product metadata persistence failed (attach + pending intent)');
            toast('Macron POS metadata failed — item not added safely.');
            setLastCartActionStatus('failed');
            setLastCartErrorMessage('normal product metadata persistence failed');
            return false;
          }
        }
      } else {
        setLastPropertiesAttachStatus('failed');
        console.error('[MSH POS DEBUG] LINE ITEM PROPERTIES ATTACH FAILURE', 'Cart API missing addLineItemProperties');
        if (isNormalProductFlow) {
          console.error('[MSH-POS-PRODUCT-DEBUG] LINE PROPERTIES ATTACH RESULT', {
            ok: false,
            reason: 'missing_addLineItemProperties_api',
          });
        }
        if (isNormalProductFlow && !pendingIntentResult.ok) {
          await rollbackAddedLines('normal product metadata persistence failed (missing addLineItemProperties + pending intent)');
          toast('Macron POS metadata failed — item not added safely.');
          setLastCartActionStatus('failed');
          setLastCartErrorMessage('missing addLineItemProperties and pending intent creation failed');
          return false;
        }
      }
      if (isNormalProductFlow && !linePropertyAttachOk && pendingIntentResult.ok) {
        console.warn('[MSH-POS-PRODUCT-DEBUG] LINE PROPERTIES ATTACH RESULT', {
          ok: false,
          reason: 'line_property_attach_unavailable_or_failed_using_pending_intent',
          pendingIntentId: pendingIntentResult.intentId || '',
        });
      }
      // When these values already exist on the exact added line the first
      // property write has also persisted the fallback. Stale or stripped
      // properties still use the dedicated retry below.
      if (fallbackMarkerKeyCount > 0 && !hasProperties(linePropertiesToObject(findCartLineByUuid(mainUuid)), fallbackMarkerProperties)) {
        if (shopify.cart && typeof shopify.cart.addLineItemProperties === 'function') {
          try {
            await shopify.cart.addLineItemProperties(mainUuid, fallbackMarkerProperties);
          } catch (fallbackErr) {
            console.error(
              '[MSH Marker] fallback_marker write=failed error=',
              fallbackErr && fallbackErr.message ? fallbackErr.message : String(fallbackErr),
            );
          }
        } else {
          console.error('[MSH Marker] fallback_marker write=skipped error=Cart API missing addLineItemProperties');
        }
      }

      if (isNormalProductFlow) await writeOrderMarkers(shopify.cart, orderFallbackProperties, durableNoteProperties);

      const matchesMainLine = state => {
        const line = state?.lineItems?.find(item => item.uuid === mainUuid);
        return Number(line?.variantId) === normalized.value && line.quantity === mainLineQuantity &&
          hasProperties(linePropertiesToObject(line), mainLineProperties);
      };

      if (bundleAttachConfig && bundleAttachConfig.enabled) {
        setBundleParentLineAdded(true);
        setBundleParentLineUuid(String(mainUuid));
        setBundleReadablePropertyCount(Object.keys(bundleAttachConfig.readableProperties).length);
        setBundleReadableAttachAttempted(true);
        if (!matchesMainLine(shopify.cart.current?.value)) {
          try {
            await shopify.cart.addLineItemProperties(mainUuid, mainLineProperties);
          } catch (error) {
            console.warn('[MSH POS] Could not retry the kit handover properties.');
          }
          if (!await confirmCartState(shopify.cart.current, matchesMainLine)) {
            await rollbackAddedLines('Kit handover could not be confirmed on its own cart line.');
            setBundleReadableAttachStatus('failed');
            setBundleReadableAttachError('Kit handover could not be verified.');
            setLastCartActionStatus('failed');
            toast('Kit handover could not be saved. Check the POS cart before checkout or retrying.');
            return false;
          }
        }
        setBundleReadableAttachStatus('success');
        setBundleReadableAttachError('');
        setBundleFinalParentPropertiesCount(countLineProperties(findCartLineByUuid(mainUuid)));
      }

      if (feeRequired) {
        setLastFeeLineAddAttempted(true);
        setLastFeeLineAddStatus('attempting');
        try {
          feeUuid = await shopify.cart.addLineItem(feeNormalized.value, 1);
          setLastFeeLineItemUuid(feeUuid ? String(feeUuid) : '');
          if (!feeUuid) {
            setLastFeeVariantStatus('failed');
            setLastFeeErrorMessage('fee addLineItem failed: cart add returned no uuid');
            setLastFeeLineAddStatus('failed');
            await rollbackAddedLines('fee addLineItem returned no uuid');
            setLastCartActionStatus('failed');
            toast('Fee line could not be added.');
            return false;
          }
          if (!isNormalProductFlow && (feeUuid === mainUuid || existingLineIds.has(feeUuid))) {
            // Never relabel or delete a fee already present from another sale line.
            feeUuid = '';
            await rollbackAddedLines('Shopify reused an existing line for the kit fee.');
            setLastCartActionStatus('failed');
            toast('An existing line’s quantity may have increased. Check the kit and fee in the POS cart before checkout.');
            return false;
          }
          setLastFeeLineAddStatus('success');
        } catch (feeAddErr) {
          setLastFeeVariantStatus('failed');
          setLastFeeErrorMessage('fee addLineItem failed: ' + (feeAddErr && feeAddErr.message ? feeAddErr.message : 'unknown add error'));
          setLastFeeLineAddStatus('failed');
          await rollbackAddedLines('fee addLineItem threw error');
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
            await rollbackAddedLines('fee addLineItemProperties failed');
            setLastCartActionStatus('failed');
            toast('Fee line added without properties.');
            return false;
          }
        } else {
          setLastFeePropertiesAttachStatus('failed');
          setLastFeeVariantStatus('failed');
          setLastFeeErrorMessage('fee addLineItemProperties failed: Cart API missing addLineItemProperties for fee');
          await rollbackAddedLines('fee addLineItemProperties missing API');
          setLastCartActionStatus('failed');
          toast('Fee properties could not be attached.');
          return false;
        }

        if (isNormalProductFlow && shopify.cart && shopify.cart.addLineItemProperties) {
          try {
            await shopify.cart.addLineItemProperties(mainUuid, {
              'Linked Fee Variant Id': String(feeNormalized.value),
            });
          } catch (linkErr) {
            setLastFeeErrorMessage('fee link-back-to-main failed: ' + (linkErr && linkErr.message ? linkErr.message : 'unknown link error'));
            toast('Added to cart. Fee link-back warning only.');
          }
        }
      }

      let afterCount = cartLineCount();
      let added = afterCount >= beforeCount + expectedIncrease;
      if (!added) {
        // A successful native add can return before the cart publishes its
        // matching line. Observe its receipt rather than submitting it again.
        const receipts = feeUuid ? [[mainUuid, normalized.value], [feeUuid, feeNormalized.value]] : [[mainUuid, normalized.value]];
        added = await confirmCartState(shopify.cart.current, state => receipts.every(([uuid, variantId]) =>
          !existingLineIds.has(uuid) && state?.lineItems?.some(line => line.uuid === uuid &&
            Number(line.variantId) === variantId && line.quantity > 0)));
        afterCount = cartLineCount();
      }
      setLastCartAfterCount(afterCount);
      if (added) {
        // Only a verified kit with all its components and any fee may leave an
        // order fallback. A failed add must not become a future handover.
        if (!isNormalProductFlow) {
          if (feeRequired) {
            const feeConfirmed = await confirmCartState(shopify.cart.current, state => {
              const line = state?.lineItems?.find(item => item.uuid === feeUuid);
              const properties = linePropertiesToObject(line);
              return Number(line?.variantId) === feeNormalized.value && line.quantity === 1 &&
                !properties._msh_handover_owner && hasProperties(properties, feeProps) && matchesMainLine(state);
            });
            if (!feeConfirmed) {
              await rollbackAddedLines('Kit fee could not be verified.');
              setLastCartActionStatus('failed');
              toast('Kit fee could not be verified. Check the POS cart before checkout or retrying.');
              return false;
            }
          }
          await writeOrderMarkers(shopify.cart, orderFallbackProperties, durableNoteProperties);
          if (!pilotHandover) await savePendingIntent();
        }
        if (pilotHandover && !await confirmCartState(shopify.cart.current, state =>
          matchesMainLine(state) && state.properties?._msh_handover_pilot_seen === 'flow_v1')) {
          await rollbackAddedLines('Shopify handover markers could not be verified');
          toast('Handover could not be verified. Check the POS cart before checkout or retrying.');
          setLastCartActionStatus('failed');
          setLastCartErrorMessage('Flow handover ownership could not be verified on this line and cart');
          return false;
        }
        toast('Added to cart. Cart lines: ' + afterCount);
        setLastCartActionStatus('success');
        setLastCartErrorMessage('');
        return true;
      }
      if (requiresNewLine) {
        await rollbackAddedLines('Protected handover cart receipt could not be verified.');
        toast('Handover could not be verified. Check the POS cart before checkout or retrying.');
        setLastCartActionStatus('failed');
        setLastCartErrorMessage('Protected handover receipt could not be verified');
        return false;
      }
      toast('Shopify returned a cart receipt. Check the POS cart before adding this item again.');
      setLastCartActionStatus('failed');
      setLastCartErrorMessage('Cart receipt could not be verified');
      return false;
    } catch (err) {
      console.error('[BundleAdd] caught error message=', err && err.message ? err.message : String(err));
      if (mainUuid || feeUuid) {
        await rollbackAddedLines('unexpected cart add failure');
      }
      toast('Could not add to cart.');
      setLastCartActionStatus('failed');
      setLastCartErrorMessage(err && err.message ? err.message : String(err));
      return false;
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
    var variantId = selectedVariant ? selectedVariant.id : '';
    return (
      <s-section heading="Cart diagnostics">
        <s-box border="base" cornerRadius="base" padding="small">
          <s-stack direction="block" gap="micro">
          <s-text size="small">Selected product: {selectedProduct ? selectedProduct.title : ''}</s-text>
          <s-text size="small">Selected variant: {selectedVariant ? selectedVariant.title : ''}</s-text>
          <s-text>Variant id: {variantId}</s-text>
          <s-text>Variant id type: {classifyVariantId(variantId)}</s-text>
          <s-text>Normalized variant id: {lastNormalizedVariantId}</s-text>
          <s-text>Product is mock: {selectedVariant ? (isMockVariant(selectedVariant.id) ? 'yes' : 'no') : ''}</s-text>
          <s-text>Cart API available: {typeof shopify !== 'undefined' && shopify.cart && shopify.cart.addLineItem ? 'yes' : 'no'}</s-text>
          <s-text>Cart line count: {cartLineCount()}</s-text>
          <s-text>Last cart before: {lastCartBeforeCount}</s-text>
          <s-text>Last cart after: {lastCartAfterCount}</s-text>
          <s-text>Last main line uuid: {lastCartLineItemUuid === '' ? 'none' : lastCartLineItemUuid}</s-text>
          <s-text>Main line add status: {lastMainLineAddStatus}</s-text>
          <s-text>Properties attach attempted: {lastPropertiesAttachAttempted ? 'yes' : 'no'}</s-text>
          <s-text>Properties attach status: {lastPropertiesAttachStatus}</s-text>
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
          <s-text>Rollback attempted: {lastRollbackAttempted ? 'yes' : 'no'}</s-text>
          <s-text>Rollback status: {lastRollbackStatus}</s-text>
          <s-text>Rollback detail: {lastRollbackDetail === '' ? 'none' : lastRollbackDetail}</s-text>
          <s-text>Main line removed during rollback: {lastRollbackMainLineRemoved ? 'yes' : 'no'}</s-text>
          <s-text>Fee line removed during rollback: {lastRollbackFeeLineRemoved ? 'yes' : 'no'}</s-text>
          <s-text>Ping attempted: {lastPingAttempted ? 'yes' : 'no'}</s-text>
          <s-text>Ping status: {lastPingStatus === '' ? 'none' : lastPingStatus}</s-text>
          <s-text>Ping error: {lastPingError === '' ? 'none' : lastPingError}</s-text>
          <s-text>Intent request attempted: {lastIntentRequestAttempted ? 'yes' : 'no'}</s-text>
          <s-text>Intent request status: {lastIntentRequestStatus === '' ? 'none' : lastIntentRequestStatus}</s-text>
          <s-text>Intent request error: {lastIntentRequestError === '' ? 'none' : lastIntentRequestError}</s-text>
          <s-text>Last cart status: {lastCartActionStatus}</s-text>
          <s-text>Last cart error: {lastCartErrorMessage === '' ? 'none' : lastCartErrorMessage}</s-text>
          <s-text>Last fee error: {lastFeeErrorMessage === '' ? 'none' : lastFeeErrorMessage}</s-text>
          <s-text size="small">Line item properties preview: {lastLineItemProperties && Object.keys(lastLineItemProperties).length > 0 ? JSON.stringify(lastLineItemProperties) : 'none'}</s-text>
          </s-stack>
        </s-box>
      </s-section>
    );
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
                setLastEnteredPersonalisation(false);
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
      setLastEnteredPersonalisation(enteredPersonalisation);
      var parsedFeeAmount = parseFeeAmount(meta.personalisationFeeRaw);
      var feeAmount = null;
      if (enteredPersonalisation && parsedFeeAmount !== null && parsedFeeAmount > 0) {
        feeAmount = parsedFeeAmount;
      }
      var props = buildPersonalisationProperties(meta, primaryFieldValue, extraField1Value, extraField2Value, feeAmount);
      var mshIntentProps = buildMshIntentProperties(fulfilmentMode, splitTakeNow);
      var mshIntentKeys = Object.keys(mshIntentProps);
      for (var m = 0; m < mshIntentKeys.length; m += 1) {
        props[mshIntentKeys[m]] = mshIntentProps[mshIntentKeys[m]];
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
