// ============================================================
// ImportPreviewResult v2 — canonical import output for SmartQuote
// Thuần JS + JSDoc. Không phụ thuộc React.
//
// Mục tiêu Phase 2:
// - Mọi import flow trả về cùng một schema preview.
// - UI chỉ cần đọc summary/lines/status/issues thay vì mỗi flow một kiểu.
// - Giữ backward compatibility bằng cách vẫn có stats/items ở runImport.
// ============================================================

export const IMPORT_STATUS = {
  AUTO_APPROVED: "auto_approved",
  NEED_REVIEW: "need_review",
  FAILED: "failed",
  SKIPPED: "skipped",
};

export const IMPORT_LINE_KIND = {
  CATALOG_PRODUCT: "catalog_product",
  PRICE_UPDATE: "price_update",
  BOM_ITEM: "bom_item",
};

let _seq = 0;
export function makeImportId(prefix = "imp") {
  return `${prefix}_${Date.now().toString(36)}_${(_seq++).toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function clamp01(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

export function normalizeImportIssue(issue) {
  if (!issue) return null;
  if (typeof issue === "string") {
    const lower = issue.toLowerCase();
    const level = /lỗi|thiếu tên|không phải|failed|error/.test(lower) ? "error" : "warning";
    return { code: slugify(issue).slice(0, 48) || "issue", level, message: issue };
  }
  return {
    code: issue.code || slugify(issue.message || "issue").slice(0, 48) || "issue",
    level: issue.level || "warning",
    message: issue.message || String(issue.code || "Có vấn đề cần kiểm tra"),
    field: issue.field,
    suggestedFix: issue.suggestedFix,
  };
}


function stableHash(str) {
  let h = 0x811c9dc5;
  const s = String(str || "");
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

function stableLineId(line = {}, index = 0) {
  if (line.lineId) return line.lineId;
  const source = line.source || {};
  const raw = line.raw || {};
  const parsed = line.parsed || {};
  const key = [
    source.fileName || "",
    source.sheet || source.sheetName || "",
    source.page || "",
    source.row ?? source.rowIndex ?? index + 1,
    raw.sku || parsed.sku || "",
    raw.productName || parsed.productName || "",
    raw.price || parsed.costPrice || parsed.unitPrice || "",
  ].join("::");
  return "line_" + stableHash(key);
}

function slugify(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function canonicalStatusFromLegacy(item = {}) {
  const old = item.status || item._meta?.status;
  const issues = (item.issues || item._meta?.issues || []).map(normalizeImportIssue).filter(Boolean);
  const hasError = issues.some((i) => i.level === "error");
  const conf = clamp01(item.confidence ?? item._meta?.confidence ?? 0.72);

  if (old === "rejected" || old === "failed") return IMPORT_STATUS.FAILED;
  if (old === "skipped") return IMPORT_STATUS.SKIPPED;
  if (old === "review") return IMPORT_STATUS.NEED_REVIEW;
  if (hasError && conf < 0.7) return IMPORT_STATUS.FAILED;
  if (conf < 0.62) return IMPORT_STATUS.NEED_REVIEW;
  return IMPORT_STATUS.AUTO_APPROVED;
}

export function buildSummary(lines = [], extra = {}) {
  const lineSkipped = lines.filter((l) => l.status === IMPORT_STATUS.SKIPPED).length;
  const extraSkipped = extra.skipped == null ? 0 : (Number(extra.skipped) || 0);
  const summary = {
    totalRows: Number(extra.totalRows ?? lines.length) || 0,
    parsedItems: lines.filter((l) => l.status !== IMPORT_STATUS.SKIPPED && (l.kind !== IMPORT_LINE_KIND.PRICE_UPDATE || l.parsed)).length,
    autoApproved: lines.filter((l) => l.status === IMPORT_STATUS.AUTO_APPROVED).length,
    needReview: lines.filter((l) => l.status === IMPORT_STATUS.NEED_REVIEW).length,
    failed: lines.filter((l) => l.status === IMPORT_STATUS.FAILED).length,
    skipped: extra.skipped == null ? lineSkipped : extraSkipped + lineSkipped,
    noteRows: Number(extra.noteRows || 0),
    aiUsed: Number(extra.aiUsed || 0),
    matched: Number(extra.matched ?? lines.filter((l) => l.matchedProduct?.productId).length) || 0,
    new: Number(extra.new ?? lines.filter((l) => !l.matchedProduct?.productId && l.status !== IMPORT_STATUS.FAILED && l.status !== IMPORT_STATUS.SKIPPED).length) || 0,
    updated: Number(extra.updated || 0),
    unchanged: Number(extra.unchanged || 0),
  };
  return summary;
}

export function createImportPreviewResult(params = {}) {
  const lines = (params.lines || []).map((line, index) => normalizeImportLine(line, index));
  const summary = buildSummary(lines, params.summary || {});
  const confidences = lines
    .filter((l) => l.status !== IMPORT_STATUS.SKIPPED)
    .map((l) => clamp01(l.confidence));
  const overallConfidence = params.overallConfidence ?? (
    confidences.length ? confidences.reduce((s, x) => s + x, 0) / confidences.length : 0
  );

  return {
    importId: params.importId || makeImportId("import"),
    fileName: params.fileName || "",
    importType: params.importType || "catalog",
    detectedTemplateId: params.detectedTemplateId || params.templateId || null,
    templateKnown: !!params.templateKnown,
    detectedIndustry: params.detectedIndustry || params.domain || "unknown",
    overallConfidence: Math.round(clamp01(overallConfidence) * 100) / 100,
    summary,
    lines,
    warnings: params.warnings || [],
    engine: params.engine || "unknown",
    createdAt: params.createdAt || new Date().toISOString(),
  };
}

export function normalizeImportLine(line = {}, index = 0) {
  const issues = (line.issues || []).map(normalizeImportIssue).filter(Boolean);
  const confidence = clamp01(line.confidence ?? 0.72);
  const status = line.status && Object.values(IMPORT_STATUS).includes(line.status)
    ? line.status
    : canonicalStatusFromLegacy({ ...line, confidence, issues });

  return {
    lineId: stableLineId(line, index),
    lineNo: Number(line.lineNo || index + 1),
    kind: line.kind || IMPORT_LINE_KIND.CATALOG_PRODUCT,
    source: normalizeSource(line.source, index),
    rowType: line.rowType || (status === IMPORT_STATUS.SKIPPED ? "skipped" : "item"),
    raw: line.raw || {},
    parsed: line.parsed || {},
    matchedProduct: line.matchedProduct || null,
    confidence: Math.round(confidence * 100) / 100,
    status,
    issues,
  };
}

function normalizeSource(source = {}, index = 0) {
  return {
    sheet: source.sheet || source.sheetName || "",
    row: Number(source.row ?? source.rowIndex ?? index + 1) || index + 1,
    cells: source.cells || source.cellRefs || {},
    rawText: source.rawText || "",
    page: source.page || null,
    fileName: source.fileName || "",
  };
}

/** Convert item engine cũ → canonical line. */
export function engineItemToImportLine(item = {}, index = 0) {
  const price = Number(item.price ?? item.costPrice ?? 0) || 0;
  const listPrice = Number(item.listPrice ?? item.publicPrice ?? 0) || 0;
  const minRetailPrice = Number(item.minRetailPrice ?? 0) || 0;
  const issues = (item.issues || []).map(normalizeImportIssue).filter(Boolean);
  const status = canonicalStatusFromLegacy(item);
  return normalizeImportLine({
    lineId: item.lineId || item._meta?.lineId,
    lineNo: index + 1,
    kind: IMPORT_LINE_KIND.CATALOG_PRODUCT,
    rowType: "item",
    source: item.source || item._meta?.source || {},
    raw: {
      productName: item.source?.rawText || item._meta?.source?.rawText || item.name || "",
      sku: item.sku || "",
      unit: item.unit || "",
      price,
    },
    parsed: {
      productName: item.name || "",
      sku: item.sku || "",
      category: item.category || "Chung",
      supplier: item.supplier || "",
      unit: item.unit || "Cái",
      unitPrice: price,
      costPrice: price,
      listPrice,
      publicPrice: listPrice,
      minRetailPrice,
      priceMode: listPrice > 0 ? "fixed" : (item.priceMode || "markup"),
      specs: item.specs || "",
      skipReason: item._skipReason || (item._subtotalSuspect ? "generic_category_subtotal" : undefined),
    },
    matchedProduct: item.matchedProductId ? {
      productId: item.matchedProductId,
      sku: item.sku || "",
      name: item.name || "",
      confidence: item._matchScore ?? item.confidence ?? 0,
      matchMethod: item._matchType || "unknown",
      reason: item._matchType ? `Khớp bằng ${item._matchType}` : "Đã khớp catalog",
    } : null,
    confidence: item.confidence ?? item._meta?.confidence ?? 0.72,
    status,
    issues,
  }, index);
}

/** Convert product UI shape → canonical line. */
export function productToImportLine(product = {}, index = 0) {
  const meta = product._meta || {};
  const price = Number(product.costPrice ?? product.price ?? 0) || 0;
  const listPrice = Number(product.listPrice ?? product.publicPrice ?? 0) || 0;
  const minRetailPrice = Number(product.minRetailPrice ?? 0) || 0;
  const issues = (meta.issues || product.issues || []).map(normalizeImportIssue).filter(Boolean);
  return normalizeImportLine({
    lineId: meta.lineId || product.lineId,
    lineNo: index + 1,
    kind: IMPORT_LINE_KIND.CATALOG_PRODUCT,
    source: meta.source || product.source || {},
    rowType: "item",
    raw: {
      productName: meta.source?.rawText || product.name || "",
      sku: product.sku || "",
      unit: product.unit || "",
      price,
    },
    parsed: {
      productName: product.name || "",
      sku: product.sku || "",
      category: product.category || "Chung",
      supplier: product.supplier || "",
      unit: product.unit || "Cái",
      unitPrice: price,
      costPrice: price,
      listPrice,
      publicPrice: listPrice,
      minRetailPrice,
      priceMode: listPrice > 0 ? "fixed" : (product.priceMode || "markup"),
      specs: product.specs || "",
    },
    matchedProduct: meta.matchedProductId ? {
      productId: meta.matchedProductId,
      sku: product.sku || "",
      name: product.name || "",
      confidence: meta.confidence || 0,
      matchMethod: meta.matchMethod || meta.status || "unknown",
      reason: "Khớp từ import engine",
    } : null,
    confidence: meta.confidence ?? product.confidence ?? 0.72,
    status: meta.canonicalStatus || canonicalStatusFromLegacy({ ...product, status: meta.status, issues, confidence: meta.confidence }),
    issues,
  }, index);
}

export function productsToImportPreviewResult({ products = [], fileName = "", engine = "ui", detectedIndustry = "unknown", warnings = [], importType = "catalog", detectedTemplateId = null, templateKnown = false, summary = {} } = {}) {
  return createImportPreviewResult({
    fileName,
    importType,
    engine,
    detectedIndustry,
    detectedTemplateId,
    templateKnown,
    warnings,
    summary,
    lines: products.map(productToImportLine),
  });
}

export function engineResultToImportPreviewResult(result = {}, fileName = "") {
  return createImportPreviewResult({
    fileName,
    importType: "catalog",
    detectedTemplateId: result.templateId,
    templateKnown: result.templateKnown,
    detectedIndustry: result.domain,
    engine: result.engine || "v2",
    warnings: result.warnings || [],
    summary: {
      totalRows: result.stats?.sourceRows ?? result.stats?.total,
      skipped: result.stats?.skipped,
      noteRows: result.stats?.noteRows,
      aiUsed: result.stats?.aiUsed,
      matched: result.stats?.matched,
      new: result.stats?.new,
    },
    lines: (result.items || []).map(engineItemToImportLine),
  });
}

export function combineImportPreviewResults(results = [], opts = {}) {
  const lines = [];
  const warnings = [];
  for (const r of results) {
    if (!r) continue;
    lines.push(...(r.lines || []));
    if (r.warnings?.length) warnings.push(...r.warnings.map((w) => `${r.fileName || "File"}: ${w}`));
  }
  return createImportPreviewResult({
    fileName: opts.fileName || `${results.length} files`,
    importType: opts.importType || "catalog_batch",
    engine: opts.engine || "mixed",
    detectedIndustry: opts.detectedIndustry || "mixed",
    warnings,
    lines,
    summary: opts.summary || {},
  });
}

/** Lọc các dòng được phép apply vào catalog. */
export function importPreviewLinesToProducts(preview) {
  return (preview?.lines || [])
    .filter((l) => l.status !== IMPORT_STATUS.FAILED && l.status !== IMPORT_STATUS.SKIPPED)
    .map((l) => ({
      id: makeImportId("imp"),
      name: l.parsed.productName || l.raw.productName || "",
      sku: l.parsed.sku || l.raw.sku || "",
      category: l.parsed.category || "Chung",
      supplier: l.parsed.supplier || "",
      unit: l.parsed.unit || "Cái",
      costPrice: Number(l.parsed.costPrice ?? l.parsed.unitPrice ?? 0) || 0,
      listPrice: Number(l.parsed.listPrice ?? l.parsed.publicPrice ?? 0) || 0,
      minRetailPrice: Number(l.parsed.minRetailPrice ?? 0) || 0,
      priceMode: Number(l.parsed.listPrice ?? l.parsed.publicPrice ?? 0) > 0 ? "fixed" : (l.parsed.priceMode || "markup"),
      specs: l.parsed.specs || "",
      image: "",
      _meta: {
        confidence: l.confidence,
        status: l.status,
        issues: l.issues,
        source: l.source,
        matchedProductId: l.matchedProduct?.productId || null,
        importId: preview.importId,
        lineId: l.lineId,
      },
    }));
}

export function priceUpdatePreviewFromLegacy({ fileName = "", matched = [], unchanged = [], newItems = [] } = {}) {
  const lines = [];
  matched.forEach((m, index) => {
    const oldCost = Number(m.existing?.costPrice || 0) || 0;
    const newCost = Number(m.newCost || 0) || 0;
    const diffPct = oldCost ? Math.round(((newCost - oldCost) / oldCost) * 100) : 0;
    lines.push(normalizeImportLine({
      lineNo: index + 1,
      kind: IMPORT_LINE_KIND.PRICE_UPDATE,
      rowType: "item",
      source: { rawText: m.name || m.existing?.name || "", fileName },
      raw: { productName: m.name || m.existing?.name || "", sku: m.existing?.sku || "", oldCost, newCost },
      parsed: { productName: m.name || m.existing?.name || "", sku: m.existing?.sku || "", costPrice: newCost, oldCost, diffPct },
      matchedProduct: m.existing ? {
        productId: m.existing.id,
        sku: m.existing.sku || "",
        name: m.existing.name || "",
        confidence: 1,
        matchMethod: "exact_sku",
        reason: "Khớp SKU để cập nhật giá nhập",
      } : null,
      confidence: 0.98,
      status: IMPORT_STATUS.AUTO_APPROVED,
      issues: [],
    }, lines.length));
  });

  newItems.forEach((it) => {
    const issues = [];
    if (!it.sku) issues.push({ code: "missing_sku", level: "warning", message: "Thiết bị mới thiếu SKU" });
    lines.push(normalizeImportLine({
      lineNo: lines.length + 1,
      kind: IMPORT_LINE_KIND.CATALOG_PRODUCT,
      rowType: "item",
      source: { rawText: it.name || it.sku || "", fileName },
      raw: { productName: it.name || "", sku: it.sku || "", price: it.costPrice || 0 },
      parsed: {
        productName: it.name || it.sku || "",
        sku: it.sku || "",
        category: it.category || "Chung",
        supplier: it.supplier || "",
        unit: it.unit || "Cái",
        costPrice: Number(it.costPrice || 0) || 0,
        unitPrice: Number(it.costPrice || 0) || 0,
        listPrice: Number(it.listPrice || it.publicPrice || 0) || 0,
        publicPrice: Number(it.listPrice || it.publicPrice || 0) || 0,
        minRetailPrice: Number(it.minRetailPrice || 0) || 0,
        priceMode: Number(it.listPrice || it.publicPrice || 0) > 0 ? "fixed" : (it.priceMode || "markup"),
        specs: it.specs || "",
      },
      matchedProduct: null,
      confidence: it.sku ? 0.88 : 0.72,
      status: it.sku ? IMPORT_STATUS.AUTO_APPROVED : IMPORT_STATUS.NEED_REVIEW,
      issues,
    }, lines.length));
  });

  return createImportPreviewResult({
    fileName,
    importType: "price_update",
    engine: "legacy-price-update",
    detectedIndustry: "catalog",
    lines,
    summary: {
      totalRows: matched.length + unchanged.length + newItems.length,
      updated: matched.length,
      unchanged: unchanged.length,
      new: newItems.length,
    },
  });
}
