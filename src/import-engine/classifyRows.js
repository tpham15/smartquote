// ============================================================
// classifyRows — phân loại từng dòng trong sheet
// KHÔNG hard-code ngành. Dựa trên đặc trưng cấu trúc + từ khoá chung.
// ============================================================
import { ROW_CLASS } from "./types.js";
import { getPriceCandidates, isLikelyNonProductRow, extractSkuFromText } from "./productSanitizer.js";

// Từ khoá NHIỄU (không bao giờ là sản phẩm) — chung mọi ngành
const NOISE_PATTERNS = [
  /^tổng\s*(cộng|tiền|giá trị|kết)/i,
  /^cộng\b/i,
  /thành tiền|tổng thanh toán/i,
  /\bvat\b|thuế\s*(gtgt|vat)|đã.*thuế|chưa.*thuế/i,
  /chiết khấu|giảm giá|khuyến mãi/i,
  /ghi chú|lưu ý|chú ý|note\b/i,
  /chính sách|điều kiện|điều khoản|cam kết/i,
  /bảo hành|bảo trì|đổi trả|hoàn tiền/i,
  /thanh toán|chuyển khoản|ngân hàng|số tk|tài khoản|hình thức tt/i,
  /giao hàng|vận chuyển|ship|thời gian giao/i,

  /hàng\s*đặt|hang\s*dat|thường\s*trong\s*vòng|thuong\s*trong\s*vong/i,
  /thi\s*công|thi\s*cong|hoàn\s*thành|hoan\s*thanh|kể\s*từ\s*ngày|ke\s*tu\s*ngay/i,
  /giao\s*hàng|giao\s*hang|vận\s*chuyển|van\s*chuyen|lắp\s*đặt|lap\s*dat/i,
  /hợp\s*đồng|hop\s*dong|tạm\s*ứng|tam\s*ung|nghiệm\s*thu|nghiem\s*thu/i,
  /miễn phí|tặng kèm|quà tặng/i,
  /thời hạn|hiệu lực|có giá trị đến|báo giá có/i,
  /cảm ơn|trân trọng|kính gửi|kính chào|liên hệ|hotline/i,
  /người (lập|báo giá|phụ trách|đại diện)|ký (tên|xác nhận)/i,
  /^(địa chỉ|email|website|đt|sđt|tel)\b/i,
  /^trang\s*\d|page\s*\d/i,
];

// Tên cột header điển hình — để nhận dòng header
const HEADER_TOKENS = [
  "stt", "tt", "no", "mã", "ma sp", "mã sp", "mã hàng", "sku", "code",
  "tên", "ten", "sản phẩm", "san pham", "hàng hoá", "hàng hóa", "mô tả", "diễn giải",
  "thiết bị", "vật tư", "quy cách", "thông số", "đặc điểm",
  "đvt", "đơn vị", "dvt", "unit", "số lượng", "sl", "qty",
  "đơn giá", "don gia", "giá", "gia", "price", "thành tiền", "thanh tien",
  "xuất xứ", "hãng", "ncc", "nhà cung cấp", "hình ảnh", "ảnh", "image", "ghi chú",
];

/** Có chứa số tiền hợp lệ không. Không strip digit thô để tránh nhầm "03-05 ngày" thành 305. */
function hasMoneyValue(row, priceCol) {
  const readCandidates = (s) => getPriceCandidates(s || "");
  if (priceCol != null && row.text[priceCol]) {
    const found = readCandidates(row.text[priceCol]);
    if (found.length) return found[0];
  }
  let best = 0;
  for (const t of row.text) {
    if (!t) continue;
    for (const n of readCandidates(t)) if (n > best) best = n;
  }
  return best;
}

/** Đếm số ô là số (để phân biệt dòng data vs dòng chữ) */
function countNumericCells(row) {
  return row.text.filter((t) => t && /^[\d.,\s]+$/.test(t) && /\d/.test(t)).length;
}

/**
 * Phân loại 1 dòng.
 * @param {import('./types').NormalizedRow} row
 * @param {Object} opt
 * @param {?number} opt.priceCol
 * @param {?number} opt.nameCol
 * @param {number}  opt.maxCol
 * @returns {RowClass}
 */
export function classifyRow(row, opt = {}) {
  const { priceCol = null, nameCol = null, maxCol = 0 } = opt;
  const joined = row.joined;
  const joinedLower = joined.toLowerCase();

  if (!joined || row.filled === 0) return ROW_CLASS.BLANK;

  // 0. STRONG SKIP: điều khoản/giao hàng/bảo hành/thanh toán không phải sản phẩm.
  if (isLikelyNonProductRow(joined)) return ROW_CLASS.NOTE;

  // 1. HEADER: nhiều token tiêu đề, ít số
  const headerHits = HEADER_TOKENS.filter((tok) => {
    return row.text.some((t) => t && t.toLowerCase().trim() === tok);
  }).length;
  const numericCells = countNumericCells(row);
  if (headerHits >= 2 && numericCells <= 1) return ROW_CLASS.HEADER;

  // 2. NOISE (note/total/...) — kiểm tra cả dòng
  for (const pat of NOISE_PATTERNS) {
    if (pat.test(joinedLower) || pat.test(joined)) {
      // Ngoại lệ: nếu có cả mã SKU rõ ràng + giá lớn thì vẫn có thể là SP
      const money = hasMoneyValue(row, priceCol);
      const looksLikeSku = !!extractSkuFromText(joined);
      if (pat.source.includes("tổng") || pat.source.includes("vat") || pat.source.includes("cộng")) {
        return ROW_CLASS.TOTAL;
      }
      if (!(money && looksLikeSku)) {
        return ROW_CLASS.NOTE;
      }
    }
  }

  // 3. Dòng bắt đầu bằng gạch đầu dòng / bullet → note
  if (/^\s*[\-–—•*+>]/.test(joined) && hasMoneyValue(row, priceCol) === 0) {
    return ROW_CLASS.NOTE;
  }

  // 4. SECTION header: ít ô, không giá, dạng tiêu đề nhóm
  const money = hasMoneyValue(row, priceCol);
  const isShortLabel = row.filled <= 2 && joined.length <= 60;
  const looksUpper = joined === joined.toUpperCase() && /[A-ZĐÀ-Ỹ]/.test(joined);
  const sectionLike = /^[IVX]+[\.\)]|^[A-Z][\.\)]\s|^(nhóm|loại|hạng mục|phần)\b/i.test(joined);
  if (money === 0 && (isShortLabel && (looksUpper || sectionLike))) {
    return ROW_CLASS.SECTION;
  }

  // 5. PRODUCT: có giá tiền HOẶC (có mã + có tên)
  const hasName = nameCol != null ? !!row.text[nameCol] : joined.length >= 3;
  if (money >= 100 && hasName) return ROW_CLASS.PRODUCT;

  // có mã SKU + tên nhưng giá ở dòng/cột khác (giá 0) — vẫn coi là product nếu có tên dài
  const hasSku = !!extractSkuFromText(joined);
  if (hasSku && hasName && joined.length >= 5) return ROW_CLASS.PRODUCT;

  // 6. Mặc định: nếu có giá → product, không thì note
  if (money >= 100) return ROW_CLASS.PRODUCT;
  return ROW_CLASS.NOTE;
}

/**
 * Phân loại toàn bộ rows trong 1 sheet.
 * @returns {Array<{row, class}>}
 */
export function classifyRows(rows, opt) {
  return rows.map((row) => ({ row, class: classifyRow(row, opt) }));
}

export { hasMoneyValue, NOISE_PATTERNS };
