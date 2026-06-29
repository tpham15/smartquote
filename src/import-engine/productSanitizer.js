import { inferCategoryForProduct } from "./categoryInference.js";

// ============================================================
// Product sanitizer — guardrail cho dữ liệu import catalog/PDF.
// Mục tiêu: không để AI/PDF nhét nguyên mô tả dài, text lỗi font,
// hoặc giá bị dính nhiều cột vào catalog như một sản phẩm hợp lệ.
// ============================================================

const MAX_NORMAL_PRICE = 1_000_000_000; // thiết bị/két an toàn cao cấp có thể >300tr; >1 tỷ vẫn coi là lỗi parse
const MIN_NORMAL_PRICE = 1_000;

const WEIRD_TEXT_RE = /[�□■█▯▮▰◆◇▶◀↔↕]/;
// Mojibake phổ biến khi text tiếng Việt bị decode sai encoding từ PDF/Excel
const MOJIBAKE_RE = /(Ã|Â|á»|áº|Ä|Æ|ð|Ð|å|Å|Ã|Â)/i;
const SPEC_KEYWORD_RE = /\b(Chất liệu|Nguồn cấp|Nguồn điện|Dòng điện|Công suất|Công suất hoạt động|Nhiệt độ|Độ ẩm|Kích thước|Tích hợp|Loại thẻ|Tốc độ|Khoảng cách|Mã khóa|Mã khóa sử dụng|Màu sắc|Điện áp|Tần số|Chuẩn kết nối|Bảo hành|Xuất xứ|Thông số|Model|Đặc điểm|Tính năng|Tải trọng|Kích cỡ|Kết nối|Ứng dụng|Nguồn máy tính)\b/i;
const CATEGORY_JUNK_RE = /tổng|tong|hợp|hop|báo giá|bao gia|khóa|khoa|tài khoản|tai khoan|ngân hàng|ngan hang|hotline|điều khoản|dieu khoan|ghi chú|ghi chu|bảo hành|bao hanh/i;
const UNIT_ALLOW_RE = /^(cái|cai|chiếc|chiec|bộ|bo|bộ\.|cặp|cap|m|mét|met|md|cuộn|cuon|thùng|thung|hộp|hop|kg|g|lít|lit|bịch|bich|tấm|tam|bộ đôi|set|pcs|piece|unit)$/i;

const NON_PRODUCT_ROW_RE = /(^|\b)(hàng\s*đặt|hang\s*dat|thi\s*công|thi\s*cong|giao\s*hàng|giao\s*hang|vận\s*chuyển|van\s*chuyen|bảo\s*hành|bao\s*hanh|bảo\s*trì|bao\s*tri|thanh\s*toán|thanh\s*toan|điều\s*khoản|dieu\s*khoan|điều\s*kiện|dieu\s*kien|hiệu\s*lực|hieu\s*luc|hợp\s*đồng|hop\s*dong|tạm\s*ứng|tam\s*ung|nghiệm\s*thu|nghiem\s*thu|lưu\s*ý|luu\s*y|ghi\s*chú|ghi\s*chu)(\b|:)/i;
const CONTACT_OR_BANK_RE = /(ngân\s*hàng|ngan\s*hang|tài\s*khoản|tai\s*khoan|số\s*tk|so\s*tk|hotline|website|email|địa\s*chỉ|dia\s*chi|mst|mã\s*số\s*thuế|ma\s*so\s*thue)/i;
const SKU_CANDIDATE_RE = /\b(?:[A-Z]{2,}[A-Z0-9]*[-_/][A-Z0-9][A-Z0-9._\-/]{1,}|[A-Z]{2,}\d{2,}[A-Z0-9._\-/]*|[A-Z0-9]{2,}-[A-Z0-9]{2,}(?:[-_/][A-Z0-9]{1,})*)\b/g;

function text(v) {
  return String(v ?? "").replace(/\s+/g, " ").trim();
}

function stripWeird(v) {
  return text(v).replace(/[�□■█▯▮▰◆◇▶◀↔↕]/g, "").replace(/\s+/g, " ").trim();
}

function weirdRatio(v) {
  const s = text(v);
  if (!s) return 0;
  const weird = (s.match(/[�□■█▯▮▰◆◇▶◀↔↕]/g) || []).length;
  return weird / s.length;
}

function issue(code, level, message, field, suggestedFix) {
  return { code, level, message, field, suggestedFix };
}

function isUserAccepted(product) {
  return !!(product?._meta?.userApproved || product?._meta?.userEdited || product?._meta?.acceptedAtPreview);
}

function getIssueCode(it) {
  return String(typeof it === "string" ? it : (it?.code || "")).toLowerCase();
}

function getIssueLevel(it) {
  return String(typeof it === "string" ? "warning" : (it?.level || "warning")).toLowerCase();
}

function isHardIssueAfterUserAcceptance(it, product) {
  const code = getIssueCode(it);
  if (["missing_product_name", "non_product_row"].includes(code)) return true;
  if (["price_parse_failed", "price_unreasonable"].includes(code)) {
    // Nếu user đã duyệt nhưng vẫn không có giá nhập hợp lệ thì bắt sửa giá.
    // Nếu đã có giá nhập dương, coi như user đã xác nhận giá đó và không chặn merge nữa.
    return !(Number(product?.costPrice || product?.price || 0) > 0);
  }
  return false;
}

function filterIssuesAfterUserAcceptance(issues, product) {
  if (!isUserAccepted(product)) return issues;
  return (issues || []).filter((it) => isHardIssueAfterUserAcceptance(it, product));
}

function splitNameAndSpecs(rawName, rawSpecs) {
  let name = text(rawName);
  let specs = text(rawSpecs);
  const issues = [];

  const m = SPEC_KEYWORD_RE.exec(name);
  if (m && m.index > 6) {
    const head = name.slice(0, m.index).trim();
    const tail = name.slice(m.index).trim();
    // Chỉ split nếu phần đầu còn giống tên sản phẩm thật
    if (head.length >= 4) {
      name = head;
      specs = [tail, specs].filter(Boolean).join(" | ");
      issues.push(issue(
        "split_specs_from_name",
        "info",
        "Đã tách thông số kỹ thuật khỏi tên sản phẩm",
        "name"
      ));
    }
  }

  if (name.length > 130) {
    issues.push(issue(
      "name_too_long",
      "warning",
      "Tên sản phẩm quá dài, có thể đang chứa cả mô tả/thông số",
      "name",
      "Rút gọn tên sản phẩm, chuyển phần thông số sang cột specs"
    ));
  }

  return { name, specs, issues };
}

function extractPricesFromText(raw) {
  const s = String(raw ?? "");
  const candidates = [];

  // Các giá có dấu phân tách nghìn: 7.200.000, 7,200,000, 768.000đ
  for (const m of s.matchAll(/\d{1,3}(?:[\.,]\d{3}){1,4}/g)) {
    const n = Number(m[0].replace(/[^\d]/g, ""));
    if (Number.isFinite(n)) candidates.push(n);
  }

  // Các số dài không có dấu phân cách: 7200000
  for (const m of s.matchAll(/\b\d{5,10}\b/g)) {
    const n = Number(m[0]);
    if (Number.isFinite(n)) candidates.push(n);
  }

  return candidates
    .filter((n) => n >= MIN_NORMAL_PRICE && n <= MAX_NORMAL_PRICE)
    .sort((a, b) => a - b);
}

function hasMeaningfulPriceInput(value) {
  if (value === undefined || value === null) return false;
  const raw = String(value).trim();
  if (!raw) return false;
  const digits = raw.replace(/[^\d]/g, "");
  if (!digits) return false;
  const n = Number(digits);
  return Number.isFinite(n) && n > 0;
}

function normalizePriceWithIssues(value, extraText = "") {
  const issues = [];

  if (typeof value === "number" && Number.isFinite(value)) {
    const n = Math.round(value);
    if (n >= MIN_NORMAL_PRICE && n <= MAX_NORMAL_PRICE) return { costPrice: n, issues };
    const recovered = extractPricesFromText(extraText);
    if (recovered.length) {
      issues.push(issue("price_recovered", "warning", "Giá gốc bị lỗi, đã lấy giá hợp lý từ text", "costPrice"));
      return { costPrice: recovered[0], issues };
    }
    issues.push(issue(
      "price_unreasonable",
      "error",
      "Giá nhập bất thường hoặc bị dính nhiều cột giá",
      "costPrice",
      "Kiểm tra lại cột giá trong file PDF/Excel"
    ));
    return { costPrice: 0, issues };
  }

  const raw = text(value);
  const fromBoth = extractPricesFromText([raw, extraText].filter(Boolean).join(" "));
  if (fromBoth.length) return { costPrice: fromBoth[0], issues };

  if (raw.replace(/\D/g, "").length > 0) {
    issues.push(issue(
      "price_parse_failed",
      "error",
      "Không tách được giá nhập hợp lệ",
      "costPrice",
      "Sửa giá thủ công trước khi nhập catalog"
    ));
  }
  return { costPrice: 0, issues };
}

function cleanCategory(category, fallback = "Chung") {
  const raw = text(category);
  if (!raw) return fallback;
  if (WEIRD_TEXT_RE.test(raw) || weirdRatio(raw) > 0.015 || MOJIBAKE_RE.test(raw)) return fallback;
  if (raw.length > 60) return fallback;
  if (CATEGORY_JUNK_RE.test(raw)) return fallback;
  return stripWeird(raw) || fallback;
}

export function cleanSupplierName(supplier, fallback = "") {
  const raw = text(supplier);
  const fb = text(fallback);
  if (!raw) return fb;
  if (WEIRD_TEXT_RE.test(raw) || weirdRatio(raw) > 0.01 || MOJIBAKE_RE.test(raw)) return fb;
  if (raw.length > 80) return fb;
  if (CONTACT_OR_BANK_RE.test(raw) || CATEGORY_JUNK_RE.test(raw)) return fb;
  return stripWeird(raw) || fb;
}

export function isLikelyNonProductRow(rawText, opts = {}) {
  const raw = text(rawText);
  if (!raw) return false;
  if (CONTACT_OR_BANK_RE.test(raw)) return true;
  if (!NON_PRODUCT_ROW_RE.test(raw)) return false;
  const sku = extractSkuFromText(raw);
  const prices = extractPricesFromText(raw);
  // Dòng điều khoản/giao hàng/bảo hành có số ngày như 03-05 không phải giá.
  // Nếu có SKU rõ + giá hợp lệ thì vẫn để engine xử lý như sản phẩm.
  return !(sku && prices.length > 0);
}

function isBadSkuCandidate(cand) {
  if (!cand || /^\d+$/.test(cand)) return true;
  if (/^(VAT|TEL|HOTLINE|EMAIL|WWW|HTTP|HTTPS|MODEL|CODE|SKU)$/.test(cand)) return true;
  if (/^20\d{2}$/.test(cand)) return true;
  if (cand.length < 4 || cand.length > 40) return true;
  if (!/[A-Z]/.test(cand) || !/\d/.test(cand)) return true;
  return false;
}

function skuScore(cand) {
  let score = 0;
  if (/[-_/]/.test(cand)) score += 8;
  if (/^[A-Z]{2,}[-_/]/.test(cand)) score += 4;
  if (/^[A-Z]{2,}\d/.test(cand)) score += 2;
  if (cand.length >= 6 && cand.length <= 22) score += 2;
  if (cand.length > 28) score -= 3;
  if (/^(OSN|DDL|SBX|K\d|R\d|LM|LS|SNT|KBT|NVR|DVR|DS|IPC|HAC|HD|MS|AQA|LUMI)/i.test(cand)) score += 2;
  return score;
}

/**
 * Trích toàn bộ SKU/model ứng viên từ text lộn xộn.
 * Giữ được mã nằm sau nhiều dấu xuống dòng trong ô hình ảnh, vd "\n\nOSN-KBT06".
 * @param {string} rawText
 * @returns {string[]}
 */
export function extractSkuCandidatesFromText(rawText) {
  const raw = String(rawText ?? "")
    .toUpperCase()
    .replace(/[\u00a0\t\r\n]+/g, " ")
    .replace(/[|]+/g, " ");
  const seen = new Set();
  const candidates = [];
  for (const m of raw.matchAll(SKU_CANDIDATE_RE)) {
    const cand = m[0].replace(/^[^A-Z0-9]+|[^A-Z0-9._\-/]+$/g, "");
    if (isBadSkuCandidate(cand)) continue;
    if (seen.has(cand)) continue;
    seen.add(cand);
    candidates.push(cand);
  }
  return candidates;
}

export function extractSkuFromText(rawText) {
  const candidates = extractSkuCandidatesFromText(rawText);
  // ưu tiên mã có dấu gạch/ngăn cách + độ dài giống model. Stable tie-break theo vị trí xuất hiện.
  candidates.sort((a, b) => skuScore(b) - skuScore(a) || a.length - b.length);
  return candidates[0] || "";
}

function cleanUnit(unit) {
  const raw = stripWeird(unit);
  if (!raw) return "Cái";
  if (raw.length > 18 || WEIRD_TEXT_RE.test(unit) || MOJIBAKE_RE.test(String(unit || ""))) return "Cái";
  return UNIT_ALLOW_RE.test(raw) ? raw : raw;
}

/**
 * Parse giá an toàn cho cả Excel/PDF.
 * Khác parse cũ ở chỗ không strip toàn bộ digit rồi ghép thành số khổng lồ.
 * Nếu một cell có nhiều giá, chọn giá hợp lý nhỏ nhất làm giá vốn.
 */
export function parseSafePrice(value, extraText = "") {
  const out = normalizePriceWithIssues(value, extraText);
  return out.costPrice || 0;
}

export function getPriceCandidates(value, extraText = "") {
  return extractPricesFromText([value, extraText].filter(Boolean).join(" "));
}

/**
 * Chuẩn hóa một product UI shape. Không xóa data; chỉ tách name/specs,
 * sửa category/unit lỗi font, chuẩn hóa giá và gắn issues/status.
 * @param {Object} product
 * @param {Object} [opts]
 */
export function sanitizeCatalogProduct(product, opts = {}) {
  const p = { ...(product || {}) };
  const existingIssues = Array.isArray(p._meta?.issues) ? p._meta.issues : Array.isArray(p.issues) ? p.issues : [];
  const issues = [...existingIssues];
  const userAccepted = !!(p._meta?.userApproved || p._meta?.userEdited);
  const wasSkippedByEngine = p._meta?.canonicalStatus === "skipped" || p._meta?.status === "skipped" || !!p._skipReason;
  const isPdfSource = p._meta?.source?.type === "pdf" || String(p._meta?.engine || "").startsWith("pdf");

  const split = splitNameAndSpecs(p.name, p.specs);
  p.name = stripWeird(split.name);
  p.specs = stripWeird(split.specs);
  issues.push(...split.issues);

  const priceRawText = [p.costPrice, p.price, p.specs, p._meta?.source?.rawText, p.rawText].filter(Boolean).join(" ");
  const price = normalizePriceWithIssues(p.costPrice ?? p.price, priceRawText);
  p.costPrice = price.costPrice;
  issues.push(...price.issues);

  const hasExplicitListPrice = hasMeaningfulPriceInput(p.listPrice) || hasMeaningfulPriceInput(p.publicPrice);
  const listTextForRecovery = [p.specs, p._meta?.source?.rawText, p.rawText].filter(Boolean).join(" ");
  const mayInferListPrice = /giá\s*(công\s*bố|cong\s*bo|niêm\s*yết|niem\s*yet|bán\s*lẻ|ban\s*le|giá\s*bán|gia\s*ban|giá\s*lẻ|gia\s*le)/i.test(listTextForRecovery);
  const listPrice = hasExplicitListPrice || mayInferListPrice
    ? normalizePriceWithIssues(p.listPrice ?? p.publicPrice, [p.listPrice, p.publicPrice, listTextForRecovery].filter(Boolean).join(" "))
    : { costPrice: 0, issues: [] };
  p.listPrice = listPrice.costPrice || 0;
  p.publicPrice = p.listPrice;
  // Không biến thiếu giá công bố thành lỗi; nhiều catalog chỉ có giá nhập.
  if (p.listPrice > 0 && p.costPrice > 0 && p.listPrice < p.costPrice) {
    issues.push(issue("list_price_below_cost", "warning", "Giá công bố thấp hơn giá nhập, cần kiểm tra lại cột giá", "listPrice"));
  }
  p.priceMode = p.listPrice > 0 ? "fixed" : (p.priceMode || "markup");
  p.minRetailPrice = parseSafePrice(p.minRetailPrice || 0) || 0;

  p.category = inferCategoryForProduct(p, cleanCategory(p.category, opts.defaultCategory || "Chung"));
  p.supplier = cleanSupplierName(p.supplier, opts.defaultSupplier || "");
  p.unit = cleanUnit(p.unit);
  p.sku = stripWeird(p.sku || "");

  if (!p.sku) {
    const extractedSku = extractSkuFromText([p.name, p.specs, p._meta?.source?.rawText, p.rawText].filter(Boolean).join(" "));
    if (extractedSku) {
      p.sku = extractedSku;
      issues.push(issue("sku_extracted_from_text", "info", "Đã tự tách SKU từ mô tả/thông số", "sku"));
    }
  }

  if (!userAccepted && isLikelyNonProductRow([p.name, p.specs, p._meta?.source?.rawText, p.rawText].filter(Boolean).join(" "))) {
    issues.push(issue("non_product_row", "error", "Dòng này giống ghi chú/điều khoản, không phải sản phẩm", "name", "Xóa dòng hoặc chọn lại khoảng dòng import"));
  }

  if (!p.name || p.name.length < 2) {
    issues.push(issue("missing_product_name", "error", "Thiếu tên sản phẩm", "name"));
  }
  if (!userAccepted && (WEIRD_TEXT_RE.test(String(product?.name || "")) || weirdRatio(product?.name) > 0.02 || MOJIBAKE_RE.test(String(product?.name || "")))) {
    issues.push(isPdfSource
      ? issue("pdf_ocr_uncertain", "warning", "PDF/OCR không chắc — kiểm tra lại tên/giá trước khi nhập", "name")
      : issue("weird_font", "warning", "Text có dấu hiệu lỗi font từ file nguồn", "name"));
  }

  const finalIssues = filterIssuesAfterUserAcceptance(issues, p);
  const hasError = finalIssues.some((it) => it.level === "error");
  const hasWarn = finalIssues.some((it) => it.level === "warning");
  const prevMeta = p._meta || {};
  if (wasSkippedByEngine) {
    p._meta = {
      ...prevMeta,
      issues: finalIssues,
      status: "skipped",
      canonicalStatus: "skipped",
      confidence: Math.min(prevMeta.confidence ?? 0.5, 0.5),
      sanitized: true,
    };
  } else {
    p._meta = {
      ...prevMeta,
      issues: finalIssues,
      status: hasError ? "review" : (hasWarn ? "review" : (prevMeta.canonicalStatus === "auto_approved" || userAccepted ? "new" : (prevMeta.status || "new"))),
      canonicalStatus: hasError || hasWarn ? (prevMeta.canonicalStatus || "need_review") : "auto_approved",
      confidence: hasError ? Math.min(prevMeta.confidence ?? 0.72, 0.42) : hasWarn ? Math.min(prevMeta.confidence ?? 0.72, 0.64) : Math.max(prevMeta.confidence ?? 0.78, userAccepted ? 0.9 : 0.78),
      sanitized: true,
    };
  }

  return p;
}

export function sanitizeCatalogProducts(products, opts = {}) {
  return (products || []).map((p) => sanitizeCatalogProduct(p, opts));
}

export function isUnsafeImportedProduct(product) {
  const issues = product?._meta?.issues || [];
  const accepted = isUserAccepted(product);
  if (accepted) {
    return issues.some((it) => isHardIssueAfterUserAcceptance(it, product));
  }
  const status = product?._meta?.status;
  return status === "review" || status === "rejected" || issues.some((it) => getIssueLevel(it) === "error" || getIssueLevel(it) === "warning");
}
