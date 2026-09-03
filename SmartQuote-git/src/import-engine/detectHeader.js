// ============================================================
// detectHeader — tìm dòng tiêu đề cột trong 1 vùng dữ liệu
// ============================================================

const HEADER_TOKENS = [
  "stt", "tt", "no", "mã", "mã sp", "mã hàng", "sku", "code", "model",
  "tên", "sản phẩm", "hàng hoá", "hàng hóa", "mô tả", "diễn giải",
  "thiết bị", "vật tư", "quy cách", "thông số", "đặc điểm", "tính năng",
  "đvt", "đơn vị", "unit", "số lượng", "sl", "qty",
  "đơn giá", "giá", "price", "thành tiền", "giá bán", "giá lẻ", "giá npp", "giá đại lý", "giá nhập",
  "xuất xứ", "hãng", "ncc", "nhà cung cấp", "hình ảnh", "ảnh", "image", "ghi chú", "màu",
];

/**
 * Chấm điểm 1 dòng xem có giống header không.
 * @param {import('./types').NormalizedRow} row
 * @returns {number} điểm
 */
function headerScore(row) {
  let score = 0;
  for (const t of row.text) {
    if (!t) continue;
    const low = t.toLowerCase().trim();
    // khớp chính xác token
    if (HEADER_TOKENS.includes(low)) score += 2;
    // chứa token
    else if (HEADER_TOKENS.some((tok) => low.includes(tok) && low.length < tok.length + 8)) score += 1;
  }
  // header thường ít số
  const numCells = row.text.filter((t) => t && /^[\d.,\s]+$/.test(t)).length;
  score -= numCells;
  return score;
}

/**
 * Tìm dòng header tốt nhất trong 1 dải rows.
 * @param {import('./types').NormalizedRow[]} rows
 * @param {number} searchLimit - chỉ tìm trong N dòng đầu
 * @returns {{headerRow: ?import('./types').NormalizedRow, headerIndex: number, score: number}}
 */
export function detectHeader(rows, searchLimit = 15) {
  let best = null;
  let bestScore = 1; // ngưỡng tối thiểu
  let bestIdx = -1;

  const limit = Math.min(searchLimit, rows.length);
  for (let i = 0; i < limit; i++) {
    const s = headerScore(rows[i]);
    if (s > bestScore) {
      bestScore = s;
      best = rows[i];
      bestIdx = i;
    }
  }

  return { headerRow: best, headerIndex: bestIdx, score: bestScore };
}

export { headerScore, HEADER_TOKENS };
