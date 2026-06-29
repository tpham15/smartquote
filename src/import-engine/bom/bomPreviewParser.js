import * as XLSX from "xlsx";
import { parseSafePrice } from "../productSanitizer.js";
import { bestBomCatalogMatch, rankBomCatalogMatches } from "./bomMatcher.js";
import { buildSolutionPackSuggestions } from "./solutionPacks.js";
import { parseTakeoffMatrixRows } from "../legacy/legacyBomImport.js";

const strip = (v) => String(v ?? "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
const lower = (v) => strip(v).toLowerCase();
const removeDiacritics = (v) => strip(v).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/Đ/g, "d").toLowerCase();
const uid = (p = "bom") => `${p}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const HEADER_HINTS = {
  name: [
    "ten goi va quy cach", "ten goi va qui cach", "ten goi va thong so", "ten goi va dac tinh",
    "ten goi", "ten vat tu", "ten thiet bi", "ten cong tac", "ten cong viec", "ten hang muc",
    "thiet bi", "hang muc", "noi dung", "mo ta", "description", "item", "product", "ten hang", "ten san pham"
  ],
  model: ["model", "ma vat tu", "ma thiet bi", "ma sp", "ma san pham", "sku", "part no", "part number", "code"],
  qty: ["so luong", "sl", "qty", "quantity", "khoi luong", "volume"],
  unit: ["dvt", "don vi", "unit", "uom"],
  unitPrice: ["don gia", "unit price", "gia ban", "gia", "price"],
  amount: ["thanh tien", "amount", "total", "tong tien"],
  area: ["phong", "khu vuc", "area", "room", "tang", "floor", "vi tri", "location"],
  note: ["ghi chu", "note", "remark", "dien giai", "spec", "thong so", "quy cach", "quy cach ky thuat", "mo ta"],
};

const TECH_KEYWORDS = [
  "cong tac", "cam bien", "den", "downlight", "spotlight", "camera", "nvr", "dau ghi", "switch", "wifi", "router",
  "khoa", "chuong", "man hinh", "bo dieu khien", "module", "relay", "rem", "dong co", "loa", "am thanh",
  "cap", "ong", "tu dien", "nguon", "adapter", "ray", "sensor", "access", "door", "exit", "led", "driver",
  "dieu hoa", "dan lanh", "dan nong", "cassette", "vrv", "vrf", "ong dong", "ong gas",
];

const NON_PRODUCT_HINTS = [
  "tong cong", "subtotal", "total", "vat", "thue", "chiet khau", "giam gia", "ghi chu", "dieu khoan",
  "thanh toan", "bao hanh", "lap dat", "thi cong", "nhan cong", "van chuyen", "note", "remark",
];

const AREA_HINTS = [
  "phong", "khu vuc", "tang", "floor", "area", "zone", "hang muc", "he thong", "giai phap", "san pham", "noi that", "dien nhe", "camera", "lighting", "smarthome",
];

const GENERIC_NAMES = ["vat tu", "thiet bi", "hang muc", "san pham", "phu kien", "bo", "combo"];

function rowToCells(row = []) {
  return row.map((cell) => strip(cell));
}

function meaningfulCells(cells) {
  return cells.map((v, idx) => ({ value: strip(v), idx })).filter((x) => x.value !== "");
}

function isNumericLike(v) {
  const s = strip(v).replace(/[,\.\s]/g, "");
  return /^-?\d+(?:\.\d+)?$/.test(s);
}

function parseQty(v) {
  const s = strip(v);
  if (!s) return 0;
  if (/^\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}$/.test(s)) return 0;
  const normalized = s.replace(/,/g, ".").match(/-?\d+(?:\.\d+)?/);
  if (!normalized) return 0;
  const n = Number(normalized[0]);
  if (!Number.isFinite(n) || n <= 0 || n > 100000) return 0;
  return n;
}

function looksLikeHeaderCell(cell, hints) {
  const s = removeDiacritics(cell);
  return hints.some((h) => s === h || s.includes(h));
}

function findHeader(rows) {
  let best = { rowIndex: -1, score: 0, columns: {} };
  const maxRows = Math.min(rows.length, 35);
  for (let r = 0; r < maxRows; r++) {
    const cells = rowToCells(rows[r]);
    const columns = {};
    let score = 0;
    cells.forEach((cell, idx) => {
      if (!cell) return;
      Object.entries(HEADER_HINTS).forEach(([field, hints]) => {
        if (columns[field] == null && looksLikeHeaderCell(cell, hints)) {
          columns[field] = idx;
          score += field === "name" || field === "qty" ? 4 : 2;
        }
      });
    });
    if (columns.name != null && columns.qty != null) score += 6;
    if (columns.unit != null) score += 2;
    if (score > best.score) best = { rowIndex: r, score, columns };
  }
  if (best.score >= 8) return best;
  return { rowIndex: -1, score: 0, columns: {} };
}

function isAreaRow(cells, headerColumns = {}) {
  const m = meaningfulCells(cells);
  if (!m.length || m.length > 3) return null;
  const joined = removeDiacritics(m.map((x) => x.value).join(" "));
  if (!joined || NON_PRODUCT_HINTS.some((k) => joined.includes(k))) return null;
  if (m.some((x) => parseQty(x.value) > 0 && x.idx === headerColumns.qty)) return null;
  const hasAreaWord = AREA_HINTS.some((k) => joined.includes(k));
  const isUpperish = m[0]?.value && m[0].value.length >= 4 && m[0].value === m[0].value.toUpperCase();
  const hasTechGroup = TECH_KEYWORDS.some((k) => joined.includes(k)) && m[0]?.value.length < 60;
  if (hasAreaWord || isUpperish || hasTechGroup) {
    const labelCell = m.find((x) => !/^(?:[IVXLCDM]+|\d+)$/i.test(strip(x.value))) || m[0];
    return labelCell.value.replace(/^\d+[\.\)]\s*/, "");
  }
  return null;
}

function extractModelFromText(text) {
  const s = strip(text);
  if (!s) return "";
  const patterns = [
    /\b[A-Z]{1,5}[-_][A-Z0-9]{2,}(?:[-_][A-Z0-9]{1,}){0,5}\b/g,
    /\b[A-Z]{2,}\d{2,}[A-Z0-9-]*\b/g,
    /\b\d{2,}[A-Z]{1,}[A-Z0-9-]*\b/g,
  ];
  const candidates = [];
  patterns.forEach((re) => {
    let m;
    while ((m = re.exec(s))) {
      const val = m[0].replace(/[.,;:]$/, "");
      if (!/^(VAT|VND|USD|AC|DC|IP|COB|SMD|LED)$/.test(val)) candidates.push(val);
    }
  });
  candidates.sort((a, b) => b.length - a.length);
  return candidates[0] || "";
}

function cleanName(value, model = "") {
  let s = strip(value)
    .replace(/^\d+[\.\)]\s*/, "")
    .replace(/\b(SL|QTY|DVT|ĐVT)\b\s*[:：]?\s*\d*\s*/gi, "")
    .trim();
  if (model && s.toUpperCase() === model.toUpperCase()) return "";
  if (model) {
    const re = new RegExp(`\\b${model.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    s = s.replace(re, "").replace(/[-–—|]+$/g, "").trim();
  }
  return s;
}

function isLikelyProductName(name) {
  const n = removeDiacritics(name);
  if (!n || n.length < 4) return false;
  if (NON_PRODUCT_HINTS.some((k) => n.includes(k))) return false;
  if (GENERIC_NAMES.includes(n)) return false;
  if (TECH_KEYWORDS.some((k) => n.includes(k))) return true;
  return n.split(/\s+/).length >= 2 && n.length >= 8;
}

function inferCategory(text = "") {
  const s = removeDiacritics(text);
  if (/dieu hoa|dan lanh|dan nong|cassette|vrv|vrf|ong dong|ong gas|hvac/.test(s)) return "Điều hòa / HVAC";
  if (/camera|dau ghi|nvr|hikvision|dahua/.test(s)) return "Camera";
  if (/cong tac|o cam|relay|module|dieu khien/.test(s)) return "Công tắc / Điều khiển";
  if (/cam bien|sensor/.test(s)) return "Cảm biến";
  if (/den|downlight|spotlight|led|lighting|driver/.test(s)) return "Chiếu sáng";
  if (/khoa|chuong|door|exit|access/.test(s)) return "An ninh / Access";
  if (/wifi|router|switch|mang|cap/.test(s)) return "Mạng / Điện nhẹ";
  if (/rem|dong co/.test(s)) return "Rèm / Motor";
  if (/loa|am thanh/.test(s)) return "Âm thanh";
  return "Khác";
}


const DISCIPLINE_PROFILES = [
  {
    key: "hvac",
    label: "Điều hòa / HVAC",
    keywords: ["dieu hoa", "hvac", "dan lanh", "dan nong", "cassette", "vrv", "vrf", "ong dong", "ong gas", "multi", "fcdu"],
  },
  {
    key: "smart_home",
    label: "Điện thông minh / Smarthome",
    keywords: ["dtm", "dien thong minh", "smarthome", "smart home", "cong tac thong minh", "chuong hinh", "cam bien", "motor rem", "khoa thong minh"],
  },
  {
    key: "lighting",
    label: "Chiếu sáng / Lighting",
    keywords: ["chieu sang", "lighting", "downlight", "spotlight", "den led", "den ray", "den san vuon", "canh quan"],
  },
  {
    key: "camera_security",
    label: "Camera / An ninh",
    keywords: ["camera", "an ninh", "dau ghi", "nvr", "hikvision", "dahua", "imou", "access control", "kiem soat"],
  },
  {
    key: "network_low_voltage",
    label: "Mạng / Điện nhẹ",
    keywords: ["mang", "dien nhe", "wifi", "router", "switch", "cat6", "mesh", "tu dien nhe"],
  },
  {
    key: "mep_infrastructure",
    label: "Hạ tầng MEP / vật tư phụ",
    keywords: ["cap", "day dien", "ong", "tu dien", "mcb", "hao cap", "tiep dia", "cot den", "mong den"],
  },
];

function classifyBomSheet(sheetName = "", rows = []) {
  const titleRows = rows.slice(0, 4).flat().map((x) => strip(x)).filter(Boolean).join(" ");
  const sampleRows = rows.slice(0, 45).flat().map((x) => strip(x)).filter(Boolean).join(" ");
  const titleText = removeDiacritics(`${sheetName} ${titleRows}`);
  const text = removeDiacritics(`${sheetName} ${sampleRows}`);
  let best = { key: "unknown", label: "Chưa rõ", score: 0, included: false };
  for (const profile of DISCIPLINE_PROFILES) {
    let score = 0;
    for (const kw of profile.keywords) {
      if (titleText.includes(kw)) score += kw.length > 8 ? 8 : 5;
      else if (text.includes(kw)) score += kw.length > 8 ? 3 : 1.5;
    }
    if (score > best.score) best = { key: profile.key, label: profile.label, score, included: score >= 4 };
  }
  // Ưu tiên tên sheet/tiêu đề: sheet "Chiếu sáng" không nên bị hạ thành MEP chỉ vì nhiều dòng cáp/ống.
  if (/dieu hoa|hvac|dan lanh|dan nong|cassette|vrv|vrf/.test(titleText)) {
    const hvac = DISCIPLINE_PROFILES.find((p) => p.key === "hvac");
    best = { key: "hvac", label: hvac.label, score: Math.max(best.score, 20), included: true };
  }
  if (/chieu sang|lighting|den led|downlight|spotlight/.test(titleText)) {
    const lighting = DISCIPLINE_PROFILES.find((p) => p.key === "lighting");
    best = { key: "lighting", label: lighting.label, score: Math.max(best.score, 20), included: true };
  }
  if (/dtm|dien thong minh|smarthome|smart home/.test(titleText)) {
    const smarthome = DISCIPLINE_PROFILES.find((p) => p.key === "smart_home");
    best = { key: "smart_home", label: smarthome.label, score: Math.max(best.score, 20), included: true };
  }

  // Sheet có header BOM hợp lệ nhưng không rõ ngành vẫn nên được đọc, nhưng đánh dấu cần xem.
  if (!best.included && /(ten goi|ten vat tu|ten cong tac|khoi luong|so luong|don vi|dvt)/.test(text)) {
    best = { ...best, key: best.key === "unknown" ? "generic_bom" : best.key, label: best.label === "Chưa rõ" ? "BOM tổng hợp" : best.label, included: true, score: Math.max(best.score, 3) };
  }
  return best;
}

const SOLUTION_FAMILIES = [
  {
    key: "hvac",
    label: "Điều hòa / HVAC",
    keywords: ["dieu hoa", "dan lanh", "dan nong", "cassette", "vrv", "vrf", "ong dong", "ong gas", "hvac", "multi"],
    vendors: ["Daikin", "Mitsubishi", "Panasonic", "LG"],
  },
  {
    key: "audio_multiroom",
    label: "Âm thanh đa vùng",
    keywords: ["am thanh", "loa", "audio", "speaker", "arylic", "ampli", "amply", "multiroom"],
    vendors: ["Lumi", "Arylic"],
  },
  {
    key: "door_phone",
    label: "Chuông cửa màn hình",
    keywords: ["chuong hinh", "camera chuong", "man hinh chuong", "door phone", "basip", "bas-ip", "intercom"],
    vendors: ["Lumi", "Bas-IP", "Akuvox"],
  },
  {
    key: "smart_switch_control",
    label: "Công tắc / điều khiển thông minh",
    keywords: ["cong tac", "phim dieu khien", "bo ket noi dieu khien", "xu ly tin hieu", "input", "relay", "module", "o cam", "dieu khien chieu sang", "dimmer"],
    vendors: ["Lumi", "Erfinden", "Schneider"],
  },
  {
    key: "smart_lighting",
    label: "Chiếu sáng / lighting",
    keywords: ["chieu sang", "lighting", "den", "downlight", "spotlight", "led", "driver", "ray nam cham", "dali", "0-10v"],
    vendors: ["Lumi", "Philips", "KingLed"],
  },
  {
    key: "sensors",
    label: "Cảm biến",
    keywords: ["cam bien", "sensor", "hien dien", "chuyen dong", "pir", "bim", "cua cuon", "mg"],
    vendors: ["Lumi", "Erfinden"],
  },
  {
    key: "curtain_gate_motor",
    label: "Motor rèm / cổng tự động",
    keywords: ["motor", "rem", "dong co", "cong tu dong", "roger", "vulcan", "ray rem"],
    vendors: ["Lumi", "Roger", "Vulcan"],
  },
  {
    key: "smart_lock_access",
    label: "Khóa / kiểm soát ra vào",
    keywords: ["khoa", "the vao ra", "doc the", "nhan dien khuon mat", "access", "kiem soat", "door exit", "van tay"],
    vendors: ["Philips", "Kaadas", "Osuno", "Lumi"],
  },
  {
    key: "camera_security",
    label: "Camera an ninh",
    keywords: ["camera", "dau ghi", "nvr", "hik", "hikvision", "dahua", "imou", "an ninh ai"],
    vendors: ["Hikvision", "Imou", "Dahua"],
  },
  {
    key: "network_wifi",
    label: "Wifi / mạng nội bộ",
    keywords: ["wifi", "mesh", "router", "switch", "mang", "cat6", "ruijie", "lan"],
    vendors: ["Ruijie", "UniFi", "TP-Link"],
  },
  {
    key: "infrastructure",
    label: "Hạ tầng dây/ống/phụ kiện",
    keywords: ["cap", "day", "ong", "hdpe", "pvc", "tu dien", "nguon", "adapter", "nhan cong", "phu kien", "mcb", "hao cap", "tiep dia"],
    vendors: [],
    supporting: true,
  },
];

function inferSolutionFamily(text = "", section = "", sheetDiscipline = "") {
  const s = removeDiacritics(`${section} ${text}`);
  let best = null;
  for (const family of SOLUTION_FAMILIES) {
    let score = 0;
    for (const kw of family.keywords) {
      if (s.includes(kw)) score += kw.length >= 8 ? 4 : 2;
    }
    if (sheetDiscipline === "hvac" && family.key === "hvac") score += 2;
    if (sheetDiscipline === "lighting" && family.key === "smart_lighting") score += 2;
    if (sheetDiscipline === "smart_home" && ["smart_switch_control", "door_phone", "sensors", "audio_multiroom"].includes(family.key)) score += 1;
    if (!best || score > best.score) best = { ...family, score };
  }
  if (!best || best.score <= 0) return { key: "other", label: "Khác / cần phân loại", vendors: [], confidence: "low", supporting: false };
  return {
    key: best.key,
    label: best.label,
    vendors: best.vendors || [],
    confidence: best.score >= 5 ? "high" : best.score >= 3 ? "medium" : "low",
    supporting: !!best.supporting,
  };
}

function makeScopeId(key) {
  return `scope_${String(key || "other").replace(/[^a-z0-9_-]/gi, "_")}`;
}

function buildScopeSummary(lines = []) {
  const map = new Map();
  for (const line of lines) {
    const fam = line.solutionFamily || { key: "other", label: "Khác / cần phân loại", vendors: [] };
    const id = makeScopeId(fam.key);
    if (!map.has(id)) {
      map.set(id, {
        id,
        key: fam.key,
        label: fam.label,
        supporting: !!fam.supporting,
        lineCount: 0,
        qtyTotal: 0,
        matched: 0,
        needReview: 0,
        unresolved: 0,
        confidenceScore: 0,
        vendors: new Set(fam.vendors || []),
        areas: new Map(),
        sampleItems: [],
      });
    }
    const scope = map.get(id);
    scope.lineCount += 1;
    scope.qtyTotal += Number(line.qty) || 0;
    if (line.suggestedMatch?.productId || line.resolvedProductId) scope.matched += 1;
    else scope.unresolved += 1;
    if (line.status === "need_review") scope.needReview += 1;
    scope.confidenceScore += fam.confidence === "high" ? 1 : fam.confidence === "medium" ? 0.72 : 0.45;
    if (line.area) scope.areas.set(line.area, (scope.areas.get(line.area) || 0) + 1);
    if (line.suggestedMatch?.supplier) scope.vendors.add(line.suggestedMatch.supplier);
    if (line.name && scope.sampleItems.length < 4) scope.sampleItems.push(line.name);
  }
  const arr = Array.from(map.values()).map((scope) => {
    const areas = Array.from(scope.areas.entries()).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([name]) => name);
    const confidence = scope.lineCount ? Math.round((scope.confidenceScore / scope.lineCount) * 100) : 0;
    return {
      ...scope,
      vendors: Array.from(scope.vendors).filter(Boolean).slice(0, 5),
      areas,
      confidence,
    };
  });
  return arr.sort((a, b) => {
    if (a.supporting !== b.supporting) return a.supporting ? 1 : -1;
    return b.lineCount - a.lineCount;
  });
}

function findProductCandidateFromLooseRow(cells, headerColumns = {}) {
  const m = meaningfulCells(cells);
  if (!m.length) return null;
  const qtyCells = m.filter((x) => parseQty(x.value) > 0 && strip(x.value).length <= 12);
  const qtyCell = headerColumns.qty != null ? { value: cells[headerColumns.qty], idx: headerColumns.qty } : qtyCells[qtyCells.length - 1];
  const qty = parseQty(qtyCell?.value);
  if (!qty) return null;
  const textCells = m.filter((x) => x.idx !== qtyCell.idx && !isNumericLike(x.value));
  const longText = textCells.map((x) => x.value).filter((v) => v.length >= 3).join(" | ");
  const model = extractModelFromText(longText);
  const nameCell = textCells.find((x) => isLikelyProductName(x.value)) || textCells.sort((a, b) => b.value.length - a.value.length)[0];
  const name = cleanName(nameCell?.value || longText.split("|")[0] || "", model);
  if (!isLikelyProductName(name) && !model) return null;
  return { name: name || model, model, qty, unit: "", note: longText, sourceText: m.map((x) => x.value).join(" | ") };
}


function shouldTryMatrixParser(rows = [], header = {}) {
  const parsed = parseTakeoffMatrixRows(rows);
  if (parsed?.error) return null;
  // Chỉ route sang matrix khi header dạng list dọc không đủ chắc, hoặc bảng thật sự có hàng đầu là Tầng/Khu vực/Phòng.
  const firstHeaderCell = removeDiacritics(rows?.find?.((row) => row?.some?.(Boolean))?.[0] || "");
  const hasMatrixFirstColumn = rows.slice(0, 8).some((row) => /^(tang|khu vuc|phong)$/.test(removeDiacritics(row?.[0] || "")));
  const hasMultipleDeviceColumns = (parsed.columns || []).length >= 2 && (parsed.floors || []).length >= 1;
  if ((header?.rowIndex == null || header.rowIndex < 0 || header.score < 8 || hasMatrixFirstColumn) && hasMultipleDeviceColumns) return parsed;
  return null;
}

function makeMatrixLineName(group = "", label = "") {
  const g = strip(group);
  const l = strip(label);
  if (!g) return l;
  if (!l) return g;
  const gn = removeDiacritics(g);
  const ln = removeDiacritics(l);
  if (ln.includes(gn) || gn.includes(ln)) return l.length >= g.length ? l : g;
  return `${g} ${l}`.replace(/\s+/g, " ").trim();
}

function appendMatrixBomLines({ matrix, sheetName, sheetProfile, products, lines, skipped }) {
  let parsedCount = 0;
  const title = matrix.title || sheetName || "BOM ma trận";
  (matrix.floors || []).forEach((floor) => {
    const area = strip(floor.name) || "Chưa phân khu";
    Object.entries(floor.qtys || {}).forEach(([label, qty]) => {
      const colIdx = (matrix.columns || []).indexOf(label);
      const group = colIdx >= 0 ? (matrix.columnGroups || [])[colIdx] : "";
      const rawName = makeMatrixLineName(group, label);
      const model = extractModelFromText(rawName);
      const name = cleanName(rawName, model) || rawName;
      if (!isLikelyProductName(name) && !model) {
        skipped.push({ sourceSheet: sheetName, sourceRow: null, reason: "matrix_column_not_product", rawText: `${area} | ${rawName} | ${qty}` });
        return;
      }
      const candidate = {
        name: name || model,
        model,
        qty: Number(qty) || 0,
        unit: "cái",
        unitPrice: 0,
        amount: 0,
        note: `Ma trận bóc tách: ${area}`,
        sourceText: `${area} | ${rawName} | ${qty}`,
      };
      const category = inferCategory(`${candidate.name} ${candidate.model} ${title}`);
      const solutionFamily = inferSolutionFamily(`${candidate.name} ${candidate.model} ${category}`, title, sheetProfile.key);
      const suggestions = rankBomCatalogMatches({ ...candidate, category, solutionFamily: solutionFamily.label }, products, 5);
      const match = suggestions[0] && (suggestions[0].learned || suggestions[0].confidence === "high" || Number(suggestions[0].score) >= 0.5) ? suggestions[0] : guessMatch({ ...candidate, category }, products);
      const quality = statusForItem(candidate);
      lines.push({
        id: uid("bomln"),
        sourceSheet: sheetName,
        sourceRow: null,
        area,
        section: title,
        name: candidate.name,
        model: candidate.model || "",
        qty: candidate.qty,
        unit: candidate.unit || "cái",
        category,
        solutionFamily,
        scopeId: makeScopeId(solutionFamily.key),
        solutionKey: solutionFamily.key,
        solutionLabel: solutionFamily.label,
        note: candidate.note || "",
        unitPrice: 0,
        amount: 0,
        rawText: candidate.sourceText,
        status: quality.status,
        issues: quality.issues,
        suggestedMatch: match,
        matchSuggestions: suggestions,
        resolvedProductId: match?.productId || "",
        sourceType: "matrix",
      });
      parsedCount += 1;
    });
  });
  return parsedCount;
}

function guessMatch(item, products = []) {
  return bestBomCatalogMatch(item, products);
}

function statusForItem(item) {
  const issues = [];
  if (!item.name || !isLikelyProductName(item.name)) issues.push("Tên thiết bị chưa rõ");
  if (!item.qty || item.qty <= 0) issues.push("Thiếu số lượng");
  if (!item.model) issues.push("Thiếu model/SKU");
  if (item.name && item.name.length > 130) issues.push("Tên quá dài, có thể lẫn mô tả");
  if (!issues.length) return { status: "ready", issues: [] };
  if (issues.length === 1 && issues[0] === "Thiếu model/SKU" && item.name && item.qty) return { status: "ready", issues: ["Thiếu model/SKU nhưng có tên + số lượng"] };
  return { status: "need_review", issues };
}

export async function parseBomPreviewFile(file, products = []) {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array", cellDates: false, raw: false });
  const lines = [];
  const skipped = [];
  const sheets = [];
  for (const sheetName of workbook.SheetNames) {
    const ws = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" });
    if (!rows.length) continue;
    const header = findHeader(rows);
    const columns = header.columns || {};
    const sheetProfile = classifyBomSheet(sheetName, rows);
    const matrix = shouldTryMatrixParser(rows, header);
    if (matrix) {
      const parsedCount = appendMatrixBomLines({ matrix, sheetName, sheetProfile, products, lines, skipped });
      sheets.push({
        sheetName,
        rows: rows.length,
        headerRow: null,
        parsedCount,
        discipline: sheetProfile.key,
        disciplineLabel: sheetProfile.label,
        disciplineScore: sheetProfile.score,
        included: sheetProfile.included,
        layout: "matrix",
        matrixColumns: matrix.columns?.length || 0,
        matrixFloors: matrix.floors?.length || 0,
      });
      continue;
    }
    let currentArea = "Chưa phân khu";
    let currentSection = sheetName || "BOM";
    const start = header.rowIndex >= 0 ? header.rowIndex + 1 : 0;
    // Nếu có tiêu đề phòng/khu vực nằm phía trên header, giữ làm context ban đầu.
    for (let pr = 0; pr < start; pr++) {
      const preArea = isAreaRow(rowToCells(rows[pr]), header.columns || {});
      if (preArea) { currentArea = preArea; currentSection = preArea; }
    }
    let parsedCount = 0;

    for (let r = start; r < rows.length; r++) {
      const cells = rowToCells(rows[r]);
      const m = meaningfulCells(cells);
      if (!m.length) continue;
      const joined = m.map((x) => x.value).join(" | ");
      const normalized = removeDiacritics(joined);
      const isSummaryRow = /^(tong|tong cong|cong|sum)(\s|\||$)/.test(normalized) || /^tong(?:\s+|$)/.test(normalized);
      if ((NON_PRODUCT_HINTS.some((k) => normalized.includes(k)) || isSummaryRow) && m.length <= 4) {
        skipped.push({ sourceSheet: sheetName, sourceRow: r + 1, reason: isSummaryRow ? "summary_row" : "non_product_note", rawText: joined });
        continue;
      }
      const areaName = isAreaRow(cells, columns);
      if (areaName && !parseQty(joined)) {
        currentArea = areaName;
        currentSection = areaName;
        skipped.push({ sourceSheet: sheetName, sourceRow: r + 1, reason: "area_header", rawText: joined });
        continue;
      }

      let candidate = null;
      if (columns.name != null || columns.qty != null) {
        const rawName = cells[columns.name] || "";
        const model = strip(cells[columns.model]) || extractModelFromText(joined);
        const qty = parseQty(cells[columns.qty]);
        const name = cleanName(rawName || cells[columns.model] || joined, model);
        const unit = strip(cells[columns.unit]) || "";
        const unitPrice = parseSafePrice(cells[columns.unitPrice]) || 0;
        const amount = parseSafePrice(cells[columns.amount]) || 0;
        if ((name || model) && qty) candidate = { name: name || model, model, qty, unit, unitPrice, amount, note: strip(cells[columns.note]) || "", sourceText: joined };
      }
      if (!candidate) candidate = findProductCandidateFromLooseRow(cells, columns);
      if (!candidate) {
        skipped.push({ sourceSheet: sheetName, sourceRow: r + 1, reason: "not_item_row", rawText: joined });
        continue;
      }

      const category = inferCategory(`${candidate.name} ${candidate.model} ${candidate.note} ${currentSection}`);
      const solutionFamily = inferSolutionFamily(`${candidate.name} ${candidate.model} ${candidate.note} ${category}`, currentSection, sheetProfile.key);
      const suggestions = rankBomCatalogMatches({ ...candidate, category, solutionFamily: solutionFamily.label }, products, 5);
      const match = suggestions[0] && (suggestions[0].learned || suggestions[0].confidence === "high" || suggestions[0].score >= 0.5) ? suggestions[0] : guessMatch({ ...candidate, category }, products);
      const quality = statusForItem(candidate);
      lines.push({
        id: uid("bomln"),
        sourceSheet: sheetName,
        sourceRow: r + 1,
        area: currentArea,
        section: currentSection,
        name: candidate.name,
        model: candidate.model || "",
        qty: candidate.qty,
        unit: candidate.unit || "cái",
        category,
        solutionFamily,
        scopeId: makeScopeId(solutionFamily.key),
        solutionKey: solutionFamily.key,
        solutionLabel: solutionFamily.label,
        note: candidate.note || "",
        unitPrice: candidate.unitPrice || 0,
        amount: candidate.amount || 0,
        rawText: candidate.sourceText || joined,
        status: quality.status,
        issues: quality.issues,
        suggestedMatch: match,
        matchSuggestions: suggestions,
        resolvedProductId: match?.productId || "",
      });
      parsedCount += 1;
    }
    sheets.push({
      sheetName,
      rows: rows.length,
      headerRow: header.rowIndex + 1 || null,
      parsedCount,
      discipline: sheetProfile.key,
      disciplineLabel: sheetProfile.label,
      disciplineScore: sheetProfile.score,
      included: sheetProfile.included,
    });
  }
  const ready = lines.filter((l) => l.status === "ready").length;
  const review = lines.filter((l) => l.status === "need_review").length;
  const matched = lines.filter((l) => l.suggestedMatch?.productId).length;
  const areas = [...new Set(lines.map((l) => l.area).filter(Boolean))];
  const scopes = buildScopeSummary(lines);
  const solutionPacks = buildSolutionPackSuggestions(scopes, lines, products);
  return {
    version: "bom-preview-v3",
    fileName: file.name,
    totalLines: lines.length,
    ready,
    review,
    matched,
    skipped: skipped.length,
    confidence: lines.length ? Math.round(((ready * 0.65 + matched * 0.2 + Math.min(scopes.length, 8) * 0.015 * lines.length) / lines.length) * 100) : 0,
    areas,
    scopes,
    scopeCount: scopes.filter((s) => !s.supporting).length,
    solutionPacks,
    packCount: solutionPacks.length,
    sheets,
    lines,
    skippedLines: skipped.slice(0, 200),
  };
}

export function buildBomSmokeWorkbook() {
  const rows = [
    ["BẢNG KHỐI LƯỢNG SMART HOME"],
    ["HẠNG MỤC: PHÒNG KHÁCH"],
    ["STT", "Tên thiết bị", "Model", "ĐVT", "Số lượng", "Ghi chú"],
    [1, "Công tắc thông minh 4 nút", "LM-S4", "cái", 2, "màu trắng"],
    [2, "Cảm biến hiện diện", "LM-HP", "cái", 1, "gắn trần"],
    ["PHÒNG NGỦ MASTER"],
    [3, "Đèn downlight 12W", "LM-D12-75", "cái", 8, "3000K"],
    ["Tổng cộng", "", "", "", "", ""],
  ];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "BOM");
  return wb;
}
