import { inferCategoryForProduct } from "./categoryInference.js";

// ============================================================
// Product sanitizer — guardrail cho dữ liệu import catalog/PDF.
// Mục tiêu: không để AI/PDF nhét nguyên mô tả dài, text lỗi font,
// hoặc giá bị dính nhiều cột vào catalog như một sản phẩm hợp lệ.
// ============================================================

const MAX_NORMAL_PRICE = 1_000_000_000; // thiết bị/két an toàn cao cấp có thể >300tr; >1 tỷ vẫn coi là lỗi parse
const MIN_NORMAL_PRICE = 1_000;

const WEIRD_TEXT_RE = /[�□■█▯▮▰◆◇▶◀↔↕\uFFFE\uFFFF]/;
// Mojibake phổ biến khi text tiếng Việt bị decode sai encoding từ PDF/Excel
const MOJIBAKE_RE = /(Ã|Â|á»|áº|Ä|Æ|ð|Ð|å|Å)/;
const SPEC_KEYWORD_RE = /\b(Chất liệu|Nguồn cấp|Nguồn điện|Dòng điện|Công suất|Công suất hoạt động|Nhiệt độ|Độ ẩm|Kích thước|Tích hợp|Loại thẻ|Tốc độ|Khoảng cách|Mã khóa|Mã khóa sử dụng|Màu sắc|Điện áp|Tần số|Chuẩn kết nối|Bảo hành|Xuất xứ|Thông số|Model|Đặc điểm|Tính năng|Tải trọng|Kích cỡ|Kết nối|Ứng dụng|Nguồn máy tính)\b/i;
const CATEGORY_JUNK_RE = /tổng|tong|hợp|hop|báo giá|bao gia|khóa|khoa|tài khoản|tai khoan|ngân hàng|ngan hang|hotline|điều khoản|dieu khoan|ghi chú|ghi chu|bảo hành|bao hanh/i;
const UNIT_ALLOW_RE = /^(cái|cai|chiếc|chiec|bộ|bo|bộ\.|cặp|cap|m|mét|met|md|cuộn|cuon|thùng|thung|hộp|hop|kg|g|lít|lit|bịch|bich|tấm|tam|bộ đôi|set|pcs|piece|unit)$/i;

const NON_PRODUCT_ROW_RE = /(^|\b)(hàng\s*đặt|hang\s*dat|thi\s*công|thi\s*cong|giao\s*hàng|giao\s*hang|vận\s*chuyển|van\s*chuyen|bảo\s*hành|bao\s*hanh|bảo\s*trì|bao\s*tri|thanh\s*toán|thanh\s*toan|điều\s*khoản|dieu\s*khoan|điều\s*kiện|dieu\s*kien|hiệu\s*lực|hieu\s*luc|hợp\s*đồng|hop\s*dong|tạm\s*ứng|tam\s*ung|nghiệm\s*thu|nghiem\s*thu|lưu\s*ý|luu\s*y|ghi\s*chú|ghi\s*chu)(\b|:)/i;
const BILLABLE_SERVICE_ROW_RE = /(^|\b)(nhân\s*công|nhan\s*cong|công\s*lắp|cong\s*lap|lắp\s*đặt|lap\s*dat|thi\s*công|thi\s*cong|bảo\s*hành\s*mở\s*rộng|bao\s*hanh\s*mo\s*rong|khảo\s*sát|khao\s*sat|dịch\s*vụ|dich\s*vu)(\b|:)/i;
const CONTACT_OR_BANK_RE = /(ngân\s*hàng|ngan\s*hang|tài\s*khoản|tai\s*khoan|số\s*tk|so\s*tk|hotline|website|email|địa\s*chỉ|dia\s*chi|mst|mã\s*số\s*thuế|ma\s*so\s*thue)/i;
const DOCUMENT_METADATA_RE = /^\s*(khách\s*hàng|khach\s*hang|công\s*trình|cong\s*trinh|địa\s*điểm(?:\s*công\s*trình)?|dia\s*diem(?:\s*cong\s*trinh)?|điện\s*thoại|dien\s*thoai|số\s*điện\s*thoại|so\s*dien\s*thoai|số\s*báo\s*giá|so\s*bao\s*gia|ngày|ngay|email|người\s*báo\s*giá|nguoi\s*bao\s*gia|hạng\s*mục|hang\s*muc|mst|mã\s*số\s*thuế|ma\s*so\s*thue|showroom|vpgd)\s*[:：]/i;
const SKU_CANDIDATE_RE = /\b(?:[A-Z]{2,}[A-Z0-9]*[-_/][A-Z0-9][A-Z0-9._\-/]{1,}|[A-Z]{2,}\d{2,}[A-Z0-9._\-/]*|[A-Z0-9]{2,}-[A-Z0-9]{2,}(?:[-_/][A-Z0-9]{1,})*)\b/g;

function text(v) {
  return String(v ?? "").replace(/\s+/g, " ").trim();
}

function asciiFold(v) {
  return text(v)
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d").replace(/Đ/g, "D")
    .toLowerCase();
}

function stripWeird(v) {
  return text(v).replace(/[�□■█▯▮▰◆◇▶◀↔↕\uFFFE\uFFFF]/g, "").replace(/\s+/g, " ").trim();
}

function weirdRatio(v) {
  const s = text(v);
  if (!s) return 0;
  const weird = (s.match(/[�□■█▯▮▰◆◇▶◀↔↕\uFFFE\uFFFF]/g) || []).length;
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

function parseLocalizedPriceToken(token = "") {
  const raw = String(token || "").trim();
  if (!/\d/.test(raw)) return 0;
  const compact = raw.replace(/\s+/g, "");

  // US/decimal style: 1,234.56 or 1234.56. This is usually not VND; keep decimal value
  // so it can later be multiplied by a header scale like "(triệu)".
  if (/^\d{1,3}(?:,\d{3})+\.\d{1,2}$/.test(compact)) {
    const n = Number(compact.replace(/,/g, ""));
    return Number.isFinite(n) ? n : 0;
  }
  // Vietnamese decimal: 1,2 (triệu) / 1.2 (triệu). Return 1.2; scale layer handles it.
  if (/^\d+[,.]\d{1,2}$/.test(compact)) {
    const n = Number(compact.replace(",", "."));
    return Number.isFinite(n) ? n : 0;
  }
  // Thousand separated VND: 7.200.000, 7,200,000, 768.000đ
  if (/^\d{1,3}(?:[\.,]\d{3}){1,4}$/.test(compact)) {
    const n = Number(compact.replace(/[^\d]/g, ""));
    return Number.isFinite(n) ? n : 0;
  }
  // Plain integer.
  const n = Number(compact.replace(/[^\d]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function looksLikeYyyymmdd(n) {
  const s = String(Math.trunc(Math.abs(Number(n) || 0)));
  return /^20\d{6}$/.test(s) || /^19\d{6}$/.test(s);
}

function looksLikePhoneNumberToken(token = "") {
  const s = String(token || "").replace(/\D/g, "");
  return /^(0|84)(3|5|7|8|9)\d{8}$/.test(s) || /^(1800|1900)\d{4,6}$/.test(s);
}

function extractPricesFromText(raw) {
  const s = String(raw ?? "");
  if (DOCUMENT_METADATA_RE.test(s)) return [];
  // Loại số điện thoại có dấu chấm/khoảng trắng trước khi tìm token tiền.
  const scan = s.replace(/\b(?:0[35789]\d{2}|84[35789]\d{1,2})[.\s-]?\d{3}[.\s-]?\d{3}\b/g, " ");
  const candidates = [];

  // Số có đơn vị triệu/tr: 1,2 triệu / 1.2 tr / 12 triệu.
  // "tr" chỉ là đơn vị khi kết thúc token. Không match tiền tố của từ Việt như
  // "1 Trình bày..." (JS \b coi ký tự có dấu là non-word nên regex cũ đọc nhầm thành 1 triệu).
  for (const m of scan.matchAll(/\b(\d+(?:[,.]\d{1,2})?)\s*(triệu|trieu|tr)(?=\s|$|[đ₫.,;:)\]])/gi)) {
    const base = parseLocalizedPriceToken(m[1]);
    const n = Math.round(base * 1_000_000);
    if (Number.isFinite(n)) candidates.push(n);
  }

  // Các giá có dấu phân tách nghìn: 7.200.000, 7,200,000, 768.000đ
  for (const m of scan.matchAll(/\d{1,3}(?:[\.,]\d{3}){1,4}(?:\.\d{1,2})?/g)) {
    // Không biến định dạng US decimal 1,234.56 thành giá VND 123.456 hoặc 1.235.
    if (/^\d{1,3}(?:,\d{3})+\.\d{1,2}$/.test(m[0])) continue;
    if (looksLikePhoneNumberToken(m[0])) continue;
    const n = parseLocalizedPriceToken(m[0]);
    if (Number.isFinite(n)) candidates.push(Math.round(n));
  }

  // Các số dài không có dấu phân cách: 7200000. Loại ngày YYYYMMDD.
  for (const m of scan.matchAll(/\b\d{5,10}\b/g)) {
    const n = Number(m[0]);
    if (Number.isFinite(n) && !looksLikeYyyymmdd(n) && !looksLikePhoneNumberToken(m[0])) candidates.push(n);
  }

  return [...new Set(candidates)]
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

export function isLikelyBillableServiceRow(rawText) {
  const raw = text(rawText);
  if (!raw) return false;
  return BILLABLE_SERVICE_ROW_RE.test(raw) && extractPricesFromText(raw).length > 0;
}

export function isLikelyNonProductRow(rawText, opts = {}) {
  const raw = text(rawText);
  if (!raw) return false;
  if (DOCUMENT_METADATA_RE.test(raw) || CONTACT_OR_BANK_RE.test(raw)) return true;
  if (!NON_PRODUCT_ROW_RE.test(raw)) return false;
  const sku = extractSkuFromText(raw);
  const prices = extractPricesFromText(raw);
  // Nhân công/lắp đặt/thi công/bảo hành mở rộng có giá là hạng mục báo giá hợp lệ.
  if (isLikelyBillableServiceRow(raw)) return false;
  // Dòng điều khoản/giao hàng/bảo hành có số ngày như 03-05 không phải giá.
  // Nếu có SKU rõ + giá hợp lệ thì vẫn để engine xử lý như sản phẩm.
  return !(sku && prices.length > 0);
}

function isBadSkuCandidate(cand) {
  if (!cand || /^\d+$/.test(cand)) return true;
  if (/^(VAT|TEL|HOTLINE|EMAIL|WWW|HTTP|HTTPS|MODEL|CODE|SKU)$/.test(cand)) return true;
  if (/^20\d{2}$/.test(cand)) return true;
  if (cand.length < 4 || cand.length > 40) return true;
  if (!/[A-Z]/.test(cand)) return true;
  const hasDigit = /\d/.test(cand);
  // Some real Vietnamese supplier models are letter-only but structurally code-like
  // (LM-PCB, TU-DAUGHI). Accept only compact uppercase segmented tokens.
  const letterOnlyModel = /^[A-Z0-9]{1,6}(?:[-_/][A-Z0-9]{2,12}){1,3}$/.test(cand);
  if (!hasDigit && !letterOnlyModel) return true;
  return false;
}

function skuScore(cand) {
  let score = 0;
  if (/[-_/]/.test(cand)) score += 8;
  if (/^[A-Z]{2,}[-_/]/.test(cand)) score += 4;
  if (/^[A-Z]{2,}\d/.test(cand)) score += 2;
  if (cand.length >= 6 && cand.length <= 22) score += 2;
  if (cand.length > 28) score -= 3;
  if (/^(OSN|DDL|SBX|K\d|R\d|LM|LS|SNT|KBT|NVR|DVR|DS|IPC|HAC|HD|MS|AQA|LUMI|TU|RG)/i.test(cand)) score += 2;
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

/**
 * Một số báo giá lịch sử dùng cột "Mã thiết bị" để ghi bảo hành (vd "BH 36 tháng"),
 * trong khi SKU thật lại nằm ở cột Tên hàng hoá. Đây là schema drift theo section,
 * không phải dòng rác nếu cột Tên thực sự chứa model hợp lệ.
 */
export function isWarrantyPseudoSku(value = "") {
  const s = asciiFold(value);
  if (!s) return false;
  return /^(?:bh|bao\s*hanh)\s*\d{1,3}\s*(?:thang|nam|months?|years?)$/.test(s);
}

function descriptiveNameFromSpecs(rawSpecs = "") {
  const cleanLine = (x) => String(x || "")
    .replace(/^[\s"'“”‘’*•\-–—]+/, "")
    .replace(/[\s"'“”‘’]+$/, "")
    .trim();
  const isSpecOnlyStart = (line) => /^(tinh\s*nang|thong\s*so|dien\s*ap|nguon|cong\s*suat|nhiet\s*do|kich\s*thuoc|bao\s*hanh|cri\b|quang\s*thong|goc\s*chieu)/.test(asciiFold(line));
  const marker = /\b(?:Tính\s*năng|Thông\s*số|Điện\s*áp|Nguồn|Công\s*suất|Nhiệt\s*độ|Kích\s*thước|Bảo\s*hành|CRI|Quang\s*thông|Góc\s*chiếu)\b/i;
  const headBeforeSpecs = (value) => {
    const line = cleanLine(value);
    const m = marker.exec(line);
    return cleanLine(m && m.index >= 4 ? line.slice(0, m.index) : line);
  };

  const lines = String(rawSpecs || "").split(/\r?\n/).map(headBeforeSpecs).filter(Boolean);
  for (const line of lines) {
    if (line.length >= 4 && line.length <= 110 && !isSpecOnlyStart(line)) return line;
  }

  // normalizeWorkbook cố ý collapse newline. Khi đó vẫn cắt theo marker thông số.
  const head = headBeforeSpecs(text(rawSpecs));
  if (head.length >= 4 && head.length <= 110 && !isSpecOnlyStart(head)) return head;
  return "";
}

export function recoverQuoteSectionSchemaIdentity({ name = "", sku = "", specs = "" } = {}) {
  const rawName = text(name);
  const rawSku = text(sku);
  const detectedSku = extractSkuFromText(rawName);
  const sameIdentity = detectedSku && asciiFold(detectedSku).replace(/[^a-z0-9]+/g, "") === asciiFold(rawName).replace(/[^a-z0-9]+/g, "");
  const promotedSku = sameIdentity ? rawName.replace(/\s*[-–—]\s*/g, "-").trim() : detectedSku;
  if (!isWarrantyPseudoSku(rawSku) || !promotedSku) {
    return { name: rawName, sku: rawSku, specs: text(specs), recovered: false, warranty: "" };
  }
  const descriptive = descriptiveNameFromSpecs(specs);
  return {
    name: descriptive || `Sản phẩm ${promotedSku}`,
    sku: promotedSku,
    specs: text(specs),
    recovered: true,
    warranty: rawSku,
  };
}

function stableCatalogSkuKey(value = "") {
  const raw = text(value);
  if (!raw || /^(?:n\/?a|na|null|none|—|-|khong\s*co)$/i.test(asciiFold(raw))) return "";
  if (isWarrantyPseudoSku(raw)) return "";
  return asciiFold(raw).replace(/[^a-z0-9]+/g, "");
}

function stableCatalogNameKey(product = {}) {
  const name = asciiFold(product?.name || "").replace(/[^a-z0-9]+/g, " ").trim();
  if (!name || name.length < 4) return "";
  const supplier = asciiFold(product?.supplier || "").replace(/[^a-z0-9]+/g, " ").trim();
  return `${supplier}|${name}`;
}

function catalogIdentityKey(product = {}) {
  const sku = stableCatalogSkuKey(product?.sku);
  if (sku) return `sku:${sku}`;
  const name = stableCatalogNameKey(product);
  return name ? `name:${name}` : "";
}

function productEvidenceScore(product = {}) {
  let score = Number(product?.confidence || product?._meta?.confidence || 0) * 20;
  const sku = stableCatalogSkuKey(product?.sku);
  if (sku) score += 12;
  if (text(product?.name).length >= 6) score += 6;
  if (text(product?.specs).length >= 20) score += 4;
  if (Number(product?.costPrice ?? product?.price ?? 0) > 0) score += 5;
  if (product?.status === "matched" || product?._meta?.status === "matched") score += 2;
  if (product?.status === "review" || product?._meta?.status === "review") score -= 3;
  return score;
}

function mergeIssues(a = [], b = []) {
  const out = [];
  const seen = new Set();
  for (const item of [...(a || []), ...(b || [])]) {
    if (!item) continue;
    const k = typeof item === "string" ? item : `${item.code || ""}|${item.level || ""}|${item.message || ""}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out;
}

/**
 * Catalog import phải trả về PRODUCT IDENTITIES, không phải mọi occurrence trong báo giá.
 * Exact SKU được ưu tiên; thiếu SKU mới fallback theo supplier+name. Nếu cùng identity có
 * giá khác nhau đáng kể thì vẫn gộp nhưng hạ về review để người dùng xác nhận.
 */
export function dedupeCatalogIdentities(products = []) {
  const out = [];
  const byKey = new Map();
  let deduped = 0;
  let conflicts = 0;

  for (const original of products || []) {
    if (!original) continue;
    const item = { ...original };
    const key = catalogIdentityKey(item);
    if (!key || !byKey.has(key)) {
      if (key) byKey.set(key, out.length);
      out.push(item);
      continue;
    }

    deduped += 1;
    const idx = byKey.get(key);
    const previous = out[idx];
    const winner = productEvidenceScore(item) > productEvidenceScore(previous) ? item : previous;
    const loser = winner === item ? previous : item;
    const previousPrice = Number(previous?.costPrice ?? previous?.price ?? 0) || 0;
    const itemPrice = Number(item?.costPrice ?? item?.price ?? 0) || 0;
    const priceConflict = previousPrice > 0 && itemPrice > 0 && Math.abs(previousPrice - itemPrice) > Math.max(100, Math.round(Math.min(previousPrice, itemPrice) * 0.01));

    const sources = [];
    const addSource = (source) => {
      if (!source) return;
      const k = `${source.sheet || ""}|${source.rowIndex ?? ""}|${source.rawText || ""}`;
      if (!sources.some((x) => x._k === k)) sources.push({ ...source, _k: k });
    };
    for (const source of previous.sourceOccurrences || []) addSource(source);
    addSource(previous.source);
    for (const source of item.sourceOccurrences || []) addSource(source);
    addSource(item.source);

    let merged = {
      ...loser,
      ...winner,
      name: text(winner.name) || text(loser.name),
      sku: text(winner.sku) || text(loser.sku),
      specs: text(winner.specs).length >= text(loser.specs).length ? winner.specs : loser.specs,
      supplier: text(winner.supplier) || text(loser.supplier),
      unit: text(winner.unit) || text(loser.unit),
      issues: mergeIssues(previous.issues, item.issues),
      sourceOccurrences: sources.map(({ _k, ...source }) => source),
    };

    if (priceConflict) {
      conflicts += 1;
      merged.issues = mergeIssues(merged.issues, [issue(
        "duplicate_identity_price_conflict",
        "warning",
        `Cùng sản phẩm xuất hiện nhiều lần với đơn giá khác nhau (${previousPrice.toLocaleString("vi-VN")}đ / ${itemPrice.toLocaleString("vi-VN")}đ)`,
        "costPrice",
        "Kiểm tra giá đúng trước khi cập nhật catalog"
      )]);
      if ("status" in merged) merged.status = "review";
      if ("confidence" in merged) merged.confidence = Math.min(Number(merged.confidence || 0.7), 0.64);
      if (merged._meta) merged._meta = { ...merged._meta, status: "review", canonicalStatus: "need_review", issues: mergeIssues(merged._meta.issues, merged.issues) };
    }

    out[idx] = merged;
  }

  return { products: out, deduped, conflicts };
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


const OLD_QUOTE_FILE_RE = /(^|[\s_\-])(bg|bao\s*gia|bang\s*bao\s*gia|quote|quotation)([\s_\-]|$)|bg\s*kh|bao\s*gia/i;
const OLD_QUOTE_SECTION_PREFIX_RE = /^(?:san\s*pham\s*)?(?:[ivxlcdm]+|\d+)\s*[.\/)]{1,3}\s*(?:tang|lau|phong|khu|khu\s*vuc|hang\s*muc|giai\s*phap|he\s*thong|thiet\s*bi|vat\s*tu|cong\s*tac|bo\s*dieu\s*khien|camera|cam\s*bien|chieu\s*sang|am\s*thanh|mang|wifi|rem|den|khoa|cong|motor|san\s*pham)\b/i;
const OLD_QUOTE_GROUP_WORD_RE = /^(?:san\s*pham\s*)?(?:giai\s*phap|he\s*thong|hang\s*muc|nhom|tong\s*hop|tong|vat\s*tu\s*phu|phu\s*kien\s*phu|goi\s*vat\s*tu|goi\s*phu\s*kien)\b/i;
const OLD_QUOTE_CONTEXT_RE = /\b(bang\s*bao\s*gia|bao\s*gia|khach\s*hang|so\s*bao\s*gia|nguoi\s*bao\s*gia|dia\s*diem\s*cong\s*trinh)\b/i;

export function isLikelyOldQuoteFileName(fileName = "") {
  return OLD_QUOTE_FILE_RE.test(asciiFold(fileName));
}

export function isLikelyOldQuoteSectionRow(rawText = "") {
  const raw = asciiFold(rawText);
  if (!raw) return false;
  // Nếu trong cùng dòng có SKU/model rõ, đừng coi là hạng mục.
  if (extractSkuFromText(rawText)) return false;
  if (OLD_QUOTE_SECTION_PREFIX_RE.test(raw)) return true;
  if (/^(?:san\s*pham\s*)?[ivxlcdm]+\s*[\/\.)]/i.test(raw) && /\b(giai\s*phap|he\s*thong|tang|phong|mang|wifi|camera|cam\s*bien|chieu\s*sang|am\s*thanh|thiet\s*bi)\b/i.test(raw)) return true;
  return false;
}

export function isLikelyOldQuoteAggregateProduct(product = {}, opts = {}) {
  const p = product || {};
  const fileName = opts.sourceFileName || opts.fileName || p._meta?.source?.fileName || p.source?.fileName || "";
  const rawText = [p._meta?.source?.rawText, p.source?.rawText, p.rawText].filter(Boolean).join(" ");
  const context = asciiFold([fileName, rawText].join(" "));
  const oldQuoteContext = !!(opts.oldQuoteMode || opts.importSourceKind === "old_quote" || isLikelyOldQuoteFileName(fileName) || OLD_QUOTE_CONTEXT_RE.test(context));
  if (!oldQuoteContext) return false;

  const sku = text(p.sku);
  // Mapping lỗi có thể chép chính sub-header vào cả Tên và SKU. Phải nhận diện
  // cấu trúc group/subtotal TRƯỚC khi xem một ô SKU không-rỗng là bằng chứng product.
  if (isLikelyOldQuoteSectionRow(p.name) || isLikelyOldQuoteSectionRow(sku)) return true;
  if (sku && !/^(n\/?a|na|null|none|—|-)$/.test(sku)) return false;

  const name = asciiFold(p.name);
  const unit = asciiFold(p.unit);
  const specs = text(p.specs);
  const supplier = asciiFold(p.supplier);
  const combined = asciiFold([p.name, p.category, p.supplier, p.unit, p.specs, rawText].join(" "));

  if (isLikelyOldQuoteSectionRow([p.name, rawText].filter(Boolean).join(" "))) return true;
  if (OLD_QUOTE_GROUP_WORD_RE.test(name)) return true;
  if (/\b(vat\s*tu\s*phu|phu\s*kien\s*phu|goi\s*vat\s*tu|goi\s*phu\s*kien)\b/i.test(combined) && (!unit || unit === "goi" || unit === "bo")) return true;
  if (/\b(tong\s*gia\s*tri|tong\s*cong|tam\s*tinh|thanh\s*tien|nhan\s*cong\s*,?\s*lap\s*trinh|nhan\s*cong|lap\s*dat|thi\s*cong)\b/i.test(name)) return true;

  const hasDetailedSpecs = specs.length >= 35 || /(model|sku|ma\s*thiet\s*bi|dien\s*ap|cong\s*suat|kich\s*thuoc|nguon|chuan\s*ket\s*noi|bao\s*hanh)/i.test(asciiFold(specs));
  const hasBrand = supplier && !/^(n\/?a|na|khong|chung|catalog|bao\s*gia)$/i.test(supplier);
  const groupish = /\b(giai\s*phap|he\s*thong|hang\s*muc|tong\s*hop)\b/i.test(name);
  if (groupish && !hasDetailedSpecs && !hasBrand) return true;

  return false;
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

  const oldQuoteGuardSkipped = !userAccepted && isLikelyOldQuoteAggregateProduct(p, opts);
  if (oldQuoteGuardSkipped) {
    p._skipReason = "old_quote_group_or_subtotal";
    issues.push(issue(
      "old_quote_group_or_subtotal",
      "error",
      "Dòng này giống hạng mục/tổng nhóm trong báo giá cũ, không lưu vào danh mục sản phẩm",
      "name",
      "Giữ làm nhóm báo giá nếu cần, nhưng không nhập vào catalog"
    ));
  }

  // Bao gồm identity + giá đã parse trong evidence. Một sản phẩm thật có SKU/giá rõ
  // không được biến thành non-product chỉ vì specs chứa câu "Bảo hành 36 tháng".
  if (!userAccepted && isLikelyNonProductRow([p.name, p.sku, p.costPrice, p.specs, p._meta?.source?.rawText, p.source?.rawText, p.rawText].filter(Boolean).join(" "))) {
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
  const shouldSkipRow = wasSkippedByEngine || oldQuoteGuardSkipped;
  if (shouldSkipRow) {
    p._meta = {
      ...prevMeta,
      issues: finalIssues,
      status: "skipped",
      canonicalStatus: "skipped",
      confidence: Math.min(prevMeta.confidence ?? 0.5, oldQuoteGuardSkipped ? 0.35 : 0.5),
      sanitized: true,
      oldQuoteGuardSkipped: oldQuoteGuardSkipped || !!prevMeta.oldQuoteGuardSkipped,
      skipReason: p._skipReason || prevMeta.skipReason,
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
  const canonicalStatus = product?._meta?.canonicalStatus;
  if (status === "skipped" || canonicalStatus === "skipped") return true;
  return status === "review" || status === "rejected" || issues.some((it) => getIssueLevel(it) === "error" || getIssueLevel(it) === "warning");
}
