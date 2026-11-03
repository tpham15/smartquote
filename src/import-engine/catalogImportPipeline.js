// RC16 S4 — the catalog-import decision pipeline as pure functions.
//
// SmartQuote.jsx (ProductImporter) and scripts/e2e-import-smoke.mjs both call
// these, so the end-to-end harness exercises exactly the code path a dealer
// hits when they upload a file, decide the price role, resolve ambiguous
// matches, approve rows and finally save into the catalog.
import { sanitizeCatalogProducts, isUnsafeImportedProduct, isLikelyOldQuoteFileName, dedupeCatalogIdentities } from "./productSanitizer.js";
import { buildCatalogPreview } from "./legacy/legacyCatalogImport.js";
import { guessSupplierFromFileName } from "./normalizeWorkbook.js";
import { annotateCatalogMatches, isWeakSupplierEvidence, isWeakBrandEvidence } from "./productIdentity.js";
import { applyCommercialValidation } from "./businessValidator.js";
import { applyAmbiguousPriceRole } from "./priceRoleDecision.js";
import { mergeCatalogImport, projectedCatalogCount } from "./catalogImportMerge.js";
import { applyCorrectionLearning, saveProductLearningBatch } from "./correctionLearning.js";
import { applyQuoteIdentityLearning } from "../learning/quoteLearning.js";

/**
 * RC16: correction learning step of the import, shared by the UI
 * (applyLearningIfAllowed, behind the correction_learning capability) and the
 * e2e harness — learned fixes from the dealer's previous imports + final quotes.
 */
export function applyImportLearning(items = [], meta = {}) {
  const corrected = applyCorrectionLearning(items, meta);
  const fromFinalQuotes = applyQuoteIdentityLearning(corrected.products || []);
  return {
    products: fromFinalQuotes.products,
    hits: Number(corrected.hits || 0) + Number(fromFinalQuotes.hits || 0),
    quoteSuggestions: Number(fromFinalQuotes.suggestions || 0),
  };
}

/** RC16: remember saved rows; returns how many rows produced a reusable rule. */
export function learnFromImportedRows(items = [], meta = {}) {
  const valid = (items || []).filter((p) => p && (p.name || p.sku));
  if (!valid.length) return 0;
  return saveProductLearningBatch(valid, meta).saved || 0;
}

export const importIssueLevel = (it) => typeof it === "string"
  ? (/lỗi|error|thiếu tên|không phải|bất thường|không tách được/i.test(it) ? "error" : "warning")
  : (it?.level || "warning");
export const importIssueCode = (it) => typeof it === "string" ? String(it).toLowerCase() : String(it?.code || "").toLowerCase();

export function isBlockingImportIssue(it) {
  const code = importIssueCode(it);
  const msg = typeof it === "string" ? it.toLowerCase() : String(it?.message || "").toLowerCase();
  if (importIssueLevel(it) === "error") return true;
  return /missing_product_name|price_parse_failed|price_unreasonable|non_product_row|name_too_long/.test(code)
    || /thiếu tên|không phải sản phẩm|giá nhập bất thường|không tách được giá|tên sản phẩm quá dài/.test(msg);
}

export function isOldQuoteImport(fileName = "", importSourceKind = "") {
  return importSourceKind === "old_quote" || isLikelyOldQuoteFileName(fileName);
}

export function isCatalogSkippedProduct(p) {
  const status = String(p?._meta?.canonicalStatus || p?._meta?.status || p?.status || "").toLowerCase();
  return status === "skipped" || !!p?._skipReason || !!p?._meta?.skipReason || !!p?._meta?.oldQuoteGuardSkipped;
}

export function splitCatalogPreviewProducts(items = []) {
  const all = (items || []).filter(Boolean);
  const skipped = all.filter(isCatalogSkippedProduct);
  const active = all.filter((p) => !isCatalogSkippedProduct(p));
  return { active, skipped, skippedCount: skipped.length };
}

function revalidate(items, catalog = []) {
  const matched = annotateCatalogMatches(items, catalog || []);
  return applyCommercialValidation(matched, { existingProducts: catalog || [] }).products;
}

/**
 * RC16: an old quote's file name names the CUSTOMER or project
 * ("BG_Villa_Anh_Tuan.xlsx" → "BG Villa Anh Tuan"), not a supplier. When the
 * dealer explicitly chose "Báo giá cũ / công trình cũ", drop a supplier/brand
 * that only came from the file name instead of saving the customer as NCC.
 */
export function dropFileNameSupplierForOldQuote(items = []) {
  return (items || []).map((p) => {
    if (!p) return p;
    const weakSupplier = !!p.supplier && isWeakSupplierEvidence(p);
    const weakBrand = !!p.brand && isWeakBrandEvidence(p);
    if (!weakSupplier && !weakBrand) return p;
    const meta = { ...(p._meta || {}) };
    if (weakSupplier) meta.droppedFileNameSupplier = p.supplier;
    if (weakBrand) meta.droppedFileNameBrand = p.brand;
    return { ...p, ...(weakSupplier ? { supplier: "" } : {}), ...(weakBrand ? { brand: "" } : {}), _meta: meta };
  });
}

/** sanitize → shared catalog matcher → commercial validation (same as the UI). */
export function prepareCatalogImportProducts(items, { catalog = [], sourceFileName = "", importSourceKind = "", ...rest } = {}) {
  if (importSourceKind === "old_quote") items = dropFileNameSupplierForOldQuote(items);
  const sanitized = sanitizeCatalogProducts(items, {
    ...rest,
    sourceFileName,
    importSourceKind,
    oldQuoteMode: isOldQuoteImport(sourceFileName, importSourceKind),
  });
  return revalidate(sanitized, catalog);
}

export function hasImportIssue(p, code) {
  return (p?._meta?.issues || p?.issues || []).some((it) => importIssueCode(it) === code);
}

/** Whole-file decision for an ambiguous "Đơn giá" column: "cost" | "list". */
export function applyPriceRoleDecision(items, role, { catalog = [] } = {}) {
  return revalidate(applyAmbiguousPriceRole(items, role), catalog);
}

/** User resolves catalog_match_ambiguous: kind "update" (with targetId) | "new". */
export function applyCatalogMatchDecision(items, index, kind, targetId = null, { catalog = [] } = {}) {
  const decided = (items || []).map((product, i) => {
    if (i !== index) return product;
    const meta = { ...(product._meta || {}) };
    const issues = (meta.issues || []).filter((it) => importIssueCode(it) !== "catalog_match_ambiguous");
    return {
      ...product,
      _meta: {
        ...meta,
        issues: [...issues, {
          code: kind === "update" ? "catalog_match_user_update" : "catalog_match_user_new",
          level: "info",
          message: kind === "update" ? "Người dùng chọn cập nhật sản phẩm catalog hiện có" : "Người dùng chọn thêm thành sản phẩm mới",
          field: "sku",
        }],
        catalogMatchDecision: { kind, targetId: kind === "update" ? targetId : null },
      },
    };
  });
  return revalidate(decided, catalog);
}

/**
 * "Duyệt" one preview row. Returns { items, refused } where refused is
 * "price_column_uncertain" | "catalog_match_ambiguous" | "blocking" | null.
 * `issuesFor(product, index)` lets the UI add line-level issues.
 */
export function approveImportRow(items, index, { issuesFor } = {}) {
  const current = (items || [])[index];
  if (!current) return { items, refused: "missing" };
  const issues = issuesFor ? issuesFor(current, index) : (current._meta?.issues || current.issues || []);
  if (issues.some((it) => importIssueCode(it) === "price_column_uncertain")) return { items, refused: "price_column_uncertain" };
  if (issues.some((it) => importIssueCode(it) === "catalog_match_ambiguous")) return { items, refused: "catalog_match_ambiguous" };
  if (issues.some(isBlockingImportIssue)) return { items, refused: "blocking" };
  const next = items.map((p, i) => i === index ? {
    ...p,
    _meta: {
      ...(p._meta || {}),
      issues: [],
      status: "new",
      canonicalStatus: "auto_approved",
      confidence: 0.9,
      userApproved: true,
    },
  } : p);
  return { items: next, refused: null };
}

export function countImportableProducts(items = []) {
  return (items || []).filter((p) => !isUnsafeImportedProduct(p)).length;
}

/** Final re-sanitize before save, then split safe/unsafe exactly like applyImport. */
export function finalizeCatalogImport(items, opts = {}) {
  const cleaned = prepareCatalogImportProducts(items, opts);
  const unsafe = cleaned.filter(isUnsafeImportedProduct);
  const safe = cleaned.filter((p) => !isUnsafeImportedProduct(p));
  return { cleaned, unsafe, safe };
}

/** Merge finalized safe rows into a catalog (merge mode) or replace it. */
export function commitCatalogImport(catalog = [], safeItems = [], { mode = "merge", idFactory } = {}) {
  if (mode === "replace") return { products: safeItems, added: safeItems.length, updated: 0, projectedCount: safeItems.length };
  const projectedCount = projectedCatalogCount(catalog, safeItems);
  const merged = mergeCatalogImport(catalog, safeItems, { idFactory });
  return { ...merged, projectedCount };
}

/**
 * RC16: the supplier that saving this preview row will actually leave in the
 * catalog — same rule as catalogImportMerge.mergePayload. The preview shows
 * this instead of the raw file value, so an "Cập nhật" row never displays a
 * filename guess ("den") that the save is going to ignore.
 * Returns { value, weak, kept } — kept=true when the catalog value is retained.
 */
export function effectiveImportSupplier(product = {}) {
  const incoming = String(product?.supplier || "").trim();
  const weak = isWeakSupplierEvidence(product);
  const match = product?._meta?.catalogMatch || {};
  const decision = product?._meta?.catalogMatchDecision || {};
  const isUpdate = match.kind === "update" || (decision.kind === "update" && decision.targetId);
  if (isUpdate && (weak || !incoming)) {
    const chosen = decision.kind === "update" && decision.targetId
      ? (match.candidates || []).find((c) => c.id === decision.targetId)
      : null;
    const kept = chosen ? chosen.supplier : match.targetSupplier;
    return { value: String(kept || "").trim(), weak: false, kept: true };
  }
  return { value: incoming, weak: weak && !!incoming, kept: false };
}

/**
 * RC16: "Sửa mapping" preview. Same file-name supplier guess as the engine
 * path, labelled weak, so a manual re-map can never reintroduce the S1 bug.
 */
export function buildManualMappingPreview(rows = [], colMap = {}, { fileName = "", startRowIndex = 0, quoteTable = false } = {}) {
  return buildCatalogPreview(rows, colMap, {
    startRowIndex,
    defaultSupplier: guessSupplierFromFileName(fileName || ""),
    defaultSupplierSource: "file_name",
    sheetName: fileName || "manual-mapping.xlsx",
    quoteTable,
  });
}

/**
 * RC16: last stage of a multi-file import — identity dedupe across files
 * (never bare-SKU last-file-wins), then the normal prepare + skip split.
 */
export function prepareMultiFileImport(products = [], opts = {}) {
  const identityBatch = dedupeCatalogIdentities(products);
  const prepared = prepareCatalogImportProducts(identityBatch.products, opts);
  return { ...splitCatalogPreviewProducts(prepared), conflicts: identityBatch.conflicts, deduped: identityBatch.deduped };
}
