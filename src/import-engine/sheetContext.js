// P2.3.3 — preserve document-level taxonomy from quotation sheets.
// Pure helper: no XLSX/browser dependency, so it can be regression-tested directly.
export function extractSheetDocumentContext(rows = []) {
  const context = { quoteSpecification: "" };
  for (const row of rows || []) {
    const joined = String(row?.joined || "").replace(/\s+/g, " ").trim();
    if (!joined) continue;
    const m = joined.match(/(?:Quy\s*Cách|Quy\s*cach)\s*[:：]\s*(.+?)(?=\s+(?:Ngày|Ngay)\s+báo\s+giá|$)/i);
    if (m && m[1]) {
      context.quoteSpecification = m[1].replace(/\s+/g, " ").trim();
      break;
    }
  }
  return context;
}
