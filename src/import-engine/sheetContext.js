// P2.3.3 — preserve document-level taxonomy from quotation sheets.
// Pure helper: no XLSX/browser dependency, so it can be regression-tested directly.

function compact(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

/**
 * Build a context line without duplicating merged-cell values.
 * normalizeWorkbook expands merged cells for table parsing and marks the
 * replicated cells with `_merged: true`. For document metadata such as
 * `Quy Cách`, those replicas must not be concatenated back into the text.
 */
function contextRowText(row = {}) {
  if (Array.isArray(row?.cells) && row.cells.length) {
    const primaryCells = row.cells
      .filter((cell) => !cell?._merged)
      .sort((a, b) => Number(a?.c ?? 0) - Number(b?.c ?? 0))
      .map((cell) => compact(cell?.v))
      .filter(Boolean);
    if (primaryCells.length) return primaryCells.join(" ");
  }
  return compact(row?.joined || "");
}

export function extractSheetDocumentContext(rows = []) {
  const context = { quoteSpecification: "" };
  for (const row of rows || []) {
    const joined = contextRowText(row);
    if (!joined) continue;
    const m = joined.match(/(?:Quy\s*Cách|Quy\s*cach)\s*[:：]\s*(.+?)(?=\s+(?:Ngày|Ngay)\s+báo\s+giá|$)/i);
    if (m && m[1]) {
      context.quoteSpecification = compact(m[1]);
      break;
    }
  }
  return context;
}

export { contextRowText };
