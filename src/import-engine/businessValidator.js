// ============================================================
// Phase 14.0 — deterministic business validator
// Independent from OCR/model confidence. Validates commercial invariants on
// already extracted data so SmartQuote can be useful even when extraction is
// imperfect.
// ============================================================

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function key(v) {
  return String(v || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function skuKey(v) {
  return String(v || "").trim().toLowerCase().replace(/[\s._\-/]+/g, "");
}

function issue(code, level, message, field = "", suggestedFix = "", evidence = {}) {
  return { code, level, message, field, suggestedFix, evidence };
}

export const PILOT_BUSINESS_RULES_V1 = Object.freeze({
  priceChangeWarnRatio: 0.35,
  priceChangeErrorRatio: 1.0,
  lineMathToleranceVnd: 2,
  totalMathToleranceVnd: 5,
});

export function validateCommercialItem(item = {}, context = {}, index = 0, rules = PILOT_BUSINESS_RULES_V1) {
  const issues = [];
  const cost = num(item.costPrice ?? item.price);
  const retail = num(item.listPrice || item.publicPrice || item.minRetailPrice);
  const sku = String(item.sku || "").trim();

  if (cost > 0 && retail > 0 && cost > retail) {
    issues.push(issue(
      "dealer_above_retail",
      "error",
      `Giá nhập ${cost.toLocaleString("vi-VN")}đ cao hơn giá công bố ${retail.toLocaleString("vi-VN")}đ`,
      "costPrice",
      "Kiểm tra lại cột giá nhập/giá công bố hoặc cập nhật bảng giá mới",
      { costPrice: cost, retailPrice: retail }
    ));
  }

  const dupMap = context.duplicateSkuMap || new Map();
  const sk = skuKey(sku);
  if (sk && (dupMap.get(sk) || []).length > 1) {
    const positions = dupMap.get(sk).map((n) => n + 1);
    issues.push(issue(
      "duplicate_sku_in_import",
      "error",
      `SKU ${sku} xuất hiện ${positions.length} lần trong file import`,
      "sku",
      `Giữ đúng một dòng cho SKU này (dòng ${positions.join(", ")})`,
      { sku, rows: positions }
    ));
  }

  const existing = context.existingBySku?.get(sk) || context.existingByName?.get(key(item.name));
  const previousCost = num(existing?.costPrice ?? existing?.price);
  if (cost > 0 && previousCost > 0 && cost !== previousCost) {
    const ratio = Math.abs(cost - previousCost) / previousCost;
    const pct = Math.round(ratio * 1000) / 10;
    if (ratio >= rules.priceChangeErrorRatio) {
      issues.push(issue(
        "price_change_extreme",
        "error",
        `Giá nhập thay đổi ${pct}% so với catalog hiện tại (${previousCost.toLocaleString("vi-VN")}đ → ${cost.toLocaleString("vi-VN")}đ)`,
        "costPrice",
        "Kiểm tra lại giá trong file nguồn trước khi cập nhật",
        { previousCost, currentCost: cost, changeRatio: ratio }
      ));
    } else if (ratio >= rules.priceChangeWarnRatio) {
      issues.push(issue(
        "price_change_outlier",
        "warning",
        `Giá nhập thay đổi ${pct}% so với catalog hiện tại (${previousCost.toLocaleString("vi-VN")}đ → ${cost.toLocaleString("vi-VN")}đ)`,
        "costPrice",
        "Xác nhận đây là thay đổi giá thật từ nhà cung cấp",
        { previousCost, currentCost: cost, changeRatio: ratio }
      ));
    }
  }

  const qty = num(item.qty ?? item.quantity);
  const unitPrice = num(item.unitPrice ?? item.costPrice ?? item.price);
  const lineTotal = num(item.lineTotal ?? item.amount ?? item.total);
  if (qty > 0 && unitPrice > 0 && lineTotal > 0) {
    const expected = qty * unitPrice;
    const delta = Math.abs(expected - lineTotal);
    if (delta > rules.lineMathToleranceVnd) {
      issues.push(issue(
        "line_total_mismatch",
        "error",
        `SL × đơn giá = ${expected.toLocaleString("vi-VN")}đ nhưng thành tiền là ${lineTotal.toLocaleString("vi-VN")}đ`,
        "lineTotal",
        "Kiểm tra số lượng, đơn giá hoặc thành tiền",
        { qty, unitPrice, expected, actual: lineTotal, delta }
      ));
    }
  }

  return { index, issues };
}

export function buildCommercialValidationContext(items = [], existingProducts = []) {
  const duplicateSkuMap = new Map();
  (items || []).forEach((item, index) => {
    const sk = skuKey(item?.sku);
    if (!sk) return;
    if (!duplicateSkuMap.has(sk)) duplicateSkuMap.set(sk, []);
    duplicateSkuMap.get(sk).push(index);
  });

  const existingBySku = new Map();
  const existingByName = new Map();
  (existingProducts || []).forEach((item) => {
    const sk = skuKey(item?.sku);
    if (sk) existingBySku.set(sk, item);
    const nk = key(item?.name);
    if (nk) existingByName.set(nk, item);
  });
  return { duplicateSkuMap, existingBySku, existingByName };
}

export function applyCommercialValidation(items = [], { existingProducts = [], rules = PILOT_BUSINESS_RULES_V1 } = {}) {
  const context = buildCommercialValidationContext(items, existingProducts);
  let errors = 0;
  let warnings = 0;
  const products = (items || []).map((item, index) => {
    const result = validateCommercialItem(item, context, index, rules);
    if (!result.issues.length) return item;
    const meta = { ...(item._meta || {}) };
    // A human may explicitly accept a warning (for example a legitimate price jump).
    // Never suppress hard business errors: approval is not a bypass for impossible math,
    // duplicate SKU ambiguity, or dealer > retail.
    const humanAccepted = Boolean(meta.userApproved || meta.userEdited || meta.acceptedAtPreview);
    const effectiveIssues = humanAccepted
      ? result.issues.filter((x) => x.level === "error")
      : result.issues;
    errors += effectiveIssues.filter((x) => x.level === "error").length;
    warnings += effectiveIssues.filter((x) => x.level === "warning").length;
    const existingIssues = Array.isArray(meta.issues) ? meta.issues : Array.isArray(item.issues) ? item.issues : [];
    const keep = existingIssues.filter((x) => !String(x?.code || "").startsWith("pilot_business_"));
    const tagged = effectiveIssues.map((x) => ({ ...x, code: `pilot_business_${x.code}`, validator: "sq-pilot-business-v1" }));
    const allIssues = [...keep, ...tagged];
    const hasError = allIssues.some((x) => x?.level === "error");
    const hasWarn = allIssues.some((x) => x?.level === "warning");
    return {
      ...item,
      _meta: {
        ...meta,
        issues: allIssues,
        businessValidated: true,
        businessValidationVersion: "sq-pilot-business-v1",
        status: hasError || hasWarn ? "review" : (meta.status || "new"),
        canonicalStatus: hasError || hasWarn ? "need_review" : (meta.canonicalStatus || "auto_approved"),
        confidence: hasError ? Math.min(Number(meta.confidence || 0.72), 0.42) : hasWarn ? Math.min(Number(meta.confidence || 0.72), 0.64) : meta.confidence,
      },
    };
  });
  return { products, summary: { errors, warnings, checked: products.length } };
}

export function validateQuoteCommercialMath({ lines = [], subtotal = 0, vatRate = 0, vatAmount = 0, total = 0 } = {}, rules = PILOT_BUSINESS_RULES_V1) {
  const issues = [];
  const computedSubtotal = (lines || []).reduce((sum, line) => {
    const qty = num(line.qty ?? line.quantity);
    const price = num(line.unitPrice ?? line.price);
    const stated = num(line.lineTotal ?? line.amount);
    return sum + (stated > 0 ? stated : qty * price);
  }, 0);
  const statedSubtotal = num(subtotal);
  if (statedSubtotal > 0 && Math.abs(statedSubtotal - computedSubtotal) > rules.totalMathToleranceVnd) {
    issues.push(issue("subtotal_mismatch", "error", `Tổng các dòng = ${computedSubtotal.toLocaleString("vi-VN")}đ nhưng subtotal = ${statedSubtotal.toLocaleString("vi-VN")}đ`, "subtotal", "Kiểm tra thành tiền từng dòng", { computedSubtotal, statedSubtotal }));
  }
  const base = statedSubtotal || computedSubtotal;
  const expectedVat = num(vatRate) > 0 ? base * num(vatRate) : num(vatAmount);
  if (num(vatAmount) > 0 && num(vatRate) > 0 && Math.abs(num(vatAmount) - expectedVat) > rules.totalMathToleranceVnd) {
    issues.push(issue("vat_mismatch", "error", `VAT tính theo tỷ lệ là ${expectedVat.toLocaleString("vi-VN")}đ nhưng file ghi ${num(vatAmount).toLocaleString("vi-VN")}đ`, "vatAmount", "Kiểm tra tỷ lệ VAT hoặc số VAT", { expectedVat, statedVat: num(vatAmount) }));
  }
  const expectedTotal = base + (num(vatAmount) || expectedVat || 0);
  if (num(total) > 0 && Math.abs(num(total) - expectedTotal) > rules.totalMathToleranceVnd) {
    issues.push(issue("grand_total_mismatch", "error", `Subtotal + VAT = ${expectedTotal.toLocaleString("vi-VN")}đ nhưng total = ${num(total).toLocaleString("vi-VN")}đ`, "total", "Kiểm tra subtotal/VAT/total", { expectedTotal, statedTotal: num(total) }));
  }
  return { computedSubtotal, expectedVat, expectedTotal, issues };
}

export { skuKey as normalizeBusinessSku };
