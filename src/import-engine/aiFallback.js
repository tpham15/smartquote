// ============================================================
// aiFallback — CHỈ chạy khi deterministic parsing thất bại / độ tin cậy thấp.
// Nhận 1 hàm aiExtract(payload) từ ngoài (không phụ thuộc provider cụ thể).
// Engine KHÔNG tự gọi mạng — host app cung cấp aiExtract.
// ============================================================

/**
 * Quyết định có cần AI fallback không.
 * @param {Object} result - {items, mapConfidence}
 * @returns {boolean}
 */
export function needsAIFallback(result) {
  const { items, mapConfidence } = result;
  if (!items || items.length === 0) return true;       // không trích được gì
  if (mapConfidence < 0.5) return true;                 // mapping kém
  const reviewRatio = items.filter((i) => i.status === "review" || i.status === "rejected").length / items.length;
  return reviewRatio > 0.4;                             // >40% phải review
}

/**
 * Gọi AI fallback cho 1 sheet/region khó.
 * @param {Object} payload - {sheetName, rows:[][], fileName}
 * @param {Function} aiExtract - async (payload) => rawItems[] | null
 * @returns {Promise<Object[]|null>}
 */
export async function runAIFallback(payload, aiExtract) {
  if (typeof aiExtract !== "function") return null;
  try {
    const items = await aiExtract(payload);
    if (!Array.isArray(items)) return null;
    return items.map((it) => ({
      name: String(it.name || "").trim(),
      sku: String(it.sku || "").trim(),
      category: String(it.category || "Chung").trim(),
      supplier: String(it.supplier || "").trim(),
      unit: String(it.unit || "Cái").trim(),
      price: Number(String(it.price ?? it.costPrice ?? 0).replace(/[^\d]/g, "")) || 0,
      specs: String(it.specs || "").trim(),
      source: { sheet: payload.sheetName, rowIndex: -1, cellRefs: [], rawText: "" },
      _viaAI: true,
    })).filter((it) => it.name && it.name.length > 1);
  } catch {
    return null;
  }
}
