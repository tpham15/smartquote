// ============================================================
// scoreConfidence — tính confidence (0..1) và status cho mỗi item
// status: matched | new | review | rejected
// ============================================================
import { STATUS } from "./types.js";

/**
 * @param {Object[]} items - đã qua matchCatalog + validateItems
 * @param {number} mapConfidence - độ tin cậy của column mapping (0..1)
 * @returns {import('./types').ImportItem[]}
 */
export function scoreConfidence(items, mapConfidence = 0.5) {
  return items.map((item) => {
    let conf = 0.3 + 0.4 * mapConfidence; // nền tảng từ chất lượng mapping

    // có giá hợp lệ
    if (item.price >= 1000) conf += 0.15;
    // có mã
    if (item.sku) conf += 0.1;
    // đã match catalog
    if (item.matchedProductId) conf += (item._matchScore || 0) * 0.15;
    // Ít issue. Riêng thiếu SKU là cảnh báo nhẹ/info nếu đã có tên + giá,
    // vì nhiều nhà cung cấp không đánh mã hoặc giấu mã trong ô hình ảnh.
    const issueText = (i) => String(typeof i === "string" ? i : (i?.message || i?.code || ""));
    const issueLevel = (i) => String(typeof i === "string" ? "warning" : (i?.level || "warning")).toLowerCase();
    const issueCode = (i) => String(typeof i === "string" ? "" : (i?.code || "")).toLowerCase();
    const isMissingSkuIssue = (i) => issueCode(i) === "missing_sku" || /thiếu mã sku/i.test(issueText(i));
    const isSubtotalSkipIssue = (i) => issueCode(i) === "generic_category_subtotal";
    const shouldSkipSubtotal = Boolean(item._subtotalSuspect || (item.issues || []).some(isSubtotalSkipIssue));
    const issueCount = (item.issues || []).filter((i) => issueLevel(i) !== "info" && !isMissingSkuIssue(i) && !isSubtotalSkipIssue(i)).length;
    conf -= issueCount * 0.08;

    conf = Math.max(0, Math.min(1, conf));

    // xác định status
    let status;
    const hardReject = (item.issues || []).some((i) => {
      const t = issueText(i);
      const code = String(i?.code || "").toLowerCase();
      return code === "non_product_row" || code === "missing_product_name" ||
        t.includes("Không phải sản phẩm") ||
        t.includes("Thiếu tên");
    });
    const blockingIssues = (item.issues || []).filter((i) => {
      const t = issueText(i);
      const code = issueCode(i);
      if (code === "missing_sku" || t.includes("Thiếu mã SKU")) return false;
      if (code === "generic_category_subtotal") return false;
      if (issueLevel(i) === "info") return false;
      return issueLevel(i) === "error" || !/sku/i.test(code);
    });

    if (shouldSkipSubtotal) {
      status = STATUS.SKIPPED || "skipped";
    } else if (hardReject || (!item.price && !item.sku)) {
      status = STATUS.REJECTED;
    } else if (item.matchedProductId && conf >= 0.7) {
      status = STATUS.MATCHED;
    } else if (conf < 0.55 || blockingIssues.some((i) => issueLevel(i) === "error") || blockingIssues.length >= 2) {
      status = STATUS.REVIEW;
    } else {
      status = STATUS.NEW;
    }

    return {
      name: item.name,
      sku: item.sku || "",
      category: item.category || "Chung",
      supplier: item.supplier || "",
      unit: item.unit || "Cái",
      price: item.price || item.costPrice || 0,
      costPrice: item.costPrice || item.price || 0,
      listPrice: item.listPrice || 0,
      minRetailPrice: item.minRetailPrice || 0,
      priceMode: item.priceMode || (item.listPrice > 0 ? "fixed" : "markup"),
      specs: item.specs || "",
      confidence: Math.round(conf * 100) / 100,
      status,
      issues: item.issues || [],
      matchedProductId: item.matchedProductId || null,
      source: item.source,
      _matchType: item._matchType,
      _subtotalSuspect: item._subtotalSuspect || false,
      _skipReason: status === (STATUS.SKIPPED || "skipped") ? "generic_category_subtotal" : item._skipReason,
    };
  });
}
