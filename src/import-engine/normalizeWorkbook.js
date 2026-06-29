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
  if (/sse\s*home|ssehome/.test(ascii)) return "SSEHOME";
  if (/nguyen\s*da|nguyenda/.test(ascii)) return "Nguyên Đà";
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
    const rows = [];
    let maxCol = 0;

    for (let r = range.s.r; r <= range.e.r; r++) {
      const cells = [];
      const text = [];
      for (let c = range.s.c; c <= range.e.c; c++) {
        const ref = XLSX.utils.encode_cell({ r, c });
        const cell = ws[ref];
        const val = cell ? cell.v : null;
        const t = cleanText(val);
        text[c] = t;
        if (t !== "") {
          cells.push({ c, v: val, ref });
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
