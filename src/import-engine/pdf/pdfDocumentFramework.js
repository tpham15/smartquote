// Phase 14.2 — Universal PDF Document Framework
// Provider-neutral intermediate representation (IR) between page perception
// and SmartQuote catalog semantics. Pure JS: safe to smoke-test without browser/AI.

import { normalizePdfTableSemantics, normalizeSellableVariants, PDF_PRICE_ROLE, PDF_ROW_MODEL } from './pdfVariants.js';

function text(v) { return String(v ?? '').replace(/\s+/g, ' ').trim(); }
function key(v) {
  return text(v).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/[^a-z0-9]+/g, ' ').trim();
}
function clamp01(v, fallback = 0) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(1, n > 1 ? n / 100 : n));
}
function normalizeBbox(v) {
  if (!Array.isArray(v) || v.length !== 4) return null;
  const nums = v.map((n) => Math.max(0, Math.min(1000, Math.round(Number(n) || 0))));
  if (nums[2] <= nums[0] || nums[3] <= nums[1]) return null;
  return nums;
}
function normalizeField(raw = {}) {
  if (typeof raw === 'string') return { text: text(raw), confidence: raw ? 0.7 : 0, bbox: null };
  return {
    text: text(raw?.text),
    confidence: clamp01(raw?.confidence, raw?.text ? 0.65 : 0),
    bbox: normalizeBbox(raw?.bbox),
  };
}
function validPrice(v) {
  const n = Number(v || 0);
  return Number.isFinite(n) && n >= 1000 && n <= 1_000_000_000;
}
function clearSku(v) {
  const s = text(v);
  return /[A-Z]/i.test(s) && /\d/.test(s) && s.replace(/[^A-Z0-9]/gi, '').length >= 4;
}
function normalizePriceValue(raw = {}) {
  const direct = Number(raw?.value || raw?.price || 0);
  if (Number.isFinite(direct) && direct > 0) return Math.round(direct);
  const digits = String(raw?.text || '').replace(/[^\d]/g, '');
  const n = digits ? Number(digits) : 0;
  return Number.isFinite(n) ? n : 0;
}

export const PDF_DOCUMENT_IR_SCHEMA_VERSION = 'sq-pdf-document-ir-v1';

const BBOX_SCHEMA = {
  type: 'array',
  items: { type: 'integer', minimum: 0, maximum: 1000 },
  minItems: 4,
  maxItems: 4,
};
const FIELD_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    text: { type: 'string' },
    confidence: { type: 'integer', minimum: 0, maximum: 100 },
    bbox: BBOX_SCHEMA,
  },
  required: ['text', 'confidence', 'bbox'],
};
const PRICE_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    label: { type: 'string' },
    role: { type: 'string', enum: ['variant_price', 'commercial_price', 'quote_value', 'unknown'] },
    variantKey: { type: 'string' },
    text: { type: 'string' },
    value: { type: 'integer' },
    confidence: { type: 'integer', minimum: 0, maximum: 100 },
    bbox: BBOX_SCHEMA,
  },
  required: ['label', 'role', 'variantKey', 'text', 'value', 'confidence', 'bbox'],
};
const VARIANT_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    sku: { type: 'string' },
    label: { type: 'string' },
    variantKey: { type: 'string' },
    priceRole: { type: 'string', enum: ['variant_price', 'commercial_price', 'quote_value', 'unknown'] },
    price: { type: 'integer' },
    confidence: { type: 'integer', minimum: 0, maximum: 100 },
    bbox: BBOX_SCHEMA,
  },
  required: ['sku', 'label', 'variantKey', 'priceRole', 'price', 'confidence', 'bbox'],
};

export const PDF_PAGE_DOCUMENT_IR_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    page: { type: 'integer' },
    pageType: { type: 'string', enum: ['catalog_table', 'quotation_table', 'mixed', 'non_catalog', 'unknown'] },
    tables: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          tableId: { type: 'string' },
          title: { type: 'string' },
          rowModel: { type: 'string', enum: ['single_sku', 'product_family_variants', 'mixed', 'unknown'] },
          headers: {
            type: 'array',
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                label: { type: 'string' },
                role: { type: 'string', enum: ['row_index', 'product_name', 'sku', 'unit', 'specs', 'variant_price', 'commercial_price', 'quote_value', 'image', 'unknown'] },
                priceRole: { type: 'string', enum: ['variant_price', 'commercial_price', 'quote_value', 'unknown'] },
                variantKey: { type: 'string' },
                bbox: BBOX_SCHEMA,
              },
              required: ['label', 'role', 'priceRole', 'variantKey', 'bbox'],
            },
          },
          sections: {
            type: 'array',
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                title: { type: 'string' },
                sharedSpecs: { type: 'string' },
                bbox: BBOX_SCHEMA,
                rows: {
                  type: 'array',
                  items: {
                    type: 'object', additionalProperties: false,
                    properties: {
                      kind: { type: 'string', enum: ['product', 'header', 'section_header', 'note', 'subtotal', 'footer', 'unknown'] },
                      visibleRowLabel: { type: 'string' },
                      sourceRow: { type: 'integer' },
                      rowIndex: { type: 'integer' },
                      bbox: BBOX_SCHEMA,
                      name: FIELD_SCHEMA,
                      sku: FIELD_SCHEMA,
                      unit: FIELD_SCHEMA,
                      specs: FIELD_SCHEMA,
                      prices: { type: 'array', items: PRICE_SCHEMA },
                      variants: { type: 'array', items: VARIANT_SCHEMA },
                    },
                    required: ['kind', 'visibleRowLabel', 'sourceRow', 'rowIndex', 'bbox', 'name', 'sku', 'unit', 'specs', 'prices', 'variants'],
                  },
                },
              },
              required: ['title', 'sharedSpecs', 'bbox', 'rows'],
            },
          },
        },
        required: ['tableId', 'title', 'rowModel', 'headers', 'sections'],
      },
    },
    ignoredRegions: { type: 'array', items: { type: 'string' } },
  },
  required: ['page', 'pageType', 'tables', 'ignoredRegions'],
};

export const PDF_ROW_RECOVERY_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    name: FIELD_SCHEMA,
    sku: FIELD_SCHEMA,
    unit: FIELD_SCHEMA,
    specs: FIELD_SCHEMA,
    prices: { type: 'array', items: PRICE_SCHEMA },
    variants: { type: 'array', items: VARIANT_SCHEMA },
  },
  required: ['name', 'sku', 'unit', 'specs', 'prices', 'variants'],
};

function normalizePrice(raw = {}) {
  const role = ['variant_price', 'commercial_price', 'quote_value'].includes(String(raw?.role || '').toLowerCase())
    ? String(raw.role).toLowerCase() : 'unknown';
  return {
    label: text(raw?.label),
    role,
    variantKey: text(raw?.variantKey || raw?.variant_key),
    text: text(raw?.text),
    value: normalizePriceValue(raw),
    confidence: clamp01(raw?.confidence, raw?.text || raw?.value ? 0.65 : 0),
    bbox: normalizeBbox(raw?.bbox),
  };
}

function normalizeVariant(raw = {}) {
  const role = ['variant_price', 'commercial_price', 'quote_value'].includes(String(raw?.priceRole || '').toLowerCase())
    ? String(raw.priceRole).toLowerCase() : 'unknown';
  return {
    sku: text(raw?.sku), label: text(raw?.label), variantKey: text(raw?.variantKey || raw?.variant_key),
    priceRole: role, price: normalizePriceValue(raw), confidence: clamp01(raw?.confidence, raw?.sku || raw?.price ? 0.65 : 0),
    bbox: normalizeBbox(raw?.bbox),
  };
}

export function normalizePdfDocumentIR(raw = {}, { pageNum = 1 } = {}) {
  const page = Math.max(1, Number(raw?.page || pageNum) || pageNum);
  const pageType = ['catalog_table', 'quotation_table', 'mixed', 'non_catalog'].includes(raw?.pageType) ? raw.pageType : 'unknown';
  const tables = (Array.isArray(raw?.tables) ? raw.tables : []).map((table, ti) => {
    const rowModel = Object.values(PDF_ROW_MODEL).includes(String(table?.rowModel || '').toLowerCase())
      ? String(table.rowModel).toLowerCase() : PDF_ROW_MODEL.UNKNOWN;
    const headers = (Array.isArray(table?.headers) ? table.headers : []).map((h) => ({
      label: text(h?.label), role: text(h?.role) || 'unknown', priceRole: text(h?.priceRole) || 'unknown',
      variantKey: text(h?.variantKey), bbox: normalizeBbox(h?.bbox),
    }));
    const sections = (Array.isArray(table?.sections) ? table.sections : []).map((section, si) => ({
      title: text(section?.title), sharedSpecs: text(section?.sharedSpecs), bbox: normalizeBbox(section?.bbox),
      rows: (Array.isArray(section?.rows) ? section.rows : []).map((row, ri) => ({
        kind: ['product', 'header', 'section_header', 'note', 'subtotal', 'footer'].includes(row?.kind) ? row.kind : 'unknown',
        visibleRowLabel: text(row?.visibleRowLabel), sourceRow: Math.max(0, Number(row?.sourceRow || 0) || 0),
        rowIndex: Math.max(1, Number(row?.rowIndex || ri + 1) || ri + 1), bbox: normalizeBbox(row?.bbox),
        name: normalizeField(row?.name), sku: normalizeField(row?.sku), unit: normalizeField(row?.unit), specs: normalizeField(row?.specs),
        prices: (Array.isArray(row?.prices) ? row.prices : []).map(normalizePrice).filter((p) => p.text || p.value),
        variants: (Array.isArray(row?.variants) ? row.variants : []).map(normalizeVariant).filter((v) => v.sku || v.price),
        _tableIndex: ti, _sectionIndex: si,
      })),
    }));
    return { tableId: text(table?.tableId) || `p${page}_t${ti + 1}`, title: text(table?.title), rowModel, headers, sections };
  });
  return { schemaVersion: PDF_DOCUMENT_IR_SCHEMA_VERSION, page, pageType, tables, ignoredRegions: (raw?.ignoredRegions || []).map(text).filter(Boolean) };
}

function semanticsFromTable(table = {}) {
  const priceColumns = (table.headers || [])
    .filter((h) => ['variant_price', 'commercial_price', 'quote_value'].includes(h.role) || ['variant_price', 'commercial_price', 'quote_value'].includes(h.priceRole))
    .map((h) => ({
      label: h.label,
      role: ['variant_price', 'commercial_price', 'quote_value'].includes(h.priceRole) ? h.priceRole : h.role,
      variantKey: h.variantKey || '',
    }));
  return normalizePdfTableSemantics({ rowModel: table.rowModel || 'unknown', priceColumns });
}

function primaryCommercialPrice(prices = []) {
  const commercial = prices.filter((p) => p.role === PDF_PRICE_ROLE.COMMERCIAL && validPrice(p.value));
  if (commercial.length) return commercial[0].value;
  const unknown = prices.filter((p) => p.role === PDF_PRICE_ROLE.UNKNOWN && validPrice(p.value));
  if (unknown.length === 1) return unknown[0].value;
  const variant = prices.filter((p) => p.role === PDF_PRICE_ROLE.VARIANT && validPrice(p.value));
  if (variant.length === 1) return variant[0].value;
  return 0;
}

function fieldConfidence(row = {}, price = 0) {
  const priceMatches = (row.prices || []).filter((p) => Number(p.value || 0) === Number(price || 0));
  const priceConf = priceMatches.length ? Math.max(...priceMatches.map((p) => p.confidence)) : 0;
  const variantConf = (row.variants || []).length ? Math.min(...row.variants.map((v) => v.confidence || 0)) : 1;
  return {
    name: clamp01(row.name?.confidence), sku: clamp01(row.sku?.confidence), price: clamp01(priceConf),
    specs: clamp01(row.specs?.confidence), unit: clamp01(row.unit?.confidence), variants: clamp01(variantConf, 1),
  };
}

export function assembleProductsFromPdfDocumentIR(rawIr = {}, { supplierGuess = '' } = {}) {
  const ir = rawIr?.schemaVersion === PDF_DOCUMENT_IR_SCHEMA_VERSION ? rawIr : normalizePdfDocumentIR(rawIr, { pageNum: rawIr?.page || 1 });
  const products = [];
  let physicalOrdinal = 0;
  let skippedRegions = 0;

  for (const table of ir.tables || []) {
    const semantics = semanticsFromTable(table);
    for (const section of table.sections || []) {
      for (const row of section.rows || []) {
        if (row.kind !== 'product') { skippedRegions += 1; continue; }
        physicalOrdinal += 1;
        const name = text(row.name?.text);
        const sku = text(row.sku?.text);
        const inheritedSpecs = text(section.sharedSpecs);
        const ownSpecs = text(row.specs?.text);
        const specs = [ownSpecs, inheritedSpecs].filter(Boolean).filter((v, i, a) => a.findIndex((x) => key(x) === key(v)) === i).join(' · ').slice(0, 1600);
        const variants = normalizeSellableVariants(row.variants || [], semantics);
        const variantPrices = variants.map((v) => Number(v.price || 0)).filter(validPrice);
        let costPrice = primaryCommercialPrice(row.prices || []);
        if (!costPrice && variantPrices.length) costPrice = Math.min(...variantPrices);
        const visiblePriceCount = (row.prices || []).filter((p) => validPrice(p.value)).length;
        const visibleSkuCount = Math.max(sku ? 1 : 0, variants.filter((v) => clearSku(v.sku)).length);
        const sourceRow = row.sourceRow > 0 ? row.sourceRow : physicalOrdinal;
        const rowSourceKind = row.sourceRow > 0 ? 'visible_row_label' : 'layout_ordinal';
        const conf = fieldConfidence(row, costPrice);
        const critical = [conf.name, conf.sku, conf.price].filter((v, i) => i !== 1 || sku || variants.length);
        const minCritical = critical.length ? Math.min(...critical) : 0;
        const missingCritical = !name || !(sku || variants.some((v) => clearSku(v.sku))) || !validPrice(costPrice);
        const needsRecovery = missingCritical || minCritical < 0.72;
        const tableTitle = text(section.title || table.title) || 'Chung';
        const rowRaw = [name, sku, ownSpecs, inheritedSpecs, ...(row.prices || []).map((p) => `${p.label} ${p.text || p.value}`)].filter(Boolean).join(' | ');

        products.push({
          name, sku, category: tableTitle, supplier: supplierGuess, unit: text(row.unit?.text) || 'Cái',
          costPrice, listPrice: 0, minRetailPrice: 0, specs, rawText: rowRaw,
          sourcePage: ir.page, sourceRow, sourceBBox: row.bbox,
          visibleSkuCount, visiblePriceCount, variants, tableSemantics: semantics,
          evidence: {
            hasGrounding: !!row.bbox, layoutGrounded: true, layoutRowIndex: row.rowIndex,
            rowSourceKind, fieldConfidence: conf, sharedSpecsInherited: !!inheritedSpecs,
            tableId: table.tableId, pageType: ir.pageType,
          },
          fieldEvidence: {
            name: { confidence: conf.name, bbox: row.name?.bbox },
            sku: { confidence: conf.sku, bbox: row.sku?.bbox },
            price: { confidence: conf.price, bbox: (row.prices || []).find((p) => Number(p.value || 0) === costPrice)?.bbox || null },
            specs: { confidence: conf.specs, bbox: row.specs?.bbox },
          },
          layoutGrounded: true,
          layoutRowIndex: row.rowIndex,
          rowSourceKind,
          _layoutNeedsRecovery: needsRecovery,
        });
      }
    }
  }

  return {
    products,
    stats: {
      page: ir.page, tables: ir.tables.length, sourceRows: products.length, skippedRegions,
      recoveryRows: products.filter((p) => p._layoutNeedsRecovery).length,
      inheritedSpecRows: products.filter((p) => p.evidence?.sharedSpecsInherited).length,
    },
    ir,
  };
}

export function mergeRecoveredPdfRow(base = {}, recovered = {}) {
  if (!base) return recovered;
  const pickField = (field, fallback) => {
    const a = base?.fieldEvidence?.[field]?.confidence || 0;
    const b = clamp01(recovered?.[field]?.confidence, recovered?.[field]?.text ? 0.7 : 0);
    return b > a && text(recovered?.[field]?.text) ? text(recovered[field].text) : fallback;
  };
  const name = pickField('name', base.name);
  const sku = pickField('sku', base.sku);
  const unit = pickField('unit', base.unit);
  const specs = pickField('specs', base.specs);
  const prices = (recovered?.prices || []).map(normalizePrice).filter((p) => validPrice(p.value));
  const variants = normalizeSellableVariants(recovered?.variants || [], base.tableSemantics || {});
  const recoveredPrice = primaryCommercialPrice(prices) || (variants.length ? Math.min(...variants.map((v) => Number(v.price || 0)).filter(validPrice)) : 0);
  const priceConf = prices.length ? Math.max(...prices.map((p) => p.confidence || 0)) : 0;
  return {
    ...base,
    name, sku, unit, specs,
    costPrice: recoveredPrice || base.costPrice,
    variants: variants.length ? variants : base.variants,
    visibleSkuCount: Math.max(Number(base.visibleSkuCount || 0), sku ? 1 : 0, variants.length),
    visiblePriceCount: Math.max(Number(base.visiblePriceCount || 0), prices.length),
    rawText: [base.rawText, name, sku, ...prices.map((p) => `${p.label} ${p.text || p.value}`)].filter(Boolean).join(' | ').slice(0, 1800),
    fieldEvidence: {
      ...(base.fieldEvidence || {}),
      name: { confidence: Math.max(base?.fieldEvidence?.name?.confidence || 0, clamp01(recovered?.name?.confidence)), bbox: normalizeBbox(recovered?.name?.bbox) || base?.fieldEvidence?.name?.bbox || null },
      sku: { confidence: Math.max(base?.fieldEvidence?.sku?.confidence || 0, clamp01(recovered?.sku?.confidence)), bbox: normalizeBbox(recovered?.sku?.bbox) || base?.fieldEvidence?.sku?.bbox || null },
      price: { confidence: Math.max(base?.fieldEvidence?.price?.confidence || 0, priceConf), bbox: prices[0]?.bbox || base?.fieldEvidence?.price?.bbox || null },
    },
    evidence: { ...(base.evidence || {}), targetedRecovery: true },
    _layoutNeedsRecovery: false,
  };
}

export function summarizePdfDocumentIR(pageIrs = []) {
  const pages = pageIrs.filter(Boolean);
  const roles = new Set();
  const rowModels = new Set();
  const sectionTitles = [];
  let rows = 0, tables = 0, mergedSpecSections = 0;
  for (const raw of pages) {
    const ir = raw?.schemaVersion === PDF_DOCUMENT_IR_SCHEMA_VERSION ? raw : normalizePdfDocumentIR(raw, { pageNum: raw?.page || 1 });
    for (const table of ir.tables || []) {
      tables += 1; rowModels.add(table.rowModel || 'unknown');
      for (const h of table.headers || []) roles.add(h.role || 'unknown');
      for (const section of table.sections || []) {
        if (section.title) sectionTitles.push(section.title);
        if (section.sharedSpecs) mergedSpecSections += 1;
        rows += (section.rows || []).filter((r) => r.kind === 'product').length;
      }
    }
  }
  return { pages: pages.length, tables, rows, roles: [...roles].sort(), rowModels: [...rowModels].sort(), mergedSpecSections, sectionTitles: sectionTitles.slice(0, 20) };
}

export function makePdfTemplateFingerprint(summary = {}) {
  const raw = [
    (summary.roles || []).slice().sort().join(','),
    (summary.rowModels || []).slice().sort().join(','),
    Number(summary.mergedSpecSections || 0) > 0 ? 'merged_specs' : 'row_specs',
    Number(summary.tables || 0) > 1 ? 'multi_table' : 'single_table',
  ].join('|');
  let h = 0x811c9dc5;
  for (let i = 0; i < raw.length; i++) { h ^= raw.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return `pdf_tpl_${(h >>> 0).toString(36)}`;
}
