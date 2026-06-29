// ============================================================
// correctionLearning — Phase 3 local learning layer.
// Học từ các dòng user Sửa/Duyệt/Merge để lần sau import file tương tự
// SmartQuote tự sửa tên, SKU, nhóm, NCC, ĐVT, giá nhập/giá công bố.
//
// Browser/localStorage first. Sau này có thể thay bằng backend per-account.
// ============================================================

const LEARNING_KEY = "sq_correction_learning_v1";
const MAX_SKU_RULES = 5000;
const MAX_RAW_RULES = 5000;
const MAX_SUPPLIER_PROFILES = 300;

function safeStorage() {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    return null;
  }
}

export function normalizeLearningText(v) {
  return String(v || "")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function compactLearningKey(v) {
  return normalizeLearningText(v).replace(/\s+/g, "");
}

export function normalizeSkuKey(v) {
  return String(v || "").toLowerCase().replace(/[\s\-\/\.\_]/g, "");
}

function now() { return Date.now(); }

function emptyDb() {
  return {
    version: 1,
    bySku: {},
    byRaw: {},
    supplierProfiles: {},
    updatedAt: now(),
  };
}

export function loadCorrectionLearning() {
  const ls = safeStorage();
  if (!ls) return emptyDb();
  try {
    const parsed = JSON.parse(ls.getItem(LEARNING_KEY) || "null");
    return parsed && typeof parsed === "object" ? { ...emptyDb(), ...parsed } : emptyDb();
  } catch {
    return emptyDb();
  }
}

function saveDb(db) {
  const ls = safeStorage();
  if (!ls) return false;
  try {
    db.updatedAt = now();
    pruneDb(db);
    ls.setItem(LEARNING_KEY, JSON.stringify(db));
    return true;
  } catch {
    return false;
  }
}

function pruneMap(obj, max) {
  const entries = Object.entries(obj || {});
  if (entries.length <= max) return obj || {};
  entries.sort((a, b) => Number(a[1]?.updatedAt || a[1]?.createdAt || 0) - Number(b[1]?.updatedAt || b[1]?.createdAt || 0));
  const keep = entries.slice(entries.length - max);
  return Object.fromEntries(keep);
}

function pruneDb(db) {
  db.bySku = pruneMap(db.bySku, MAX_SKU_RULES);
  db.byRaw = pruneMap(db.byRaw, MAX_RAW_RULES);
  db.supplierProfiles = pruneMap(db.supplierProfiles, MAX_SUPPLIER_PROFILES);
}

export function supplierProfileKey(fileName = "", supplier = "") {
  const fromSupplier = normalizeLearningText(supplier);
  if (fromSupplier) return fromSupplier.slice(0, 80);
  return normalizeLearningText(fileName)
    .replace(/\.(xlsx|xls|pdf)$/i, "")
    .replace(/\b(20\d{2}|19\d{2}|bang gia|bao gia|catalog|price|dl|dai ly|cap nhat|update|file|xlsx|xls|pdf)\b/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function sourceRaw(product = {}) {
  return product?._meta?.source?.rawText || product?.source?.rawText || product?.rawText || product?.name || "";
}

function toLearnedFields(product = {}) {
  return {
    name: String(product.name || "").trim(),
    sku: String(product.sku || "").trim(),
    category: String(product.category || "").trim(),
    supplier: String(product.supplier || "").trim(),
    unit: String(product.unit || "").trim(),
    costPrice: Number(product.costPrice || product.price || 0) || 0,
    listPrice: Number(product.listPrice || product.publicPrice || 0) || 0,
    minRetailPrice: Number(product.minRetailPrice || 0) || 0,
    specs: String(product.specs || "").trim(),
  };
}

function mergeRule(prev = {}, fields = {}, meta = {}) {
  const acceptedCount = Number(prev.acceptedCount || 0) + 1;
  const userEditedCount = Number(prev.userEditedCount || 0) + (meta.userEdited ? 1 : 0);
  // User-edited fields should win over purely auto-approved historical data.
  const preferNew = meta.userEdited || !prev.fields || userEditedCount >= Number(prev.userEditedCount || 0);
  const nextFields = preferNew ? { ...(prev.fields || {}), ...fields } : { ...fields, ...(prev.fields || {}) };
  return {
    ...prev,
    fields: nextFields,
    acceptedCount,
    userEditedCount,
    lastFileName: meta.fileName || prev.lastFileName || "",
    lastIndustry: meta.detectedIndustry || prev.lastIndustry || "",
    lastSource: meta.source || prev.lastSource || {},
    createdAt: prev.createdAt || now(),
    updatedAt: now(),
  };
}

export function saveProductLearning(product, meta = {}) {
  if (!product) return { ok: false, reason: "missing_product" };
  const fields = toLearnedFields(product);
  if (!fields.name && !fields.sku) return { ok: false, reason: "empty_product" };

  const db = loadCorrectionLearning();
  const skuKey = normalizeSkuKey(fields.sku);
  const rawKey = compactLearningKey(sourceRaw(product));
  const source = product?._meta?.source || product?.source || {};
  const baseMeta = { ...meta, source };

  if (skuKey) db.bySku[skuKey] = mergeRule(db.bySku[skuKey], fields, baseMeta);
  if (rawKey && rawKey.length >= 6) db.byRaw[rawKey] = mergeRule(db.byRaw[rawKey], fields, baseMeta);

  const supplierKey = supplierProfileKey(meta.fileName || source.fileName || "", fields.supplier);
  if (supplierKey) {
    const prev = db.supplierProfiles[supplierKey] || { categories: {}, suppliers: {}, units: {}, acceptedCount: 0, createdAt: now() };
    if (fields.category) prev.categories[fields.category] = (prev.categories[fields.category] || 0) + 1;
    if (fields.supplier) prev.suppliers[fields.supplier] = (prev.suppliers[fields.supplier] || 0) + 1;
    if (fields.unit) prev.units[fields.unit] = (prev.units[fields.unit] || 0) + 1;
    prev.acceptedCount = Number(prev.acceptedCount || 0) + 1;
    prev.lastFileName = meta.fileName || prev.lastFileName || "";
    prev.lastIndustry = meta.detectedIndustry || prev.lastIndustry || "";
    prev.updatedAt = now();
    db.supplierProfiles[supplierKey] = prev;
  }

  return { ok: saveDb(db), skuKey, rawKey };
}

export function saveProductLearningBatch(products = [], meta = {}) {
  let saved = 0;
  for (const p of products || []) {
    const res = saveProductLearning(p, meta);
    if (res.ok) saved += 1;
  }
  return { saved };
}

function isPlaceholderCategory(v) {
  const s = normalizeLearningText(v);
  return !s || ["chung", "san pham", "bang bao gia", "bao gia"].includes(s);
}

function shouldUseLearnedText(current, learned) {
  const c = String(current || "").trim();
  const l = String(learned || "").trim();
  if (!l) return false;
  if (!c) return true;
  if (compactLearningKey(c) === compactLearningKey(l)) return false;
  // If current name is just SKU/model and learned has a human name, prefer learned.
  const cCompact = compactLearningKey(c);
  const lCompact = compactLearningKey(l);
  if (cCompact.length <= 18 && lCompact.length > cCompact.length + 6) return true;
  return false;
}

function applyFields(product, fields, source) {
  if (!fields) return { product, applied: false };
  const p = { ...product, _meta: { ...(product._meta || {}) } };
  let applied = false;

  if (shouldUseLearnedText(p.name, fields.name)) { p.name = fields.name; applied = true; }
  if (!p.sku && fields.sku) { p.sku = fields.sku; applied = true; }
  if (isPlaceholderCategory(p.category) && fields.category) { p.category = fields.category; applied = true; }
  if (!p.supplier && fields.supplier) { p.supplier = fields.supplier; applied = true; }
  if ((!p.unit || normalizeLearningText(p.unit) === "cai") && fields.unit) { p.unit = fields.unit; applied = true; }
  if (!(Number(p.costPrice) > 0) && Number(fields.costPrice) > 0) { p.costPrice = fields.costPrice; applied = true; }
  if (!(Number(p.listPrice || p.publicPrice) > 0) && Number(fields.listPrice) > 0) {
    p.listPrice = fields.listPrice;
    p.publicPrice = fields.listPrice;
    p.priceMode = "fixed";
    applied = true;
  }
  if (!(Number(p.minRetailPrice) > 0) && Number(fields.minRetailPrice) > 0) { p.minRetailPrice = fields.minRetailPrice; applied = true; }
  if (!p.specs && fields.specs) { p.specs = fields.specs; applied = true; }

  if (applied) {
    const issues = Array.isArray(p._meta.issues) ? p._meta.issues.filter((it) => it?.code !== "correction_learning_applied") : [];
    issues.push({ code: "correction_learning_applied", level: "info", message: `Áp dụng học từ lần sửa trước (${source})` });
    p._meta = {
      ...p._meta,
      issues,
      correctionApplied: true,
      correctionSource: source,
      confidence: Math.max(Number(p._meta.confidence || 0), source === "sku" ? 0.95 : 0.9),
    };
  }
  return { product: p, applied };
}

export function applyCorrectionLearning(products = [], context = {}) {
  const db = loadCorrectionLearning();
  let hits = 0;
  const corrected = (products || []).map((product) => {
    const skuKey = normalizeSkuKey(product?.sku);
    const rawKey = compactLearningKey(sourceRaw(product));
    let result = { product, applied: false };
    if (skuKey && db.bySku[skuKey]?.fields) result = applyFields(result.product, db.bySku[skuKey].fields, "sku");
    if (!result.applied && rawKey && db.byRaw[rawKey]?.fields) result = applyFields(result.product, db.byRaw[rawKey].fields, "raw_text");
    if (result.applied) hits += 1;
    return result.product;
  });
  return { products: corrected, hits, dbUpdatedAt: db.updatedAt || null };
}

export function listCorrectionLearningStats() {
  const db = loadCorrectionLearning();
  return {
    skuRules: Object.keys(db.bySku || {}).length,
    rawRules: Object.keys(db.byRaw || {}).length,
    supplierProfiles: Object.keys(db.supplierProfiles || {}).length,
    updatedAt: db.updatedAt || null,
  };
}

export function clearCorrectionLearning() {
  const ls = safeStorage();
  if (!ls) return false;
  try { ls.removeItem(LEARNING_KEY); return true; } catch { return false; }
}
