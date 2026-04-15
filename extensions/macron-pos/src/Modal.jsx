import "@shopify/ui-extensions/preact";
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
    {id: 'comp-tee', handle: 'comp-tee', title: 'Training Tee', variants: mockVariants('comp-tee')},
    {id: 'comp-shorts', handle: 'comp-shorts', title: 'Training Shorts', variants: mockVariants('comp-shorts')},
    {id: 'comp-socks', handle: 'comp-socks', title: 'Socks', variants: mockVariants('comp-socks')},
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
    _msh_intent_take_now: baseIntent._msh_take_now,
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

  if (source !== '') {
    orderFallback._msh_order_source = source;
  }
  if (mode !== '') {
    orderFallback._msh_order_fulfilment_mode = mode;
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

function bundleComponentLineText(index, componentTitle, variantTitle) {
  return String(index) + '. ' + toStr(componentTitle) + ' — ' + toStr(variantTitle);
}

function buildBundleGroupedSummaryValue(lines) {
  if (!lines || lines.length === 0) {
    return '';
  }
  return '- ' + lines.join('\n- ');
}

function buildBundleComponentSummaryLine(componentTitle, variantTitle) {
  return toStr(componentTitle) + ' — ' + toStr(variantTitle);
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
  var props = {};
  props.Bundle = toStr(bundleTitle);
  var mode = fulfilmentMode === 'order_in' || fulfilmentMode === 'split' ? fulfilmentMode : 'take_today';
  var takeNowSummaryLines = [];
  var orderLaterSummaryLines = [];
  for (var i = 0; i < components.length; i += 1) {
    var item = components[i];
    var selected = selections[item.key];
    if (!selected) {
      continue;
    }
    props['Item ' + String(i + 1)] = item.title + ' — ' + selected.title;
    var componentFulfilment = 'take_now';
    if (mode === 'order_in') {
      componentFulfilment = 'order_later';
    } else if (mode === 'split') {
      var explicit = fulfilmentByComponent[item.key];
      componentFulfilment = explicit === 'order_later' ? 'order_later' : 'take_now';
    }
    props['Bundle Component ' + String(i + 1) + ' Fulfilment'] = componentFulfilment;
    var summaryLine = buildBundleComponentSummaryLine(item.title, selected.title);
    if (componentFulfilment === 'order_later') {
      orderLaterSummaryLines.push(summaryLine);
    } else {
      takeNowSummaryLines.push(summaryLine);
    }
  }
  if (takeNowSummaryLines.length > 0) {
    props['Bundle Take Now Summary'] = buildBundleGroupedSummaryValue(takeNowSummaryLines);
  }
  if (orderLaterSummaryLines.length > 0) {
    props['Bundle Order Later Summary'] = buildBundleGroupedSummaryValue(orderLaterSummaryLines);
  }
  if (personalisationProps && typeof personalisationProps === 'object') {
    var personalisationKeys = Object.keys(personalisationProps);
    for (var p = 0; p < personalisationKeys.length; p += 1) {
      var personalisationKey = personalisationKeys[p];
      props[personalisationKey] = personalisationProps[personalisationKey];
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
        list.push({id: edge.node.id, title: edge.node.title, selectedOptions: selectedOptions, optionMap: optionMap});
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
    var productImage = null;
    if (node.featuredImage && node.featuredImage.url) {
      productImage = node.featuredImage.url;
    } else if (node.images && node.images.edges && node.images.edges[0] && node.images.edges[0].node && node.images.edges[0].node.url) {
      productImage = node.images.edges[0].node.url;
    }
    products.push({
      id: node.id,
      title: node.title,
      imageUrl: productImage,
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
            url
          }
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
            featuredImage {
              url
            }
            images(first: 1) {
              edges {
                node {
                  url
                }
              }
            }
            variants(first: 20) {
              edges {
                node {
                  id
                  title
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
          imageUrl: edges[i].node.featuredImage && edges[i].node.featuredImage.url
            ? edges[i].node.featuredImage.url
            : (edges[i].node.images &&
              edges[i].node.images.edges &&
              edges[i].node.images.edges[0] &&
              edges[i].node.images.edges[0].node &&
              edges[i].node.images.edges[0].node.url
              ? edges[i].node.images.edges[0].node.url
              : ''),
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

  var byHandleQuery = 'query BundleComponentByHandle($handle: String!) { productByHandle(handle: $handle) { id title handle variants(first: 50) { edges { node { id title } } } } }';
  var byGidQuery = 'query BundleComponentByGid($id: ID!) { node(id: $id) { ... on Product { id title handle variants(first: 50) { edges { node { id title } } } } } }';
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
      var query = normalized.type === 'product_gid' ? byGidQuery : byHandleQuery;
      var variables = normalized.type === 'product_gid' ? {id: normalized.value} : {handle: normalized.value};
      var response = await fetch('shopify:admin/api/graphql.json', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query: query,
          variables: variables,
        }),
      });

      if (!response || !response.ok) {
        result.unresolvedRefs.push(ref);
        result.errors.push('Bundle component fetch HTTP error for ref "' + ref + '"');
        continue;
      }

      var json = await response.json();
      if (json && json.errors && Array.isArray(json.errors) && json.errors.length > 0) {
        result.unresolvedRefs.push(ref);
        result.errors.push('Bundle component GraphQL error for ref "' + ref + '": ' + (json.errors[0] && json.errors[0].message ? json.errors[0].message : 'unknown error'));
        continue;
      }
      var productNode = null;
      if (normalized.type === 'product_gid') {
        productNode = json && json.data && json.data.node ? json.data.node : null;
      } else {
        productNode = json && json.data && json.data.productByHandle ? json.data.productByHandle : null;
      }
      if (!productNode) {
        result.unresolvedRefs.push(ref);
        continue;
      }
      result.productsByReference[ref] = {
        id: productNode.id,
        handle: toStr(productNode.handle),
        title: productNode.title,
        variants: mapVariants(productNode.variants && productNode.variants.edges ? productNode.variants.edges : []),
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
var collectionProductsRequestCache = {};

async function getCollectionProductsCached(collectionId) {
  if (!collectionId) {
    return [];
  }
  if (!collectionProductsRequestCache[collectionId]) {
    collectionProductsRequestCache[collectionId] = fetchProductsForCollection(collectionId).then(function (products) {
      return products || [];
    }).catch(function (err) {
      delete collectionProductsRequestCache[collectionId];
      throw err;
    });
  }
  return collectionProductsRequestCache[collectionId];
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

  var productsCacheState = useState({});
  var productsCache = productsCacheState[0];
  var setProductsCache = productsCacheState[1];

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

  async function loadProductsForCollection(collectionId) {
    if (!collectionId) {
      return;
    }
    if (productsCache[collectionId] && Array.isArray(productsCache[collectionId])) {
      setCurrentProductsCollectionId(collectionId);
      setCurrentProducts(productsCache[collectionId]);
      setProductListLoading(false);
      return;
    }
    setProductListLoading(true);
    setCurrentProducts(currentProductsCollectionId === collectionId ? currentProducts : []);
    setCurrentProductsCollectionId(collectionId);
    try {
      var products = await getCollectionProductsCached(collectionId);
      setCurrentProducts(products);
      setProductsCache(function (previousCache) {
        var nextCache = {};
        var previousKeys = Object.keys(previousCache || {});
        for (var k = 0; k < previousKeys.length; k += 1) {
          nextCache[previousKeys[k]] = previousCache[previousKeys[k]];
        }
        nextCache[collectionId] = products;
        return nextCache;
      });
    } catch (err) {
      setErrorMessage(err && err.message ? err.message : String(err));
      setCurrentProducts([]);
    }
    setProductListLoading(false);
  }


  useEffect(function () {
    if (dataSource !== 'Live data') {
      return;
    }
    if (screen !== 'subsections') {
      return;
    }
    if (!selectedClub || !selectedClub.subsections || !Array.isArray(selectedClub.subsections)) {
      return;
    }
    function warmSubsectionCollection(subsectionCollectionId) {
      if (!subsectionCollectionId) {
        return;
      }
      if (productsCache[subsectionCollectionId] && Array.isArray(productsCache[subsectionCollectionId])) {
        return;
      }
      getCollectionProductsCached(subsectionCollectionId).then(function (products) {
        setProductsCache(function (previousCache) {
          var nextCache = {};
          var previousKeys = Object.keys(previousCache || {});
          for (var p = 0; p < previousKeys.length; p += 1) {
            nextCache[previousKeys[p]] = previousCache[previousKeys[p]];
          }
          if (!nextCache[subsectionCollectionId]) {
            nextCache[subsectionCollectionId] = products;
          }
          return nextCache;
        });
      }).catch(function () {
        return null;
      });
    }
    for (var i = 0; i < selectedClub.subsections.length; i += 1) {
      var subsection = selectedClub.subsections[i];
      warmSubsectionCollection(subsection && subsection.collectionId ? subsection.collectionId : null);
    }
  }, [dataSource, screen, selectedClub, productsCache]);

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
    setSelectedOptionValues({});
    setPrimaryFieldValue('');
    setExtraField1Value('');
    setExtraField2Value('');
    setCurrentProducts([]);
    setCurrentProductsCollectionId(null);
    setProductListLoading(false);
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
          var foundKey = toStr(found.handle);
          loaded.push({
            key: foundKey !== '' ? foundKey : found.id,
            id: found.id,
            handle: found.handle,
            title: found.title,
            variants: found.variants || [],
          });
        } else if (fallbackAny) {
          var fallbackAnyHandle = fallbackAny && fallbackAny.handle ? toStr(fallbackAny.handle) : '';
          var fallbackAnyId = fallbackAny && fallbackAny.id ? toStr(fallbackAny.id) : '';
          loaded.push({
            key: fallbackAnyHandle !== '' ? fallbackAnyHandle : fallbackAnyId,
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
          key: componentHandle !== '' ? componentHandle : component.id,
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

    if (loaded.length === 0) {
      setBundleError('No bundle components could be loaded');
    }
    setBundleComponents(loaded);
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
    if (!bundleComponents || bundleComponents.length === 0) {
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

    console.log('[BundleAdd] mode=', fulfilmentMode, 'componentCount=', bundleComponents.length);
    for (var idx = 0; idx < bundleComponents.length; idx += 1) {
      var item = bundleComponents[idx];
      var selected = bundleSelections[item.key];
      var selectedComponentFulfilment = bundleComponentFulfilment[item.key];
      var componentFulfilment = defaultBundleComponentFulfilment(fulfilmentMode);
      if (fulfilmentMode === 'split') {
        componentFulfilment = selectedComponentFulfilment;
        if (componentFulfilment !== 'take_now' && componentFulfilment !== 'order_later') {
          toast('Select fulfilment for each bundle component');
          setBundleAddStatus('failed');
          setBundleAddError('Missing split fulfilment for component: ' + item.title);
          return;
        }
      } else if (fulfilmentMode === 'order_in') {
        componentFulfilment = 'order_later';
      } else {
        componentFulfilment = 'take_now';
      }
      var fulfilmentKey = 'Bundle Component ' + String(idx + 1) + ' Fulfilment';
      console.log(
        '[BundleAdd] component',
        idx + 1,
        'title=',
        item.title,
        'variant=',
        selected ? selected.title : '',
        'state=',
        selectedComponentFulfilment,
        'property=',
        fulfilmentKey,
        '=>',
        componentFulfilment
      );
    }

    var personalisationProps = buildPersonalisationProperties(
      personalisationMeta,
      primaryFieldValue,
      extraField1Value,
      extraField2Value,
      bundleFeeAmount
    );
    var bundleProps = buildBundleReadableProperties(
      selectedProduct.title,
      bundleComponents,
      bundleSelections,
      bundleComponentFulfilment,
      fulfilmentMode,
      personalisationProps
    );
    var mshIntentProps = buildBundleMshIntentProperties(fulfilmentMode);
    var mshKeys = Object.keys(mshIntentProps);
    for (var mk = 0; mk < mshKeys.length; mk += 1) {
      bundleProps[mshKeys[mk]] = mshIntentProps[mshKeys[mk]];
    }
    var sanitizedBundleProps = sanitizeLineItemProperties(bundleProps);
    console.log('[BundleAdd] parentTitle=', selectedProduct.title);
    console.log('[BundleAdd] selectedParentVariantId(raw)=', parentVariant.id);
    console.log('[BundleAdd] selectedParentVariantId(normalized)=', normalizedParentVariant.value);
    console.log('[BundleAdd] rawBundleProperties=', bundleProps);
    console.log('[BundleAdd] sanitizedBundleProperties=', sanitizedBundleProps);

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
    if (dataSource === 'Mock data') {
      setProductListLoading(false);
      setCurrentProducts(club.products || []);
      setCurrentProductsCollectionId(club.collectionId ? club.collectionId : club.name);
      setScreen('products');
      return;
    }
    if (club.collectionId && productsCache[club.collectionId] && Array.isArray(productsCache[club.collectionId])) {
      setCurrentProducts(productsCache[club.collectionId]);
      setProductListLoading(false);
    } else {
      setCurrentProducts([]);
      setProductListLoading(true);
    }
    setCurrentProductsCollectionId(club.collectionId ? club.collectionId : club.name);
    setScreen('products');
    await loadProductsForCollection(club.collectionId);
  }

  async function handleSubsectionPress(subsection) {
    setSelectedSubsection(subsection);
    setSelectedProduct(null);
    setSelectedVariant(null);
    setSelectedOptionValues({});
    resetBundleBuilderState();
    if (dataSource === 'Mock data') {
      setProductListLoading(false);
      setCurrentProducts(subsection.products || []);
      setCurrentProductsCollectionId(subsection.collectionId ? subsection.collectionId : subsection.label);
      setScreen('products');
      return;
    }
    if (subsection.collectionId && productsCache[subsection.collectionId] && Array.isArray(productsCache[subsection.collectionId])) {
      setCurrentProducts(productsCache[subsection.collectionId]);
      setProductListLoading(false);
    } else {
      setCurrentProducts([]);
      setProductListLoading(true);
    }
    setCurrentProductsCollectionId(subsection.collectionId ? subsection.collectionId : subsection.label);
    setScreen('products');
    await loadProductsForCollection(subsection.collectionId);
  }

  function handleProductPress(product) {
    setSelectedProduct(product);
    var defaultVariant = null;
    if (product && product.bundleMeta && product.bundleMeta.isBundle && Array.isArray(product.variants) && product.variants.length > 0) {
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


  async function addSelectedProductToCart(product, variant, lineItemProperties, feeAmount, bundleAttachConfig) {
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
        productTitle: product && product.title ? String(product.title) : '',
        variantTitle: variant && variant.title ? String(variant.title) : '',
        normalizedVariantId: String(normalized.value),
        quantity: String(mainLineQuantity),
        hasFee: feeRequired,
        isBundle: Boolean(bundleAttachConfig && bundleAttachConfig.enabled),
        bundleSummary: pendingIntentBundleSummary || '',
      });
      var explicitIntentKeys = Object.keys(explicitLineItemIntentProps);
      for (var i = 0; i < explicitIntentKeys.length; i += 1) {
        var explicitKey = explicitIntentKeys[i];
        propertiesObject[explicitKey] = explicitLineItemIntentProps[explicitKey];
      }
      var mainLineProperties = sanitizeLineItemProperties(propertiesObject);
      setLastLineItemProperties(mainLineProperties);
      var fallbackMarkerProperties = buildMshFallbackMarkerProperties(mainLineProperties);
      var orderFallbackProperties = buildMshOrderFallbackProperties(mainLineProperties, bundleAttachConfig);
      var durableNoteToken = buildMshDurableNoteToken(mainLineProperties, bundleAttachConfig);
      var durableNoteProperties = buildMshDurableNoteProperties(durableNoteToken);
      var fallbackMarkerKeyCount = Object.keys(fallbackMarkerProperties).length;
      var orderFallbackKeyCount = Object.keys(orderFallbackProperties).length;
      var durableNoteKeyCount = Object.keys(durableNoteProperties).length;
      setLastPingAttempted(false);
      setLastPingStatus('skipped_direct_fetch');
      setLastPingError('');
      setLastIntentRequestAttempted(false);
      setLastIntentRequestStatus('skipped_direct_fetch');
      setLastIntentRequestError('');
      console.log('PENDING_INTENT_CREATE REQUEST SKIPPED', 'reason=skipped_direct_fetch', 'intent_source=line_item_properties');

      console.log('ADDING BUNDLE WITH PROPERTIES:', propertiesObject);
      console.log('[MSH Marker] line_item_properties payload=', mainLineProperties);
      console.log('[MSH Marker] fallback_marker payload=', fallbackMarkerProperties);
      console.log('[MSH Marker] order_fallback payload=', orderFallbackProperties);
      console.log('[MSH Marker] durable_note token=', durableNoteToken);
      console.log('[MSH Marker] durable_note payload=', durableNoteProperties);
      console.log('[BundleAdd] final parent title=', product && product.title ? product.title : '');
      console.log('[BundleAdd] final normalized parent variant id=', normalized.value);
      console.log('[BundleAdd] final addLineItem args=', [normalized.value, mainLineQuantity]);
      setLastMainLineAddStatus('attempting');
      try {
        mainUuid = await shopify.cart.addLineItem(normalized.value, mainLineQuantity);
        setLastMainLineAddStatus('success');
        console.log('[MSH POS DEBUG] MAIN LINE ADDED', { uuid: mainUuid ? String(mainUuid) : '', variantId: String(normalized.value), quantity: String(mainLineQuantity) });
      } catch (mainAddErr) {
        setLastMainLineAddStatus('failed');
        console.error('[BundleAdd] main addLineItem error object=', mainAddErr);
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

      setLastPropertiesAttachAttempted(true);
      if (shopify.cart && typeof shopify.cart.addLineItemProperties === 'function') {
        console.log('[MSH POS DEBUG] LINE ITEM PROPERTIES OUTBOUND', mainLineProperties);
        try {
          await shopify.cart.addLineItemProperties(mainUuid, mainLineProperties);
          setLastPropertiesAttachStatus('success');
          console.log('[MSH POS DEBUG] LINE ITEM PROPERTIES ATTACH SUCCESS', { uuid: String(mainUuid) });
        } catch (mainPropsErr) {
          setLastPropertiesAttachStatus('failed');
          console.error('[MSH POS DEBUG] LINE ITEM PROPERTIES ATTACH FAILURE', mainPropsErr && mainPropsErr.message ? mainPropsErr.message : String(mainPropsErr));
          throw mainPropsErr;
        }
      } else {
        setLastPropertiesAttachStatus('failed');
        console.error('[MSH POS DEBUG] LINE ITEM PROPERTIES ATTACH FAILURE', 'Cart API missing addLineItemProperties');
        throw new Error('Cart API missing addLineItemProperties for main line');
      }
      if (fallbackMarkerKeyCount > 0) {
        if (shopify.cart && typeof shopify.cart.addLineItemProperties === 'function') {
          console.log('[MSH Marker] fallback_marker api=shopify.cart.addLineItemProperties line_uuid=', mainUuid);
          try {
            await shopify.cart.addLineItemProperties(mainUuid, fallbackMarkerProperties);
            console.log('[MSH Marker] fallback_marker write=success');
          } catch (fallbackErr) {
            console.error(
              '[MSH Marker] fallback_marker write=failed error=',
              fallbackErr && fallbackErr.message ? fallbackErr.message : String(fallbackErr),
            );
          }
        } else {
          console.error('[MSH Marker] fallback_marker write=skipped error=Cart API missing addLineItemProperties');
        }
      } else {
        console.log('[MSH Marker] fallback_marker write=skipped reason=no marker data');
      }

      if (orderFallbackKeyCount > 0) {
        if (shopify.cart && typeof shopify.cart.addCartProperties === 'function') {
          console.log('[MSH Marker] order_fallback api=shopify.cart.addCartProperties');
          try {
            await shopify.cart.addCartProperties(orderFallbackProperties);
            console.log('[MSH Marker] order_fallback write=success');
          } catch (orderFallbackErr) {
            console.error(
              '[MSH Marker] order_fallback write=failed error=',
              orderFallbackErr && orderFallbackErr.message ? orderFallbackErr.message : String(orderFallbackErr),
            );
          }
        } else {
          console.error('[MSH Marker] order_fallback write=skipped error=Cart API missing addCartProperties');
        }
      } else {
        console.log('[MSH Marker] order_fallback write=skipped reason=no marker data');
      }

      if (durableNoteKeyCount > 0) {
        if (shopify.cart && typeof shopify.cart.addCartProperties === 'function') {
          console.log('[MSH Marker] durable_note api=shopify.cart.addCartProperties');
          try {
            await shopify.cart.addCartProperties(durableNoteProperties);
            console.log('[MSH Marker] durable_note write=success');
          } catch (durableNoteErr) {
            console.error(
              '[MSH Marker] durable_note write=failed error=',
              durableNoteErr && durableNoteErr.message ? durableNoteErr.message : String(durableNoteErr),
            );
          }
        } else {
          console.error('[MSH Marker] durable_note write=skipped error=Cart API missing addCartProperties');
        }
      } else {
        console.log('[MSH Marker] durable_note write=skipped reason=no marker data');
      }

      if (bundleAttachConfig && bundleAttachConfig.enabled) {
        setBundleParentLineAdded(true);
        setBundleParentLineUuid(String(mainUuid));
        console.log('[BundleAdd] parent line added=yes uuid=', mainUuid);
        var readableProps = sanitizeLineItemProperties(bundleAttachConfig.readableProperties || {});
        var readablePropertyCount = Object.keys(readableProps).length;
        setBundleReadablePropertyCount(readablePropertyCount);
        var locatedParentLine = findCartLineByUuid(mainUuid);
        console.log('[BundleAdd] exact parent line located in cart=', locatedParentLine);
        setBundleReadableAttachAttempted(true);
        console.log('[BundleAdd] exact property attach method=shopify.cart.addLineItemProperties');
        console.log('[BundleAdd] exact attach payload=', readableProps);
        if (shopify.cart && typeof shopify.cart.addLineItemProperties === 'function') {
          try {
            await shopify.cart.addLineItemProperties(mainUuid, readableProps);
            setBundleReadableAttachStatus('success');
            setBundleReadableAttachError('');
            console.log('[BundleAdd] readable property attach result=success');
          } catch (bundleAttachErr) {
            var readableAttachMessage = bundleAttachErr && bundleAttachErr.message ? bundleAttachErr.message : String(bundleAttachErr);
            setBundleReadableAttachStatus('failed');
            setBundleReadableAttachError(readableAttachMessage);
            console.error('[BundleAdd] readable property attach result=failed error=', readableAttachMessage);
            toast('Bundle added, but readable properties failed to attach.');
          }
        } else {
          setBundleReadableAttachStatus('failed');
          setBundleReadableAttachError('Cart API missing addLineItemProperties');
          console.error('[BundleAdd] readable property attach result=failed error=Cart API missing addLineItemProperties');
        }
        var finalParentLine = findCartLineByUuid(mainUuid);
        var finalPropertiesCount = countLineProperties(finalParentLine);
        setBundleFinalParentPropertiesCount(finalPropertiesCount);
        console.log('[BundleAdd] final cart line snapshot after attach=', finalParentLine);
        console.log('[BundleAdd] final cart line properties count=', finalPropertiesCount);
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

        if (shopify.cart && shopify.cart.addLineItemProperties) {
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
      console.error('[BundleAdd] caught error object=', err);
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

  function renderScreenIntro(title, subtitle) {
    var showBack = screen !== 'clubs';
    return (
      <s-section>
        <s-box border="base" cornerRadius="large" padding="base">
          <s-stack direction="block" gap="base">
            {showBack ? (
              <s-stack direction="inline" gap="small" alignItems="center">
                <s-box inlineSize="auto">
                  <s-button variant="secondary" onClick={handleBack}>← Back</s-button>
                </s-box>
              </s-stack>
            ) : null}
            <s-stack direction="block" gap="small">
              <s-text emphasis="bold">{title}</s-text>
              {subtitle ? <s-text size="small" appearance="subdued">{subtitle}</s-text> : null}
            </s-stack>
          </s-stack>
        </s-box>
      </s-section>
    );
  }


  function productTileColumns() {
    return 4;
  }

  function productCardMinHeight() {
    return '260px';
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

  function getCurrentVariantOptionSelections(product) {
    var currentSelections = {};
    if (selectedVariant && selectedVariant.optionMap) {
      var selectedKeys = Object.keys(selectedVariant.optionMap);
      for (var i = 0; i < selectedKeys.length; i += 1) {
        currentSelections[selectedKeys[i]] = selectedVariant.optionMap[selectedKeys[i]];
      }
    }
    var stateKeys = Object.keys(selectedOptionValues || {});
    for (var s = 0; s < stateKeys.length; s += 1) {
      currentSelections[stateKeys[s]] = selectedOptionValues[stateKeys[s]];
    }
    return currentSelections;
  }

  function getOptionValuesForProduct(product, optionName) {
    var values = [];
    var variants = product && product.variants ? product.variants : [];
    for (var i = 0; i < variants.length; i += 1) {
      var optionMap = variants[i] && variants[i].optionMap ? variants[i].optionMap : {};
      var value = toStr(optionMap[optionName]);
      if (value !== '' && values.indexOf(value) === -1) {
        values.push(value);
      }
    }
    return values;
  }

  function optionValueIsAvailable(product, optionName, optionValue, currentSelections) {
    var variants = product && product.variants ? product.variants : [];
    for (var i = 0; i < variants.length; i += 1) {
      var optionMap = variants[i] && variants[i].optionMap ? variants[i].optionMap : {};
      if (toStr(optionMap[optionName]) !== toStr(optionValue)) {
        continue;
      }
      var matchesOtherSelections = true;
      var selectionKeys = Object.keys(currentSelections || {});
      for (var s = 0; s < selectionKeys.length; s += 1) {
        var selectionKey = selectionKeys[s];
        if (selectionKey === optionName) {
          continue;
        }
        var selectionValue = toStr(currentSelections[selectionKey]);
        if (selectionValue !== '' && toStr(optionMap[selectionKey]) !== selectionValue) {
          matchesOtherSelections = false;
          break;
        }
      }
      if (matchesOtherSelections) {
        return true;
      }
    }
    return false;
  }

  function handleVariantOptionValueSelect(product, optionName, optionValue) {
    var nextSelections = {};
    var existingKeys = Object.keys(selectedOptionValues || {});
    for (var i = 0; i < existingKeys.length; i += 1) {
      nextSelections[existingKeys[i]] = selectedOptionValues[existingKeys[i]];
    }
    nextSelections[optionName] = optionValue;
    setSelectedOptionValues(nextSelections);

    var optionNames = deriveVariantOptionNames(product);
    var variants = product && product.variants ? product.variants : [];
    var matches = [];
    for (var v = 0; v < variants.length; v += 1) {
      var optionMap = variants[v] && variants[v].optionMap ? variants[v].optionMap : {};
      var isMatch = true;
      for (var s = 0; s < optionNames.length; s += 1) {
        var currentOptionName = optionNames[s];
        var chosenValue = toStr(nextSelections[currentOptionName]);
        if (chosenValue !== '' && toStr(optionMap[currentOptionName]) !== chosenValue) {
          isMatch = false;
          break;
        }
      }
      if (isMatch) {
        matches.push(variants[v]);
      }
    }

    var allChosen = true;
    for (var o = 0; o < optionNames.length; o += 1) {
      if (toStr(nextSelections[optionNames[o]]) === '') {
        allChosen = false;
        break;
      }
    }

    if (allChosen && matches.length === 1) {
      setSelectedVariant(matches[0]);
      return;
    }
    if (selectedVariant) {
      var selectedStillMatches = false;
      for (var m = 0; m < matches.length; m += 1) {
        if (matches[m].id === selectedVariant.id) {
          selectedStillMatches = true;
          break;
        }
      }
      if (!selectedStillMatches) {
        setSelectedVariant(null);
      }
    }
  }

  function renderVariantSelectors(product) {
    if (!product || !product.variants) {
      return null;
    }
    if (!productUsesSeparateOptions(product)) {
      return renderVariants(product);
    }
    var optionNames = deriveVariantOptionNames(product);
    var currentSelections = getCurrentVariantOptionSelections(product);
    return (
      <s-stack direction="block" gap="base">
        {optionNames.map(function (optionName) {
          var values = getOptionValuesForProduct(product, optionName);
          return (
            <s-stack key={optionName} direction="block" gap="small">
              <s-text>{optionName}</s-text>
              <s-stack direction="inline" wrap="true" gap="small">
                {values.map(function (value) {
                  var active = toStr(currentSelections[optionName]) === toStr(value);
                  var available = optionValueIsAvailable(product, optionName, value, currentSelections);
                  return (
                    <s-button
                      key={optionName + '-' + value}
                      variant={active ? 'primary' : 'secondary'}
                      disabled={!available}
                      onClick={function () { handleVariantOptionValueSelect(product, optionName, value); }}
                    >
                      {value}
                    </s-button>
                  );
                })}
              </s-stack>
            </s-stack>
          );
        })}
      </s-stack>
    );
  }


  function renderImageOrFallback(imageUrl, altText, height, fitMode) {
    var cleanUrl = toStr(imageUrl);
    var imageHeight = toStr(height) === '' ? '64px' : toStr(height);
    var fallbackLabel = altText ? 'No image for ' + altText : 'No image';
    var imageFit = toStr(fitMode);
    var fitProps = {};
    if (imageFit === 'contain' || imageFit === 'cover' || imageFit === 'fill') {
      fitProps.fit = imageFit;
    }
    return (
      cleanUrl !== '' ? (
        <s-box blockSize={imageHeight} inlineSize="fill" padding="none">
          <s-stack direction="block" alignItems="center" justifyContent="center">
            <s-image src={cleanUrl} accessibilityDescription={altText || ''} {...fitProps} />
          </s-stack>
        </s-box>
      ) : (
        <s-box blockSize="auto" inlineSize="fill" padding="none">
          <s-stack direction="block" alignItems="center">
            <s-text size="small" appearance="subdued">{fallbackLabel}</s-text>
          </s-stack>
        </s-box>
      )
    );
  }


  function tileWidth(columns) {
    if (columns === 4) {
      return '24%';
    }
    if (columns === 3) {
      return '32%';
    }
    if (columns === 2) {
      return '49%';
    }
    return '100%';
  }



  function renderCollectionTile(item, subtitle, onPress, columns) {
    var title = item && item.name ? item.name : (item && item.label ? item.label : 'Collection');
    var imageHeight = columns >= 4 ? '64px' : '72px';
    return (
      <s-clickable key={'collection-' + title} onClick={onPress}>
        <s-box border="base" cornerRadius="large" padding="small">
          <s-stack direction="block" gap="base">
            <s-box border="base" cornerRadius="base" padding="small" blockSize={columns >= 4 ? '84px' : '92px'} inlineSize="fill">
              {renderImageOrFallback(item ? item.imageUrl : '', title, imageHeight, 'contain')}
            </s-box>
            <s-stack direction="block" gap="micro" alignItems="center">
              <s-box style="text-align:center; width:100%;">
                <s-text emphasis="bold" size="small">{title}</s-text>
              </s-box>
              {subtitle ? (
                <s-box style="text-align:center; width:100%;">
                  <s-text size="small" appearance="subdued">{subtitle}</s-text>
                </s-box>
              ) : null}
            </s-stack>
          </s-stack>
        </s-box>
      </s-clickable>
    );
  }


  function renderProductTile(product, onPress, columns) {
    var imageHeight = columns >= 4 ? '64px' : '72px';
    return (
      <s-clickable key={'product-' + product.id} onClick={onPress}>
        <s-box border="base" cornerRadius="large" padding="small">
          <s-stack direction="block" gap="base">
            <s-box border="base" cornerRadius="base" padding="small" blockSize={columns >= 4 ? '84px' : '92px'} inlineSize="fill">
              {renderImageOrFallback(product.imageUrl, product.title, imageHeight, 'contain')}
            </s-box>
            <s-stack direction="block" gap="small" alignItems="center">
              <s-box style="text-align:center; width:100%;">
                <s-text emphasis="bold" size="small">{product.title}</s-text>
              </s-box>
            </s-stack>
          </s-stack>
        </s-box>
      </s-clickable>
    );
  }


  function renderGrid(items, renderItem, columns) {
    var list = items || [];
    if (list.length === 0) {
      return null;
    }
    var width = tileWidth(columns);
    return (
      <s-stack direction="inline" wrap="true" gap="small" alignItems="stretch">
        {list.map(function (item, index) {
          var keyBase = item && (item.id || item.name || item.label)
            ? (item.id || item.name || item.label)
            : String(index);
          return (
            <s-box key={'grid-' + keyBase} inlineSize={width} padding="none">
              {renderItem(item, columns)}
            </s-box>
          );
        })}
      </s-stack>
    );
  }


  function renderClubsScreen() {
    return (
      <s-page heading="Macron POS">
        <ScreenScroll>
          {renderScreenIntro('Club Shop', 'Select a club')}
          <s-section>
            <s-stack direction="block" gap="small">
              <s-text size="small" appearance="subdued">Data source: {dataSource === 'Live data' ? 'Live' : 'Mock'}</s-text>
              {renderGrid(clubs, function (club) {
                return renderCollectionTile(
                  club,
                  '',
                  function () { handleClubPress(club); },
                  4
                );
              }, 4)}
            </s-stack>
          </s-section>
          <s-box style="margin-top:6px; opacity:0.72;">
            {renderDiagnosticsToggle()}
          </s-box>
          {showDebug ? renderDebugHeader() : null}
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
          {renderScreenIntro(selectedClub.name, 'Choose a subsection')}
          <s-section>
            <s-stack direction="block" gap="small">
              {renderGrid(selectedClub.subsections, function (subsection) {
                return renderCollectionTile(
                  subsection,
                  '',
                  function () { handleSubsectionPress(subsection); },
                  4
                );
              }, 4)}
            </s-stack>
          </s-section>
          <s-box style="margin-top:6px; opacity:0.72;">
            {renderDiagnosticsToggle()}
          </s-box>
          {showDebug ? renderDebugHeader() : null}
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
          {renderScreenIntro(heading, 'Select a product')}
          <s-section>
            <s-stack direction="block" gap="small">
              {productListLoading ? <s-text size="small" appearance="subdued">Loading products…</s-text> : null}
              {!productListLoading && products.length === 0 ? <s-text>No products found.</s-text> : null}
              {!productListLoading ? renderGrid(products, function (product) {
                return renderProductTile(product, function () { handleProductPress(product); }, productTileColumns());
              }, productTileColumns()) : null}
            </s-stack>
          </s-section>
          <s-box style="margin-top:6px; opacity:0.72;">
            {renderDiagnosticsToggle()}
          </s-box>
          {showDebug ? renderProductDebug() : null}
          {showDebug ? renderDebugHeader() : null}
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
          <s-button variant="secondary" onClick={handleBundleBuilderOpen}>
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
            <s-box key={variant.id} padding="none">
              <s-button variant={active ? 'primary' : 'secondary'} onClick={function () { handleVariantSelect(variant); }}>
                {variant.title}
              </s-button>
            </s-box>
          );
        })}
      </s-stack>
    );
  }


  function renderFulfilmentControls(options) {
    var config = options || {};
    var hideSplitLineChoice = config.hideSplitLineChoice ? true : false;
    return (
      <s-section heading="Fulfilment intent">
        <s-stack direction="block" gap="small">
          <s-stack direction="inline" wrap="true" gap="small">
            <s-button variant={fulfilmentMode === 'take_today' ? 'primary' : 'secondary'} onClick={function () { setFulfilmentMode('take_today'); }}>
              Take today
            </s-button>
            <s-button variant={fulfilmentMode === 'order_in' ? 'primary' : 'secondary'} onClick={function () { setFulfilmentMode('order_in'); }}>
              Order in
            </s-button>
            <s-button variant={fulfilmentMode === 'split' ? 'primary' : 'secondary'} onClick={function () { setFulfilmentMode('split'); }}>
              Split fulfilment
            </s-button>
          </s-stack>
          {fulfilmentMode === 'split' && !hideSplitLineChoice ? (
            <s-stack direction="inline" wrap="true" gap="small">
              <s-text size="small" appearance="subdued">This line:</s-text>
              <s-button variant={splitTakeNow ? 'primary' : 'secondary'} onClick={function () { setSplitTakeNow(true); }}>
                Take now
              </s-button>
              <s-button variant={!splitTakeNow ? 'primary' : 'secondary'} onClick={function () { setSplitTakeNow(false); }}>
                Order in
              </s-button>
            </s-stack>
          ) : null}
        </s-stack>
      </s-section>
    );
  }

  function renderBundleFulfilmentControls() {
    return (
      <s-section heading="Bundle fulfilment">
        <s-stack direction="block" gap="small">
          <s-stack direction="inline" wrap="true" gap="small">
            <s-button variant={fulfilmentMode === 'take_today' ? 'primary' : 'secondary'} onClick={function () { setFulfilmentMode('take_today'); }}>
              Take today
            </s-button>
            <s-button variant={fulfilmentMode === 'order_in' ? 'primary' : 'secondary'} onClick={function () { setFulfilmentMode('order_in'); }}>
              Order in
            </s-button>
            <s-button variant={fulfilmentMode === 'split' ? 'primary' : 'secondary'} onClick={function () { setFulfilmentMode('split'); }}>
              Split fulfilment
            </s-button>
          </s-stack>
          <s-text size="small" appearance="subdued">
            {fulfilmentMode === 'take_today' ? 'All components will be marked Take now' : null}
            {fulfilmentMode === 'order_in' ? 'All components will be marked Order later' : null}
            {fulfilmentMode === 'split' ? 'Choose fulfilment per component below.' : null}
          </s-text>
        </s-stack>
      </s-section>
    );
  }

  function renderCheckoutReminderPanel() {
    return (
      <s-box style="background:#f6f7f8; border:1px solid #dfe3e8; border-radius:10px; padding:12px;">
        <s-stack direction="block" gap="micro">
          <s-text emphasis="bold" size="small">Delivery method chosen at checkout</s-text>
          <s-text size="small" appearance="subdued">
            After adding this order to cart, use Shopify POS checkout to choose either Ship to customer for delivery or complete it as pickup / in-store.
          </s-text>
        </s-stack>
      </s-box>
    );
  }

  function renderPostAddCheckoutReminder() {
    return (
      <s-text size="small" appearance="subdued">
        Next step after add: choose delivery or pickup in Shopify POS checkout.
      </s-text>
    );
  }


  function renderProductDetailScreen() {
    if (!selectedProduct) {
      return renderProductsScreen();
    }
    var meta = selectedProduct.personalisationMeta || {};
    var hasPersonalisation = hasAnyPersonalisation(meta);
    var isBundleProduct = selectedProduct.bundleMeta && selectedProduct.bundleMeta.isBundle;
    var showAddToCart = !hasPersonalisation && !isBundleProduct;
    return (
      <s-page heading="Macron POS">
        <ScreenScroll>
          <s-section>
            <s-stack direction="block" gap="base">
              <s-box style="max-width:360px; margin:0 auto; width:100%;">
                {renderImageOrFallback(selectedProduct.imageUrl, selectedProduct.title, '232px', 'contain')}
              </s-box>
              <s-stack direction="block" gap="micro" alignItems="center">
                <s-box style="text-align:center; width:100%;">
                  <s-text emphasis="bold">{selectedProduct.title}</s-text>
                </s-box>
              </s-stack>
              {!selectedProduct.bundleMeta || !selectedProduct.bundleMeta.isBundle ? (
                <s-text size="small" appearance="subdued">Select size to continue.</s-text>
              ) : <s-text size="small" appearance="subdued">Bundle options available for this item.</s-text>}
            </s-stack>
          </s-section>
          <s-section heading={productUsesSeparateOptions(selectedProduct) ? 'Options' : 'Size'}>
            {renderVariantSelectors(selectedProduct)}
          </s-section>
          {renderBundleNote(selectedProduct)}
          {renderFulfilmentControls()}
          <s-section heading="Actions">
            <s-stack direction="block" gap="small">
              {showAddToCart ? renderCheckoutReminderPanel() : null}
              {showAddToCart ? (
                <s-stack direction="block" gap="micro">
                  <s-button
                    variant="primary"
                    onClick={function () {
                      setLastEnteredPersonalisation(false);
                      addSelectedProductToCart(selectedProduct, selectedVariant, buildMshIntentProperties(fulfilmentMode, splitTakeNow), null);
                    }}
                  >
                    Add to cart
                  </s-button>
                  {renderPostAddCheckoutReminder()}
                </s-stack>
              ) : (!isBundleProduct ? (
                <s-button variant="primary" onClick={function () { setScreen('personalisation'); }}>
                  Add personalisation
                </s-button>
              ) : null)}
              <s-button variant="secondary" onClick={handleBack}>Back</s-button>
            </s-stack>
          </s-section>
          <s-box style="margin-top:6px; opacity:0.72;">
            {renderDiagnosticsToggle()}
          </s-box>
          {showDebug ? renderPersonalisationDebug(selectedProduct) : null}
          {showDebug ? renderBundleDebug(selectedProduct) : null}
          {showDebug ? renderCartDebug() : null}
          {showDebug ? renderProductDebug() : null}
          {showDebug ? renderDebugHeader() : null}
        </ScreenScroll>
      </s-page>
    );
  }


  function renderBundleBuilderScreen() {
    if (!selectedProduct) {
      return renderProductsScreen();
    }
    var meta = selectedProduct.personalisationMeta || {};
    var feeDisplay = parseFeeDisplay(meta.personalisationFeeRaw);
    var maxChars = parseMaxChars(meta.personalisationMaxCharsRaw);
    function polishLabel(label, fallback) {
      var value = toStr(label);
      if (value === '') {
        return fallback;
      }
      if (value === 'Please Enter The Players Name And Age Group') {
        return "Player name and age group";
      }
      if (value === 'Please Upload Your Sponsor Logo Here') {
        return 'Sponsor logo';
      }
      return value;
    }
    return (
      <s-page heading="Macron POS">
        <ScreenScroll>
          <s-section heading="Build bundle">
            <s-stack direction="block" gap="base">
              <s-text>{selectedProduct.title}</s-text>
              <s-text appearance="subdued">Items to choose: {bundleComponents.length}</s-text>
              {bundleLoading ? <s-text>Loading bundle components…</s-text> : null}
              {bundleError !== '' ? <s-text appearance="critical">{bundleError}</s-text> : null}
              {bundleComponents.map(function (component) {
                var chosen = bundleSelections[component.key];
                return (
                  <s-section key={component.key} heading={component.title}>
                    <s-box border="base" cornerRadius="large" padding="small">
                      <s-stack direction="block" gap="small">
                        <s-text appearance="subdued">{chosen ? ('Selected: ' + chosen.title) : 'Choose one variant'}</s-text>
                        {component.variants && component.variants.length > 0 ? (
                          <s-stack direction="inline" wrap="true" gap="small">
                            {component.variants.map(function (variant) {
                              var active = chosen && chosen.id === variant.id;
                              return (
                                <s-button
                                  key={variant.id}
                                  variant={active ? 'primary' : 'secondary'}
                                  onClick={function () { handleBundleVariantSelect(component.key, variant); }}
                                >
                                  {variant.title}
                                </s-button>
                              );
                            })}
                          </s-stack>
                        ) : (
                          <s-text appearance="critical">No variants available for this component</s-text>
                        )}
                      </s-stack>
                    </s-box>
                  </s-section>
                );
              })}
              {hasAnyPersonalisation(meta) ? (
                <s-section heading="Bundle personalisation">
                  <s-stack direction="block" gap="small">
                    {meta.enablePersonalisation ? (
                      <s-stack direction="block" gap="small">
                        {fieldLabel(polishLabel(meta.personalisationLabel, 'Personalisation'), meta.personalisationRequired, feeDisplay)}
                        <s-text-field
                          value={primaryFieldValue}
                          maxLength={maxChars === null ? undefined : maxChars}
                          onInput={function (event) { setPrimaryFieldValue(event.target.value); }}
                          placeholder="Enter text"
                        />
                      </s-stack>
                    ) : null}

                    {meta.extraField1Enabled ? (
                      <s-stack direction="block" gap="small">
                        {fieldLabel(polishLabel(meta.extraField1Label, 'Additional information'), meta.extraField1Required, '')}
                        <s-text-field
                          value={extraField1Value}
                          onInput={function (event) { setExtraField1Value(event.target.value); }}
                          placeholder="Enter text"
                        />
                      </s-stack>
                    ) : null}

                    {meta.extraField2Enabled ? (
                      <s-stack direction="block" gap="small">
                        {fieldLabel(polishLabel(meta.extraField2Label, 'Additional information 2'), meta.extraField2Required, '')}
                        <s-text-field
                          value={extraField2Value}
                          onInput={function (event) { setExtraField2Value(event.target.value); }}
                          placeholder="Enter text"
                        />
                      </s-stack>
                    ) : null}

                    {meta.enableFileUpload ? (
                      <s-stack direction="block" gap="small">
                        {fieldLabel(polishLabel(meta.fileUploadLabel, 'Upload file'), meta.fileUploadRequired, '')}
                        <s-text appearance="critical">File upload is not available in POS V1 for bundle personalisation.</s-text>
                        <s-text appearance="subdued">{meta.fileUploadHelpText || 'File upload not wired in POS V1 yet.'}</s-text>
                      </s-stack>
                    ) : null}
                  </s-stack>
                </s-section>
              ) : null}
              {renderBundleFulfilmentControls()}
              {fulfilmentMode === 'split' ? (
                <s-section heading="Component fulfilment">
                  <s-stack direction="block" gap="small">
                    {bundleComponents.map(function (component) {
                      var componentFulfilmentValue = bundleComponentFulfilment[component.key];
                      if (componentFulfilmentValue !== 'take_now' && componentFulfilmentValue !== 'order_later') {
                        componentFulfilmentValue = 'take_now';
                      }
                      return (
                        <s-box key={'fulfilment-' + component.key} border="base" cornerRadius="base" padding="small">
                          <s-stack direction="block" gap="small">
                            <s-text emphasis="bold" size="small">{component.title}</s-text>
                            <s-stack direction="inline" wrap="true" gap="small">
                              {[
                                {value: 'take_now', label: 'Take now'},
                                {value: 'order_later', label: 'Order later'},
                              ].map(function (option) {
                                var active = componentFulfilmentValue === option.value;
                                return (
                                  <s-button
                                    key={option.value}
                                    variant={active ? 'primary' : 'secondary'}
                                    onClick={function () { handleBundleComponentFulfilmentSelect(component.key, option.value); }}
                                  >
                                    {option.label}
                                  </s-button>
                                );
                              })}
                            </s-stack>
                          </s-stack>
                        </s-box>
                      );
                    })}
                  </s-stack>
                </s-section>
              ) : null}
              <s-section heading="Actions">
                <s-stack direction="block" gap="small">
                  {renderCheckoutReminderPanel()}
                  <s-stack direction="block" gap="micro">
                    <s-button
                      variant="primary"
                      onClick={addBundleParentToCart}
                      disabled={bundleLoading}
                    >
                      Add bundle to cart
                    </s-button>
                    {renderPostAddCheckoutReminder()}
                  </s-stack>
                  <s-button variant="secondary" onClick={handleBack}>Back</s-button>
                </s-stack>
              </s-section>
            </s-stack>
          </s-section>
          <s-box style="margin-top:6px; opacity:0.72;">
            {renderDiagnosticsToggle()}
          </s-box>
          {showDebug ? renderBundleDebug(selectedProduct) : null}
          {showDebug ? renderCartDebug() : null}
          {showDebug ? renderProductDebug() : null}
          {showDebug ? renderDebugHeader() : null}
        </ScreenScroll>
      </s-page>
    );
  }

  function fieldLabel(label, required, feeText) {
    return (
      <s-stack direction="block" gap="small">
        <s-text>{label}</s-text>
        <s-stack direction="inline" gap="small" wrap="true">
          {required ? <s-text appearance="critical">Required</s-text> : <s-text appearance="subdued">Optional</s-text>}
          {feeText ? <s-text appearance="subdued">{feeText}</s-text> : null}
        </s-stack>
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
    function polishLabel(label, fallback) {
      var value = toStr(label);
      if (value === '') {
        return fallback;
      }
      if (value === 'Please Enter The Players Name And Age Group') {
        return "Player name and age group";
      }
      if (value === 'Please Upload Your Sponsor Logo Here') {
        return 'Sponsor logo';
      }
      if (value === 'Printed Number To Back Of Shirt') {
        return 'Printed number on back of shirt';
      }
      return value;
    }

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

    return (
      <s-page heading="Macron POS">
        <ScreenScroll>
          <s-section heading="Personalisation">
            <s-stack direction="block" gap="small">
              <s-text>{selectedProduct.title}</s-text>
              <s-text appearance="subdued">Variant: {selectedVariant ? selectedVariant.title : ''}</s-text>

              {meta.enablePersonalisation ? (
                <s-stack direction="block" gap="small">
                  {fieldLabel(polishLabel(meta.personalisationLabel, 'Personalisation'), meta.personalisationRequired, feeDisplay)}
                  <s-text-field
                    value={primaryFieldValue}
                    maxLength={maxChars === null ? undefined : maxChars}
                    onInput={function (event) { setPrimaryFieldValue(event.target.value); }}
                    placeholder="Enter text"
                  />
                </s-stack>
              ) : null}

              {meta.extraField1Enabled ? (
                <s-stack direction="block" gap="small">
                  {fieldLabel(polishLabel(meta.extraField1Label, 'Additional information'), meta.extraField1Required, '')}
                  <s-text-field
                    value={extraField1Value}
                    onInput={function (event) { setExtraField1Value(event.target.value); }}
                    placeholder="Enter text"
                  />
                </s-stack>
              ) : null}

              {meta.extraField2Enabled ? (
                <s-stack direction="block" gap="small">
                  {fieldLabel(polishLabel(meta.extraField2Label, 'Additional information 2'), meta.extraField2Required, '')}
                  <s-text-field
                    value={extraField2Value}
                    onInput={function (event) { setExtraField2Value(event.target.value); }}
                    placeholder="Enter text"
                  />
                </s-stack>
              ) : null}

              {meta.enableFileUpload ? (
                <s-stack direction="block" gap="small">
                  {fieldLabel(polishLabel(meta.fileUploadLabel, 'Upload file'), meta.fileUploadRequired, '')}
                  <s-text appearance="subdued">{meta.fileUploadHelpText || 'File upload not wired in POS V1 yet.'}</s-text>
                </s-stack>
              ) : null}

              {renderFulfilmentControls()}
              <s-section heading="Actions">
                <s-stack direction="block" gap="small">
                  {renderCheckoutReminderPanel()}
                  <s-stack direction="block" gap="micro">
                    <s-button variant="primary" onClick={submitPersonalisation}>
                      Add to cart
                    </s-button>
                    {renderPostAddCheckoutReminder()}
                  </s-stack>
                  <s-button variant="secondary" onClick={handleBack}>
                    Back
                  </s-button>
                </s-stack>
              </s-section>
            </s-stack>
          </s-section>
          <s-box style="margin-top:6px; opacity:0.72;">{renderDiagnosticsToggle()}</s-box>
          {showDebug ? renderPersonalisationDebug(selectedProduct) : null}
          {showDebug ? renderCartDebug() : null}
          {showDebug ? renderProductDebug() : null}
          {showDebug ? renderDebugHeader() : null}
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
  if (screen === 'bundleBuilder') {
    return renderBundleBuilderScreen();
  }
  return renderClubsScreen();
}
