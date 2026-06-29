const strip = (v) => String(v ?? "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
const normalize = (v) => strip(v)
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .replace(/đ/g, "d")
  .replace(/Đ/g, "d")
  .toLowerCase();

const LEARNING_KEY = "sq_bom_match_learning_v1";
const STOPWORDS = new Set(["va", "cho", "cua", "the", "bo", "cai", "chiec", "module", "thiet", "bi", "san", "pham"]);

function safeJsonParse(raw, fallback) {
  try { return raw ? JSON.parse(raw) : fallback; } catch { return fallback; }
}

export function loadBomMatchLearning() {
  if (typeof localStorage === "undefined") return { byModel: {}, byName: {} };
  return safeJsonParse(localStorage.getItem(LEARNING_KEY), { byModel: {}, byName: {} });
}

function saveLearning(data) {
  if (typeof localStorage === "undefined") return;
  try { localStorage.setItem(LEARNING_KEY, JSON.stringify(data)); } catch {}
}

export function bomLearningKeyForLine(line = {}) {
  const model = normalize(line.model || line.sku || "");
  const name = normalize(line.name || "");
  const category = normalize(line.category || "");
  return {
    model,
    name: [name, category].filter(Boolean).join(" | "),
  };
}

export function saveBomMatchLearning(line = {}, product = {}) {
  if (!product?.id) return;
  const data = loadBomMatchLearning();
  const key = bomLearningKeyForLine(line);
  const payload = {
    productId: product.id,
    sku: product.sku || "",
    productName: product.name || "",
    updatedAt: new Date().toISOString(),
  };
  if (key.model && key.model.length >= 3) data.byModel[key.model] = payload;
  if (key.name && key.name.length >= 8) data.byName[key.name] = payload;
  saveLearning(data);
}

function getLearnedMatch(item, products = []) {
  const data = loadBomMatchLearning();
  const key = bomLearningKeyForLine(item);
  const learned = data.byModel[key.model] || data.byName[key.name];
  if (!learned?.productId) return null;
  const product = products.find((p) => p.id === learned.productId || (learned.sku && normalize(p.sku) === normalize(learned.sku)));
  if (!product) return null;
  return {
    product,
    score: 1,
    confidence: "high",
    reason: "Đã học từ lần chọn trước",
    learned: true,
  };
}

function tokens(v) {
  return normalize(v)
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
}

function jaccard(aTokens, bTokens) {
  const a = new Set(aTokens);
  const b = new Set(bTokens);
  if (!a.size || !b.size) return 0;
  let hit = 0;
  a.forEach((t) => { if (b.has(t)) hit += 1; });
  return hit / Math.max(1, Math.min(a.size, b.size));
}

function productToMatchPayload(product, score, confidence, reason, extra = {}) {
  return {
    productId: product.id,
    productName: product.name,
    sku: product.sku || "",
    category: product.category || "",
    supplier: product.supplier || "",
    costPrice: Number(product.costPrice) || 0,
    listPrice: Number(product.listPrice || product.salePrice || product.price) || 0,
    score: Math.round(score * 100) / 100,
    confidence,
    reason,
    ...extra,
  };
}

export function rankBomCatalogMatches(item = {}, products = [], limit = 5) {
  if (!Array.isArray(products) || !products.length) return [];
  const learned = getLearnedMatch(item, products);
  const itemModel = normalize(item.model || item.sku || "");
  const itemText = `${item.name || ""} ${item.model || ""} ${item.category || ""} ${item.note || ""}`;
  const itemNorm = normalize(itemText);
  const itemTokens = tokens(itemText);

  const scored = [];
  for (const product of products) {
    const sku = normalize(product.sku || "");
    const pText = `${product.name || ""} ${product.sku || ""} ${product.category || ""} ${product.supplier || ""}`;
    const pNorm = normalize(pText);
    let score = 0;
    let reason = "Tên gần giống catalog";

    if (itemModel && sku && itemModel === sku) {
      score = 0.98;
      reason = "Trùng model/SKU";
    } else if (itemModel && sku && (itemModel.includes(sku) || sku.includes(itemModel)) && Math.min(itemModel.length, sku.length) >= 4) {
      score = 0.9;
      reason = "Model/SKU gần trùng";
    } else if (itemModel && pNorm.includes(itemModel) && itemModel.length >= 4) {
      score = 0.84;
      reason = "Model xuất hiện trong tên catalog";
    } else {
      const overlap = jaccard(itemTokens, tokens(pText));
      const modelBoost = itemModel && pNorm.includes(itemModel.slice(0, Math.min(itemModel.length, 6))) ? 0.1 : 0;
      const catBoost = item.category && product.category && normalize(product.category).includes(normalize(item.category).slice(0, 5)) ? 0.08 : 0;
      score = Math.min(0.82, overlap * 0.78 + modelBoost + catBoost);
    }

    if (score >= 0.32) {
      const confidence = score >= 0.78 ? "high" : score >= 0.5 ? "medium" : "low";
      scored.push({ product, score, confidence, reason });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  const deduped = [];
  const seen = new Set();
  if (learned) {
    deduped.push(learned);
    seen.add(learned.product.id);
  }
  for (const row of scored) {
    if (seen.has(row.product.id)) continue;
    deduped.push(row);
    seen.add(row.product.id);
    if (deduped.length >= limit) break;
  }

  return deduped.slice(0, limit).map((row) => productToMatchPayload(row.product, row.score, row.confidence, row.reason, { learned: row.learned || false }));
}

export function bestBomCatalogMatch(item = {}, products = []) {
  const suggestions = rankBomCatalogMatches(item, products, 5);
  const top = suggestions[0];
  if (!top) return null;
  if (top.learned || top.confidence === "high" || top.score >= 0.5) return top;
  return null;
}
