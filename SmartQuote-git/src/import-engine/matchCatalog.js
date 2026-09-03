// ============================================================
// matchCatalog — khớp item với catalog hiện có (DETERMINISTIC)
// Thứ tự: correction đã học → SKU chính xác → tên chuẩn hoá → fuzzy.
// AI KHÔNG tham gia ở bước này.
// ============================================================
import { STATUS } from "./types.js";

/** Chuẩn hoá chuỗi để so khớp: bỏ dấu, ký tự đặc biệt, lowercase */
function norm(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // bỏ dấu tiếng Việt
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9]/g, "");
}

/** Chuẩn hoá SKU: giữ chữ-số, bỏ phân cách */
function normSku(s) {
  return String(s || "").toLowerCase().replace(/[\s\-\/\.\_]/g, "");
}

/** Độ tương đồng đơn giản (Dice coefficient trên bigram) */
function similarity(a, b) {
  const na = norm(a), nb = norm(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const bigrams = (s) => {
    const set = new Set();
    for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
    return set;
  };
  const A = bigrams(na), B = bigrams(nb);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const g of A) if (B.has(g)) inter++;
  return (2 * inter) / (A.size + B.size);
}

/**
 * Khớp 1 item với catalog.
 * @param {Object} item
 * @param {Object} indexes - {bySku, byName, catalog}
 * @param {Object} corrections - rawText(normalized) -> productId
 * @returns {{matchedProductId: ?string, matchType: string, score: number}}
 */
function matchOne(item, indexes, corrections) {
  // 1. Correction đã học (người dùng sửa trước đó)
  const rawKey = norm(item.source?.rawText || item.name);
  if (corrections && corrections[rawKey]) {
    return { matchedProductId: corrections[rawKey], matchType: "correction", score: 1 };
  }

  // 2. SKU chính xác
  if (item.sku) {
    const key = normSku(item.sku);
    if (key && indexes.bySku.has(key)) {
      return { matchedProductId: indexes.bySku.get(key), matchType: "sku", score: 1 };
    }
  }

  // 3. Tên chuẩn hoá trùng khớp
  const nameKey = norm(item.name);
  if (nameKey && indexes.byName.has(nameKey)) {
    return { matchedProductId: indexes.byName.get(nameKey), matchType: "name", score: 0.95 };
  }

  // 4. Fuzzy theo tên (ngưỡng cao để tránh sai)
  let best = null, bestScore = 0.82;
  for (const p of indexes.catalog) {
    const s = similarity(item.name, p.name);
    if (s > bestScore) { bestScore = s; best = p; }
  }
  if (best) return { matchedProductId: best.id, matchType: "fuzzy", score: bestScore };

  return { matchedProductId: null, matchType: "none", score: 0 };
}

/**
 * Khớp toàn bộ items.
 * @param {Object[]} items
 * @param {Array} catalog
 * @param {Object} corrections
 * @returns {Object[]} items có thêm matchedProductId, _matchType, _matchScore
 */
export function matchCatalog(items, catalog = [], corrections = {}) {
  // build index
  const bySku = new Map();
  const byName = new Map();
  for (const p of catalog) {
    if (p.sku) bySku.set(normSku(p.sku), p.id);
    if (p.name) byName.set(norm(p.name), p.id);
  }
  const indexes = { bySku, byName, catalog };

  return items.map((item) => {
    const m = matchOne(item, indexes, corrections);
    return {
      ...item,
      matchedProductId: m.matchedProductId,
      _matchType: m.matchType,
      _matchScore: m.score,
    };
  });
}

export { norm, normSku, similarity };
