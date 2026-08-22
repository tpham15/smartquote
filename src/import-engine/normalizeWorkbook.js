// ============================================================
// normalizeWorkbook — đọc file Excel → cấu trúc chuẩn hoá
// Mỗi cell giữ toạ độ (ref) để truy vết nguồn gốc.
// ============================================================
import * as XLSX from "xlsx";
import { cleanSupplierName } from "./productSanitizer.js";

function stripVietnameseMarks(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D");
}

function guessSupplierFromFileName(fileName = "") {
  const raw = String(fileName || "").replace(/\.(xlsx|xls|csv|pdf)$/i, "").replace(/[_\-]+/g, " ").trim();
  const ascii = stripVietnameseMarks(raw).toLowerCase();
  if (/lumi/.test(ascii)) return "Lumi";
  if (/philips/.test(ascii)) return "Philips";
  if (/kaadas/.test(ascii)) return "Kaadas";
  if (/hexa/.test(ascii)) return "Hexa";

  const cleaned = raw
    .replace(/\b(20\d{2}|19\d{2})\b/g, " ")
    .replace(/\b\d{1,2}[.\-_/]\d{1,2}[.\-_/]\d{2,4}\b/g, " ")
    .replace(/\b(v\d+|final|new|copy|file|catalog|price|list)\b/gi, " ");
  const asciiClean = stripVietnameseMarks(cleaned)
    .replace(/\b(bao\s*gia|bang\s*gia|gia|dl|dai\s*ly|nha\s*cung\s*cap|cap\s*nhat|tong\s*hop|san\s*pham)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleanSupplierName(asciiClean || raw, "");
}

/** Chuẩn hoá 1 giá trị cell thành string sạch */
function cleanText(v) {
  if (v === null || v === undefined) return "";
  return String(v).replace(/\s+/g, " ").trim();
}

function buildMergedCellLookup(ws) {
  const lookup = new Map();
  for (const merge of ws["!merges"] || []) {
    const topLeftRef = XLSX.utils.encode_cell({ r: merge.s.r, c: merge.s.c });
    const topLeftCell = ws[topLeftRef];
    if (!topLeftCell) continue;
    for (let r = merge.s.r; r <= merge.e.r; r++) {
      for (let c = merge.s.c; c <= merge.e.c; c++) {
        const ref = XLSX.utils.encode_cell({ r, c });
        if (ref === topLeftRef) continue;
        lookup.set(ref, { sourceRef: topLeftRef, v: topLeftCell.v });
      }
    }
  }
  return lookup;
}

/**
 * @param {ArrayBuffer} buf
 * @param {string} fileName
 * @returns {import('./types').NormalizedWorkbook}
 */
export function normalizeWorkbook(buf, fileName) {
  const wb = XLSX.read(buf, { type: "array" });
  const fileSupplier = guessSupplierFromFileName(fileName);


  const sheets = [];
  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    if (!ws || !ws["!ref"]) continue;

    const range = XLSX.utils.decode_range(ws["!ref"]);
    const mergedLookup = buildMergedCellLookup(ws);
    const rows = [];
    let maxCol = 0;

    for (let r = range.s.r; r <= range.e.r; r++) {
      const cells = [];
      const text = [];
      for (let c = range.s.c; c <= range.e.c; c++) {
        const ref = XLSX.utils.encode_cell({ r, c });
        const cell = ws[ref];
        const merged = !cell ? mergedLookup.get(ref) : null;
        const val = cell ? cell.v : (merged ? merged.v : null);
        const t = cleanText(val);
        text[c] = t;
        if (t !== "") {
          cells.push({ c, v: val, ref, ...(merged ? { _merged: true, mergedFrom: merged.sourceRef } : {}) });
          if (c > maxCol) maxCol = c;
        }
      }
      // bỏ dòng trắng hoàn toàn
      if (cells.length === 0) continue;

      const joined = text.filter(Boolean).join(" ").trim();
      rows.push({
        r,
        cells,
        text,
        joined,
        filled: cells.length,
      });
    }

    if (rows.length > 0) {
      sheets.push({ name: sheetName, rows, maxCol });
    }
  }

  return { sheets, fileName, fileSupplier };
}

export { cleanText };
