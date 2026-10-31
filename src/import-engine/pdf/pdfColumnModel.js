// Pilot P1.3 — deterministic digital-PDF column model.
// Pure geometry/text logic: no browser, AI, OCR, or network dependency.

function text(v) { return String(v ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim(); }
function key(v) {
  return text(v).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/[^a-z0-9]+/g, ' ').trim();
}
function median(values = []) {
  const a = values.map(Number).filter(Number.isFinite).sort((x, y) => x - y);
  if (!a.length) return 0;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}
function clamp01(v) { return Math.max(0, Math.min(1, Number(v) || 0)); }

export function bboxFromParts(parts = [], rowY = 0) {
  const valid = (parts || []).filter((p) => Number.isFinite(Number(p?.x)));
  if (!valid.length) return null;
  const minX = Math.min(...valid.map((p) => Number(p.x || 0)));
  const maxX = Math.max(...valid.map((p) => Number(p.x || 0) + Math.max(0, Number(p.width || 0))));
  const height = Math.max(1, ...valid.map((p) => Number(p.height || 0) || 0));
  return { x: minX, y: Number(rowY || 0), width: Math.max(1, maxX - minX), height };
}

export function parsePdfColumnMoney(v) {
  const raw = text(v).toLowerCase().replace(/vnđ|vnd|đ/g, '').trim();
  if (!raw) return 0;
  const k = raw.match(/\b(\d+(?:[.,]\d+)?)\s*k\b/i);
  if (k) return Math.round(Number(k[1].replace(',', '.')) * 1000) || 0;
  const shorthand = raw.match(/\b(\d{1,3})\s*tr\s*(\d{1,3})\b/i);
  if (shorthand) {
    const whole = Number(shorthand[1]);
    const fracRaw = shorthand[2];
    const frac = Number(fracRaw) / (10 ** fracRaw.length);
    return Math.round((whole + frac) * 1_000_000);
  }
  const million = raw.match(/\b(\d+(?:[.,]\d+)?)\s*(?:tr|trieu|triệu)\b/i);
  if (million) return Math.round(Number(million[1].replace(',', '.')) * 1_000_000) || 0;
  const grouped = raw.match(/(?:\d{1,3}(?:[.,\s]\d{3}){1,3}|\d{4,12})/);
  if (!grouped) return 0;
  const digits = grouped[0].replace(/[^\d]/g, '');
  const n = Number(digits || 0);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

function moneyLike(v) {
  const s = text(v).toLowerCase().replace(/\u00a0/g, ' ').trim();
  if (!s) return false;
  // Column detection must classify a PRICE CELL, not merely find a 4-digit
  // number somewhere inside a product description (e.g. 1400kg or model 2022).
  // Keep the permissive parser for already-known price fields, but use this
  // strict shape check while inferring table columns.
  const compact = s.replace(/\s+/g, ' ');
  if (/^(?:19|20)\d{2}$/.test(compact)) return false; // likely year, not VND
  const currencySuffix = '(?:\s*(?:đ|₫|vnd|vnđ))?';
  const grouped = new RegExp(`^\\d{1,3}(?:[., ]\\d{3}){1,4}${currencySuffix}$`, 'i');
  const plain = new RegExp(`^\\d{5,12}${currencySuffix}$`, 'i');
  const shorthand = /^\d+(?:[.,]\d+)?\s*(?:k|tr|triệu|trieu)$/i;
  const trCompact = /^\d{1,3}\s*tr\s*\d{1,3}$/i;
  if (!(grouped.test(compact) || plain.test(compact) || shorthand.test(compact) || trCompact.test(compact))) return false;
  return parsePdfColumnMoney(compact) >= 1000;
}
function integerLike(v) {
  const s = text(v).replace(/[.,\s]/g, '');
  return /^\d{1,5}$/.test(s);
}
function unitLike(v) {
  return /^(cai|cái|bo|bộ|chiec|chiếc|set|pcs?|m|met|mét|m2|m²|kg|hop|hộp|cuon|cuộn|tu|tủ)$/i.test(text(v));
}
function skuLike(v) {
  const s = text(v);
  if (!s || moneyLike(s)) return false;
  const compact = s.replace(/[^A-Z0-9]/gi, '');
  return compact.length >= 4 && /[A-Z]/i.test(compact) && /\d/.test(compact) && s.length <= 36;
}

function headerRole(v) {
  const k = key(v);
  if (!k) return '';
  if (/^(stt|no|so tt|thu tu)$/.test(k)) return 'rowIndex';
  if (/^(loai sp|loai san pham|nhom sp|nhom san pham|category|product category)$/.test(k)) return 'category';
  if (/^(ten|ten hang|ten san pham|san pham|thong tin san pham|thong tin hang hoa|hang hoa|thiet bi|mo ta|dien giai)$/.test(k) || /\b(?:ten|thong tin) san pham\b/.test(k)) return 'name';
  if (/^(ma|ma sp|ma san pham|sku|model|part no|part number)$/.test(k)) return 'sku';
  if (/^(ncc|nha cung cap|supplier|vendor)$/.test(k)) return 'supplier';
  if (/^(hang|thuong hieu|brand|nsx|nha san xuat|manufacturer)$/.test(k)) return 'brand';
  if (/^(xuat xu|origin|country of origin)$/.test(k)) return 'origin';
  if (/^(dvt|don vi|unit)$/.test(k)) return 'unit';
  if (/^(sl|so luong|qty|quantity)$/.test(k)) return 'qty';
  if (/thanh tien|tong tien|line total|amount/.test(k)) return 'total';
  if (/gia ban le|gia niem yet|list price|retail price|public price/.test(k)) return 'listPrice';
  if (/gia dai ly|gia npp|gia nhap|don gia|unit price|dealer price|cost price/.test(k)) return 'unitPrice';
  if (/^(gia cap \d+|gia dai ly cap \d+|dealer price|cost price)$/.test(k)) return 'unitPrice';
  if (/^(gia|price)$/.test(k)) return 'genericPrice';
  if (/thong so|spec|specification/.test(k)) return 'specs';
  return '';
}

export function mergePdfRowParts(row = {}, { gap = null } = {}) {
  const parts = (Array.isArray(row.parts) ? row.parts : [])
    .filter((p) => text(p?.str))
    .map((p) => ({ x: Number(p.x || 0), width: Math.max(0, Number(p.width || 0)), height: Math.max(1, Number(p.height || 0) || 1), str: text(p.str) }))
    .sort((a, b) => a.x - b.x);
  if (!parts.length) return [];
  const typicalHeight = median(parts.map((p) => p.height)) || 8;
  const hasExplicitGap = gap !== null && gap !== undefined && gap !== '' && Number.isFinite(Number(gap));
  const mergeGap = hasExplicitGap ? Number(gap) : Math.max(3.5, Math.min(8, typicalHeight * 0.62));
  const cells = [];
  for (const part of parts) {
    const prev = cells[cells.length - 1];
    const partRight = part.x + part.width;
    const gapToPrev = prev ? part.x - prev.right : Infinity;
    // Do not let a commercial price cell absorb an adjacent free-text note.
    // Real supplier PDFs often place notes immediately after the dealer price
    // (e.g. "1,700,000 Giá thu hồi ngõng 550k"). If merged, the cell stops
    // being moneyLike and can be assigned to the wrong price column.
    const prevIsMoney = !!prev && moneyLike(prev.text);
    const partIsMoney = moneyLike(part.str);
    const partCurrencyToken = /^(?:đ|₫|vnd|vnđ)$/i.test(text(part.str));
    const prevCurrencyToken = !!prev && /^(?:đ|₫|vnd|vnđ)$/i.test(text(prev.text));
    const splitAfterMoney = prevIsMoney && !partIsMoney && !partCurrencyToken;
    const splitBeforeMoney = partIsMoney && !prevIsMoney && !prevCurrencyToken;
    if (prev && gapToPrev <= mergeGap && !splitAfterMoney && !splitBeforeMoney) {
      prev.parts.push(part);
      prev.right = Math.max(prev.right, partRight);
      prev.text = text(`${prev.text} ${part.str}`);
      prev.height = Math.max(prev.height, part.height);
    } else {
      cells.push({ left: part.x, right: partRight, height: part.height, text: part.str, parts: [part] });
    }
  }
  return cells.map((c) => ({
    ...c,
    center: (c.left + c.right) / 2,
    moneyLike: moneyLike(c.text),
    integerLike: integerLike(c.text),
    unitLike: unitLike(c.text),
    skuLike: skuLike(c.text),
    headerRole: headerRole(c.text),
    bbox: bboxFromParts(c.parts, row.y),
  }));
}

function rowTableCandidate(row = {}, pageWidth = 0) {
  const cells = mergePdfRowParts(row);
  if (cells.length < 2) return { candidate: false, cells };
  const spread = cells[cells.length - 1].right - cells[0].left;
  const minSpread = Math.max(70, Number(pageWidth || 0) * 0.22);
  const semantic = cells.some((c) => c.moneyLike || c.skuLike || c.unitLike || c.headerRole);
  return { candidate: spread >= minSpread && semantic, cells };
}

export function inferTableRegions(pages = []) {
  const regions = [];
  for (const page of pages || []) {
    const rows = Array.isArray(page?.rows) ? page.rows : [];
    const pageWidth = Number(page?.pageWidth || 0) || 600;
    let start = -1;
    let cache = [];
    const close = (endExclusive) => {
      if (start < 0) return;
      const rowIndexes = [];
      let moneyRows = 0;
      let headerRows = 0;
      for (let i = start; i < endExclusive; i++) {
        const info = cache[i - start] || rowTableCandidate(rows[i], pageWidth);
        if (!info.candidate) continue;
        rowIndexes.push(i);
        if (info.cells.some((c) => c.moneyLike)) moneyRows += 1;
        if (info.cells.some((c) => c.headerRole)) headerRows += 1;
      }
      // A real commercial table should have at least 3 structural rows and price/header evidence.
      if (rowIndexes.length >= 3 && (moneyRows >= 2 || (moneyRows >= 1 && headerRows >= 1))) {
        regions.push({
          id: `p${Number(page.page || 1)}-r${start + 1}-${endExclusive}`,
          page: Number(page.page || 1),
          pageWidth,
          pageHeight: Number(page?.pageHeight || 0) || null,
          startRowIndex: start,
          endRowIndex: endExclusive - 1,
          rowIndexes,
          rows: rowIndexes.map((i) => ({ rowIndex: i, row: rows[i], cells: rowTableCandidate(rows[i], pageWidth).cells })),
        });
      }
      start = -1;
      cache = [];
    };

    for (let i = 0; i < rows.length; i++) {
      const info = rowTableCandidate(rows[i], pageWidth);
      if (info.candidate) {
        if (start < 0) start = i;
        cache.push(info);
      } else {
        close(i);
      }
    }
    close(rows.length);
  }
  // Attach the nearest multi-row header block as context. Supplier PDFs often
  // have 2-4 header lines (e.g. main labels + price subheaders + year) that are
  // separated from data by merged cells or notes, so a data region alone cannot
  // reliably distinguish STT from quantity or retail from dealer price.
  for (const region of regions) {
    const page = (pages || []).find((p) => Number(p?.page || 1) === Number(region.page || 1));
    const rows = Array.isArray(page?.rows) ? page.rows : [];
    let anchor = -1;
    let anchorInsideRegion = false;
    const start = Math.max(0, Number(region.startRowIndex || 0));
    const end = Math.min(rows.length - 1, Number(region.endRowIndex ?? start));
    // Prefer a header that is part of this region. Without this, a second table
    // on the same page can accidentally inherit the first table's price roles.
    for (let i = start; i <= Math.min(end, start + 3); i++) {
      const cells = mergePdfRowParts(rows[i] || {});
      const roles = cells.map((c) => c.headerRole).filter(Boolean);
      if (roles.length >= 2) { anchor = i; anchorInsideRegion = true; break; }
    }
    if (anchor < 0) {
      for (let i = start - 1; i >= 0; i--) {
        const cells = mergePdfRowParts(rows[i] || {});
        const roles = cells.map((c) => c.headerRole).filter(Boolean);
        if (roles.length >= 2) { anchor = i; break; }
      }
    }
    if (anchor >= 0) {
      const from = anchorInsideRegion ? anchor : Math.max(0, anchor - 2);
      const to = anchorInsideRegion
        ? Math.min(rows.length, anchor + 5)
        : Math.min(start, anchor + 5);
      region.headerRows = rows.slice(from, to).map((row, offset) => ({ rowIndex: from + offset, row, cells: mergePdfRowParts(row) }));
    } else {
      region.headerRows = [];
    }
  }
  return regions;
}

function clusterAnchors(samples = [], tolerance = 12) {
  const sorted = [...samples].sort((a, b) => a.anchor - b.anchor);
  const clusters = [];
  for (const sample of sorted) {
    let best = null;
    let bestD = Infinity;
    for (const c of clusters) {
      const d = Math.abs(sample.anchor - c.anchor);
      if (d <= tolerance && d < bestD) { best = c; bestD = d; }
    }
    if (!best) {
      clusters.push({ anchor: sample.anchor, members: [sample] });
    } else {
      best.members.push(sample);
      best.anchor = median(best.members.map((m) => m.anchor));
    }
  }
  return clusters;
}

function assignCellToColumn(cell, columns = []) {
  if (!cell || !columns.length) return null;
  const anchor = (cell.moneyLike || cell.integerLike) ? cell.right : cell.left;
  let best = null;
  let bestScore = Infinity;
  for (const col of columns) {
    const anchorDist = Math.abs(anchor - col.anchor);
    const centerDistanceRaw = Math.abs(cell.center - col.center);
    // Headers are often centered over right-aligned numeric cells, so their
    // left edge is a bad anchor. Map semantic header cells by visual center.
    const score = cell.headerRole
      ? centerDistanceRaw
      : Math.min(anchorDist, centerDistanceRaw * 0.35 + anchorDist * 0.35);
    if (score < bestScore) { best = col; bestScore = score; }
  }
  const tolerance = Math.max(16, (columns[columns.length - 1]?.anchor || 600) * 0.035);
  return bestScore <= tolerance ? best : null;
}

function confidenceFromHeader(role) {
  return role ? 0.96 : 0.82;
}

export function inferColumnModel(region = {}) {
  const rows = Array.isArray(region.rows) ? region.rows : [];
  const pageWidth = Number(region.pageWidth || 0) || 600;
  if (rows.length < 3) return null;
  const tolerance = Math.max(9, Math.min(18, pageWidth * 0.022));
  const samples = [];
  for (const r of rows) {
    for (const cell of r.cells || []) {
      samples.push({
        anchor: (cell.moneyLike || cell.integerLike) ? cell.right : cell.left,
        center: cell.center,
        rowIndex: r.rowIndex,
        cell,
      });
    }
  }
  const minSupport = Math.max(2, Math.ceil(rows.length * 0.25));
  let rawClusters = clusterAnchors(samples, tolerance)
    .map((c) => ({
      ...c,
      support: new Set(c.members.map((m) => m.rowIndex)).size,
      center: median(c.members.map((m) => m.center)),
      left: median(c.members.map((m) => m.cell.left)),
      right: median(c.members.map((m) => m.cell.right)),
    }))
    .filter((c) => c.support >= minSupport)
    .sort((a, b) => a.center - b.center);
  if (rawClusters.length < 2) return null;

  const columns = rawClusters.map((c, i) => ({
    id: `c${i + 1}`,
    anchor: c.anchor,
    center: c.center,
    left: c.left,
    right: c.right,
    support: c.support,
    role: '',
    roleSource: '',
    confidence: 0,
    headerText: '',
    moneyRatio: 0,
    skuRatio: 0,
    unitRatio: 0,
    integerRatio: 0,
    avgTextLength: 0,
  }));

  const assignments = [];
  for (const r of rows) {
    for (const cell of r.cells || []) {
      const col = assignCellToColumn(cell, columns);
      if (col) assignments.push({ rowIndex: r.rowIndex, cell, col });
    }
  }

  // Header labels are authoritative when available.
  for (const a of assignments) {
    const role = a.cell.headerRole;
    if (!role) continue;
    if (!a.col.role || a.rowIndex <= rows[0].rowIndex + 2) {
      a.col.role = role;
      a.col.roleSource = 'header';
      a.col.headerText = a.cell.text;
      a.col.confidence = 0.96;
    }
  }

  // Also project roles from the nearest page-level header block. This is what
  // keeps multi-line supplier headers attached to a data region even when merged
  // cells/notes split the geometric region. Map by horizontal overlap/center and
  // let explicit header evidence override content/structure guesses.
  const contextualHeaderAssignments = [];
  for (const h of Array.isArray(region.headerRows) ? region.headerRows : []) {
    const headerCells = (h.cells || mergePdfRowParts(h.row || {}))
      .filter((cell) => cell.headerRole)
      .sort((a, b) => a.center - b.center);
    for (let hi = 0; hi < headerCells.length; hi++) {
      const cell = headerCells[hi];
      let col = assignCellToColumn(cell, columns);
      if (!col) {
        // Wide text headers are commonly centered over a much wider data column,
        // so the header center may be far from short values in that column. Use
        // the interval between neighboring header centers as a secondary band.
        const prev = headerCells[hi - 1];
        const next = headerCells[hi + 1];
        const left = prev ? (prev.center + cell.center) / 2 - 12 : -Infinity;
        const right = next ? (cell.center + next.center) / 2 + 12 : Infinity;
        const bandCandidates = columns
          .filter((candidate) => candidate.center >= left && candidate.center <= right)
          .sort((a, b) => Math.abs(a.center - cell.center) - Math.abs(b.center - cell.center));
        col = bandCandidates[0] || null;
      }
      if (!col) continue;
      contextualHeaderAssignments.push({ rowIndex: h.rowIndex, cell, col });
      col.role = cell.headerRole;
      col.roleSource = 'header-context';
      col.headerText = cell.text;
      col.confidence = 0.98;
    }
  }

  const headerRowIndexes = new Set([
    ...assignments.filter((a) => a.cell.headerRole).map((a) => a.rowIndex),
    ...contextualHeaderAssignments.map((a) => a.rowIndex),
  ]);
  for (const col of columns) {
    const vals = assignments.filter((a) => a.col.id === col.id && !headerRowIndexes.has(a.rowIndex)).map((a) => a.cell);
    const n = Math.max(1, vals.length);
    col.moneyRatio = vals.filter((c) => c.moneyLike).length / n;
    col.skuRatio = vals.filter((c) => c.skuLike).length / n;
    col.unitRatio = vals.filter((c) => c.unitLike).length / n;
    col.integerRatio = vals.filter((c) => c.integerLike && !c.moneyLike).length / n;
    col.avgTextLength = vals.length ? vals.reduce((s, c) => s + c.text.length, 0) / vals.length : 0;
  }

  // Infer non-price semantic columns from data when header is absent.
  const unassigned = () => columns.filter((c) => !c.role);
  for (const col of unassigned()) {
    if (col.unitRatio >= 0.55) { col.role = 'unit'; col.roleSource = 'content'; col.confidence = 0.84; }
    else if (col.skuRatio >= 0.5) { col.role = 'sku'; col.roleSource = 'content'; col.confidence = 0.84; }
  }
  const qtyCandidate = unassigned().filter((c) => c.integerRatio >= 0.6 && c.moneyRatio < 0.25).sort((a, b) => b.integerRatio - a.integerRatio)[0];
  if (qtyCandidate) { qtyCandidate.role = 'qty'; qtyCandidate.roleSource = 'content'; qtyCandidate.confidence = 0.8; }

  // Resolve price columns. Explicit dealer/unit/list/total labels win.
  const genericPrices = columns.filter((c) => c.role === 'genericPrice');
  const inferredPrices = unassigned().filter((c) => c.moneyRatio >= 0.55);
  let ambiguousPrice = false;
  const allUnknownPrices = [...genericPrices, ...inferredPrices].sort((a, b) => a.center - b.center);
  const explicitUnit = columns.some((c) => c.role === 'unitPrice');
  const explicitList = columns.some((c) => c.role === 'listPrice');
  const explicitTotal = columns.some((c) => c.role === 'total');

  if (allUnknownPrices.length === 1) {
    const p = allUnknownPrices[0];
    p.role = 'unitPrice'; p.roleSource = p.roleSource || (p.headerText ? 'header' : 'content'); p.confidence = p.headerText ? 0.92 : 0.82;
  } else if (allUnknownPrices.length > 1) {
    const hasQty = columns.some((c) => c.role === 'qty');
    if (hasQty && !explicitTotal) {
      const total = allUnknownPrices[allUnknownPrices.length - 1];
      total.role = 'total'; total.roleSource = 'structure'; total.confidence = 0.78;
      const remaining = allUnknownPrices.filter((c) => c !== total);
      if (!explicitUnit && remaining.length === 1) {
        remaining[0].role = 'unitPrice'; remaining[0].roleSource = 'structure'; remaining[0].confidence = 0.78;
      } else if (remaining.length > 0) {
        for (const p of remaining) { if (p.role === 'genericPrice' || !p.role) { p.role = 'unknownPrice'; p.roleSource = 'ambiguous'; p.confidence = 0.5; } }
        ambiguousPrice = !explicitUnit;
      }
    } else {
      for (const p of allUnknownPrices) { p.role = 'unknownPrice'; p.roleSource = 'ambiguous'; p.confidence = 0.5; }
      ambiguousPrice = !explicitUnit && !(explicitList && allUnknownPrices.length === 0);
    }
  }

  // Pick name/specs after price columns are identified. Prefer longest text-rich left-side column.
  if (!columns.some((c) => c.role === 'name')) {
    const candidates = columns.filter((c) => !c.role && c.moneyRatio < 0.35 && c.unitRatio < 0.5 && c.skuRatio < 0.5);
    candidates.sort((a, b) => (b.avgTextLength - a.avgTextLength) || (a.center - b.center));
    if (candidates[0]) {
      candidates[0].role = 'name'; candidates[0].roleSource = 'content'; candidates[0].confidence = 0.82;
    }
  }

  // Convert genericPrice left by unusual header combinations safely.
  for (const c of columns) {
    if (c.role === 'genericPrice') { c.role = 'unknownPrice'; c.roleSource = 'ambiguous'; c.confidence = 0.5; ambiguousPrice = true; }
    if (!c.confidence && c.role) c.confidence = confidenceFromHeader(c.roleSource === 'header');
  }

  const modeledRoles = new Set(columns.map((c) => c.role).filter(Boolean));
  const hasIdentity = modeledRoles.has('name') || modeledRoles.has('sku');
  const hasPrice = modeledRoles.has('unitPrice') || modeledRoles.has('listPrice') || modeledRoles.has('unknownPrice');
  if (!hasIdentity || !hasPrice) return null;

  return {
    schemaVersion: 'sq-pdf-column-model-v2',
    regionId: region.id || '',
    page: Number(region.page || 0) || null,
    columns,
    ambiguousPrice,
    confidence: clamp01(median(columns.filter((c) => c.role).map((c) => c.confidence)) || 0.72),
    headerRowIndexes: Array.from(headerRowIndexes),
  };
}

export function assignCellsToColumnModel(row = {}, model = {}) {
  const cells = mergePdfRowParts(row);
  const columns = Array.isArray(model.columns) ? model.columns : [];
  const assigned = [];
  for (const cell of cells) {
    const col = assignCellToColumn(cell, columns);
    if (col) assigned.push({ cell, column: col });
  }
  return assigned;
}

export function fieldForRole(row = {}, model = {}, role = '') {
  const priceRole = ['unitPrice', 'listPrice', 'total', 'unknownPrice', 'genericPrice'].includes(role);
  const matches = assignCellsToColumnModel(row, model).filter((a) => a.column.role === role && (!priceRole || a.cell.moneyLike));
  if (!matches.length) return { text: '', bbox: null, parts: [], confidence: 0 };
  const parts = matches.flatMap((m) => m.cell.parts || []).sort((a, b) => a.x - b.x);
  return {
    text: text(matches.map((m) => m.cell.text).join(' ')),
    bbox: bboxFromParts(parts, row.y),
    parts,
    confidence: Math.min(...matches.map((m) => Number(m.column.confidence || 0.72))),
  };
}
