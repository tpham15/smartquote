// ============================================================
// detectRegions — chia sheet thành các vùng dữ liệu (region)
// Mỗi region là 1 dải dòng liên tục thuộc cùng 1 bảng,
// có thể gắn với 1 section header.
// ============================================================
import { classifyRow } from "./classifyRows.js";
import { ROW_CLASS } from "./types.js";

/**
 * Phát hiện các region trong 1 sheet.
 * Chiến lược: quét tuần tự, gom các dòng product liên tục thành region.
 * Section header cập nhật "sectionName" cho các region phía sau.
 *
 * @param {import('./types').NormalizedSheet} sheet
 * @param {Object} preMap - {priceCol, nameCol, maxCol} ước lượng sơ bộ (có thể null)
 * @returns {import('./types').Region[]}
 */
export function detectRegions(sheet, preMap = {}) {
  const { rows, maxCol } = sheet;
  const opt = { priceCol: preMap.priceCol ?? null, nameCol: preMap.nameCol ?? null, maxCol };

  const regions = [];
  let currentSection = "";
  let regionStart = -1;
  let lastProductRow = -1;

  const flush = (endIdx) => {
    if (regionStart >= 0 && lastProductRow >= regionStart) {
      regions.push({
        sheet: sheet.name,
        startRow: regionStart,
        endRow: lastProductRow,
        sectionName: currentSection || undefined,
      });
    }
    regionStart = -1;
  };

  for (let i = 0; i < rows.length; i++) {
    const cls = classifyRow(rows[i], opt);

    if (cls === ROW_CLASS.PRODUCT) {
      if (regionStart < 0) regionStart = i;
      lastProductRow = i;
    } else if (cls === ROW_CLASS.SECTION) {
      flush(i);
      // tên section = text dồn lại
      currentSection = rows[i].joined.replace(/^[IVX]+[\.\)]\s*|^[A-Z][\.\)]\s*/i, "").trim();
    } else if (cls === ROW_CLASS.HEADER) {
      // header mới = có thể bắt đầu bảng mới, flush region cũ
      flush(i);
    } else if (cls === ROW_CLASS.TOTAL) {
      // tổng cộng = kết thúc 1 bảng
      flush(i);
    }
    // NOTE/BLANK: bỏ qua, không ngắt region (cho phép ghi chú xen giữa)
  }
  flush(rows.length);

  // Nếu không tìm được region nào (vd sheet phẳng), tạo 1 region cho cả sheet
  if (regions.length === 0 && rows.length > 1) {
    regions.push({ sheet: sheet.name, startRow: 0, endRow: rows.length - 1, sectionName: undefined });
  }

  return regions;
}
