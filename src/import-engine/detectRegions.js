// ============================================================
// detectRegions — chia sheet thành các vùng dữ liệu (region)
// Mỗi region là 1 dải dòng liên tục thuộc cùng 1 bảng,
// có thể gắn với 1 section header.
//
// IMPORTANT: Region coordinates are SOURCE worksheet row numbers (`row.r`),
// not indexes inside the compact `sheet.rows` array. normalizeWorkbook removes
// fully blank rows, so mixing those coordinate systems can pull pre-table
// metadata into a product region or silently drop real product rows.
// ============================================================
import { classifyRow } from "./classifyRows.js";
import { ROW_CLASS } from "./types.js";

/**
 * Phát hiện các region trong 1 sheet.
 * Chiến lược: quét tuần tự, gom các dòng product liên tục thành region.
 * Section header cập nhật "sectionName" cho các region phía sau.
 *
 * @param {import('./types').NormalizedSheet} sheet
 * @param {Object} preMap - {priceCol, nameCol, maxCol, minSourceRow} ước lượng sơ bộ
 * @returns {import('./types').Region[]}
 */
export function detectRegions(sheet, preMap = {}) {
  const { rows, maxCol } = sheet;
  const opt = { priceCol: preMap.priceCol ?? null, nameCol: preMap.nameCol ?? null, maxCol };
  const minSourceRow = Number.isInteger(preMap.minSourceRow) ? preMap.minSourceRow : -1;

  const regions = [];
  let currentSection = "";
  let regionStartSourceRow = -1;
  let lastProductSourceRow = -1;

  const flush = () => {
    if (regionStartSourceRow >= 0 && lastProductSourceRow >= regionStartSourceRow) {
      regions.push({
        sheet: sheet.name,
        startRow: regionStartSourceRow,
        endRow: lastProductSourceRow,
        sectionName: currentSection || undefined,
      });
    }
    regionStartSourceRow = -1;
    lastProductSourceRow = -1;
  };

  for (const row of rows) {
    // A detected table header is a hard boundary. Everything above it is
    // document metadata (customer, phone, quote number, address, title...).
    if (row.r <= minSourceRow) continue;

    const cls = classifyRow(row, opt);

    if (cls === ROW_CLASS.PRODUCT) {
      if (regionStartSourceRow < 0) regionStartSourceRow = row.r;
      lastProductSourceRow = row.r;
    } else if (cls === ROW_CLASS.SECTION) {
      flush();
      currentSection = row.joined.replace(/^[IVX]+[\.\)]\s*|^[A-Z][\.\)]\s*/i, "").trim();
    } else if (cls === ROW_CLASS.HEADER) {
      flush();
    } else if (cls === ROW_CLASS.TOTAL) {
      flush();
    }
    // NOTE/BLANK: bỏ qua, không ngắt region (cho phép ghi chú xen giữa)
  }
  flush();

  // Nếu không có region nhưng đã detect header, KHÔNG fallback ra toàn sheet:
  // fallback đó có thể biến metadata trước bảng thành sản phẩm. Chỉ fallback cho
  // sheet phẳng thật sự không có header đáng tin.
  if (regions.length === 0 && rows.length > 1 && minSourceRow < 0) {
    regions.push({
      sheet: sheet.name,
      startRow: rows[0].r,
      endRow: rows[rows.length - 1].r,
      sectionName: undefined,
    });
  }

  return regions;
}
