import { tenantStorageGetItem, tenantStorageSetItem, tenantStorageRemoveItem } from "../storage/tenantStorage.js";
import { productIdentityKey, normalizeIdentityName, normalizeIdentitySku } from "../import-engine/productIdentity.js";

const KEY = "sq_quote_learning_v1";
const MAX_PRODUCTS = 10000;
const MAX_SEEN_OBSERVATIONS = 20000;
const MAX_PRICE_SAMPLES = 40;

function now() { return Date.now(); }
function n(value, fallback = 0) { const out = Number(value); return Number.isFinite(out) ? out : fallback; }
function text(value) { return value == null ? "" : String(value).trim(); }

function emptyDb() {
  return { version: 1, products: {}, seenObservations: {}, finalQuoteIds: {}, finalQuoteCount: 0, updatedAt: now() };
}

export function loadQuoteLearning() {
  try {
    const parsed = JSON.parse(tenantStorageGetItem(KEY) || "null");
    if (!parsed || typeof parsed !== "object") return emptyDb();
    return { ...emptyDb(), ...parsed, products: parsed.products || {}, seenObservations: parsed.seenObservations || {}, finalQuoteIds: parsed.finalQuoteIds || {} };
  } catch { return emptyDb(); }
}

function pruneObjectByTimestamp(obj = {}, max = 1000) {
  const entries = Object.entries(obj || {});
  if (entries.length <= max) return obj || {};
  entries.sort((a, b) => n(a[1]?.updatedAt ?? a[1]?.lastSeenAt ?? a[1], 0) - n(b[1]?.updatedAt ?? b[1]?.lastSeenAt ?? b[1], 0));
  return Object.fromEntries(entries.slice(entries.length - max));
}

function saveDb(db) {
  db.updatedAt = now();
  db.products = pruneObjectByTimestamp(db.products, MAX_PRODUCTS);
  db.seenObservations = pruneObjectByTimestamp(db.seenObservations, MAX_SEEN_OBSERVATIONS);
  db.finalQuoteIds = pruneObjectByTimestamp(db.finalQuoteIds, 5000);
  try { return tenantStorageSetItem(KEY, JSON.stringify(db)); } catch { return false; }
}

export function clearQuoteLearning() { try { return tenantStorageRemoveItem(KEY); } catch { return false; } }

function productSnapshotFromLine(line = {}) {
  const p = line.productSnapshot && typeof line.productSnapshot === "object" ? line.productSnapshot : {};
  return {
    id: text(p.id || line.productId), name: text(p.name), sku: text(p.sku), supplier: text(p.supplier), brand: text(p.brand),
    origin: text(p.origin || p.attributes?.origin), category: text(p.category), unit: text(p.unit || "Cái") || "Cái", specs: p.specs || "",
  };
}

function weightedAverage(values = []) {
  let totalWeight = 0, total = 0;
  for (const row of values) {
    const weight = Math.max(0, n(row.weight, 0));
    if (!weight) continue;
    total += n(row.value, 0) * weight; totalWeight += weight;
  }
  return totalWeight ? total / totalWeight : 0;
}

export function buildFinalQuoteLearningObservations({ quoteId = "", revision = 1, rooms = [], customer = {}, finalizedAt = "", industryId = "generic" } = {}) {
  const finalAt = finalizedAt || new Date().toISOString();
  const qid = text(quoteId) || `local:${finalAt}`;
  const grouped = new Map();
  for (const room of Array.isArray(rooms) ? rooms : []) {
    const sectionName = text(room?.name);
    for (const line of Array.isArray(room?.lines) ? room.lines : []) {
      const qty = Math.max(0, n(line?.qty, 0));
      if (!qty) continue;
      const product = productSnapshotFromLine(line);
      const productKey = productIdentityKey(product);
      if (!productKey) continue;
      const sale = Math.max(0, n(line?.salePriceSnapshot, 0));
      const cost = Math.max(0, n(line?.costPriceSnapshot, 0));
      const marginPct = sale > 0 && cost > 0 ? ((sale - cost) / sale) * 100 : null;
      const existing = grouped.get(productKey) || {
        observationKey: `${qid}|${productKey}`, quoteId: qid, revision: Math.max(1, n(revision, 1)), productKey, product,
        customerCategory: text(customer?.category), project: text(customer?.project), industryId: text(industryId || "generic") || "generic",
        sectionNames: [], totalQty: 0, saleRows: [], costRows: [], marginRows: [], finalizedAt: finalAt,
      };
      existing.totalQty += qty;
      if (sectionName && !existing.sectionNames.includes(sectionName)) existing.sectionNames.push(sectionName);
      if (sale > 0) existing.saleRows.push({ value: sale, weight: qty });
      if (cost > 0) existing.costRows.push({ value: cost, weight: qty });
      if (marginPct != null) existing.marginRows.push({ value: marginPct, weight: sale * qty || qty });
      grouped.set(productKey, existing);
    }
  }
  return [...grouped.values()].map((row) => ({
    observationKey: row.observationKey, quoteId: row.quoteId, revision: row.revision, productKey: row.productKey, product: row.product,
    customerCategory: row.customerCategory, project: row.project, industryId: row.industryId, sectionNames: row.sectionNames,
    totalQty: row.totalQty, salePrice: Math.round(weightedAverage(row.saleRows)), costPrice: Math.round(weightedAverage(row.costRows)),
    marginPct: row.marginRows.length ? weightedAverage(row.marginRows) : null, finalizedAt: row.finalizedAt,
  }));
}

function pushSample(list = [], value, meta = {}) {
  const v = n(value, NaN);
  if (!Number.isFinite(v) || v <= 0) return list || [];
  const next = [...(Array.isArray(list) ? list : []), { value: v, ...meta }];
  return next.slice(Math.max(0, next.length - MAX_PRICE_SAMPLES));
}
function incrementCounter(obj = {}, key = "") { return key ? { ...(obj || {}), [key]: n(obj?.[key], 0) + 1 } : (obj || {}); }

function mergeObservationIntoDb(db, observation = {}) {
  const observationKey = text(observation.observationKey || `${observation.quoteId}|${observation.productKey}`);
  const productKey = text(observation.productKey);
  if (!observationKey || !productKey || db.seenObservations[observationKey]) return false;
  const ts = Date.parse(observation.finalizedAt || "") || now();
  db.seenObservations[observationKey] = { updatedAt: ts };
  const prev = db.products[productKey] || {
    productKey, product: {}, quoteCount: 0, lineConfirmCount: 0, totalQty: 0, saleSamples: [], marginSamples: [],
    customerCategories: {}, sections: {}, industries: {}, firstSeenAt: ts,
  };
  const product = observation.product && typeof observation.product === "object" ? observation.product : {};
  const next = {
    ...prev,
    product: { ...prev.product, ...Object.fromEntries(Object.entries(product).filter(([, v]) => v !== "" && v != null)) },
    quoteCount: n(prev.quoteCount, 0) + 1, lineConfirmCount: n(prev.lineConfirmCount, 0) + 1,
    totalQty: n(prev.totalQty, 0) + Math.max(0, n(observation.totalQty, 0)),
    saleSamples: pushSample(prev.saleSamples, observation.salePrice, { quoteId: observation.quoteId, at: ts }),
    marginSamples: observation.marginPct == null ? (prev.marginSamples || []) : pushSample(prev.marginSamples, observation.marginPct, { quoteId: observation.quoteId, at: ts }),
    customerCategories: incrementCounter(prev.customerCategories, text(observation.customerCategory)),
    industries: incrementCounter(prev.industries, text(observation.industryId)), firstSeenAt: prev.firstSeenAt || ts,
    lastSeenAt: Math.max(n(prev.lastSeenAt, 0), ts), lastQuoteId: text(observation.quoteId), lastProject: text(observation.project), updatedAt: now(),
  };
  for (const section of Array.isArray(observation.sectionNames) ? observation.sectionNames : []) next.sections = incrementCounter(next.sections, text(section));
  db.products[productKey] = next;
  return true;
}

export function recordQuoteLearningObservations(observations = []) {
  const db = loadQuoteLearning();
  let added = 0;
  const quoteIds = new Set();
  for (const observation of Array.isArray(observations) ? observations : []) {
    if (mergeObservationIntoDb(db, observation)) { added += 1; if (observation?.quoteId) quoteIds.add(String(observation.quoteId)); }
  }
  for (const quoteId of quoteIds) {
    if (!db.finalQuoteIds[quoteId]) { db.finalQuoteIds[quoteId] = { updatedAt: now() }; db.finalQuoteCount = n(db.finalQuoteCount, 0) + 1; }
  }
  const ok = added ? saveDb(db) : true;
  return { ok, added, finalQuoteCount: db.finalQuoteCount, productMemoryCount: Object.keys(db.products).length };
}

export function mergeCloudQuoteLearningObservations(rows = []) {
  return recordQuoteLearningObservations((Array.isArray(rows) ? rows : []).map((row) => ({
    observationKey: row.observation_key || row.observationKey || `${row.quote_id || row.quoteId}|${row.product_key || row.productKey}`,
    quoteId: row.quote_id || row.quoteId, revision: row.quote_revision || row.revision || 1,
    productKey: row.product_key || row.productKey, product: row.product_snapshot || row.product || {},
    customerCategory: row.customer_category || row.customerCategory || "", project: row.project_name || row.project || "",
    industryId: row.industry_profile || row.industryId || "generic", sectionNames: row.section_names || row.sectionNames || [],
    totalQty: row.total_qty ?? row.totalQty ?? 0, salePrice: row.sale_price ?? row.salePrice ?? 0, costPrice: row.cost_price ?? row.costPrice ?? 0,
    marginPct: row.margin_pct ?? row.marginPct ?? null, finalizedAt: row.finalized_at || row.finalizedAt || row.created_at || new Date().toISOString(),
  })));
}

function median(values = []) {
  const nums = values.map((x) => n(x?.value ?? x, NaN)).filter(Number.isFinite).sort((a, b) => a - b);
  if (!nums.length) return null;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
}
function minMax(values = []) {
  const nums = values.map((x) => n(x?.value ?? x, NaN)).filter(Number.isFinite);
  return nums.length ? { min: Math.min(...nums), max: Math.max(...nums) } : { min: null, max: null };
}

export function quoteLearningConfidenceTier(memory = {}) {
  const count = n(memory.quoteCount, 0);
  if (count >= 5) return "trusted";
  if (count >= 3) return "suggest";
  return count > 0 ? "observe" : "none";
}

export function getQuoteLearningInsight(product = {}) {
  const key = productIdentityKey(product);
  if (!key) return null;
  const memory = loadQuoteLearning().products[key];
  if (!memory) return null;
  const saleRange = minMax(memory.saleSamples);
  return {
    productKey: key, quoteCount: n(memory.quoteCount, 0), totalQty: n(memory.totalQty, 0), confidenceTier: quoteLearningConfidenceTier(memory),
    medianSalePrice: median(memory.saleSamples), minSalePrice: saleRange.min, maxSalePrice: saleRange.max,
    medianMarginPct: median(memory.marginSamples), lastSeenAt: n(memory.lastSeenAt, 0) || null,
    product: memory.product || {}, customerCategories: memory.customerCategories || {}, sections: memory.sections || {},
  };
}

function isWeakName(value = "", sku = "") {
  const name = normalizeIdentityName(value), skuNorm = normalizeIdentitySku(sku);
  if (!name) return true;
  if (skuNorm && name.replace(/\s+/g, "") === skuNorm) return true;
  return ["san pham", "product", "item", "hang hoa"].includes(name);
}

export function applyQuoteIdentityLearning(products = []) {
  const db = loadQuoteLearning();
  let hits = 0, suggestions = 0;
  const next = (Array.isArray(products) ? products : []).map((product) => {
    const key = productIdentityKey(product), memory = key ? db.products[key] : null;
    if (!memory) return product;
    const tier = quoteLearningConfidenceTier(memory);
    if (tier === "observe") return product;
    const learned = memory.product || {}, p = { ...product, _meta: { ...(product._meta || {}) } };
    p._meta.quoteLearning = { tier, quoteCount: n(memory.quoteCount, 0), medianSalePrice: median(memory.saleSamples), medianMarginPct: median(memory.marginSamples) };
    if (tier === "suggest") { suggestions += 1; return p; }
    let applied = false;
    if (isWeakName(p.name, p.sku) && learned.name) { p.name = learned.name; applied = true; }
    if (!p.category && learned.category) { p.category = learned.category; applied = true; }
    if (!p.unit && learned.unit) { p.unit = learned.unit; applied = true; }
    if (!p.brand && learned.brand) { p.brand = learned.brand; applied = true; }
    if (!p.origin && learned.origin) { p.origin = learned.origin; p.attributes = { ...(p.attributes || {}), origin: learned.origin }; applied = true; }
    if (!p.specs && learned.specs) { p.specs = learned.specs; applied = true; }
    if (applied) {
      hits += 1;
      p._meta.issues = [...(Array.isArray(p._meta.issues) ? p._meta.issues : []), { code: "final_quote_learning_applied", level: "info", message: `Đã áp dụng identity được xác nhận qua ${memory.quoteCount} báo giá Final` }];
      p._meta.quoteLearningApplied = true;
    }
    return p;
  });
  return { products: next, hits, suggestions };
}

export function listQuoteLearningStats() {
  const db = loadQuoteLearning(), memories = Object.values(db.products || {});
  return {
    finalQuotes: n(db.finalQuoteCount, 0), products: memories.length,
    suggest: memories.filter((m) => quoteLearningConfidenceTier(m) === "suggest").length,
    trusted: memories.filter((m) => quoteLearningConfidenceTier(m) === "trusted").length,
    updatedAt: db.updatedAt || null,
  };
}
