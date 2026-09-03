// ============================================================
// legacyParser — parser cũ (giữ làm fallback cuối cùng).
// Trích xuất tối giản: tìm header tốt nhất, đoán cột theo keyword.
// Không có region/section/confidence nâng cao.
// ============================================================
import * as XLSX from "xlsx";

function guessColumnsByName(hdrs) {
  const m = {};
  const norm = (s) => String(s || "").toLowerCase().trim();
  hdrs.forEach((h, idx) => {
    const label = norm(h);
    const i = String(idx);
    if (!m.name && /tên|sản phẩm|hàng ho[áa]|mô tả|thiết bị|vật tư|diễn giải/.test(label)) m.name = i;
    else if (!m.sku && /mã|sku|code|model/.test(label)) m.sku = i;
    else if (!m.category && /nhóm|loại|danh mục|phân loại/.test(label)) m.category = i;
    else if (!m.supplier && /nhà cung cấp|ncc|hãng|xuất xứ/.test(label)) m.supplier = i;
    else if (!m.unit && /đvt|đơn vị|unit/.test(label)) m.unit = i;
    else if (!m.price && /giá|price|đơn giá|thành tiền/.test(label)) m.price = i;
    else if (!m.specs && /thông số|kỹ thuật|quy cách/.test(label)) m.specs = i;
  });
  return m;
}

/**
 * @param {ArrayBuffer} buf
 * @param {string} fileName
 * @returns {Object[]} raw items (name, sku, price...)
 */
export function legacyParse(buf, fileName) {
  const wb = XLSX.read(buf, { type: "array" });
  const fileSupplier = fileName.replace(/\.(xlsx|xls|pdf|csv)$/i, "").replace(/[_\-]/g, " ").slice(0, 25);
  let out = [];

  for (const sheetName of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, blankrows: false, defval: null });
    if (rows.length < 2) continue;

    // header = dòng nhiều text nhất trong 10 dòng đầu
    let hdrIdx = 0, maxText = 0;
    for (let i = 0; i < Math.min(10, rows.length); i++) {
      const tc = (rows[i] || []).filter((c) => c && String(c).trim().length > 1 && isNaN(c)).length;
      if (tc > maxText) { maxText = tc; hdrIdx = i; }
    }
    const hdrs = (rows[hdrIdx] || []).map((h) => String(h ?? "").trim());
    const cmap = guessColumnsByName(hdrs);
    if (!cmap.name) {
      // cột text dài nhất
      let bestCol = 0, bestLen = 0;
      const data = rows.slice(hdrIdx + 1);
      hdrs.forEach((_, ci) => {
        const avg = data.slice(0, 5).reduce((s, r) => s + String(r[ci] ?? "").length, 0);
        if (avg > bestLen) { bestLen = avg; bestCol = ci; }
      });
      cmap.name = String(bestCol);
    }

    const get = (row, key) => {
      const idx = parseInt(cmap[key]);
      return isNaN(idx) ? "" : String(row[idx] ?? "").trim();
    };

    for (const row of rows.slice(hdrIdx + 1)) {
      if (!row.some((c) => c !== null && c !== "")) continue;
      const name = get(row, "name");
      if (!name || name.length < 2) continue;
      const price = parseInt(get(row, "price").replace(/[^\d]/g, "")) || 0;
      out.push({
        name, sku: get(row, "sku"),
        category: get(row, "category") || "Chung",
        supplier: get(row, "supplier") || fileSupplier,
        unit: get(row, "unit") || "Cái",
        price, specs: get(row, "specs"),
        source: { sheet: sheetName, rowIndex: -1, cellRefs: [], rawText: row.join(" ") },
      });
    }
  }
  return out;
}
