import { numberForField, normalizeText } from "../lib/normalize.mjs";

const FIELD_SYNONYMS = Object.freeze({
  name: ["ten san pham", "ten hang hoa", "ten hang", "san pham", "mo ta", "dien giai", "noi dung"],
  sku: ["ma san pham", "ma thiet bi", "ma hang", "model", "sku", "ma sp", "ma"],
  unit: ["dvt", "don vi tinh", "don vi"],
  quantity: ["so luong", "sl", "qty"],
  unitPrice: ["gia npp", "gia dai ly", "gia ban si", "don gia", "gia net", "gia nhap", "gia"],
  listPrice: ["gia ban le", "gia niem yet", "retail", "list price"],
  lineTotal: ["thanh tien", "tong tien", "amount"],
  section: ["hang muc", "nhom", "phan loai", "category"],
});

const SUMMARY_RE = /^(tong|tong cong|tong tien|tong gia tri|tong hop|subtotal|grand total|thanh tien|vat|thue|nhan cong|chiet khau|ghi chu|dieu khoan|bao hanh|thanh toan)(\b|\s|:)/i;
const SECTION_RE = /^(?:[ivxlcdm]+[./:-]|[a-z][./:-]|\d+[./:-])\s+/i;

function decodeEntities(s) {
  const named = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return String(s || "")
    .replace(/&#(x?[0-9a-f]+);/gi, (_, n) => String.fromCodePoint(n[0].toLowerCase() === "x" ? parseInt(n.slice(1), 16) : parseInt(n, 10)))
    .replace(/&([a-z]+);/gi, (m, n) => named[n.toLowerCase()] ?? m);
}

function stripHtml(s) {
  return decodeEntities(String(s || "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeBbox(bbox) {
  if (!Array.isArray(bbox) || bbox.length < 4) return null;
  const nums = bbox.slice(0, 4).map(Number);
  return nums.every(Number.isFinite) ? nums : null;
}

function parseSpan(attrs, name) {
  const m = String(attrs || "").match(new RegExp(`${name}\\s*=\\s*["']?(\\d+)`, "i"));
  const n = m ? Number(m[1]) : 1;
  return Number.isInteger(n) && n > 0 ? n : 1;
}

export function htmlTableToGrid(html) {
  const source = String(html || "");
  const rowMatches = [...source.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)];
  const grid = [];
  const pending = [];
  for (let ri = 0; ri < rowMatches.length; ri++) {
    const row = [];
    for (let ci = 0; ci < pending.length; ci++) {
      const p = pending[ci];
      if (p?.remaining > 0) {
        row[ci] = p.text;
        p.remaining -= 1;
        if (p.remaining <= 0) pending[ci] = null;
      }
    }
    const cellMatches = [...rowMatches[ri][1].matchAll(/<(td|th)\b([^>]*)>([\s\S]*?)<\/\1>/gi)];
    let cursor = 0;
    for (const match of cellMatches) {
      while (row[cursor] !== undefined) cursor += 1;
      const attrs = match[2] || "";
      const text = stripHtml(match[3]);
      const rowspan = parseSpan(attrs, "rowspan");
      const colspan = parseSpan(attrs, "colspan");
      for (let k = 0; k < colspan; k++) {
        const ci = cursor + k;
        row[ci] = text;
        if (rowspan > 1) pending[ci] = { text, remaining: rowspan - 1 };
      }
      cursor += colspan;
    }
    const width = Math.max(row.length, pending.length);
    for (let i = 0; i < width; i++) if (row[i] === undefined) row[i] = "";
    grid.push(row.map((x) => String(x || "").trim()));
  }
  return grid;
}

export function markdownTableToGrid(content) {
  const lines = String(content || "").split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  const rows = [];
  for (const line of lines) {
    if (!line.includes("|")) continue;
    const cells = line.replace(/^\|/, "").replace(/\|$/, "").split("|").map((x) => x.trim());
    if (cells.every((x) => /^:?-{3,}:?$/.test(x))) continue;
    rows.push(cells);
  }
  return rows;
}

function scoreHeaderForField(header, field) {
  const h = normalizeText(header);
  if (!h) return 0;
  let best = 0;
  for (const phrase of FIELD_SYNONYMS[field] || []) {
    const p = normalizeText(phrase);
    if (h === p) best = Math.max(best, 1);
    else if (h.includes(p)) best = Math.max(best, p.length >= 6 ? 0.9 : 0.75);
  }
  if (field === "unitPrice" && /(ban le|niem yet|retail|list price)/.test(h)) best *= 0.15;
  if (field === "listPrice" && /(npp|dai ly|ban si|don gia|net|nhap)/.test(h)) best *= 0.2;
  if (field === "lineTotal" && /don gia/.test(h)) best = 0;
  return best;
}

export function inferHeaderMap(grid, { maxHeaderRows = 5 } = {}) {
  const width = Math.max(0, ...grid.map((r) => r.length));
  let best = { headerRows: 0, map: {}, score: -1, headers: [] };
  for (let depth = 1; depth <= Math.min(maxHeaderRows, grid.length); depth++) {
    const headers = [];
    for (let c = 0; c < width; c++) {
      const parts = [];
      for (let r = 0; r < depth; r++) {
        const t = String(grid[r]?.[c] || "").trim();
        if (t && parts[parts.length - 1] !== t) parts.push(t);
      }
      headers[c] = parts.join(" ");
    }
    const map = {};
    let score = 0;
    const used = new Set();
    for (const field of Object.keys(FIELD_SYNONYMS)) {
      let winner = null;
      for (let c = 0; c < headers.length; c++) {
        if (used.has(c)) continue;
        const s = scoreHeaderForField(headers[c], field);
        if (!winner || s > winner.score) winner = { c, score: s };
      }
      if (winner?.score >= 0.65) {
        map[field] = winner.c;
        used.add(winner.c);
        score += winner.score;
      }
    }
    const businessSignals = ["name", "sku", "unitPrice", "listPrice", "quantity", "lineTotal"].filter((f) => map[f] != null).length;
    const total = score + businessSignals * 0.4;
    if (total > best.score) best = { headerRows: depth, map, score: total, headers };
  }
  return best;
}

function cell(row, idx) { return idx == null ? "" : String(row[idx] || "").trim(); }
function numeric(field, value) { return numberForField(field, value); }

function looksLikeSectionRow(row, map) {
  const nonEmpty = row.map((x) => String(x || "").trim()).filter(Boolean);
  if (!nonEmpty.length) return false;
  const unique = [...new Set(nonEmpty)];
  const joined = unique.join(" ").trim();
  if (unique.length === 1 && numberForField("price", unique[0]) == null && joined.length > 3) return true;
  const hasPrice = numeric("price", cell(row, map.unitPrice)) != null || numeric("price", cell(row, map.listPrice)) != null;
  const hasSku = cell(row, map.sku) !== "";
  if (hasPrice || hasSku) return false;
  return unique.length <= 2 && (SECTION_RE.test(joined) || joined.length > 8);
}

function isSummaryText(text) {
  return SUMMARY_RE.test(normalizeText(text));
}

export function tableGridToPredictionRows(grid, { page = null, bbox = null, blockId = null, tableIndex = 0 } = {}) {
  if (!Array.isArray(grid) || grid.length < 2) return [];
  const header = inferHeaderMap(grid);
  const map = header.map;
  const hasBusinessColumns = map.name != null || map.sku != null;
  const hasCommercialColumn = map.unitPrice != null || map.listPrice != null || map.quantity != null || map.lineTotal != null;
  if (!hasBusinessColumns || !hasCommercialColumn) return [];

  const out = [];
  let currentSection = "";
  for (let ri = header.headerRows; ri < grid.length; ri++) {
    const row = grid[ri] || [];
    const allText = row.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
    if (!allText) continue;
    if (looksLikeSectionRow(row, map)) {
      currentSection = [...new Set(row.map((x) => String(x || "").trim()).filter(Boolean))].join(" ");
      out.push({
        predictionId: `p${page ?? "x"}-t${tableIndex + 1}-r${ri + 1}-section`, kind: "non_product", status: "need_review", confidence: null,
        source: { page, sheet: "", row: ri + 1, bbox }, fields: { name: currentSection, sku: "", section: currentSection, unit: "", quantity: null, unitPrice: null, listPrice: null, lineTotal: null, specs: "" },
        meta: { paddleBlockId: blockId, tableRow: ri + 1, reason: "section_row" },
      });
      continue;
    }

    const name = cell(row, map.name);
    const sku = cell(row, map.sku);
    const unit = cell(row, map.unit);
    const quantity = numeric("quantity", cell(row, map.quantity));
    const unitPrice = numeric("price", cell(row, map.unitPrice));
    const listPrice = numeric("price", cell(row, map.listPrice));
    const lineTotal = numeric("price", cell(row, map.lineTotal));
    const explicitSection = cell(row, map.section);
    if (explicitSection) currentSection = explicitSection;

    const labelText = `${name} ${sku}`.trim();
    const summary = isSummaryText(labelText || allText);
    const productSignal = !!sku || (!!name && (unitPrice != null || listPrice != null || quantity != null || lineTotal != null));
    const kind = !summary && productSignal ? "product" : "non_product";
    out.push({
      predictionId: `p${page ?? "x"}-t${tableIndex + 1}-r${ri + 1}`,
      kind,
      status: "need_review",
      confidence: null,
      source: { page, sheet: "", row: ri + 1, bbox },
      fields: { name: name || (kind === "non_product" ? allText : ""), sku, section: currentSection, unit, quantity, unitPrice, listPrice, lineTotal, specs: "" },
      meta: { paddleBlockId: blockId, tableRow: ri + 1, reason: summary ? "summary_row" : productSignal ? "business_row" : "non_product_row" },
    });
  }
  return out;
}

function unwrapPage(raw) {
  if (raw?.res && typeof raw.res === "object") return raw.res;
  if (raw?.prunedResult && typeof raw.prunedResult === "object") return raw.prunedResult;
  return raw || {};
}

export function paddlePageToPredictionRows(rawPage) {
  const page = unwrapPage(rawPage);
  const pageNo = Number.isInteger(page.page_index) ? page.page_index + 1 : (Number.isInteger(page.page) ? page.page : null);
  const blocks = Array.isArray(page.parsing_res_list) ? page.parsing_res_list : [];
  const out = [];
  let tableIndex = 0;
  for (const block of blocks) {
    const content = String(block?.block_content || "");
    const label = String(block?.block_label || "").toLowerCase();
    if (label !== "table" && !/<table\b/i.test(content) && !/^\s*\|.*\|/m.test(content)) continue;
    const grid = /<table\b/i.test(content) ? htmlTableToGrid(content) : markdownTableToGrid(content);
    out.push(...tableGridToPredictionRows(grid, {
      page: pageNo,
      bbox: normalizeBbox(block?.block_bbox),
      blockId: block?.block_id ?? null,
      tableIndex,
    }));
    tableIndex += 1;
  }
  return out;
}

export function normalizePaddleOcrVlResult(raw) {
  const pages = Array.isArray(raw?.pages) ? raw.pages : Array.isArray(raw) ? raw : [raw];
  return pages.flatMap(paddlePageToPredictionRows);
}
