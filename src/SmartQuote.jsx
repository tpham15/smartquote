import React, { useState, useMemo, useRef, useEffect } from "react";
import { InteractionHost, confirmAction, notify } from "./ui/interaction.jsx";
import * as XLSX from "xlsx";
import { importFileForUI, importManyForUI, productsToImportPreviewResult, combineImportPreviewResults } from "./import-engine/uiAdapter.js";
import { parseKtsBomExcel, parseTakeoffMatrixFile, guessProductForColumn } from "./import-engine/legacy/legacyBomImport.js";
import { parseBomPreviewFile } from "./import-engine/bom/bomPreviewParser.js";
import { saveBomMatchLearning } from "./import-engine/bom/bomMatcher.js";
import { buildBomQuoteVariants, quoteVariantToRooms } from "./import-engine/bom/bomQuoteComposer.js";
import { mapBomRowsWithClaude, mapTakeoffColumnsWithClaude, autoMapCatalogColumnsWithClaude } from "./import-engine/legacy/legacyClaudeMapper.js";
import { parsePdfCatalogWithClaude, parseSupplierPriceFile, guessCatalogColumnsByName, buildCatalogPreview, readCatalogRowsForManualMapping } from "./import-engine/legacy/legacyCatalogImport.js";
import { sanitizeCatalogProducts, isUnsafeImportedProduct, parseSafePrice, isLikelyOldQuoteFileName, isLikelyOldQuoteAggregateProduct } from "./import-engine/productSanitizer.js";
import { webScrapeItemsToProducts } from "./import-engine/web/webCatalogImport.js";
import { loadCloudState, saveCloudState } from "./supabase/cloudState.js";
import { listCloudCatalog, syncCloudCatalogSnapshot, logCloudCatalogImport, serializeProductsForCatalog, deleteCloudCatalogItems, replaceCloudCatalog } from "./supabase/catalogStore.js";
import { deleteCloudQuote, listCloudQuotes, saveCloudQuote } from "./supabase/quoteStore.js";
import { requestManualUpgrade, listBillingEvents, getPlanPriceVnd, formatVnd } from "./supabase/billingStore.js";
import { smartQuoteFetch } from "./supabase/apiFetch.js";
import { setTenantStorageScope, tenantStorageGetItem, tenantStorageSetItem, tenantStorageRemoveItem, tenantStorageKeysWithPrefix } from "./storage/tenantStorage.js";
import { PLAN_LIMITS, PLAN_ORDER, FEATURE_LABELS, normalizeBilling, canUseFeature, canFitProductCount, formatLimit, buildUpgradeMessage } from "./billing/planLimits.js";
import { canAccessCapability, CAPABILITY_LABELS, PLAN_CAPABILITIES } from "./billing/planCapabilities.js";
import { QUOTE_TEMPLATE_PRESET_LIST, applyQuoteTemplatePreset, buildDefaultQuoteTemplateConfig, normalizeQuoteTemplateConfig, getQuoteTemplateLabel } from "./quoteTemplates.js";
import { assertSmartQuoteUploadFile, filterSafeSmartQuoteFiles, rejectedFilesMessage } from "./import-engine/fileGuards.js";
import {
  loadCatalogTemplate as loadStoredCatalogTemplate,
  saveCatalogTemplate as persistCatalogTemplate,
  listCatalogTemplates as listStoredCatalogTemplates,
  suggestCatalogTemplates as suggestStoredCatalogTemplates,
  deleteCatalogTemplate as deleteStoredCatalogTemplate,
} from "./import-engine/templateMemory.js";
import {
  applyCorrectionLearning,
  saveProductLearning,
  saveProductLearningBatch,
  listCorrectionLearningStats,
} from "./import-engine/correctionLearning.js";

// ============================================================
// SmartQuote — App báo giá smarthome
// Giải quyết: giá nhà cung cấp đổi liên tục, nhập tay mất thời gian,
// báo giá theo phòng/gói. Sửa giá 1 nơi (catalog) → mọi báo giá dùng giá mới.
// Dữ liệu giữ trong state; dùng Xuất/Nhập JSON để lưu lâu dài & sao lưu.
// ============================================================

const VND = (n) =>
  (Number(n) || 0).toLocaleString("vi-VN", { maximumFractionDigits: 0 }) + "đ";

const uid = (p) => `${p}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

const DEFAULT_EXCEL_QUOTE_TEMPLATE_MAPPING = {
  sheetName: "",
  fields: {
    customerName: "B6",
    customerPhone: "B7",
    projectAddress: "B8",
    projectName: "B9",
    quoteDate: "H6",
    quoteNumber: "H7",
    companyName: "",
    salesPerson: "H8",
    salesPhone: "",
  },
  items: {
    startRow: 15,
    templateRow: 15,
    columns: {
      no: "A",
      note: "B",
      name: "C",
      specs: "D",
      image: "E",
      sku: "F",
      supplier: "G",
      unit: "H",
      qty: "I",
      unitPrice: "J",
      lineTotal: "K",
    },
  },
  summary: {
    titleRow: null,
    templateRow: null,
    labelColumn: "A",
    totalColumn: "K",
  },
  totals: {
    subtotal: "K40",
    labor: "K41",
    vat: "K42",
    grandTotal: "K43",
  },
};

function normalizeExcelQuoteTemplate(template = {}) {
  const mapping = template.mapping || {};
  return {
    id: template.id || uid("xlt"),
    name: template.name || "Mẫu Excel báo giá",
    fileName: template.fileName || "",
    dataUrl: template.dataUrl || "",
    sheetNames: Array.isArray(template.sheetNames) ? template.sheetNames : [],
    sourceChecksum: template.sourceChecksum || "",
    manifestVersion: Number(template.manifestVersion || 0) || null,
    engineVersion: template.engineVersion || "",
    manifest: template.manifest || null,
    isActive: template.isActive !== false,
    createdAt: template.createdAt || new Date().toISOString(),
    mapping: {
      sheetName: mapping.sheetName || template.sheetName || "",
      fields: { ...DEFAULT_EXCEL_QUOTE_TEMPLATE_MAPPING.fields, ...(mapping.fields || {}) },
      fieldPrefixes: { ...(mapping.fieldPrefixes || {}) },
      items: {
        ...DEFAULT_EXCEL_QUOTE_TEMPLATE_MAPPING.items,
        ...(mapping.items || {}),
        columns: { ...DEFAULT_EXCEL_QUOTE_TEMPLATE_MAPPING.items.columns, ...((mapping.items || {}).columns || {}) },
      },
      summary: { ...DEFAULT_EXCEL_QUOTE_TEMPLATE_MAPPING.summary, ...(mapping.summary || {}) },
      totals: { ...DEFAULT_EXCEL_QUOTE_TEMPLATE_MAPPING.totals, ...(mapping.totals || {}) },
    },
    detection: template.detection || mapping.detection || null,
  };
}

function normalizeExcelQuoteTemplates(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((t) => t && (t.dataUrl || t.fileName || t.name)).map(normalizeExcelQuoteTemplate);
}

const readFileAsDataUrl = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result || ""));
  reader.onerror = () => reject(reader.error || new Error("Không đọc được file."));
  reader.readAsDataURL(file);
});

function dataUrlToArrayBuffer(dataUrl = "") {
  const base64 = String(dataUrl || "").split(",").pop() || "";
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

async function sha256HexArrayBuffer(buffer) {
  if (typeof crypto === "undefined" || !crypto.subtle) return "";
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function excelSafeDisplayText(value) {
  if (value == null) return "";
  if (["string", "number", "boolean"].includes(typeof value)) return String(value);
  if (Array.isArray(value)) return value.map(excelSafeDisplayText).filter(Boolean).join("\n");
  if (typeof value === "object") {
    for (const key of ["text", "value", "description", "specs", "label"]) {
      if (value[key] != null && value[key] !== "") return excelSafeDisplayText(value[key]);
    }
    return Object.entries(value).map(([k, v]) => { const t = excelSafeDisplayText(v); return t ? `${k}: ${t}` : ""; }).filter(Boolean).join("\n");
  }
  return String(value);
}

function cleanExcelCellRef(value = "") {
  return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function normalizeExcelTemplateText(value = "") {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function excelColLetterFromIndex(indexZero) {
  return XLSX.utils.encode_col(Math.max(0, Number(indexZero) || 0));
}

function excelCellRefFromPos(rowOne, colZero) {
  return XLSX.utils.encode_cell({ r: Math.max(0, Number(rowOne) - 1), c: Math.max(0, Number(colZero) || 0) }).toUpperCase();
}

function extractExcelFieldPrefix(rawValue = "", fallback = "") {
  const text = String(rawValue ?? "").replace(/\s+/g, " ").trim();
  const idx = text.indexOf(":");
  if (idx >= 0 && idx <= 40) return `${text.slice(0, idx + 1)} `;
  return fallback;
}

function findExcelValueCellOnRow(ws, rowOne, preferredColLetter = "") {
  const range = XLSX.utils.decode_range(ws["!ref"] || "A1:A1");
  const preferredIdx = colLetterToIndex(preferredColLetter);
  if (preferredIdx >= 0) return excelCellRefFromPos(rowOne, preferredIdx);
  for (let c = range.e.c; c >= range.s.c; c--) {
    const addr = XLSX.utils.encode_cell({ r: rowOne - 1, c });
    const cell = ws[addr];
    if (cell && String(cell.v ?? cell.w ?? "").trim()) return addr.toUpperCase();
  }
  return "";
}

function isLikelyExcelTemplateSectionText(value = "") {
  const raw = String(value || "").trim();
  const norm = normalizeExcelTemplateText(raw);
  if (/^(?:[ivxlcdm]+|\d+)\s*[\.\/]\s+/.test(norm)) return true;
  return /^(?:giai phap|he thong|hang muc|tong hop)\b/.test(norm);
}

function buildExcelTemplatePreview(template, maxRows = 36, maxCols = 12) {
  try {
    if (!template?.dataUrl) return [];
    const wb = XLSX.read(dataUrlToArrayBuffer(template.dataUrl), { type: "array", cellDates: true, cellText: true });
    const sheetName = template.mapping?.sheetName && wb.Sheets[template.mapping.sheetName] ? template.mapping.sheetName : wb.SheetNames?.[0];
    const ws = wb.Sheets[sheetName];
    if (!ws || !ws["!ref"]) return [];
    const range = XLSX.utils.decode_range(ws["!ref"]);
    const rows = [];
    const endRow = Math.min(range.e.r, range.s.r + maxRows - 1);
    const endCol = Math.min(range.e.c, range.s.c + maxCols - 1);
    for (let r = range.s.r; r <= endRow; r++) {
      const cells = [];
      for (let c = range.s.c; c <= endCol; c++) {
        const addr = XLSX.utils.encode_cell({ r, c }).toUpperCase();
        const cell = ws[addr];
        cells.push({ ref: addr, row: r + 1, col: excelColLetterFromIndex(c), text: cell ? String(cell.w ?? cell.v ?? "") : "" });
      }
      rows.push({ row: r + 1, cells });
    }
    return rows;
  } catch (e) {
    console.warn("Không tạo được preview mẫu Excel:", e);
    return [];
  }
}

function detectExcelQuoteTemplateMapping(buffer, fileName = "") {
  const wb = XLSX.read(buffer, { type: "array", cellDates: true, cellFormula: true, cellText: true });
  const sheetName = wb.SheetNames?.[0] || "";
  const ws = wb.Sheets[sheetName];
  if (!ws || !ws["!ref"]) {
    return { mapping: { ...DEFAULT_EXCEL_QUOTE_TEMPLATE_MAPPING, sheetName }, detection: { confidence: 0, notes: ["Không đọc được sheet trong file Excel."] } };
  }

  const range = XLSX.utils.decode_range(ws["!ref"]);
  const cellText = (r, c) => {
    const cell = ws[XLSX.utils.encode_cell({ r, c })];
    if (!cell) return "";
    if (cell.w != null) return String(cell.w);
    if (cell.v != null) return String(cell.v);
    return "";
  };
  const normCell = (r, c) => normalizeExcelTemplateText(cellText(r, c));

  const fields = { ...DEFAULT_EXCEL_QUOTE_TEMPLATE_MAPPING.fields };
  const fieldPrefixes = {};
  const fieldHits = [];
  const fieldSpecs = [
    { key: "customerName", label: "Tên khách", fallback: "Khách hàng: ", any: ["khach hang", "ten khach hang"] },
    { key: "customerPhone", label: "Số điện thoại", fallback: "Điện thoại: ", any: ["dien thoai", "so dien thoai", "sdt"] },
    { key: "projectAddress", label: "Địa chỉ công trình", fallback: "Địa điểm công trình: ", any: ["dia diem cong trinh", "dia chi cong trinh", "dia chi"] },
    { key: "projectName", label: "Hạng mục / dự án", fallback: "Hạng mục: ", any: ["hang muc", "cong trinh", "ten du an"] },
    { key: "quoteDate", label: "Ngày báo giá", fallback: "Ngày: ", any: ["ngay bao gia", "ngay"] },
    { key: "quoteNumber", label: "Số báo giá", fallback: "Số báo giá: ", any: ["so bao gia", "ma bao gia"] },
    { key: "salesPerson", label: "Người báo giá", fallback: "Người báo giá: ", any: ["nguoi bao gia", "nhan vien bao gia", "sale"] },
  ];

  for (let r = range.s.r; r <= Math.min(range.e.r, range.s.r + 80); r++) {
    for (let c = range.s.c; c <= Math.min(range.e.c, range.s.c + 20); c++) {
      const raw = cellText(r, c);
      const norm = normalizeExcelTemplateText(raw);
      if (!norm) continue;
      for (const spec of fieldSpecs) {
        if (fieldHits.some((h) => h.key === spec.key)) continue;
        if (spec.any.some((needle) => norm.includes(needle))) {
          const ref = excelCellRefFromPos(r + 1, c);
          fields[spec.key] = ref;
          fieldPrefixes[spec.key] = extractExcelFieldPrefix(raw, spec.fallback);
          fieldHits.push({ key: spec.key, label: spec.label, ref });
        }
      }
    }
  }

  const headerMatchers = [
    { key: "no", any: ["stt", "tt"] },
    { key: "note", any: ["khu vuc", "phong", "vi tri", "khu vuc lap dat"] },
    { key: "name", any: ["ten hang", "ten san pham", "hang hoa", "mo ta"] },
    { key: "specs", any: ["thong so", "tinh nang", "mo ta chi tiet"] },
    { key: "image", any: ["hinh anh", "anh"] },
    { key: "sku", any: ["ma thiet bi", "ma hang", "ma sp", "sku", "model"] },
    { key: "supplier", any: ["xuat xu", "hang", "thuong hieu", "nha cung cap"] },
    { key: "unit", any: ["dvt", "don vi", "don vi tinh"] },
    { key: "qty", any: ["so luong", "sl", "qty"] },
    { key: "unitPrice", any: ["don gia", "gia ban", "gia"] },
    { key: "lineTotal", any: ["thanh tien", "tong tien", "amount"] },
  ];

  let bestHeader = { row: -1, score: 0, columns: {} };
  for (let r = range.s.r; r <= Math.min(range.e.r, range.s.r + 120); r++) {
    const found = {};
    let score = 0;
    for (let c = range.s.c; c <= range.e.c; c++) {
      const norm = normCell(r, c);
      if (!norm) continue;
      for (const m of headerMatchers) {
        if (found[m.key]) continue;
        const ok = m.any.some((needle) => {
          if (m.key === "no") return norm === needle || norm.startsWith(`${needle} `);
          if (m.key === "unitPrice") return norm.includes(needle) && !norm.includes("thanh tien");
          return norm.includes(needle);
        });
        if (ok) {
          found[m.key] = excelColLetterFromIndex(c);
          score += ["name", "qty", "unitPrice", "lineTotal", "sku"].includes(m.key) ? 2 : 1;
        }
      }
    }
    if (found.name && found.qty && found.unitPrice && found.lineTotal) score += 6;
    if (score > bestHeader.score) bestHeader = { row: r + 1, score, columns: found };
  }

  const columns = { ...DEFAULT_EXCEL_QUOTE_TEMPLATE_MAPPING.items.columns, ...(bestHeader.columns || {}) };
  let sectionRow = null;
  let startRow = bestHeader.row > 0 ? bestHeader.row + 1 : DEFAULT_EXCEL_QUOTE_TEMPLATE_MAPPING.items.startRow;
  let templateRow = startRow;
  if (bestHeader.row > 0) {
    const nameCol = colLetterToIndex(columns.name);
    const skuCol = colLetterToIndex(columns.sku);
    const qtyCol = colLetterToIndex(columns.qty);
    const priceCol = colLetterToIndex(columns.unitPrice);
    for (let rr = bestHeader.row + 1; rr <= Math.min(range.e.r + 1, bestHeader.row + 30); rr++) {
      const r = rr - 1;
      const nameText = nameCol >= 0 ? cellText(r, nameCol) : "";
      const skuText = skuCol >= 0 ? cellText(r, skuCol) : "";
      const qtyText = qtyCol >= 0 ? cellText(r, qtyCol) : "";
      const priceText = priceCol >= 0 ? cellText(r, priceCol) : "";
      let firstNonEmptyText = "";
      let firstNonEmptyCol = "";
      for (let c = range.s.c; c <= range.e.c; c++) {
        const txt = cellText(r, c);
        if (String(txt || "").trim()) { firstNonEmptyText = txt; firstNonEmptyCol = excelColLetterFromIndex(c); break; }
      }
      const joined = [firstNonEmptyText, nameText, skuText, qtyText, priceText].join(" ").trim();
      if (!joined) continue;
      if (!sectionRow && isLikelyExcelTemplateSectionText(firstNonEmptyText) && !qtyText && !priceText) {
        sectionRow = rr;
        var sectionLabelColumn = firstNonEmptyCol || columns.no || "A";
        continue;
      }
      const hasItemShape = !!nameText && (!!skuText || !!qtyText || !!priceText);
      if (hasItemShape && !isLikelyExcelTemplateSectionText(firstNonEmptyText)) {
        startRow = rr;
        templateRow = rr;
        break;
      }
    }
  }

  const totals = { ...DEFAULT_EXCEL_QUOTE_TEMPLATE_MAPPING.totals };
  const totalHits = [];
  let summaryStartRow = null;
  const preferredTotalCol = columns.lineTotal || "";
  for (let r = range.s.r; r <= range.e.r; r++) {
    let rowText = "";
    for (let c = range.s.c; c <= range.e.c; c++) rowText += ` ${normCell(r, c)}`;
    rowText = rowText.trim();
    if (!rowText) continue;
    const ref = findExcelValueCellOnRow(ws, r + 1, preferredTotalCol);
    if (!summaryStartRow && rowText.includes("tong hop") && rowText.includes("giai phap")) summaryStartRow = r + 1;
    if (rowText.includes("tong gia tri hop dong") || rowText.includes("tong thanh toan")) {
      totals.grandTotal = ref; totalHits.push({ label: "Tổng thanh toán", ref }); continue;
    }
    if (rowText.includes("tong tien hang") || rowText.includes("tam tinh")) {
      totals.subtotal = ref; totalHits.push({ label: "Tạm tính", ref }); continue;
    }
    if (rowText.includes("nhan cong") || rowText.includes("thi cong") || rowText.includes("lap trinh")) {
      totals.labor = ref; totalHits.push({ label: "Nhân công", ref }); continue;
    }
    if (rowText.includes("vat") || rowText.includes("thue gtgt")) {
      totals.vat = ref; totalHits.push({ label: "VAT", ref }); continue;
    }
  }

  const clearUntilRow = summaryStartRow ? Math.max(startRow, summaryStartRow - 1) : Math.max(startRow, (totals.subtotal ? Number(String(totals.subtotal).replace(/^[A-Z]+/, "")) - 1 : startRow));
  const mapping = {
    sheetName,
    fields,
    fieldPrefixes,
    items: {
      startRow,
      templateRow,
      headerRow: bestHeader.row > 0 ? bestHeader.row : undefined,
      sectionRow: sectionRow || undefined,
      sectionLabelColumn: typeof sectionLabelColumn !== "undefined" ? sectionLabelColumn : (columns.no || "A"),
      clearUntilRow,
      columns,
    },
    summary: {
      titleRow: summaryStartRow || undefined,
      templateRow: summaryStartRow ? summaryStartRow + 1 : undefined,
      labelColumn: columns.no || "A",
      totalColumn: columns.lineTotal || "K",
    },
    totals,
  };
  const columnCount = Object.keys(bestHeader.columns || {}).length;
  const confidence = Math.min(100, Math.round((fieldHits.length * 7) + (columnCount * 5) + (totalHits.length * 8) + (bestHeader.row > 0 ? 15 : 0)));
  const notes = [];
  if (bestHeader.row > 0) notes.push(`Tìm thấy bảng sản phẩm ở dòng ${bestHeader.row}.`);
  if (templateRow) notes.push(`Dòng sản phẩm mẫu: ${templateRow}.`);
  if (sectionRow) notes.push(`Dòng tiêu đề nhóm mẫu: ${sectionRow}.`);
  if (summaryStartRow) notes.push(`Giữ vùng tổng hợp từ dòng ${summaryStartRow}.`);
  if (!bestHeader.row || columnCount < 5) notes.push("Chưa chắc bảng sản phẩm; hãy mở Chỉnh tay để kiểm tra.");

  return {
    mapping,
    detection: {
      source: "smart_mapper_v2",
      confidence,
      fileName,
      sheetName,
      fieldHits,
      columnHits: Object.entries(bestHeader.columns || {}).map(([key, col]) => ({ key, col })),
      totalHits,
      headerRow: bestHeader.row > 0 ? bestHeader.row : null,
      startRow,
      templateRow,
      sectionRow,
      clearUntilRow,
      notes,
      detectedAt: new Date().toISOString(),
    },
  };
}

function colLetterToIndex(letter = "") {
  const text = String(letter || "").trim().toUpperCase().replace(/[^A-Z]/g, "");
  if (!text) return -1;
  let n = 0;
  for (const ch of text) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function buildQuoteExportRows({ rooms = [], productById = {}, lineSalePrice }) {
  const rows = [];
  let no = 0;
  (rooms || []).forEach((room) => {
    (room.lines || []).forEach((line) => {
      const p = productById[line.productId];
      if (!p) return;
      no += 1;
      const unitPrice = Number(lineSalePrice(p, line) || 0);
      const qty = Number(line.qty || 0);
      rows.push({
        no,
        room: room.name || "",
        note: line.note || room.name || "",
        name: p.name || "",
        sku: p.sku || "",
        specs: excelSafeDisplayText(p.specs || p.description || ""),
        supplier: p.supplier || p.brand || "",
        unit: p.unit || "Cái",
        qty,
        unitPrice,
        lineTotal: unitPrice * qty,
        image: p.image || p.imageUrl || "",
      });
    });
  });
  return rows;
}

function buildQuoteExportSections({ rooms = [], productById = {}, lineSalePrice }) {
  let no = 0;
  return (rooms || [])
    .map((room) => {
      const rows = (room.lines || [])
        .map((line) => {
          const p = productById[line.productId];
          if (!p) return null;
          no += 1;
          const unitPrice = Number(lineSalePrice(p, line) || 0);
          const qty = Number(line.qty || 0);
          return {
            no,
            room: room.name || "",
            note: line.note || room.name || "",
            name: p.name || "",
            sku: p.sku || "",
            specs: p.specs || p.description || "",
            supplier: p.supplier || p.brand || "",
            unit: p.unit || "Cái",
            qty,
            unitPrice,
            lineTotal: unitPrice * qty,
            image: p.image || p.imageUrl || "",
          };
        })
        .filter(Boolean);
      return rows.length ? { name: room.name || "Hạng mục", rows } : null;
    })
    .filter(Boolean);
}

function safeExcelFileName(name = "KhachHang") {
  return String(name || "KhachHang").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80) || "KhachHang";
}

// Catalog mặc định bắt đầu trắng — mỗi đại lý tự import Excel/PDF bảng giá của họ.
const SEED_PRODUCTS = [];
const SEED_CATEGORIES = [];
const buildSeedTemplates = () => [];

const buildDefaultCompany = () => ({
  name: "", phone: "", address: "", taxCode: "",
  laborPercent: 0, quoteNumber: "", salesPerson: "", salesPhone: "",
  website: "", googleApiKey: "", googleCx: "",
  logoUrl: "", bankInfo: "", introText: "",
  quoteTemplate: buildDefaultQuoteTemplateConfig("smarthome_pro"),
  excelQuoteTemplates: [],
  defaultExcelQuoteTemplateId: "",
});

const buildDefaultMarkups = () => [
  { id: uid("mk"), label: "Mặc định", value: 1 },
];

const valueOrFactory = (fallback) => (typeof fallback === "function" ? fallback() : fallback);

const isCloudMode = (cloud) => Boolean(cloud?.enabled);
const dealerScopedStorageKey = (dealerId, key) => `sq_dealer_${dealerId}_${key}`;
const legacyStorageKey = (key) => `sq_${key}`;

function readLocalState(cloud, key, fallback) {
  // Khi đã bật Cloud/Supabase, tuyệt đối không đọc các key localStorage global
  // như sq_products/sq_templates. Nếu không, đại lý mới đăng nhập trên cùng máy
  // có thể nhìn thấy hoặc sync nhầm dữ liệu của đại lý trước đó.
  if (isCloudMode(cloud)) return valueOrFactory(fallback);
  if (typeof localStorage === "undefined") return valueOrFactory(fallback);
  try {
    const saved = localStorage.getItem(legacyStorageKey(key));
    return saved ? JSON.parse(saved) : valueOrFactory(fallback);
  } catch {
    return valueOrFactory(fallback);
  }
}

function writeLocalState(cloud, key, value, cloudLoaded) {
  if (typeof localStorage === "undefined") return;
  try {
    if (cloud?.enabled) {
      if (!cloud.dealerId || !cloudLoaded) return;
      localStorage.setItem(dealerScopedStorageKey(cloud.dealerId, key), JSON.stringify(value));
      return;
    }
    localStorage.setItem(legacyStorageKey(key), JSON.stringify(value));
  } catch (e) {
    if (key === "products") console.warn("Lưu products lỗi (có thể đầy bộ nhớ):", e);
  }
}

function buildNormalizedCloudSnapshot(state = {}) {
  const products = Array.isArray(state.products) ? state.products : [];
  const templates = Array.isArray(state.templates) ? state.templates : [];
  const company = state.company && typeof state.company === "object" && Object.keys(state.company).length
    ? {
        ...buildDefaultCompany(),
        ...state.company,
        quoteTemplate: normalizeQuoteTemplateConfig(state.company.quoteTemplate || {}),
        excelQuoteTemplates: normalizeExcelQuoteTemplates(state.company.excelQuoteTemplates),
      }
    : buildDefaultCompany();
  const markups = Array.isArray(state.markups) && state.markups.length ? state.markups : buildDefaultMarkups();
  const suppliers = Array.isArray(state.suppliers) ? state.suppliers : [];
  const nameMap = state.nameMap && typeof state.nameMap === "object" ? state.nameMap : {};
  const solutionFamilies = normalizeSolutionFamilies(state.solutionFamilies);
  return { products, templates, company, markups, suppliers, nameMap, solutionFamilies };
}


const SOLUTION_CATEGORY_KEYS = [
  { key: "gate_motor", label: "Motor cổng", hints: ["motor cong", "cong tu dong", "roger", "vulcan", "cua cong"] },
  { key: "door_phone", label: "Chuông cửa màn hình", hints: ["chuong cua", "door phone", "video door", "man hinh chuong cua", "intercom"] },
  { key: "smart_switch", label: "Công tắc thông minh", hints: ["cong tac", "switch", "nut", "dimmer", "mat cong tac"] },
  { key: "lighting", label: "Chiếu sáng", hints: ["den", "lighting", "downlight", "spotlight", "chieu sang"] },
  { key: "sensor", label: "Cảm biến", hints: ["cam bien", "sensor", "hien dien", "chuyen dong", "hong ngoai"] },
  { key: "curtain_motor", label: "Motor rèm", hints: ["rem", "curtain", "motor rem", "ray rem"] },
  { key: "door_lock", label: "Khoá cửa", hints: ["khoa cua", "khoá cua", "door lock", "smart lock", "philips", "kaadas", "osuno"] },
  { key: "ir_control", label: "Điều khiển TV/Điều hoà", hints: ["dieu khien", "dieu hoa", "đieu hoa", "tivi", "tv", "ir", "remote", "hong ngoai"] },
  { key: "audio", label: "Âm thanh đa vùng", hints: ["am thanh", "audio", "loa", "amply", "amplifier", "arylic"] },
  { key: "camera", label: "Camera an ninh", hints: ["camera", "hikvision", "hik", "imou", "dahua", "dau ghi"] },
  { key: "wifi", label: "Wifi / mạng", hints: ["wifi", "mesh", "router", "access point", "ap ", "ruijie", "switch mang", "mang noi bo"] },
];

const SOLUTION_SEGMENTS = [
  { key: "economy", label: "Tiết kiệm" },
  { key: "standard", label: "Đề xuất" },
  { key: "premium", label: "Cao cấp" },
  { key: "brand", label: "Theo hãng" },
];

const solutionCategoryLabel = (key) => SOLUTION_CATEGORY_KEYS.find((c) => c.key === key)?.label || key;
const normalizeVN = (value = "") => String(value || "")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .replace(/đ/g, "d")
  .replace(/Đ/g, "d")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, " ")
  .replace(/\s+/g, " ")
  .trim();

function solutionProductText(p = {}) {
  return normalizeVN([p.name, p.sku, p.category, p.supplier, p.brand, p.specs, p.description].filter(Boolean).join(" "));
}

function productMatchesBrand(p = {}, brand = "") {
  const b = normalizeVN(brand);
  if (!b) return true;
  const text = solutionProductText(p);
  return text.includes(b);
}

function inferSolutionCategoryKey(product = {}) {
  if (product.solutionCategoryKey && SOLUTION_CATEGORY_KEYS.some((c) => c.key === product.solutionCategoryKey)) return product.solutionCategoryKey;
  const text = solutionProductText(product);
  const found = SOLUTION_CATEGORY_KEYS.find((cat) => cat.hints.some((hint) => text.includes(normalizeVN(hint))));
  return found?.key || "";
}

function productMatchesSolutionCategory(product = {}, categoryKey = "") {
  if (!categoryKey) return true;
  if (product.solutionCategoryKey === categoryKey) return true;
  return inferSolutionCategoryKey(product) === categoryKey;
}

function buildDefaultSolutionItems(primaryBrand = "", fallbackByCategory = {}) {
  return SOLUTION_CATEGORY_KEYS.map((cat, idx) => ({
    id: uid("sfi"),
    categoryKey: cat.key,
    enabled: true,
    preferredBrand: fallbackByCategory[cat.key]?.preferredBrand ?? primaryBrand,
    fallbackBrand: fallbackByCategory[cat.key]?.fallbackBrand || "",
    productId: "",
    fallbackProductId: "",
    qty: 1,
    note: cat.label,
    sortOrder: idx,
  }));
}

function buildSolutionFamily(name, { description = "", segment = "brand", projectType = "villa", primaryBrand = "", fallbackByCategory = {} } = {}) {
  return {
    id: uid("sf"),
    name,
    description,
    segment,
    projectType,
    primaryBrand,
    isActive: true,
    items: buildDefaultSolutionItems(primaryBrand, fallbackByCategory),
    createdAt: new Date().toISOString(),
  };
}

function buildSeedSolutionFamilies() {
  return [
    buildSolutionFamily("Bộ Lumi Villa", {
      description: "Ưu tiên Lumi cho smart home; camera/wifi/cổng/khoá dùng hãng phù hợp.",
      segment: "brand",
      primaryBrand: "Lumi",
      fallbackByCategory: {
        gate_motor: { preferredBrand: "Vulcan", fallbackBrand: "Roger" },
        door_lock: { preferredBrand: "Philips", fallbackBrand: "Kaadas" },
        audio: { preferredBrand: "Arylic" },
        camera: { preferredBrand: "Hikvision", fallbackBrand: "Imou" },
        wifi: { preferredBrand: "Ruijie" },
      },
    }),
    buildSolutionFamily("Bộ Erfinden Villa", {
      description: "Phương án theo Erfinden cho công tắc/cảm biến/điều khiển, các hệ còn lại fallback theo nhóm.",
      segment: "brand",
      primaryBrand: "Erfinden",
      fallbackByCategory: {
        gate_motor: { preferredBrand: "Vulcan", fallbackBrand: "Roger" },
        door_phone: { preferredBrand: "Lumi" },
        lighting: { preferredBrand: "Lumi" },
        curtain_motor: { preferredBrand: "Lumi" },
        door_lock: { preferredBrand: "Philips", fallbackBrand: "Kaadas" },
        audio: { preferredBrand: "Arylic" },
        camera: { preferredBrand: "Hikvision", fallbackBrand: "Imou" },
        wifi: { preferredBrand: "Ruijie" },
      },
    }),
    buildSolutionFamily("Bộ Schneider Villa", {
      description: "Phương án cao cấp: Schneider cho công tắc/điều khiển khi có, các hệ còn lại dùng brand mạnh.",
      segment: "premium",
      primaryBrand: "Schneider",
      fallbackByCategory: {
        gate_motor: { preferredBrand: "Roger", fallbackBrand: "Vulcan" },
        door_phone: { preferredBrand: "Lumi" },
        lighting: { preferredBrand: "Lumi" },
        sensor: { preferredBrand: "Schneider", fallbackBrand: "Lumi" },
        curtain_motor: { preferredBrand: "Lumi" },
        door_lock: { preferredBrand: "Kaadas", fallbackBrand: "Philips" },
        ir_control: { preferredBrand: "Schneider", fallbackBrand: "Lumi" },
        audio: { preferredBrand: "Arylic" },
        camera: { preferredBrand: "Hikvision" },
        wifi: { preferredBrand: "Ruijie" },
      },
    }),
    buildSolutionFamily("Phương án Tiết kiệm", {
      description: "Ưu tiên brand dễ chốt giá, dùng cho khách nhạy ngân sách.",
      segment: "economy",
      primaryBrand: "",
      fallbackByCategory: {
        gate_motor: { preferredBrand: "Vulcan" },
        door_phone: { preferredBrand: "Basic", fallbackBrand: "Lumi" },
        smart_switch: { preferredBrand: "Erfinden", fallbackBrand: "Lumi" },
        lighting: { preferredBrand: "Lumi" },
        sensor: { preferredBrand: "Erfinden", fallbackBrand: "Lumi" },
        curtain_motor: { preferredBrand: "Erfinden", fallbackBrand: "Lumi" },
        door_lock: { preferredBrand: "Osuno", fallbackBrand: "Philips" },
        ir_control: { preferredBrand: "Erfinden", fallbackBrand: "Lumi" },
        audio: { preferredBrand: "Arylic" },
        camera: { preferredBrand: "Imou", fallbackBrand: "Dahua" },
        wifi: { preferredBrand: "Ruijie" },
      },
    }),
    buildSolutionFamily("Phương án Cao cấp", {
      description: "Ưu tiên sản phẩm/brand mạnh cho villa và công trình nhiều hạng mục.",
      segment: "premium",
      primaryBrand: "",
      fallbackByCategory: {
        gate_motor: { preferredBrand: "Roger", fallbackBrand: "Vulcan" },
        door_phone: { preferredBrand: "Lumi" },
        smart_switch: { preferredBrand: "Schneider", fallbackBrand: "Lumi" },
        lighting: { preferredBrand: "Lumi" },
        sensor: { preferredBrand: "Lumi" },
        curtain_motor: { preferredBrand: "Lumi" },
        door_lock: { preferredBrand: "Kaadas", fallbackBrand: "Philips" },
        ir_control: { preferredBrand: "Lumi" },
        audio: { preferredBrand: "Arylic" },
        camera: { preferredBrand: "Hikvision", fallbackBrand: "Dahua" },
        wifi: { preferredBrand: "Ruijie" },
      },
    }),
  ];
}

function normalizeSolutionFamilyItem(item = {}, index = 0, familyPrimaryBrand = "") {
  const categoryKey = SOLUTION_CATEGORY_KEYS.some((c) => c.key === item.categoryKey) ? item.categoryKey : (SOLUTION_CATEGORY_KEYS[index]?.key || "smart_switch");
  return {
    id: item.id || uid("sfi"),
    categoryKey,
    enabled: item.enabled !== false,
    preferredBrand: item.preferredBrand ?? familyPrimaryBrand ?? "",
    fallbackBrand: item.fallbackBrand || "",
    productId: item.productId || "",
    fallbackProductId: item.fallbackProductId || "",
    qty: Math.max(1, Number(item.qty || 1)),
    note: item.note || solutionCategoryLabel(categoryKey),
    sortOrder: Number.isFinite(Number(item.sortOrder)) ? Number(item.sortOrder) : index,
  };
}

function normalizeSolutionFamily(family = {}, index = 0) {
  const primaryBrand = family.primaryBrand || "";
  const rawItems = Array.isArray(family.items) && family.items.length ? family.items : buildDefaultSolutionItems(primaryBrand);
  const byKey = new Map(rawItems.map((item, i) => [item.categoryKey || SOLUTION_CATEGORY_KEYS[i]?.key, item]));
  const items = SOLUTION_CATEGORY_KEYS.map((cat, idx) => normalizeSolutionFamilyItem(byKey.get(cat.key) || { categoryKey: cat.key }, idx, primaryBrand));
  return {
    id: family.id || uid("sf"),
    name: family.name || `Bộ giải pháp ${index + 1}`,
    description: family.description || "",
    segment: family.segment || "brand",
    projectType: family.projectType || "villa",
    primaryBrand,
    isActive: family.isActive !== false,
    items,
    createdAt: family.createdAt || new Date().toISOString(),
  };
}

function normalizeSolutionFamilies(value) {
  if (!Array.isArray(value) || value.length === 0) return buildSeedSolutionFamilies();
  return value.map(normalizeSolutionFamily);
}

function findProductById(products = [], id = "") {
  return id ? products.find((p) => p.id === id) : null;
}

function bestProductMatch(products = [], categoryKey = "", brand = "") {
  const branded = normalizeVN(brand);
  const scored = products
    .map((p) => {
      let score = 0;
      const text = solutionProductText(p);
      if (productMatchesSolutionCategory(p, categoryKey)) score += 70;
      if (branded && productMatchesBrand(p, brand)) score += 45;
      if (p.costPrice || p.listPrice) score += 8;
      if (p.sku) score += 6;
      if (branded && normalizeVN(p.supplier || p.brand || "").includes(branded)) score += 10;
      if (categoryKey && !productMatchesSolutionCategory(p, categoryKey)) score -= 80;
      if (branded && !text.includes(branded)) score -= 5;
      return { p, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored[0]?.p || null;
}

function resolveSolutionFamily(family, products = []) {
  const normalized = normalizeSolutionFamily(family);
  const rows = normalized.items
    .filter((item) => item.enabled)
    .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))
    .map((item) => {
      const fixed = findProductById(products, item.productId);
      const preferred = fixed || bestProductMatch(products, item.categoryKey, item.preferredBrand);
      const fallbackFixed = !preferred ? findProductById(products, item.fallbackProductId) : null;
      const fallback = preferred || fallbackFixed || bestProductMatch(products, item.categoryKey, item.fallbackBrand);
      const product = preferred || fallback || null;
      const source = fixed ? "product" : (preferred ? "brand" : (fallbackFixed ? "fallbackProduct" : (fallback ? "fallbackBrand" : "missing")));
      return {
        item,
        product,
        source,
        categoryLabel: solutionCategoryLabel(item.categoryKey),
        reason: product
          ? `${product.name}${product.supplier ? ` · ${product.supplier}` : ""}`
          : `Chưa tìm thấy sản phẩm ${item.preferredBrand ? `hãng ${item.preferredBrand}` : "phù hợp"}`,
      };
    });
  return {
    family: normalized,
    rows,
    matched: rows.filter((r) => r.product).length,
    missing: rows.filter((r) => !r.product).length,
  };
}

function makeSolutionFamilyRoom(family, products = []) {
  const resolved = resolveSolutionFamily(family, products);
  const lines = resolved.rows
    .filter((row) => row.product)
    .map((row) => ({
      id: uid("ln"),
      productId: row.product.id,
      qty: Math.max(1, Number(row.item.qty || 1)),
      note: row.item.note || row.categoryLabel,
    }));
  return {
    room: { id: uid("room"), name: resolved.family.name, lines },
    resolved,
  };
}

const PRIMARY_TABS = [
  { key: "quote", label: "Báo giá" },
  { key: "data", label: "Danh mục", subs: [
    { key: "products", label: "Sản phẩm" },
    { key: "import", label: "Nhập file" },
    { key: "ask", label: "Hỏi Nhà cung cấp" },
  ] },
  { key: "assets", label: "Mẫu & Gói", subs: [
    { key: "room_packs", label: "Gói phòng" },
    { key: "solution_families", label: "Bộ giải pháp" },
    { key: "quote_tmpl", label: "Mẫu báo giá" },
  ] },
  { key: "settings", label: "Cài đặt", subs: [
    { key: "general", label: "Chung" },
    { key: "plan", label: "Gói sử dụng" },
  ] },
];


const PLAN_TAGLINES = {
  free: "Bắt đầu miễn phí",
  starter: "Thợ & đại lý nhỏ",
  pro: "Đại lý đang chạy đều",
  business: "Công ty & nhiều team",
};

const LEGACY_TAB_MAP = {
  quote: ["quote", null],
  catalog: ["data", "products"],
  takeoff: ["data", "import"],
  ai_reader: ["data", "import"],
  ask: ["data", "ask"],
  templates: ["assets", "room_packs"],
  solution_families: ["assets", "solution_families"],
  quote_template: ["assets", "quote_tmpl"],
  upgrade: ["settings", "plan"],
  settings: ["settings", "general"],
  data: ["data", "products"],
  assets: ["assets", "room_packs"],
};

function resolveSmartQuoteTab(targetTab, targetSubView) {
  const mapped = LEGACY_TAB_MAP[targetTab] || [targetTab || "quote", targetSubView || null];
  const primaryKey = mapped[0];
  const primary = PRIMARY_TABS.find((t) => t.key === primaryKey) || PRIMARY_TABS[0];
  const defaultSub = primary.subs?.[0]?.key || null;
  return { tab: primary.key, subView: targetSubView || mapped[1] || defaultSub };
}

function NavIcon({ name }) {
  if (name === "quote") return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>;
  if (name === "data") return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>;
  if (name === "assets") return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>;
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>;
}


function SidebarUsageMini({ billing, usage = {}, onUpgrade }) {
  const planLabel = billing?.label || PLAN_LIMITS[billing?.plan]?.label || "Trial";
  const rows = [
    ["quotes_per_month", "Báo giá"],
    ["ai_claude_request", "Nhập AI"],
  ];
  const meter = (key, fallbackLabel) => {
    const limit = billing?.limits?.[key];
    const used = Number(usage?.[key] || 0);
    const unlimited = limit === -1 || limit === Infinity || limit == null;
    const pct = unlimited ? 100 : Math.min(100, Math.round((used / Math.max(1, Number(limit) || 1)) * 100));
    return { label: FEATURE_LABELS[key] || fallbackLabel, used, limit, unlimited, pct, warn: !unlimited && pct >= 80 };
  };
  return (
    <div className="usage-mini">
      <div className="um-top"><span className="plan">{planLabel}</span><span className="tag">{billing?.locked ? "Cần gia hạn" : "Đang dùng"}</span></div>
      {rows.map(([key, label]) => {
        const m = meter(key, label);
        return (
          <div key={key}>
            <div className="um-row"><span>{m.label}</span><span className="num">{m.unlimited ? "Không giới hạn" : `${m.used.toLocaleString("vi-VN")}/${Number(m.limit || 0).toLocaleString("vi-VN")}`}</span></div>
            <div className={`um-bar ${m.warn ? "warn" : ""}`}><i style={{ width: `${m.pct}%` }} /></div>
          </div>
        );
      })}
      <button className="up" onClick={onUpgrade}>{billing?.locked ? "Gia hạn gói" : "Nâng lên Pro"}</button>
    </div>
  );
}

function getBillingFromCloud(cloud) {
  if (!cloud?.enabled) return null;
  return normalizeBilling(cloud.billing || {});
}

function billingLimit(billing, featureKey) {
  const state = normalizeBilling(billing || {});
  const value = state?.limits?.[featureKey];
  return value === undefined ? 0 : value;
}

function showUpgradeGuard(result, onUpgrade) {
  notify.warning(result.reason, typeof onUpgrade === "function" ? {
    title: "Giới hạn gói hiện tại",
    actionLabel: "Xem gói",
    onAction: onUpgrade,
    duration: 7000,
  } : { title: "Giới hạn gói hiện tại" });
  return false;
}

function guardFeature(cloud, featureKey, units = 1, onUpgrade) {
  if (!cloud?.enabled) return true;
  const result = canUseFeature(cloud.billing, featureKey, units);
  if (result.ok) return true;
  return showUpgradeGuard(result, onUpgrade);
}

function guardCapability(cloud, capabilityKey, onUpgrade) {
  if (!cloud?.enabled) return true;
  const result = canAccessCapability(cloud.billing, capabilityKey);
  if (result.ok) return true;
  return showUpgradeGuard(result, onUpgrade);
}

function guardProductCount(cloud, nextCount, onUpgrade) {
  if (!cloud?.enabled) return true;
  const result = canFitProductCount(cloud.billing, nextCount);
  if (result.ok) return true;
  return showUpgradeGuard(result, onUpgrade);
}


export default function SmartQuote({ cloud = { enabled: false } } = {}) {
  setTenantStorageScope(cloud?.enabled ? cloud?.dealerId : null);

  const [tab, setPrimaryTab] = useState("quote");
  const [subView, setSubView] = useState(null);
  const [quoteCreateRequest, setQuoteCreateRequest] = useState(0);
  const [roomPackCreateRequest, setRoomPackCreateRequest] = useState(0);
  const setTab = (nextTab, nextSubView) => {
    const target = resolveSmartQuoteTab(nextTab, nextSubView);
    setPrimaryTab(target.tab);
    setSubView(target.subView);
  };
  const [products, setProducts] = useState(() => readLocalState(cloud, "products", () => SEED_PRODUCTS));
  const [templates, setTemplates] = useState(() => readLocalState(cloud, "templates", buildSeedTemplates));
  const [solutionFamilies, setSolutionFamilies] = useState(() => readLocalState(cloud, "solutionFamilies", buildSeedSolutionFamilies));
  const [company, setCompany] = useState(() => readLocalState(cloud, "company", buildDefaultCompany));

  // Các mức hệ số áp cho giá gốc → giá bán
  const [markups, setMarkups] = useState(() => readLocalState(cloud, "markups", buildDefaultMarkups));

  // Báo giá: mỗi "room" = 1 phòng/hạng mục. Bắt đầu với 1 phòng trống.
  const DEFAULT_ROOMS = () => [
    { id: uid("room"), name: "Phòng 1", lines: [] },
  ];
  const [rooms, setRooms] = useState(DEFAULT_ROOMS);
  const [customer, setCustomer] = useState({ name: "", phone: "", address: "", project: "" });
  const [activeQuoteId, setActiveQuoteId] = useState(null);

  // Danh sách nhà cung cấp — local mode lưu global, cloud mode chỉ cache theo dealer_id.
  const [suppliersList, setSuppliersList] = useState(() => readLocalState(cloud, "suppliers", () => []));

  // Ánh xạ tên cột trong file bóc tách (vd "1 nút", "Cam ngoài trời") → SKU thiết bị trong catalog.
  // App nhớ lại để lần sau tự khớp, không phải chọn lại.
  const [nameMap, setNameMap] = useState(() => readLocalState(cloud, "nameMap", () => ({})));

  const productById = useMemo(() => {
    const m = {};
    products.forEach((p) => (m[p.id] = p));
    return m;
  }, [products]);

  const cloudLoadedRef = useRef(false);
  const cloudSaveTimerRef = useRef(null);
  const catalogSaveTimerRef = useRef(null);
  const lastCloudJsonRef = useRef("");
  const lastCatalogJsonRef = useRef("");
  const [cloudSyncStatus, setCloudSyncStatus] = useState(cloud?.enabled ? "Đang tải cloud..." : "Local");
  const billingStatus = useMemo(() => getBillingFromCloud(cloud), [cloud?.enabled, cloud?.billing]);
  const activePrimary = PRIMARY_TABS.find((t) => t.key === tab) || PRIMARY_TABS[0];
  const effectiveSubView = activePrimary.subs?.some((s) => s.key === subView) ? subView : (activePrimary.subs?.[0]?.key || null);
  const openUpgrade = () => setTab("settings", "plan");
  const activeSubLabel = activePrimary.subs?.find((item) => item.key === effectiveSubView)?.label || "";
  const userEmail = cloud?.session?.user?.email || "";
  const userInitial = (userEmail || "SQ").slice(0, 1).toUpperCase();
  const usageSnapshot = cloud?.billing?.usage || {};
  const contextualTopbarAction = !billingStatus?.locked
    ? (tab === "quote" && products.length > 0
      ? { label: "+ Tạo báo giá", tone: "primary", onClick: () => setQuoteCreateRequest((value) => value + 1) }
      : tab === "data" && effectiveSubView === "products"
        ? { label: "Nhập sản phẩm", tone: "primary", onClick: () => setTab("data", "import") }
        : tab === "assets" && effectiveSubView === "room_packs"
          ? { label: "+ Tạo gói", tone: "primary", onClick: () => setRoomPackCreateRequest((value) => value + 1) }
          : null)
    : null;

  // ── TỰ ĐỘNG LƯU local cache ──
  // Local mode: giữ tương thích key cũ sq_*.
  // Cloud mode: chỉ cache theo dealer_id và chỉ sau khi đã tải cloud xong.
  // Không bao giờ ghi/đọc sq_products global khi đang ở Cloud mode.
  useEffect(() => {
    writeLocalState(cloud, "products", products, cloudLoadedRef.current);
  }, [products, cloud?.enabled, cloud?.dealerId]);
  useEffect(() => {
    writeLocalState(cloud, "templates", templates, cloudLoadedRef.current);
  }, [templates, cloud?.enabled, cloud?.dealerId]);
  useEffect(() => {
    writeLocalState(cloud, "solutionFamilies", solutionFamilies, cloudLoadedRef.current);
  }, [solutionFamilies, cloud?.enabled, cloud?.dealerId]);
  useEffect(() => {
    writeLocalState(cloud, "company", company, cloudLoadedRef.current);
  }, [company, cloud?.enabled, cloud?.dealerId]);
  useEffect(() => {
    writeLocalState(cloud, "markups", markups, cloudLoadedRef.current);
  }, [markups, cloud?.enabled, cloud?.dealerId]);
  useEffect(() => {
    writeLocalState(cloud, "suppliers", suppliersList, cloudLoadedRef.current);
  }, [suppliersList, cloud?.enabled, cloud?.dealerId]);
  useEffect(() => {
    writeLocalState(cloud, "nameMap", nameMap, cloudLoadedRef.current);
  }, [nameMap, cloud?.enabled, cloud?.dealerId]);

  // ── CLOUD SYNC Supabase: mỗi đại lý có một snapshot riêng ──
  useEffect(() => {
    if (!cloud?.enabled || !cloud.dealerId) {
      cloudLoadedRef.current = false;
      setCloudSyncStatus(cloud?.enabled ? "Đang chờ workspace..." : "Local");
      return;
    }

    let cancelled = false;
    if (cloudSaveTimerRef.current) clearTimeout(cloudSaveTimerRef.current);
    cloudLoadedRef.current = false;
    lastCloudJsonRef.current = "";
    setCloudSyncStatus("Đang tải cloud...");

    // Xóa dữ liệu đang hiển thị ngay khi đổi workspace để tránh đại lý mới
    // thấy thoáng qua dữ liệu của đại lý trước trong lúc chờ Supabase trả về.
    const safeEmptySnapshot = buildNormalizedCloudSnapshot({});
    setProducts(safeEmptySnapshot.products);
    setTemplates(safeEmptySnapshot.templates);
    setSolutionFamilies(safeEmptySnapshot.solutionFamilies);
    setCompany(safeEmptySnapshot.company);
    setMarkups(safeEmptySnapshot.markups);
    setSuppliersList(safeEmptySnapshot.suppliers);
    setNameMap(safeEmptySnapshot.nameMap);
    setRooms(DEFAULT_ROOMS());
    setCustomer({ name: "", phone: "", address: "", project: "" });
    setActiveQuoteId(null);

    Promise.all([loadCloudState(cloud.dealerId), listCloudCatalog(cloud.dealerId)])
      .then(async ([state, catalogProducts]) => {
        if (cancelled) return;
        const nextSnapshot = buildNormalizedCloudSnapshot(state);
        let nextProducts = Array.isArray(catalogProducts) ? catalogProducts : [];

        // Phase 5 migration: nếu workspace cũ vẫn còn products trong dealer_app_state
        // nhưng bảng catalog_items chưa có dữ liệu, dùng snapshot cũ một lần rồi ghi sang bảng mới.
        if (!nextProducts.length && nextSnapshot.products.length) {
          nextProducts = nextSnapshot.products;
          try {
            await syncCloudCatalogSnapshot(cloud.dealerId, nextProducts, {
              mode: "replace",
              importMeta: { source_type: "migration", source_name: "dealer_app_state.products", merge_mode: "replace", status: "migrated" },
            });
          } catch (migrationError) {
            console.warn("Không migrate được catalog snapshot sang catalog_items:", migrationError);
          }
        }

        const settingsSnapshot = {
          templates: nextSnapshot.templates,
          solutionFamilies: nextSnapshot.solutionFamilies,
          company: nextSnapshot.company,
          markups: nextSnapshot.markups,
          suppliers: nextSnapshot.suppliers,
          nameMap: nextSnapshot.nameMap,
        };
        setProducts(nextProducts);
        setTemplates(nextSnapshot.templates);
        setSolutionFamilies(nextSnapshot.solutionFamilies);
        setCompany(nextSnapshot.company);
        setMarkups(nextSnapshot.markups);
        setSuppliersList(nextSnapshot.suppliers);
        setNameMap(nextSnapshot.nameMap);
        lastCloudJsonRef.current = JSON.stringify(settingsSnapshot);
        lastCatalogJsonRef.current = serializeProductsForCatalog(nextProducts);
        cloudLoadedRef.current = true;
        setCloudSyncStatus(nextProducts.length ? `Đã tải catalog (${nextProducts.length} SP)` : (state.updatedAt ? "Đã tải cloud" : "Cloud mới"));
      })
      .catch((error) => {
        console.error(error);
        if (!cancelled) setCloudSyncStatus("Lỗi tải cloud/catalog");
      });

    return () => { cancelled = true; };
  }, [cloud?.enabled, cloud?.dealerId]);

  useEffect(() => {
    if (!cloud?.enabled || !cloud.dealerId || !cloudLoadedRef.current) return;

    // Phase 5: dealer_app_state chỉ giữ settings nhẹ. Catalog nằm ở bảng catalog_items.
    const snapshot = { templates, solutionFamilies, company, markups, suppliers: suppliersList, nameMap };
    const json = JSON.stringify(snapshot);
    if (json === lastCloudJsonRef.current) return;

    if (cloudSaveTimerRef.current) clearTimeout(cloudSaveTimerRef.current);
    setCloudSyncStatus("Đang lưu cài đặt...");

    cloudSaveTimerRef.current = setTimeout(() => {
      saveCloudState(cloud.dealerId, snapshot)
        .then(() => {
          lastCloudJsonRef.current = json;
          setCloudSyncStatus("Đã lưu cài đặt");
        })
        .catch((error) => {
          console.error(error);
          setCloudSyncStatus("Lỗi lưu cài đặt");
        });
    }, 900);

    return () => {
      if (cloudSaveTimerRef.current) clearTimeout(cloudSaveTimerRef.current);
    };
  }, [cloud?.enabled, cloud?.dealerId, templates, solutionFamilies, company, markups, suppliersList, nameMap]);

  useEffect(() => {
    if (!cloud?.enabled || !cloud.dealerId || !cloudLoadedRef.current) return;

    const json = serializeProductsForCatalog(products);
    if (json === lastCatalogJsonRef.current) return;

    if (catalogSaveTimerRef.current) clearTimeout(catalogSaveTimerRef.current);
    setCloudSyncStatus("Đang lưu catalog...");

    catalogSaveTimerRef.current = setTimeout(() => {
      syncCloudCatalogSnapshot(cloud.dealerId, products, { mode: "merge" })
        .then(() => {
          lastCatalogJsonRef.current = json;
          setCloudSyncStatus(`Đã lưu catalog (${products.length} SP)`);
          cloud.refreshBilling?.();
        })
        .catch((error) => {
          console.error(error);
          setCloudSyncStatus(error?.message || "Lỗi lưu catalog");
        });
    }, 1200);

    return () => {
      if (catalogSaveTimerRef.current) clearTimeout(catalogSaveTimerRef.current);
    };
  }, [cloud?.enabled, cloud?.dealerId, products]);

  return (
    <div className="app app-shell">
      <style>{CSS}</style>
      <InteractionHost />

      <aside className="rail">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M4 13l5 5L20 6" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </div>
          <div className="brand-name">Smart<span>Quote</span></div>
        </div>
        <nav className="nav" aria-label="Điều hướng chính">
          {PRIMARY_TABS.map((item) => (
            <div className="nav-group" key={item.key}>
              <button className={tab === item.key ? "active" : ""} onClick={() => setTab(item.key)}>
                <NavIcon name={item.key} />
                <span>{item.label}</span>
              </button>
              {tab === item.key && item.subs?.length ? (
                <div className="sub-nav">
                  {item.subs.map((sub) => (
                    <button key={sub.key} className={effectiveSubView === sub.key ? "active" : ""} onClick={() => setSubView(sub.key)}>
                      {sub.label}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
        </nav>
        <div className="spacer" />
        {cloud?.enabled && <SidebarUsageMini billing={billingStatus} usage={usageSnapshot} onUpgrade={openUpgrade} />}
      </aside>

      <div className="main shell-main">
        <header className="topbar">
          <div className="crumb">{activePrimary.label}{activeSubLabel ? <small>{activeSubLabel}</small> : null}</div>
          <div className="topbar-right">
            {cloud?.enabled && <span className={cloud?.enabled ? "cloud-dot on" : "cloud-dot"}></span>}
            {cloud?.enabled && <span className="cloud-status">{cloudSyncStatus}</span>}
            {billingStatus && <span className={`plan-pill ${billingStatus.locked ? "locked" : ""}`}>{billingStatus.label}{billingStatus.plan === "trial" && billingStatus.trialDaysLeft != null ? ` · còn ${Math.max(0, billingStatus.trialDaysLeft)} ngày` : ""}</span>}
            {cloud?.enabled && <button className="cloud-upgrade" onClick={openUpgrade}>{billingStatus?.locked ? "Gia hạn" : "Xem gói"}</button>}
            {contextualTopbarAction ? <button className={`btn ${contextualTopbarAction.tone}`} onClick={contextualTopbarAction.onClick}>{contextualTopbarAction.label}</button> : null}
            {cloud?.enabled && <button className="btn ghost cloud-logout" onClick={cloud.onLogout}>Đăng xuất</button>}
            {userEmail && <div className="avatar" title={userEmail}>{userInitial}</div>}
          </div>
        </header>

        <main className="content smartquote-content">
        {cloud?.enabled && <PlanBanner billing={billingStatus} productsCount={products.length} onUpgrade={openUpgrade} onRefresh={cloud.refreshBilling} />}
        {tab === "settings" && effectiveSubView === "plan" && <UpgradePage billing={billingStatus} usage={cloud?.billing?.usage || {}} cloud={cloud} onBack={() => setTab("quote")} />}
        {billingStatus?.locked && !(tab === "settings" && effectiveSubView === "plan") && <UpgradePage billing={billingStatus} usage={cloud?.billing?.usage || {}} cloud={cloud} locked onBack={() => setTab("settings", "plan")} />}
        {!billingStatus?.locked && tab === "quote" && products.length === 0 && (
          <NewUserEmptyState
            context="quote"
            onImport={() => setTab("data", "import")}
          />
        )}
        {!billingStatus?.locked && tab === "quote" && products.length > 0 && (
          <QuoteBuilder
            products={products}
            setProducts={setProducts}
            productById={productById}
            templates={templates}
            solutionFamilies={solutionFamilies}
            company={company}
            markups={markups}
            rooms={rooms}
            setRooms={setRooms}
            defaultRooms={DEFAULT_ROOMS}
            customer={customer}
            setCustomer={setCustomer}
            activeQuoteId={activeQuoteId}
            setActiveQuoteId={setActiveQuoteId}
            cloud={cloud}
            onUpgrade={openUpgrade}
            quoteTemplateConfig={company.quoteTemplate}
            createRequest={quoteCreateRequest}
          />
        )}
        {!billingStatus?.locked && tab === "data" && effectiveSubView === "products" && (
          <Catalog
            products={products}
            setProducts={setProducts}
            company={company}
            markups={markups}
            cloud={cloud}
            onUpgrade={openUpgrade}
            onOpenImportHub={() => setTab("data", "import")}
          />
        )}
        {!billingStatus?.locked && tab === "data" && effectiveSubView === "import" && (
          <UnifiedImportHub
            products={products}
            setProducts={setProducts}
            nameMap={nameMap}
            setNameMap={setNameMap}
            markups={markups}
            company={company}
            cloud={cloud}
            onUpgrade={openUpgrade}
            onGoProducts={() => setTab("data", "products")}
            onCreateQuote={(newRooms, customerInfo) => {
              setRooms(newRooms);
              if (customerInfo) setCustomer((c) => ({ ...c, ...customerInfo }));
              setActiveQuoteId(null);
              setTab("quote");
            }}
          />
        )}
        {!billingStatus?.locked && tab === "data" && effectiveSubView === "ask" && (
          <AskSupplier
            products={products}
            company={company}
            suppliers={suppliersList}
            setSuppliers={setSuppliersList}
          />
        )}
        {!billingStatus?.locked && tab === "assets" && effectiveSubView === "room_packs" && (
          <Templates products={products} productById={productById} templates={templates} setTemplates={setTemplates} markups={markups} createRequest={roomPackCreateRequest} />
        )}
        {!billingStatus?.locked && tab === "assets" && effectiveSubView === "solution_families" && (
          <SolutionFamilies products={products} solutionFamilies={solutionFamilies} setSolutionFamilies={setSolutionFamilies} />
        )}
        {!billingStatus?.locked && tab === "assets" && effectiveSubView === "quote_tmpl" && (
          <QuoteTemplateSettings company={company} setCompany={setCompany} products={products} rooms={rooms} productById={productById} />
        )}
        {!billingStatus?.locked && tab === "settings" && effectiveSubView === "general" && (
          <Settings
            company={company}
            setCompany={setCompany}
            markups={markups}
            setMarkups={setMarkups}
            data={{ products, templates, solutionFamilies, company, markups, suppliers: suppliersList, nameMap }}
            onImport={(d) => {
              if (d.products) setProducts(d.products);
              if (d.templates) setTemplates(d.templates);
              if (d.solutionFamilies) setSolutionFamilies(normalizeSolutionFamilies(d.solutionFamilies));
              if (d.company) setCompany(d.company);
              if (d.markups) setMarkups(d.markups);
              if (d.suppliers) setSuppliersList(d.suppliers);
              if (d.nameMap) setNameMap(d.nameMap);
            }}
          />
        )}
      </main>
      </div>
    </div>
  );
}

function NewUserEmptyState({ context = "quote", onImport }) {
  const isQuote = context === "quote";
  return (
    <section className={`new-user-empty ${isQuote ? "quote-empty" : "catalog-empty-state"}`}>
      <div className="new-user-empty-icon">{isQuote ? "🧾" : "📦"}</div>
      <div className="new-user-empty-kicker">Mới bắt đầu</div>
      <h1>{isQuote ? "Bắt đầu trong 2 bước" : "Chưa có sản phẩm nào"}</h1>
      <p>
        {isQuote
          ? "Trước khi tạo báo giá, bạn cần nhập bảng giá để SmartQuote biết sản phẩm, mã và giá của công ty bạn."
          : "Danh mục đang trống. Nhập bảng giá nhà cung cấp trước, sau đó bạn có thể tạo báo giá nhanh hơn."}
      </p>

      <div className="new-user-steps">
        <div className="new-user-step active">
          <span>①</span>
          <div>
            <strong>Nhập bảng giá của bạn</strong>
            <small>Excel/PDF bảng giá, catalog, hoặc link website nhà cung cấp.</small>
          </div>
        </div>
        <div className="new-user-step disabled">
          <span>②</span>
          <div>
            <strong>Tạo báo giá đầu tiên</strong>
            <small>Bước này sẽ mở sau khi danh mục có ít nhất một sản phẩm.</small>
          </div>
        </div>
      </div>

      <div className="new-user-actions">
        <button className="btn-primary" style={{ width: "auto" }} onClick={onImport}>📥 Nhập bảng giá</button>
        <span className="new-user-hint">Máy đọc — người duyệt giá trước khi lưu.</span>
      </div>
    </section>
  );
}


function UnifiedImportHub({ products, setProducts, nameMap, setNameMap, markups, company, cloud, onUpgrade, onCreateQuote, onGoProducts }) {
  const [mode, setMode] = useState(null);

  if (mode === "supplier_price") {
    return (
      <div className="unified-import">
        <div className="import-panel-head">
          <button className="btn-ghost" onClick={() => setMode(null)}>← Chọn loại file khác</button>
          <div>
            <h2>Bảng giá nhà cung cấp</h2>
            <p>Đưa file Excel/PDF hoặc link web nhà cung cấp vào danh mục sản phẩm. SmartQuote vẫn cho bạn xem trước, kiểm tra giá rồi mới lưu.</p>
          </div>
          <button className="btn-ghost" onClick={onGoProducts}>Xem danh mục</button>
        </div>
        <Catalog
          products={products}
          setProducts={setProducts}
          company={company}
          markups={markups}
          cloud={cloud}
          onUpgrade={onUpgrade}
          importOnly
          onImportDone={onGoProducts}
        />
      </div>
    );
  }

  if (mode === "old_quote") {
    return (
      <div className="unified-import">
        <div className="import-panel-head">
          <button className="btn-ghost" onClick={() => setMode(null)}>← Chọn loại file khác</button>
          <div>
            <h2>Báo giá cũ / công trình cũ</h2>
            <p>Lấy lại sản phẩm và giá từ file báo giá đã từng gửi khách. SmartQuote sẽ bỏ qua dòng hạng mục, tổng nhóm, vật tư phụ gộp và nhân công để không làm bẩn danh mục.</p>
          </div>
          <button className="btn-ghost" onClick={onGoProducts}>Xem danh mục</button>
        </div>
        <Catalog
          products={products}
          setProducts={setProducts}
          company={company}
          markups={markups}
          cloud={cloud}
          onUpgrade={onUpgrade}
          importOnly
          importSourceKind="old_quote"
          onImportDone={onGoProducts}
        />
      </div>
    );
  }

  if (mode === "takeoff") {
    return (
      <div className="unified-import">
        <div className="import-panel-head">
          <button className="btn-ghost" onClick={() => setMode(null)}>← Chọn loại file khác</button>
          <div>
            <h2>Bảng bóc tách từ KTS / kỹ sư</h2>
            <p>Đọc file bóc tách Excel, khớp thiết bị với danh mục hiện có, rồi tạo báo giá nháp để bạn kiểm tra.</p>
          </div>
        </div>
        <TakeoffReader
          products={products}
          nameMap={nameMap}
          setNameMap={setNameMap}
          markups={markups}
          company={company}
          cloud={cloud}
          onUpgrade={onUpgrade}
          onCreateQuote={onCreateQuote}
        />
      </div>
    );
  }

  return (
    <div className="unified-import">
      <section className="import-choice-hero">
        <div>
          <div className="upgrade-kicker">Nhập dữ liệu</div>
          <h1>Bạn có file gì?</h1>
          <p>Chọn theo cách thợ và đại lý hay làm việc. SmartQuote sẽ mở đúng bộ nhập file, không bắt bạn nhớ tên kỹ thuật.</p>
        </div>
        <button className="btn-ghost" onClick={onGoProducts}>Xem danh mục</button>
      </section>

      <div className="import-choice-grid">
        <button className="import-choice-card" onClick={() => setMode("supplier_price")}>
          <span className="import-choice-icon">📥</span>
          <strong>Bảng giá nhà cung cấp</strong>
          <small>Excel/PDF bảng giá, catalog sản phẩm, hoặc link website nhà cung cấp. Dùng để tạo và cập nhật danh mục sản phẩm.</small>
          <em>Mở bộ nhập bảng giá →</em>
        </button>
        <button className="import-choice-card" onClick={() => setMode("old_quote")}>
          <span className="import-choice-icon">🧾</span>
          <strong>Báo giá cũ / công trình cũ</strong>
          <small>File báo giá đã từng gửi khách. Dùng để lấy lại sản phẩm thật, bỏ qua dòng hạng mục/tổng nhóm và vật tư phụ gộp.</small>
          <em>Mở bộ lọc báo giá cũ →</em>
        </button>
        <button className="import-choice-card" onClick={() => setMode("takeoff")}>
          <span className="import-choice-icon">📋</span>
          <strong>Bảng bóc tách từ KTS / kỹ sư</strong>
          <small>File Excel khối lượng theo phòng/khu vực. Dùng để khớp với danh mục và tạo báo giá nháp.</small>
          <em>Mở bộ đọc bóc tách →</em>
        </button>
      </div>

      <div className="import-choice-note">
        <b>Gợi ý:</b> Nếu file là báo giá từng gửi khách, chọn <b>Báo giá cũ / công trình cũ</b> để SmartQuote bỏ qua hạng mục và tổng nhóm. Nếu là bảng giá sạch từ nhà cung cấp, chọn <b>Bảng giá nhà cung cấp</b>.
      </div>
    </div>
  );
}


function PlanBanner({ billing, productsCount, onUpgrade, onRefresh }) {
  if (!billing) return null;
  const productLimit = billing.limits?.products;
  const productPct = productLimit && productLimit !== Infinity ? Math.min(100, Math.round((productsCount / productLimit) * 100)) : 0;
  const trialText = billing.plan === "trial"
    ? billing.trialDaysLeft == null
      ? "Trial 14 ngày"
      : billing.trialDaysLeft > 0
        ? `Trial còn ${billing.trialDaysLeft} ngày`
        : "Trial đã hết hạn"
    : billing.subscriptionStatus === "active"
      ? "Đang hoạt động"
      : billing.subscriptionStatus;

  return (
    <div className={`plan-banner ${billing.locked ? "danger" : billing.plan === "trial" ? "trial" : ""}`}>
      <div>
        <strong>{billing.label}</strong>
        <span>{trialText}</span>
        {productLimit !== Infinity && productLimit != null && <span>Catalog {formatLimit(productsCount)}/{formatLimit(productLimit)}</span>}
        {productLimit !== Infinity && productLimit != null && <span className="plan-meter"><i style={{ width: `${productPct}%` }} /></span>}
      </div>
      <div className="plan-banner-actions">
        <button className="btn-ghost" onClick={onRefresh}>Cập nhật quota</button>
        <button className="btn-primary" style={{ width: "auto" }} onClick={onUpgrade}>{billing.locked ? "Gia hạn / nâng cấp" : "Xem gói"}</button>
      </div>
    </div>
  );
}

function UpgradePage({ billing, usage = {}, cloud, locked = false, onBack }) {
  const current = billing || normalizeBilling({ dealer: { plan: "trial" }, usage });

  const [billingCycle, setBillingCycle] = useState("monthly");
  const [modalPlan, setModalPlan] = useState(null);        // gói đang mở modal nâng cấp
  const [customerContact, setCustomerContact] = useState("");
  const [customerNote, setCustomerNote] = useState("");
  const [billingRequests, setBillingRequests] = useState([]);
  const [requestBusy, setRequestBusy] = useState(false);
  const [requestStatus, setRequestStatus] = useState("");

  const supportContact = (import.meta.env.VITE_SQ_SUPPORT_CONTACT || "Zalo / Hotline SmartQuote").trim();
  const paymentBank = (import.meta.env.VITE_SQ_PAYMENT_BANK || "—").trim();
  const paymentAccount = (import.meta.env.VITE_SQ_PAYMENT_ACCOUNT || "").trim();
  const paymentOwner = (import.meta.env.VITE_SQ_PAYMENT_OWNER || "").trim();

  const reloadBillingRequests = async () => {
    if (!cloud?.enabled || !cloud?.dealerId) return;
    try { setBillingRequests(await listBillingEvents(cloud.dealerId)); }
    catch (e) { console.error(e); setRequestStatus(e.message || "Không tải được lịch sử."); }
  };
  useEffect(() => { reloadBillingRequests(); }, [cloud?.enabled, cloud?.dealerId]);

  const latestPending = billingRequests.find((r) => ["pending", "paid"].includes(String(r.status || "").toLowerCase()));

  const submitUpgradeRequest = async (plan) => {
    if (!cloud?.enabled || !cloud?.dealerId) { notify.warning("Cần đăng nhập Cloud trước khi nâng gói."); return; }
    const amount = getPlanPriceVnd(plan, billingCycle);
    setRequestBusy(true); setRequestStatus("Đang tạo yêu cầu…");
    try {
      const request = await requestManualUpgrade(cloud.dealerId, { plan, billingCycle, customerContact, customerNote });
      await reloadBillingRequests();
      await cloud?.refreshBilling?.();
      setModalPlan(null);
      setRequestStatus(`Đã tạo yêu cầu. Nội dung chuyển khoản: ${request?.transfer_content || "xem lịch sử bên dưới"}.`);
      notify.success(`Đã tạo yêu cầu nâng gói.\n\nSố tiền: ${formatVnd(request?.amount_vnd || amount)}\nNội dung CK: ${request?.transfer_content || "xem lịch sử"}\n\nGói sẽ được bật ngay khi xác nhận đã nhận tiền.`);
    } catch (e) {
      console.error(e); setRequestStatus(e.message || "Không tạo được yêu cầu."); notify.error(e.message || "Không tạo được yêu cầu.");
    } finally { setRequestBusy(false); }
  };

  // Các mục sử dụng có thanh tiến độ (bỏ products/seats vì không đếm theo tháng)
  const meterKeys = ["quotes_per_month", "ai_claude_request", "pdf_extract", "excel_export", "web_scrape", "product_enrich"];
  const isUnlimited = (v) => v === -1 || v === Infinity || v == null;

  // Vài điểm nổi bật cho mỗi thẻ (không liệt kê hết)
  const highlights = (plan) => {
    const s = PLAN_LIMITS[plan]; const caps = PLAN_CAPABILITIES[plan] || {};
    const rows = [
      { on: true, text: `${formatLimit(s.products)} sản phẩm · ${formatLimit(s.seats)} người dùng` },
      { on: true, text: `${formatLimit(s.quotes_per_month)} báo giá/tháng` },
    ];
    const capOrder = ["ai_import", "quote_variants_abc", "bom_import", "price_intelligence", "api_access", "priority_support"];
    const onCaps = capOrder.filter((c) => caps[c]);
    onCaps.slice(0, 3).forEach((c) => rows.push({ on: true, text: CAPABILITY_LABELS[c] || c }));
    // gợi ý 1 tính năng bị thiếu để thấy đường nâng cấp
    const missing = ["quote_variants_abc", "bom_import"].find((c) => !caps[c]);
    if (missing && plan !== "business") rows.push({ on: false, text: CAPABILITY_LABELS[missing] || missing });
    return rows;
  };

  const planCards = PLAN_ORDER.filter((p) => p !== "trial");

  return (
    <div className="plan-page">
      {/* HEADER */}
      <div className="pp-head">
        <div>
          <h1>Gói &amp; Sử dụng</h1>
          <p>Xem mức dùng tháng này và nâng gói khi cần thêm sản phẩm, báo giá hay tính năng.</p>
        </div>
        <button className="pp-back" onClick={onBack}>← Quay lại app</button>
      </div>

      {/* KHOÁ WORKSPACE (nếu có) */}
      {(locked || current.locked) && (
        <div className="pp-locked">{current.lockReason || "Workspace cần gia hạn để tiếp tục dùng đầy đủ."}</div>
      )}

      {/* GÓI HIỆN TẠI + MỨC DÙNG */}
      <div className="pp-current">
        <div className="pp-current-top">
          <div>
            <div className="pp-lbl">Gói hiện tại</div>
            <div className="pp-plan">{PLAN_LIMITS[current.plan]?.label || current.plan}</div>
          </div>
          <div className="pp-renew">Chu kỳ {current.billingCycle === "annual" ? "theo năm" : "theo tháng"}</div>
        </div>
        <div className="pp-meters">
          {meterKeys.map((key) => {
            const limit = current.limits?.[key];
            const used = Number(usage?.[key] || 0);
            const unlimited = isUnlimited(limit);
            const pct = unlimited ? 100 : Math.min(100, Math.round((used / Math.max(1, limit)) * 100));
            const warn = !unlimited && pct >= 80;
            return (
              <div className={`pp-meter ${unlimited ? "unlimited" : ""}`} key={key}>
                <div className="pp-meter-top">
                  <span>{FEATURE_LABELS[key] || key}</span>
                  <b>{unlimited ? "Không giới hạn" : `${used.toLocaleString("vi-VN")} / ${limit.toLocaleString("vi-VN")}`}</b>
                </div>
                <div className={`pp-bar ${warn ? "warn" : ""}`}><i style={{ width: `${pct}%` }} /></div>
              </div>
            );
          })}
        </div>
      </div>

      {/* CHU KỲ */}
      <div className="pp-cycle-row">
        <div className="pp-cycle">
          <button className={billingCycle === "monthly" ? "active" : ""} onClick={() => setBillingCycle("monthly")}>Theo tháng</button>
          <button className={billingCycle === "annual" ? "active" : ""} onClick={() => setBillingCycle("annual")}>
            Theo năm<span className="pp-save">tặng 2 tháng</span>
          </button>
        </div>
      </div>

      {/* BẢNG GIÁ */}
      <div className="pp-grid">
        {planCards.map((plan) => {
          const spec = PLAN_LIMITS[plan];
          const isCurrent = current.plan === plan;
          const amount = getPlanPriceVnd(plan, billingCycle);
          const annual = getPlanPriceVnd(plan, "annual");
          const popular = plan === "pro";
          return (
            <div className={`pp-card ${popular ? "popular" : ""}`} key={plan}>
              {popular && <span className="pp-badge">Phổ biến nhất</span>}
              {isCurrent && <span className="pp-badge cur">Đang dùng</span>}
              <h3>{spec.label}</h3>
              <div className="pp-tag">{PLAN_TAGLINES[plan] || ""}</div>
              <div className="pp-price">
                <span className="pp-num">{plan === "free" ? "0đ" : formatVnd(amount)}</span>
                {plan !== "free" && <span className="pp-per">/{billingCycle === "annual" ? "năm" : "tháng"}</span>}
              </div>
              <div className="pp-price-sub">
                {plan === "free" ? "Dùng vĩnh viễn" : billingCycle === "annual" ? "Tiết kiệm ~2 tháng" : `hoặc ${formatVnd(annual)}/năm`}
              </div>
              <ul className="pp-feats">
                {highlights(plan).map((f, i) => (
                  <li className={f.on ? "" : "off"} key={i}>{f.on ? "✓" : "✕"} {f.text}</li>
                ))}
              </ul>
              {plan === "free" ? (
                <button className="pp-cta ghost" disabled>{isCurrent ? "Đang dùng Free" : "Gói miễn phí"}</button>
              ) : (
                <button className={`pp-cta ${isCurrent ? "ghost" : "primary"}`} onClick={() => setModalPlan(plan)}>
                  {isCurrent ? "Gia hạn gói này" : `Nâng lên ${spec.label}`}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {requestStatus && <div className="pp-status">{requestStatus}</div>}

      {/* THANH TOÁN + LỊCH SỬ (gấp lại) */}
      <details className="pp-more">
        <summary>Thông tin thanh toán &amp; lịch sử <span className="pp-chev">⌄</span></summary>
        <div className="pp-more-body">
          <div className="pp-pay">
            <div><div className="k">Chuyển khoản</div>{paymentBank}</div>
            {paymentAccount && <div><div className="k">Số tài khoản</div>{paymentAccount}</div>}
            {paymentOwner && <div><div className="k">Chủ tài khoản</div>{paymentOwner}</div>}
            <div><div className="k">Hỗ trợ</div>{supportContact}</div>
          </div>
          {latestPending && <div className="pp-note">Nội dung chuyển khoản của bạn: <b>{latestPending.transfer_content}</b></div>}
          <div className="pp-hist-head">
            <span>Lịch sử nâng gói</span>
            <button className="pp-back" onClick={reloadBillingRequests}>Tải lại</button>
          </div>
          {billingRequests.length === 0 ? (
            <div className="pp-note">Chưa có yêu cầu nâng gói nào.</div>
          ) : (
            <div className="pp-hist">
              {billingRequests.map((r) => (
                <div className="pp-hist-row" key={r.id}>
                  <div>
                    <b>{PLAN_LIMITS[r.plan]?.label || r.plan} · {r.billing_cycle === "annual" ? "theo năm" : "theo tháng"}</b>
                    <span>{new Date(r.created_at).toLocaleString("vi-VN")} · {r.transfer_content}</span>
                  </div>
                  <div className="pp-hist-right">
                    <b>{formatVnd(r.amount_vnd)}</b>
                    <i className={`pp-st ${String(r.status).toLowerCase()}`}>{r.status}</i>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </details>

      {/* MODAL NÂNG CẤP */}
      {modalPlan && (
        <div className="pp-modal-bg" onClick={() => !requestBusy && setModalPlan(null)}>
          <div className="pp-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Nâng lên {PLAN_LIMITS[modalPlan]?.label || modalPlan}</h3>
            <div className="pp-modal-price">
              {formatVnd(getPlanPriceVnd(modalPlan, billingCycle))} <span>/{billingCycle === "annual" ? "năm" : "tháng"}</span>
            </div>
            <div className="pp-cycle" style={{ margin: "12px 0" }}>
              <button className={billingCycle === "monthly" ? "active" : ""} onClick={() => setBillingCycle("monthly")}>Theo tháng</button>
              <button className={billingCycle === "annual" ? "active" : ""} onClick={() => setBillingCycle("annual")}>Theo năm</button>
            </div>
            <input value={customerContact} onChange={(e) => setCustomerContact(e.target.value)} placeholder="Số Zalo / điện thoại liên hệ" />
            <input value={customerNote} onChange={(e) => setCustomerNote(e.target.value)} placeholder="Ghi chú (ví dụ: đã chuyển khoản lúc 10:30)" />
            <div className="pp-modal-actions">
              <button className="pp-cta ghost" disabled={requestBusy} onClick={() => setModalPlan(null)}>Huỷ</button>
              <button className="pp-cta primary" disabled={requestBusy} onClick={() => submitUpgradeRequest(modalPlan)}>
                {requestBusy ? "Đang tạo…" : "Tạo yêu cầu nâng gói"}
              </button>
            </div>
            <div className="pp-note" style={{ marginTop: 10 }}>Hệ thống tạo nội dung chuyển khoản riêng để đối soát. Gói bật ngay khi xác nhận đã nhận tiền.</div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// TAB 1 — Tạo báo giá
// ============================================================
function QuoteBuilder({ products, setProducts, productById, templates, solutionFamilies = [], company, markups, rooms, setRooms, defaultRooms, customer, setCustomer, activeQuoteId, setActiveQuoteId, cloud, onUpgrade, quoteTemplateConfig, createRequest = 0 }) {
  const [pickerRoomId, setPickerRoomId] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [editingLine, setEditingLine] = useState(null); // {roomId, line} đang đổi thiết bị
  const [quoteList, setQuoteList] = useState([]);
  const [quoteListLoading, setQuoteListLoading] = useState(false);
  const [quoteSaving, setQuoteSaving] = useState(false);
  const [quoteListOpen, setQuoteListOpen] = useState(false);
  const [quoteManageOpen, setQuoteManageOpen] = useState(false);
  const [quoteStatus, setQuoteStatus] = useState("draft");
  const [solutionModalOpen, setSolutionModalOpen] = useState(false);
  const lastCreateRequestRef = useRef(createRequest);
  const excelQuoteTemplates = useMemo(() => normalizeExcelQuoteTemplates(company?.excelQuoteTemplates), [company?.excelQuoteTemplates]);
  const defaultExcelTemplateId = company?.defaultExcelQuoteTemplateId
    || excelQuoteTemplates.find((t) => t.isActive)?.id
    || excelQuoteTemplates[0]?.id
    || "";
  const [selectedExcelTemplateId, setSelectedExcelTemplateId] = useState(defaultExcelTemplateId);
  const activeExcelTemplate = excelQuoteTemplates.find((t) => t.id === selectedExcelTemplateId)
    || excelQuoteTemplates.find((t) => t.id === defaultExcelTemplateId)
    || excelQuoteTemplates[0]
    || null;

  useEffect(() => {
    const selectedStillExists = excelQuoteTemplates.some((t) => t.id === selectedExcelTemplateId);
    if (!selectedStillExists) setSelectedExcelTemplateId(defaultExcelTemplateId);
  }, [selectedExcelTemplateId, defaultExcelTemplateId, excelQuoteTemplates]);

  // Giá niêm yết gốc của 1 thiết bị (chưa nhân hệ số):
  // - Lumi: costPrice (giá niêm yết)
  // - Cổng (fixed): listPrice (giá bán lẻ cố định)
  const listPriceOf = (p) => {
    if (!p) return 0;
    return p.priceMode === "fixed" ? (p.listPrice || 0) : (p.costPrice || 0);
  };

  // Giá bán 1 dòng = giá niêm yết × hệ số riêng của dòng (factor). Mặc định factor = 1.
  // Hàng cổng (fixed) luôn giữ giá bán lẻ, không nhân (factor ép = 1).
  const lineSalePrice = (p, line) => {
    if (!p) return 0;
    const base = listPriceOf(p);
    if (p.priceMode === "fixed") return base;
    const f = line?.factor || 1;
    return Math.round((base * f) / 1000) * 1000;
  };

  // Tạo thiết bị mới ngay tại chỗ (từ ô tìm trong báo giá) + thêm luôn vào phòng đang chọn
  const createProductAndAdd = (roomId, draft) => {
    if (!guardProductCount(cloud, products.length + 1, onUpgrade)) return;
    const newProduct = {
      id: uid("p"),
      name: draft.name.trim(),
      sku: draft.sku.trim(),
      category: draft.category?.trim() || "",
      supplier: draft.supplier?.trim() || "",
      unit: draft.unit?.trim() || "Cái",
      costPrice: draft.costPrice || 0,
      priceMode: "markup",
      specs: draft.specs?.trim() || "",
      image: draft.image?.trim() || "",
    };
    setProducts((ps) => [...ps, newProduct]); // lưu vào danh mục để lần sau dùng lại
    addProductToRoom(roomId, newProduct.id);  // thêm ngay vào báo giá
  };

  // Đổi thiết bị của 1 dòng (vd Luto → Lumes), giữ nguyên số lượng và hệ số
  const swapLineProduct = (roomId, lineId, newProductId) => {
    setRooms((r) =>
      r.map((room) =>
        room.id === roomId
          ? { ...room, lines: room.lines.map((l) => (l.id === lineId ? { ...l, productId: newProductId } : l)) }
          : room
      )
    );
    setEditingLine(null);
  };

  // Đặt hệ số riêng cho 1 dòng
  const setLineFactor = (roomId, lineId, factor) =>
    setRooms((r) =>
      r.map((room) =>
        room.id === roomId
          ? { ...room, lines: room.lines.map((l) => (l.id === lineId ? { ...l, factor } : l)) }
          : room
      )
    );

  // Cập nhật ghi chú phân bổ tầng cho 1 dòng (vd "Tầng 1: 10, Tầng 2: 7")
  const setLineNote = (roomId, lineId, note) =>
    setRooms((r) =>
      r.map((room) =>
        room.id === roomId
          ? { ...room, lines: room.lines.map((l) => (l.id === lineId ? { ...l, note } : l)) }
          : room
      )
    );

  const addRoom = () => {
    const idx = rooms.length + 1;
    const name = `Phòng ${idx}`;
    setRooms((r) => [...r, { id: uid("room"), name, lines: [] }]);
  };
  const removeRoom = (roomId) => setRooms((r) => r.filter((x) => x.id !== roomId));
  const renameRoom = (roomId, name) =>
    setRooms((r) => r.map((x) => (x.id === roomId ? { ...x, name } : x)));

  // Tạo báo giá mới: reset về phòng mặc định
  const newQuote = async () => {
    if (rooms.some((r) => r.lines.length > 0)) {
      if (!(await confirmAction({ title: "Tạo báo giá mới?", message: "Nội dung báo giá hiện tại sẽ được xóa khỏi màn hình.", confirmLabel: "Tạo báo giá mới", tone: "danger" }))) return;
    }
    setRooms(defaultRooms());
    setCustomer({ name: "", phone: "", address: "", project: "" });
    setActiveQuoteId(null);
    setQuoteStatus("draft");
  };

  useEffect(() => {
    if (!createRequest || createRequest === lastCreateRequestRef.current) return;
    lastCreateRequestRef.current = createRequest;
    newQuote();
  }, [createRequest]);

  const applyTemplate = (roomId, tplId) => {
    const tpl = templates.find((t) => t.id === tplId);
    if (!tpl) return;
    setRooms((r) =>
      r.map((room) => {
        if (room.id !== roomId) return room;
        const lines = [...room.lines];
        tpl.items.forEach((it) => {
          const existing = lines.find((l) => l.productId === it.productId);
          if (existing) existing.qty += it.qty;
          else lines.push({ id: uid("ln"), productId: it.productId, qty: it.qty, note: "" });
        });
        return { ...room, lines };
      })
    );
  };

  const addProductToRoom = (roomId, productId) => {
    setRooms((r) =>
      r.map((room) => {
        if (room.id !== roomId) return room;
        const existing = room.lines.find((l) => l.productId === productId);
        if (existing)
          return { ...room, lines: room.lines.map((l) => (l.productId === productId ? { ...l, qty: l.qty + 1 } : l)) };
        return { ...room, lines: [...room.lines, { id: uid("ln"), productId, qty: 1, note: "" }] };
      })
    );
  };

  const applySolutionFamily = (family, mode = "append") => {
    const { room, resolved } = makeSolutionFamilyRoom(family, products);
    if (!room.lines.length) {
      notify.warning("Bộ giải pháp này chưa match được sản phẩm nào trong danh mục. Hãy cấu hình brand/sản phẩm hoặc import catalog trước.");
      return;
    }
    setRooms((prev) => {
      if (mode === "replace") return [room];
      if (prev.length === 1 && (!prev[0].lines || prev[0].lines.length === 0)) return [room];
      return [...prev, room];
    });
    setActiveQuoteId(null);
    setSolutionModalOpen(false);
    if (resolved.missing > 0) {
      notify.success(`Đã tạo bộ ${resolved.family.name} với ${resolved.matched} dòng. Còn ${resolved.missing} nhóm chưa tìm thấy sản phẩm trong danh mục.`);
    }
  };

  const setQty = (roomId, lineId, qty) =>
    setRooms((r) =>
      r.map((room) =>
        room.id === roomId
          ? { ...room, lines: room.lines.map((l) => (l.id === lineId ? { ...l, qty: Math.max(0, qty) } : l)) }
          : room
      )
    );

  const removeLine = (roomId, lineId) =>
    setRooms((r) =>
      r.map((room) => (room.id === roomId ? { ...room, lines: room.lines.filter((l) => l.id !== lineId) } : room))
    );

  // Di chuyển dòng lên (-1) hoặc xuống (+1) trong danh sách
  const moveLine = (roomId, lineId, dir) =>
    setRooms((r) =>
      r.map((room) => {
        if (room.id !== roomId) return room;
        const lines = [...room.lines];
        const idx = lines.findIndex((l) => l.id === lineId);
        const newIdx = idx + dir;
        if (newIdx < 0 || newIdx >= lines.length) return room;
        [lines[idx], lines[newIdx]] = [lines[newIdx], lines[idx]];
        return { ...room, lines };
      })
    );

  // ---- Tính toán tổng tiền ----
  const calc = useMemo(() => {
    let deviceTotal = 0;
    let pointCount = 0;
    rooms.forEach((room) => {
      room.lines.forEach((l) => {
        const p = productById[l.productId];
        if (!p) return;
        deviceTotal += lineSalePrice(p, l) * l.qty;
        pointCount += l.qty;
      });
    });
    const laborTotal = Math.round((deviceTotal * (company.laborPercent || 0)) / 100);
    const grand = deviceTotal + laborTotal;
    return { deviceTotal, pointCount, laborTotal, grand };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rooms, productById, company]);

  const grossMarginPct = useMemo(() => {
    let baseTotal = 0;
    rooms.forEach((room) => {
      room.lines.forEach((l) => {
        const p = productById[l.productId];
        if (!p) return;
        baseTotal += listPriceOf(p) * l.qty;
      });
    });
    if (!calc.deviceTotal || calc.deviceTotal <= 0) return 0;
    return Math.max(0, Math.round(((calc.deviceTotal - baseTotal) / calc.deviceTotal) * 100));
  }, [rooms, productById, calc.deviceTotal]);

  const currentQuoteTitle = activeQuoteId ? `Đang mở báo giá cloud` : "Báo giá chưa lưu";

  const reloadQuotes = async () => {
    if (!cloud?.enabled || !cloud.dealerId) return;
    setQuoteListLoading(true);
    try {
      const rows = await listCloudQuotes(cloud.dealerId, { limit: 50 });
      setQuoteList(rows);
    } catch (error) {
      console.error(error);
      notify.error(error.message || "Không tải được danh sách báo giá.");
    } finally {
      setQuoteListLoading(false);
    }
  };

  useEffect(() => {
    setQuoteStatus("draft");
    if (!cloud?.enabled || !cloud.dealerId) {
      setQuoteList([]);
      setQuoteListOpen(false);
      return;
    }
    reloadQuotes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloud?.enabled, cloud?.dealerId]);

  const buildQuoteSnapshot = ({ asCopy = false } = {}) => ({
    id: asCopy ? null : activeQuoteId,
    customer: {
      ...customer,
      quoteNumber: asCopy && customer.quoteNumber ? `${customer.quoteNumber}-COPY` : (customer.quoteNumber || ""),
    },
    rooms,
    calc,
    status: quoteStatus || "draft",
  });

  const openQuoteRecord = async (quote) => {
    if (!quote) return;
    if (rooms.some((r) => r.lines?.length > 0) && !(await confirmAction({ title: "Mở báo giá đã lưu?", message: "Nội dung đang chỉnh sửa trên màn hình sẽ được thay bằng báo giá bạn chọn.", confirmLabel: "Mở báo giá" }))) return;
    setActiveQuoteId(quote.id);
    setCustomer({
      name: quote.customer?.name || quote.customer_name || "",
      phone: quote.customer?.phone || quote.customer_phone || "",
      address: quote.customer?.address || quote.customer_address || "",
      project: quote.customer?.project || quote.project_name || "",
      quoteNumber: quote.customer?.quoteNumber || quote.quote_number || "",
      category: quote.customer?.category || quote.category || "",
      customerId: quote.customer?.customerId || quote.customer_id || null,
    });
    setRooms(Array.isArray(quote.rooms) && quote.rooms.length ? quote.rooms : defaultRooms());
    setQuoteStatus(quote.status || "draft");
    setQuoteListOpen(false);
  };

  const saveCurrentQuote = async ({ asCopy = false } = {}) => {
    if (!cloud?.enabled || !cloud.dealerId) {
      notify.warning("Lưu báo giá cloud chỉ khả dụng khi đăng nhập SmartQuote Cloud.");
      return;
    }
    if (calc.pointCount === 0) {
      notify.warning("Chưa có thiết bị nào để lưu báo giá.");
      return;
    }
    const isNewQuote = asCopy || !activeQuoteId;
    if (isNewQuote && !guardFeature(cloud, "quotes_per_month", 1, onUpgrade)) return;
    setQuoteSaving(true);
    try {
      const savedId = await saveCloudQuote(cloud.dealerId, buildQuoteSnapshot({ asCopy }));
      setActiveQuoteId(savedId);
      await Promise.all([reloadQuotes(), cloud?.refreshBilling?.()]);
      notify.success(asCopy ? "Đã lưu bản sao báo giá." : "Đã lưu báo giá cloud.");
    } catch (error) {
      console.error(error);
      const msg = error.message || "Không lưu được báo giá.";
      if (/quota|trial|expired|hết hạn|vượt/i.test(msg) && typeof onUpgrade === "function") {
        if (await confirmAction({ title: "Cần nâng gói", message: buildUpgradeMessage(msg), confirmLabel: "Xem gói" })) onUpgrade();
      } else {
        notify.info(msg);
      }
    } finally {
      setQuoteSaving(false);
    }
  };

  const deleteQuoteRecord = async (quote) => {
    if (!quote?.id || !cloud?.dealerId) return;
    if (!(await confirmAction({ title: "Xóa báo giá?", message: `Bạn sắp xóa ${quote.quote_number || quote.customer_name || "báo giá này"}. Hành động này không thể hoàn tác.`, confirmLabel: "Xóa báo giá", tone: "danger" }))) return;
    try {
      await deleteCloudQuote(cloud.dealerId, quote.id);
      if (activeQuoteId === quote.id) {
        setActiveQuoteId(null);
        setRooms(defaultRooms());
        setCustomer({ name: "", phone: "", address: "", project: "" });
        setQuoteStatus("draft");
      }
      await reloadQuotes();
    } catch (error) {
      console.error(error);
      notify.error(error.message || "Không xóa được báo giá.");
    }
  };

  // Phase 12.5 — một đường xuất Excel duy nhất.
  // Có template => fill trực tiếp quote hiện tại vào template lossless.
  // Không có template => mới dùng workbook generic của SmartQuote.
  // Nếu template export lỗi, tuyệt đối không fallback âm thầm sang generic vì sẽ làm mất fidelity.
  const exportExcel = async () => {
    if (calc.pointCount === 0) {
      notify.warning("Chưa có thiết bị nào để xuất báo giá.");
      return;
    }
    if (!guardFeature(cloud, "excel_export", 1, onUpgrade)) return;
    setExporting(true);
    try {
      if (activeExcelTemplate) {
        await exportQuoteExcelWithTemplate({
          template: activeExcelTemplate,
          company,
          customer,
          rooms,
          productById,
          lineSalePrice,
          calc,
        });
      } else {
        await exportQuoteExcel({ company, customer, rooms, productById, lineSalePrice, calc });
      }
      cloud?.refreshBilling?.();
    } catch (e) {
      console.error(e);
      notify.error(e.message || (activeExcelTemplate
        ? "Không xuất được Excel theo mẫu. Kiểm tra mapping rồi thử lại."
        : "Có lỗi khi xuất Excel. Thử lại nhé."));
    } finally {
      setExporting(false);
    }
  };

  const exportPDF = () => {
    if (calc.pointCount === 0) {
      notify.warning("Chưa có thiết bị nào để xuất báo giá.");
      return;
    }
    const brandCapability = canAccessCapability(cloud?.billing, "branded_pdf");
    const html = buildQuotePrintHTML({
      company, customer, rooms, productById, lineSalePrice, calc, quoteTemplateConfig,
      watermark: cloud?.enabled && !brandCapability.ok,
    });
    const w = window.open("", "_blank");
    if (!w) {
      notify.warning("Trình duyệt chặn cửa sổ in. Cho phép pop-up rồi thử lại.");
      return;
    }
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 500);
  };

  const markupLabel = "";

  return (
    <div className="quote-grid">
      <div className="quote-main">
        {cloud?.enabled && (
          <section className="quote-manage-card quote-manage-bar">
            <div className="quote-manage-head">
              <div>
                <h2>Quản lý báo giá</h2>
                <p>{currentQuoteTitle}{activeQuoteId ? ` · ${activeQuoteId.slice(0, 8)}` : ""}</p>
              </div>
              <button
                className="btn-ghost quote-manage-toggle"
                onClick={() => { setQuoteManageOpen(!quoteManageOpen); if (!quoteManageOpen) reloadQuotes(); }}
                aria-expanded={quoteManageOpen}
              >
                ⋯ Quản lý
              </button>
            </div>
            {quoteManageOpen && (
              <div className="quote-manage-body">
                <div className="quote-manage-actions">
                  <label className="quote-status-field">
                    <span>Trạng thái</span>
                    <select className="quote-status-select" value={quoteStatus} onChange={(e) => setQuoteStatus(e.target.value)}>
                      <option value="draft">Nháp</option>
                      <option value="sent">Đã gửi</option>
                      <option value="won">Đã chốt</option>
                      <option value="lost">Thua</option>
                    </select>
                  </label>
                  <button className="btn-ghost" onClick={() => { setQuoteListOpen(!quoteListOpen); if (!quoteListOpen) reloadQuotes(); }}>
                    {quoteListOpen ? "Ẩn báo giá cũ" : "Mở báo giá cũ"}
                  </button>
                  <button className="btn-ghost" disabled={quoteSaving || calc.pointCount === 0} onClick={() => saveCurrentQuote({ asCopy: true })}>Lưu bản sao</button>
                </div>
                <div className="quote-cloud-meta">
                  <span>Quota báo giá tháng này: {formatLimit(cloud?.billing?.usage?.quotes_per_month || 0)} / {formatLimit(billingLimit(cloud?.billing, "quotes_per_month"))}</span>
                  <span>{quoteList.length} báo giá gần nhất</span>
                </div>
                {quoteListOpen && (
                  <QuoteListPanel
                    quotes={quoteList}
                    loading={quoteListLoading}
                    activeQuoteId={activeQuoteId}
                    onOpen={openQuoteRecord}
                    onRefresh={reloadQuotes}
                    onDelete={deleteQuoteRecord}
                  />
                )}
              </div>
            )}
          </section>
        )}

        {/* Thông tin khách hàng */}
        <section className="card">
          <h2>Thông tin khách hàng</h2>
          <div className="field-grid">
            <Field label="Tên khách hàng / Công trình" value={customer.name} onChange={(v) => setCustomer({ ...customer, name: v })} />
            <Field label="Số điện thoại" value={customer.phone} onChange={(v) => setCustomer({ ...customer, phone: v })} />
            <Field label="Tên công trình" value={customer.project} onChange={(v) => setCustomer({ ...customer, project: v })} />
            <Field label="Địa điểm" value={customer.address} onChange={(v) => setCustomer({ ...customer, address: v })} />
            <Field label="Số báo giá" value={customer.quoteNumber || ""} onChange={(v) => setCustomer({ ...customer, quoteNumber: v })} />
            <Field label="Hạng mục" value={customer.category || ""} onChange={(v) => setCustomer({ ...customer, category: v })} />
          </div>
        </section>

        {/* Các phòng trong báo giá */}
        {rooms.map((room) => (
          <section className="card room-card" key={room.id}>
            <div className="room-head">
              <textarea className="room-name" rows={2} value={room.name} onChange={(e) => renameRoom(room.id, e.target.value)} />
              <div className="room-head-actions">
                <select
                  className="tpl-select"
                  value=""
                  onChange={(e) => { if (e.target.value) { applyTemplate(room.id, e.target.value); e.target.value = ""; } }}
                >
                  <option value="">+ Thêm gói…</option>
                  {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
                <button className="btn-ghost" onClick={() => setPickerRoomId(pickerRoomId === room.id ? null : room.id)}>
                  + Thêm thiết bị
                </button>
                {rooms.length > 1 && (
                  <button className="btn-ghost danger" onClick={() => removeRoom(room.id)}>Xóa</button>
                )}
              </div>
            </div>

            {pickerRoomId === room.id && (
              <ProductPicker
                products={products}
                priceOf={listPriceOf}
                onPick={(pid) => addProductToRoom(room.id, pid)}
                onCreate={(draft) => createProductAndAdd(room.id, draft)}
                onClose={() => setPickerRoomId(null)}
              />
            )}

            {room.lines.length === 0 ? (
              <p className="empty-hint">Chưa có thiết bị. Chọn “Thêm gói” để dùng combo dựng sẵn, hoặc “Thêm thiết bị” để chọn lẻ.</p>
            ) : (
              <table className="line-table">
                <thead>
                  <tr>
                    <th className="stt-col">STT</th>
                    <th className="note-col">Phòng / Phân bổ</th>
                    <th>Thiết bị</th>
                    <th className="num">Niêm yết</th>
                    <th className="num">Đơn giá</th>
                    <th className="num qty-col">SL</th>
                    <th className="num">Thành tiền</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {room.lines.map((l, lineIdx) => {
                    const p = productById[l.productId];
                    if (!p) return null;
                    const isFixed = p.priceMode === "fixed";
                    const base = listPriceOf(p);
                    const sp = lineSalePrice(p, l);
                    const f = l.factor || 1;
                    const missingPrice = base === 0; // chưa có giá

                    // Cập nhật giá vào catalog ngay khi người dùng gõ số
                    const updatePrice = (num) => {
                      if (!num || num <= 0) return;
                      setProducts((ps) => ps.map((x) => x.id === p.id ? { ...x, costPrice: num } : x));
                    };

                    return (
                      <tr key={l.id} className={missingPrice ? "row-missing-price" : ""}>
                        <td className="stt-col">
                          <div className="stt-cell">
                            <span className="stt-num">{lineIdx + 1}</span>
                            <div className="stt-move">
                              <button
                                className="move-btn"
                                title="Lên"
                                disabled={lineIdx === 0}
                                onClick={() => moveLine(room.id, l.id, -1)}
                              >▲</button>
                              <button
                                className="move-btn"
                                title="Xuống"
                                disabled={lineIdx === room.lines.length - 1}
                                onClick={() => moveLine(room.id, l.id, 1)}
                              >▼</button>
                            </div>
                          </div>
                        </td>
                        <td className="note-col">
                          <textarea
                            className="note-input"
                            value={l.note || ""}
                            onChange={(e) => setLineNote(room.id, l.id, e.target.value)}
                            rows={2}
                          />
                        </td>
                        <td>
                          <div className="ln-name">{p.name}</div>
                          <div className="ln-sku">{p.sku}{p.supplier ? ` · ${p.supplier}` : ""}</div>
                        </td>
                        <td className="num">
                          {missingPrice ? (
                            <div className="price-missing-cell">
                              <input
                                type="text" inputMode="numeric"
                                className="price-inline-input"
                                onChange={(e) => {
                                  const n = parseInt(e.target.value.replace(/\D/g,""),10);
                                  if(n>0) updatePrice(n);
                                }}
                                onKeyDown={(e) => { if(e.key==="Enter") e.target.blur(); }}
                              />
                              <span className="price-missing-hint">⚠ Chưa có giá</span>
                            </div>
                          ) : (
                            <span className="muted">{VND(base)}</span>
                          )}
                        </td>
                        <td className="num">
                          <div>{VND(sp)}</div>
                          {!isFixed && f !== 1 && <span className="muted hs-inline-note">×{f}</span>}
                        </td>
                        <td className="num qty-col">
                          <input type="text" inputMode="numeric" className="qty-input" value={l.qty}
                            onChange={(e) => setQty(room.id, l.id, parseInt(e.target.value.replace(/\D/g, "")) || 0)} />
                        </td>
                        <td className="num strong">{VND(sp * l.qty)}</td>
                        <td className="ln-actions">
                          <button className="ln-edit" title="Đổi thiết bị" onClick={() => setEditingLine({ roomId: room.id, line: l })}>✎</button>
                          <button className="x-btn" onClick={() => removeLine(room.id, l.id)}>×</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </section>
        ))}

        <div className="quote-actions-bottom">
          <button className="btn-solution-family" onClick={() => setSolutionModalOpen(true)}>⚡ Tạo từ bộ giải pháp</button>
          <button className="btn-add-room" onClick={addRoom}>+ Thêm phòng</button>
          <button className="btn-ghost" onClick={newQuote}>⟳ Báo giá mới</button>
        </div>
      </div>

      {/* Cột tổng kết bên phải */}
      <aside className="quote-side">
        <div className="card summary">
          <div className="s-body">
            <div className="s-lbl">Tổng báo giá</div>
            <div className="s-total num">{VND(calc.grand).replace("đ", "")}<small>đ</small></div>
            <div className="s-margin">▲ Lãi gộp {grossMarginPct}%</div>
            <div className="s-rows">
              <Row label={`Tiền hàng (${calc.pointCount} thiết bị)`} value={VND(calc.deviceTotal)} />
              <Row label={`Nhân công, lập trình (${company.laborPercent}%)`} value={VND(calc.laborTotal)} />
              <div className="s-row"><span>VAT (0%)</span><b>—</b></div>
              <div className="s-row big"><span>Tổng cộng</span><b className="num">{VND(calc.grand)}</b></div>
            </div>
            <div className="s-actions">
              <button className="btn-pdf" onClick={exportPDF}>Xuất PDF</button>
              <div className="row2">
                <button className="btn-ghost" disabled={exporting} onClick={exportExcel}>{exporting ? "Đang tạo…" : "Xuất Excel"}</button>
                {cloud?.enabled && (
                  <button className="btn-ghost" disabled={quoteSaving} onClick={() => saveCurrentQuote()}>
                    {quoteSaving ? "Đang lưu…" : "Lưu"}
                  </button>
                )}
              </div>
              {excelQuoteTemplates.length > 0 && (
                <div className="excel-template-export-box">
                  <label>Mẫu Excel dùng khi xuất</label>
                  <select value={activeExcelTemplate?.id || ""} onChange={(e) => setSelectedExcelTemplateId(e.target.value)}>
                    {excelQuoteTemplates.map((tpl) => <option key={tpl.id} value={tpl.id}>{tpl.name}{tpl.id === company?.defaultExcelQuoteTemplateId ? " · mặc định" : ""}</option>)}
                  </select>
                  <span className="excel-template-export-hint">Nút “Xuất Excel” sẽ điền dữ liệu báo giá hiện tại trực tiếp vào mẫu này.</span>
                </div>
              )}
            </div>
            <p className="side-note">
              PDF đang dùng mẫu <strong>{getQuoteTemplateLabel(quoteTemplateConfig?.presetId)}</strong>{activeExcelTemplate ? <> · Excel sẽ fill vào <strong>{activeExcelTemplate.name}</strong></> : <> · Excel dùng mẫu SmartQuote mặc định</>}. Máy tính tiền — người duyệt trước khi gửi khách.
            </p>
          </div>
        </div>
      </aside>

      {solutionModalOpen && (
        <SolutionFamilyApplyModal
          products={products}
          solutionFamilies={solutionFamilies}
          onApply={applySolutionFamily}
          onClose={() => setSolutionModalOpen(false)}
        />
      )}

      {/* Modal đổi thiết bị của 1 dòng */}
      {editingLine && (
        <LineProductSwap
          products={products}
          markups={markups}
          current={productById[editingLine.line.productId]}
          line={editingLine.line}
          onSetFactor={(factor) => setLineFactor(editingLine.roomId, editingLine.line.id, factor)}
          onSwap={(pid) => swapLineProduct(editingLine.roomId, editingLine.line.id, pid)}
          onClose={() => setEditingLine(null)}
        />
      )}
    </div>
  );
}


function SolutionFamilyApplyModal({ products, solutionFamilies = [], onApply, onClose }) {
  const families = useMemo(() => normalizeSolutionFamilies(solutionFamilies).filter((f) => f.isActive !== false), [solutionFamilies]);
  const [selectedId, setSelectedId] = useState(families[0]?.id || "");
  const selected = families.find((f) => f.id === selectedId) || families[0];
  const resolved = useMemo(() => selected ? resolveSolutionFamily(selected, products) : null, [selected, products]);

  useEffect(() => {
    if (!selectedId && families[0]?.id) setSelectedId(families[0].id);
  }, [families, selectedId]);

  if (!selected) {
    return (
      <div className="modal-backdrop" onClick={onClose}>
        <div className="modal solution-apply-modal" onClick={(e) => e.stopPropagation()}>
          <h2>Chưa có bộ giải pháp</h2>
          <p className="tab-intro">Vào Mẫu &amp; Gói → Bộ giải pháp để tạo bộ Lumi/Erfinden/Schneider trước.</p>
          <div className="modal-actions"><button className="btn-ghost" onClick={onClose}>Đóng</button></div>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal solution-apply-modal" onClick={(e) => e.stopPropagation()}>
        <div className="solution-modal-head">
          <div>
            <h2>Tạo báo giá từ bộ giải pháp</h2>
            <p>Chọn một phương án, SmartQuote sẽ lấy sản phẩm trong danh mục theo brand/fallback đã cấu hình.</p>
          </div>
          <button className="x-btn" onClick={onClose}>×</button>
        </div>
        <div className="solution-apply-grid">
          <div className="solution-apply-list">
            {families.map((family) => {
              const preview = resolveSolutionFamily(family, products);
              return (
                <button key={family.id} className={`solution-family-pick ${selected.id === family.id ? "active" : ""}`} onClick={() => setSelectedId(family.id)}>
                  <strong>{family.name}</strong>
                  <span>{family.primaryBrand || SOLUTION_SEGMENTS.find((s) => s.key === family.segment)?.label || "Bộ giải pháp"}</span>
                  <em>{preview.matched}/{preview.rows.length} nhóm có sản phẩm</em>
                </button>
              );
            })}
          </div>
          <div className="solution-apply-preview">
            <div className="solution-preview-title">
              <div>
                <h3>{selected.name}</h3>
                <p>{selected.description || "Map category → brand/product → fallback."}</p>
              </div>
              <span className={resolved?.missing ? "sf-badge warn" : "sf-badge ok"}>{resolved?.matched || 0}/{resolved?.rows?.length || 0} match</span>
            </div>
            <div className="solution-preview-rows">
              {resolved?.rows.map((row) => (
                <div key={row.item.id} className={`solution-preview-row ${row.product ? "" : "missing"}`}>
                  <div>
                    <strong>{row.categoryLabel}</strong>
                    <span>{row.item.preferredBrand || "Bất kỳ hãng"}{row.item.fallbackBrand ? ` → ${row.item.fallbackBrand}` : ""}</span>
                  </div>
                  <div className="solution-preview-product">
                    {row.product ? (
                      <>
                        <b>{row.product.name}</b>
                        <small>{row.product.sku || "Chưa có SKU"}{row.product.supplier ? ` · ${row.product.supplier}` : ""}</small>
                      </>
                    ) : (
                      <b>Chưa có sản phẩm phù hợp</b>
                    )}
                  </div>
                </div>
              ))}
            </div>
            {resolved?.missing > 0 && (
              <div className="solution-warning">Còn {resolved.missing} nhóm chưa tìm thấy sản phẩm. Bạn vẫn có thể tạo báo giá nháp, rồi bổ sung thủ công sau.</div>
            )}
            <div className="solution-modal-actions">
              <button className="btn-ghost" onClick={() => onApply(selected, "append")}>Thêm vào báo giá hiện tại</button>
              <button className="btn-primary" onClick={() => onApply(selected, "replace")}>Tạo báo giá mới từ bộ này</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SolutionFamilies({ products, solutionFamilies = [], setSolutionFamilies }) {
  const families = useMemo(() => normalizeSolutionFamilies(solutionFamilies), [solutionFamilies]);
  const [activeId, setActiveId] = useState(families[0]?.id || "");
  const active = families.find((f) => f.id === activeId) || families[0];
  const availableProducts = Array.isArray(products) ? products : [];

  useEffect(() => {
    if (!activeId && families[0]?.id) setActiveId(families[0].id);
    if (activeId && !families.some((f) => f.id === activeId) && families[0]?.id) setActiveId(families[0].id);
  }, [families, activeId]);

  const commit = (next) => setSolutionFamilies(normalizeSolutionFamilies(next));
  const updateFamily = (id, patch) => commit(families.map((f) => f.id === id ? { ...f, ...patch } : f));
  const updateItem = (familyId, itemId, patch) => commit(families.map((f) => f.id === familyId ? { ...f, items: f.items.map((it) => it.id === itemId ? { ...it, ...patch } : it) } : f));
  const addFamily = () => {
    const created = buildSolutionFamily("Bộ giải pháp mới", { description: "Cấu hình category → brand/product → fallback cho một phương án bán hàng.", primaryBrand: "" });
    commit([...families, created]);
    setActiveId(created.id);
  };
  const duplicateFamily = () => {
    if (!active) return;
    const copy = normalizeSolutionFamily({ ...active, id: uid("sf"), name: `${active.name} (bản sao)`, createdAt: new Date().toISOString(), items: active.items.map((it) => ({ ...it, id: uid("sfi") })) });
    commit([...families, copy]);
    setActiveId(copy.id);
  };
  const deleteFamily = async () => {
    if (!active || families.length <= 1) return notify.warning("Cần giữ ít nhất một bộ giải pháp.");
    if (!(await confirmAction({ title: "Xóa bộ giải pháp?", message: `Bạn sắp xóa “${active.name}”.`, confirmLabel: "Xóa", tone: "danger" }))) return;
    const next = families.filter((f) => f.id !== active.id);
    commit(next);
    setActiveId(next[0]?.id || "");
  };
  const resetSeeds = async () => {
    if (!(await confirmAction({ title: "Khôi phục bộ mẫu?", message: "Danh sách bộ giải pháp hiện tại sẽ bị ghi đè bằng bộ mẫu mặc định.", confirmLabel: "Khôi phục", tone: "danger" }))) return;
    const seeds = buildSeedSolutionFamilies();
    setSolutionFamilies(seeds);
    setActiveId(seeds[0]?.id || "");
  };

  const resolved = active ? resolveSolutionFamily(active, availableProducts) : null;

  return (
    <div className="solution-page">
      <section className="section-card solution-hero">
        <div className="section-card-head">
          <span>Bộ giải pháp / phương án theo hãng</span>
          <div className="solution-head-actions">
            <button className="btn-ghost" onClick={resetSeeds}>Khôi phục bộ mẫu</button>
            <button className="btn-primary" onClick={addFamily}>+ Tạo bộ mới</button>
          </div>
        </div>
        <div className="section-card-body">
          <p className="tab-intro" style={{ margin: 0 }}>
            Tạo các option như <strong>Bộ Lumi</strong>, <strong>Bộ Erfinden</strong>, <strong>Bộ Schneider</strong>, hoặc <strong>Tiết kiệm / Đề xuất / Cao cấp</strong>. Mỗi bộ map từng nhóm hạng mục sang brand hoặc sản phẩm cụ thể, có fallback khi hãng chính thiếu hàng.
          </p>
        </div>
      </section>

      <div className="solution-layout">
        <aside className="solution-list card">
          <div className="solution-list-title">Danh sách bộ</div>
          {families.map((family) => {
            const preview = resolveSolutionFamily(family, availableProducts);
            const segment = SOLUTION_SEGMENTS.find((s) => s.key === family.segment)?.label || "Theo hãng";
            return (
              <button key={family.id} className={`solution-card ${active?.id === family.id ? "active" : ""}`} onClick={() => setActiveId(family.id)}>
                <strong>{family.name}</strong>
                <span>{family.primaryBrand || segment}</span>
                <em>{preview.matched}/{preview.rows.length} nhóm match catalog</em>
              </button>
            );
          })}
        </aside>

        {active && (
          <section className="solution-editor card">
            <div className="solution-editor-head">
              <div>
                <h2>{active.name}</h2>
                <p>{resolved?.matched || 0}/{resolved?.rows?.length || 0} nhóm đang tìm được sản phẩm trong catalog.</p>
              </div>
              <div className="solution-editor-actions">
                <button className="btn-ghost" onClick={duplicateFamily}>Nhân bản</button>
                <button className="btn-ghost danger" onClick={deleteFamily}>Xóa</button>
              </div>
            </div>

            <div className="field-grid solution-meta-grid">
              <Field label="Tên bộ" value={active.name} onChange={(v) => updateFamily(active.id, { name: v })} />
              <Field label="Brand chính" value={active.primaryBrand || ""} onChange={(v) => updateFamily(active.id, { primaryBrand: v })} />
              <label className="field"><span>Phân khúc</span>
                <select value={active.segment || "brand"} onChange={(e) => updateFamily(active.id, { segment: e.target.value })}>
                  {SOLUTION_SEGMENTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                </select>
              </label>
              <label className="field"><span>Loại công trình</span>
                <select value={active.projectType || "villa"} onChange={(e) => updateFamily(active.id, { projectType: e.target.value })}>
                  <option value="villa">Villa</option>
                  <option value="apartment">Căn hộ</option>
                  <option value="townhouse">Nhà phố</option>
                  <option value="office">Văn phòng</option>
                </select>
              </label>
              <label className="field full"><span>Mô tả</span>
                <textarea rows={2} value={active.description || ""} onChange={(e) => updateFamily(active.id, { description: e.target.value })} />
              </label>
            </div>

            <div className="solution-matrix-head">
              <div>
                <h3>Ma trận nhóm → hãng/sản phẩm</h3>
                <p>Chọn product cụ thể nếu muốn cố định model. Nếu để trống, SmartQuote sẽ tự tìm theo brand chính rồi fallback.</p>
              </div>
              {resolved?.missing > 0 && <span className="sf-badge warn">Thiếu {resolved.missing} nhóm</span>}
            </div>
            <div className="solution-table-wrap">
              <table className="solution-table">
                <thead>
                  <tr>
                    <th>Bật</th>
                    <th>Nhóm</th>
                    <th>Brand chính</th>
                    <th>Fallback</th>
                    <th>Sản phẩm cố định</th>
                    <th>SL</th>
                    <th>Ghi chú</th>
                    <th>Match hiện tại</th>
                  </tr>
                </thead>
                <tbody>
                  {active.items.map((item) => {
                    const row = resolved?.rows.find((r) => r.item.id === item.id) || { product: null };
                    return (
                      <tr key={item.id} className={row.product ? "" : "missing"}>
                        <td><input type="checkbox" checked={item.enabled !== false} onChange={(e) => updateItem(active.id, item.id, { enabled: e.target.checked })} /></td>
                        <td><strong>{solutionCategoryLabel(item.categoryKey)}</strong></td>
                        <td><input value={item.preferredBrand || ""} onChange={(e) => updateItem(active.id, item.id, { preferredBrand: e.target.value })} placeholder="Lumi" /></td>
                        <td><input value={item.fallbackBrand || ""} onChange={(e) => updateItem(active.id, item.id, { fallbackBrand: e.target.value })} placeholder="Hikvision" /></td>
                        <td>
                          <select value={item.productId || ""} onChange={(e) => updateItem(active.id, item.id, { productId: e.target.value })}>
                            <option value="">Tự tìm theo brand</option>
                            {availableProducts.map((p) => <option key={p.id} value={p.id}>{p.name}{p.sku ? ` · ${p.sku}` : ""}</option>)}
                          </select>
                        </td>
                        <td><input className="qty-mini" type="number" min="1" value={item.qty || 1} onChange={(e) => updateItem(active.id, item.id, { qty: Math.max(1, Number(e.target.value || 1)) })} /></td>
                        <td><input value={item.note || ""} onChange={(e) => updateItem(active.id, item.id, { note: e.target.value })} /></td>
                        <td className="solution-match-cell">
                          {row.product ? (
                            <><b>{row.product.name}</b><span>{row.product.sku || "Chưa có SKU"}{row.source === "fallbackBrand" ? " · fallback" : ""}</span></>
                          ) : <span className="missing-text">Chưa match</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

// Modal đổi thiết bị cho 1 dòng (giữ nguyên SL & hệ số)
function LineProductSwap({ products, markups = [], current, line, onSetFactor, onSwap, onClose }) {
  const [q, setQ] = useState("");
  const filtered = products.filter(
    (p) => p.name.toLowerCase().includes(q.toLowerCase()) || (p.sku || "").toLowerCase().includes(q.toLowerCase())
  );
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Đổi thiết bị</h2>
        {current && (
          <p className="tab-intro" style={{ margin: "0 0 12px" }}>
            Đang chọn: <strong>{current.name}</strong> ({current.sku}). Chọn thiết bị thay thế bên dưới — số lượng giữ nguyên.
          </p>
        )}
        {current && current.priceMode !== "fixed" && (
          <div className="line-detail-factor">
            <label>
              <span>Hệ số riêng của dòng này</span>
              <input
                type="number"
                step="0.05"
                min="1"
                value={line?.factor || 1}
                onChange={(e) => onSetFactor?.(parseFloat(e.target.value) || 1)}
              />
            </label>
            <div className="hs-quick">
              {(markups.length ? markups : [{ id: "default", value: 1 }]).slice(0, 4).map((m) => {
                const factor = Number(m.value) > 0 ? Number(m.value) : 1;
                return <button key={m.id || factor} className={(line?.factor || 1) === factor ? "on" : ""} onClick={() => onSetFactor?.(factor)}>{factor}</button>;
              })}
            </div>
            <p>Chỉ chỉnh khi dòng này cần hệ số khác markup chung.</p>
          </div>
        )}
        <input className="search" autoFocus value={q} onChange={(e) => setQ(e.target.value)} style={{ width: "100%", marginBottom: 10 }} />
        <div className="swap-list">
          {filtered.slice(0, 30).map((p) => (
            <button key={p.id} className={`picker-item ${current && p.id === current.id ? "cur" : ""}`} onClick={() => onSwap(p.id)}>
              {p.image && <img src={imgSrc(p.image)} alt="" loading="lazy" className="pi-thumb" onError={(e)=>{e.currentTarget.style.display="none"}} />}
              <span className="pi-name">{p.name}</span>
              <span className="pi-meta">{p.sku}{p.supplier ? ` · ${p.supplier}` : ""}</span>
            </button>
          ))}
          {filtered.length === 0 && <div className="empty-hint">Không tìm thấy thiết bị.</div>}
        </div>
        <div className="modal-actions">
          <button className="btn-ghost" onClick={onClose}>Hủy</button>
        </div>
      </div>
    </div>
  );
}

function ProductPicker({ products, priceOf, onPick, onCreate, onClose }) {
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(null); // draft thiết bị mới đang tạo

  const filtered = products.filter(
    (p) => p.name.toLowerCase().includes(q.toLowerCase()) || (p.sku || "").toLowerCase().includes(q.toLowerCase())
  );

  const startCreate = () => {
    // Đoán: nếu chuỗi tìm trông giống mã (có gạch/chữ in hoa) thì điền vào ô mã, ngược lại điền tên
    const looksLikeSku = /[-/]/.test(q) || (q === q.toUpperCase() && /\d/.test(q));
    setCreating({
      name: looksLikeSku ? "" : q,
      sku: looksLikeSku ? q : "",
      category: "", supplier: "", unit: "Cái", costPrice: 0, specs: "", image: "",
    });
  };

  const submitCreate = () => {
    if (!creating.name.trim() && !creating.sku.trim()) {
      notify.warning("Nhập tên hoặc mã thiết bị.");
      return;
    }
    if (!creating.costPrice || creating.costPrice <= 0) {
      notify.warning("Nhập giá gốc của thiết bị.");
      return;
    }
    onCreate(creating);
    setCreating(null);
    setQ("");
  };

  // Đang ở chế độ tạo mới
  if (creating) {
    return (
      <div className="picker">
        <div className="picker-create-head">
          <strong>Thêm thiết bị mới vào danh mục</strong>
          <button className="btn-ghost" onClick={() => setCreating(null)}>← Quay lại</button>
        </div>
        <div className="picker-create-grid">
          <label className="field"><span>Tên thiết bị *</span>
            <input autoFocus value={creating.name} onChange={(e) => setCreating({ ...creating, name: e.target.value })} /></label>
          <label className="field"><span>Mã sản phẩm (SKU)</span>
            <input value={creating.sku} onChange={(e) => setCreating({ ...creating, sku: e.target.value })} /></label>
          <label className="field"><span>Nhóm thiết bị</span>
            <input value={creating.category} onChange={(e) => setCreating({ ...creating, category: e.target.value })} /></label>
          <label className="field"><span>Nhà cung cấp</span>
            <input value={creating.supplier} onChange={(e) => setCreating({ ...creating, supplier: e.target.value })} /></label>
          <label className="field"><span>Đơn vị tính</span>
            <input value={creating.unit} onChange={(e) => setCreating({ ...creating, unit: e.target.value })} /></label>
          <label className="field"><span>Giá niêm yết (đ) *</span>
            <input type="text" inputMode="numeric" value={creating.costPrice || ""} onChange={(e) => setCreating({ ...creating, costPrice: parseInt(e.target.value.replace(/\D/g,""),10)||0 })} /></label>
        </div>
        <label className="field" style={{ marginTop:10, display:"block" }}>
          <span>Thông số kỹ thuật (hiện trong báo giá PDF)</span>
          <textarea rows={2} className="specs-textarea" value={creating.specs||""} onChange={(e) => setCreating({ ...creating, specs: e.target.value })} />
        </label>
        <div style={{ display:"flex", gap:8, marginTop:12 }}>
          <button className="btn-primary" style={{ flex:1 }} onClick={submitCreate}>✔ Thêm vào báo giá</button>
          <button className="btn-ghost" onClick={() => setCreating(null)}>Hủy</button>
        </div>
      </div>
    );
  }

  return (
    <div className="picker">
      <div className="picker-bar">
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn-ghost" onClick={onClose}>Đóng</button>
      </div>
      <div className="picker-list">
        {filtered.map((p) => (
          <button key={p.id} className="picker-item" onClick={() => onPick(p.id)}>
            {p.image && <img src={imgSrc(p.image)} alt="" loading="lazy" className="pi-thumb" onError={(e)=>{e.currentTarget.style.display="none"}} />}
            <span className="pi-name">{p.name}</span>
            <span className="pi-meta">{p.sku} · {VND(priceOf ? priceOf(p) : p.costPrice)}</span>
          </button>
        ))}
      </div>
      {filtered.length === 0 && q.trim() && (
        <div className="empty-hint">Không tìm thấy &quot;{q.trim()}&quot; trong danh mục.</div>
      )}
      {/* Nút tạo mới LUÔN HIỆN — không cần gõ không ra mới thấy */}
      <button className="picker-create-btn" onClick={startCreate}>
        {q.trim() && filtered.length === 0
          ? "+ Thêm mới vào danh mục"
          : "+ Tạo thiết bị mới (chưa có trong danh mục)"}
      </button>
    </div>
  );
}

// ============================================================
// TAB — Hỏi giá nhà cung cấp (soạn tin, copy, mở Zalo)
// ============================================================
function AskSupplier({ products, company, suppliers, setSuppliers }) {
  const [askItems, setAskItems] = useState([]); // {key, code, name} - món cần hỏi
  const [freeCode, setFreeCode] = useState(""); // gõ mã/tên tự do
  const [q, setQ] = useState(""); // tìm trong catalog
  const [selectedSupplier, setSelectedSupplier] = useState(suppliers[0]?.id || "");
  const [copied, setCopied] = useState(false);
  const [editingNcc, setEditingNcc] = useState(null);

  const supplier = suppliers.find((s) => s.id === selectedSupplier);

  const addFromCatalog = (p) => {
    if (askItems.some((it) => it.key === p.id)) return;
    setAskItems((a) => [...a, { key: p.id, code: p.sku, name: p.name }]);
  };
  const addFreeCode = () => {
    const v = freeCode.trim();
    if (!v) return;
    setAskItems((a) => [...a, { key: uid("free"), code: v, name: "" }]);
    setFreeCode("");
  };
  const removeItem = (key) => setAskItems((a) => a.filter((it) => it.key !== key));

  // Soạn nội dung tin nhắn hỏi giá — văn phong lịch sự, gọn, dùng chung cho mọi đại lý
  const message = useMemo(() => {
    if (askItems.length === 0) return "";
    const greeting = supplier ? `Dạ ${supplier.name.split(" ")[0]} ơi, ` : "Dạ shop ơi, ";
    if (askItems.length === 1) {
      const it = askItems[0];
      const label = it.name ? `${it.name} (${it.code})` : it.code;
      return `${greeting}cho em hỏi mã ${label} còn hàng và giá hiện tại bao nhiêu ạ? Em cảm ơn!`;
    }
    const lines = askItems.map((it, i) => {
      const label = it.name ? `${it.name} - ${it.code}` : it.code;
      return `${i + 1}. ${label}`;
    });
    return `${greeting}cho em hỏi giá và tình trạng hàng các mã sau ạ:\n${lines.join("\n")}\n\nEm cảm ơn ạ!`;
  }, [askItems, supplier]);

  const copyMsg = async () => {
    if (!message) return;
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      notify.warning("Không copy được tự động. Hãy bôi đen nội dung và copy thủ công.");
    }
  };

  const openZalo = () => {
    if (!supplier?.phone) {
      notify.warning("Nhà cung cấp này chưa có số điện thoại. Thêm số ở danh sách bên dưới để mở Zalo trực tiếp.");
      return;
    }
    // Link mở chat Zalo với 1 người theo số điện thoại
    window.open(`https://zalo.me/${supplier.phone.replace(/\D/g, "")}`, "_blank");
  };

  const filtered = products.filter(
    (p) => p.name.toLowerCase().includes(q.toLowerCase()) || (p.sku || "").toLowerCase().includes(q.toLowerCase())
  );

  const saveNcc = (ncc) => {
    if (ncc.id) setSuppliers((s) => s.map((x) => (x.id === ncc.id ? ncc : x)));
    else {
      const created = { ...ncc, id: uid("ncc") };
      setSuppliers((s) => [...s, created]);
      setSelectedSupplier(created.id);
    }
    setEditingNcc(null);
  };
  const deleteNcc = async (id) => {
    if (await confirmAction({ title: "Xóa nhà cung cấp?", message: "Nhà cung cấp này sẽ bị xóa khỏi danh sách.", confirmLabel: "Xóa", tone: "danger" })) setSuppliers((s) => s.filter((x) => x.id !== id));
  };

  return (
    <div className="ask-grid">
      <div className="ask-main">
        <section className="card">
          <h2>Chọn thiết bị cần hỏi giá</h2>
          <p className="tab-intro" style={{ margin: "0 0 12px" }}>
            Chọn từ bảng giá có sẵn, hoặc gõ mã thiết bị mới (chưa có trong bảng giá) để hỏi.
          </p>

          <div className="ask-add-row">
            <input
              className="search"
              value={freeCode}
              onChange={(e) => setFreeCode(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") addFreeCode(); }}
            />
            <button className="btn-ghost" onClick={addFreeCode}>+ Thêm mã</button>
          </div>

          <div className="ask-catalog-search">
            <input className="search" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          {q && (
            <div className="picker-list" style={{ marginTop: 8 }}>
              {filtered.slice(0, 8).map((p) => (
                <button key={p.id} className="picker-item" onClick={() => addFromCatalog(p)}>
                  {p.image && <img src={imgSrc(p.image)} alt="" loading="lazy" className="pi-thumb" onError={(e)=>{e.currentTarget.style.display="none"}} />}
                  <span className="pi-name">{p.name}</span>
                  <span className="pi-meta">{p.sku}</span>
                </button>
              ))}
              {filtered.length === 0 && <div className="empty-hint">Không tìm thấy.</div>}
            </div>
          )}

          {askItems.length > 0 && (
            <div className="ask-chips">
              {askItems.map((it) => (
                <span className="ask-chip" key={it.key}>
                  {it.name ? `${it.name} (${it.code})` : it.code}
                  <button onClick={() => removeItem(it.key)}>×</button>
                </span>
              ))}
            </div>
          )}
        </section>

        {askItems.length > 0 && (
          <section className="card">
            <h2>Nội dung tin nhắn</h2>
            <textarea className="ask-msg" value={message} readOnly rows={Math.min(3 + askItems.length, 12)} />
            <div className="ask-actions">
              <button className="btn-primary" onClick={copyMsg}>{copied ? "✓ Đã copy" : "Copy nội dung"}</button>
              <button className="btn-excel" onClick={openZalo}>Mở Zalo với Nhà cung cấp</button>
            </div>
            <p className="side-note">
              Zalo không cho điền sẵn nội dung qua link, nên cách nhanh nhất: bấm <strong>Copy nội dung</strong> → bấm
              <strong> Mở Zalo</strong> → dán vào ô chat rồi gửi. Với nhóm Zalo (nhiều nhà cung cấp), mở app Zalo và dán vào nhóm.
            </p>
          </section>
        )}
      </div>

      <aside className="ask-side">
        <div className="card">
          <h2>Nhà cung cấp</h2>
          <select className="form-select" style={{ width: "100%", marginBottom: 10 }} value={selectedSupplier} onChange={(e) => setSelectedSupplier(e.target.value)}>
            {suppliers.length === 0 && <option value="">Chưa có nhà cung cấp</option>}
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>

          {supplier && (
            <div className="ncc-info">
              <div>{supplier.phone ? `ĐT: ${supplier.phone}` : "Chưa có số điện thoại"}</div>
              {supplier.note && <div className="muted">{supplier.note}</div>}
              <div className="ncc-info-actions">
                <button className="link" onClick={() => setEditingNcc(supplier)}>Sửa</button>
                <button className="link danger" onClick={() => deleteNcc(supplier.id)}>Xóa</button>
              </div>
            </div>
          )}

          <button className="btn-ghost" style={{ width: "100%", marginTop: 10 }} onClick={() => setEditingNcc({ name: "", phone: "", note: "" })}>
            + Thêm nhà cung cấp
          </button>
        </div>
      </aside>

      {editingNcc && (
        <div className="modal-backdrop" onClick={() => setEditingNcc(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>{editingNcc.id ? "Sửa nhà cung cấp" : "Thêm nhà cung cấp"}</h2>
            <div className="field-grid">
              <Field label="Tên nhà cung cấp" value={editingNcc.name} onChange={(v) => setEditingNcc({ ...editingNcc, name: v })} full />
              <Field label="Số điện thoại (để mở Zalo)" value={editingNcc.phone} onChange={(v) => setEditingNcc({ ...editingNcc, phone: v })} />
              <Field label="Ghi chú (vd tên nhóm Zalo)" value={editingNcc.note} onChange={(v) => setEditingNcc({ ...editingNcc, note: v })} />
            </div>
            <div className="modal-actions">
              <button className="btn-ghost" onClick={() => setEditingNcc(null)}>Hủy</button>
              <button className="btn-primary" onClick={() => { if (!editingNcc.name) { notify.warning("Nhập tên nhà cung cấp."); return; } saveNcc(editingNcc); }}>Lưu</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// TAB — Đọc file bóc tách khối lượng (bảng ma trận tầng × thiết bị)
// ============================================================
// Helper: proxy ảnh qua Vercel để tránh CORS/hotlink block
const imgSrc = (url) => {
  if (!url) return "";
  if (url.startsWith("data:")) return url; // data URI dùng trực tiếp
  if (url.includes("encrypted-tbn") || url.includes("gstatic.com/images?q=tbn")) return ""; // Google thumbnail không dùng được
  if (typeof window !== "undefined" && window.location.protocol === "https:") {
    return `/api/img?url=${encodeURIComponent(url)}`;
  }
  return url; // local: dùng URL gốc
};

// Img với fallback: proxy → URL gốc → ẩn
const ImgWithFallback = ({ src, className, style, alt = "" }) => {
  if (!src) return null;
  const proxied = imgSrc(src);
  if (!proxied) return null;
  return React.createElement("img", {
    src: proxied,
    alt,
    className,
    style,
    loading: "lazy",
    onError: (e) => {
      // Nếu proxy lỗi → thử URL gốc
      if (e.currentTarget.src !== src) {
        e.currentTarget.src = src;
      } else {
        e.currentTarget.style.display = "none";
        if (e.currentTarget.nextSibling) e.currentTarget.nextSibling.style.display = "flex";
      }
    },
  });
};
// ============================================================
function SearchSelect({ products, value, onChange, placeholder = "Tìm thiết bị...", hasValue }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const wrapRef = useRef();
  const inputRef = useRef();

  const selected = products.find((p) => p.id === value);

  // Đóng khi click ngoài
  useEffect(() => {
    const handler = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false);
        setQ("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const filtered = q.trim()
    ? products.filter((p) =>
        p.name.toLowerCase().includes(q.toLowerCase()) ||
        (p.sku || "").toLowerCase().includes(q.toLowerCase())
      ).slice(0, 20)
    : products.slice(0, 60); // hiện 60 item đầu khi chưa search

  const handleOpen = () => {
    setOpen(true);
    setQ("");
    setTimeout(() => inputRef.current?.focus(), 30);
  };

  const handleSelect = (p) => {
    onChange(p ? p.id : "");
    setOpen(false);
    setQ("");
  };

  return (
    <div className="ss-wrap" ref={wrapRef}>
      {/* Trigger button */}
      <button
        type="button"
        className={`ss-trigger${hasValue ? "" : " ss-unmapped"}`}
        onClick={handleOpen}
      >
        <svg className="ss-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <span className={selected ? "ss-val" : "ss-placeholder"}>
          {selected ? `${selected.name} (${selected.sku})` : placeholder}
        </span>
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: "auto", flexShrink: 0, color: "var(--muted)" }}><polyline points="6 9 12 15 18 9"/></svg>
      </button>

      {/* Dropdown */}
      {open && (
        <div className="ss-dropdown">
          {/* Search input */}
          <div className="ss-search-bar">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input
              ref={inputRef}
              className="ss-search-inp"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onClick={(e) => e.stopPropagation()}
            />
            {q && <button className="ss-clear" onClick={() => setQ("")}>×</button>}
          </div>

          {/* List */}
          <div className="ss-list">
            <div className="ss-item ss-item-empty" onClick={() => handleSelect(null)}>
              — Bỏ qua cột này —
            </div>
            {filtered.length === 0 && (
              <div className="ss-no-result">Không tìm thấy "{q}"</div>
            )}
            {filtered.map((p) => {
              const tag = (p.supplier || "").toLowerCase();
              const tagCls = tag.includes("lumi") ? "tag-ncc tag-lumi"
                : tag.includes("hikvision") || tag.includes("hik") ? "tag-ncc tag-hik"
                : tag.includes("ruijie") ? "tag-ncc tag-ruijie"
                : tag.includes("bisco") ? "tag-ncc tag-bisco"
                : tag.includes("roger") ? "tag-ncc tag-roger" : "";
              return (
                <div
                  key={p.id}
                  className={`ss-item${p.id === value ? " ss-selected" : ""}`}
                  onClick={() => handleSelect(p)}
                >
                  {p.image && <img src={imgSrc(p.image)} alt="" className="ss-thumb" onError={(e) => { e.currentTarget.style.display = "none"; }} />}
                  <div className="ss-item-info">
                    <span className="ss-item-name">{p.name}</span>
                    <span className="ss-item-meta">{p.sku}{tagCls && <span className={tagCls} style={{ marginLeft: 6 }}>{p.supplier}</span>}</span>
                  </div>
                  {p.id === value && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, color: "var(--brand)" }}><polyline points="20 6 9 17 4 12"/></svg>}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
function AIReader({ products, setProducts, company, onCreateQuote, cloud, onUpgrade, embedded = false, ktsFileRef = null, onBack = null }) {
  const [step, setStep] = useState("upload"); // upload | parsing | review | done
  const [rows, setRows] = useState([]); // {section, name, unit, qty}
  const [mapped, setMapped] = useState([]); // {row, product, qty, confidence, section}
  const [unmatched, setUnmatched] = useState([]); // {row} cần chọn tay
  const [ignored, setIgnored] = useState([]); // {row} bỏ qua
  const [progress, setProgress] = useState({ cur: 0, total: 0, msg: "" });
  const [manualMap, setManualMap] = useState({}); // rowIdx → productId
  const [sectionMap, setSectionMap] = useState({}); // rowIdx → solution name
  const fileRef = useRef();

  // Đọc file Excel KTS → danh sách rows có số lượng (legacy module)
  const handleBomFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!guardCapability(cloud, "bom_import", onUpgrade)) { e.target.value = ""; return; }
    try { assertSmartQuoteUploadFile(file, { allow: ["excel"] }); }
    catch (error) { notify.error(error.message); e.target.value = ""; return; }
    setBomStatus("loading");
    setBomError("");
    try {
      const result = await parseBomPreviewFile(file, products);
      setBomPreview(result);
      setBomFilter(result.review > 0 ? "review" : result.ready > 0 ? "ready" : "all");
      setBomStatus("done");
    } catch (err) {
      console.error("BOM preview parser lỗi:", err);
      setBomError("Không đọc được file BOM/dự toán. Hãy kiểm tra file Excel có bảng vật tư, số lượng và đơn vị.");
      setBomStatus("error");
    } finally {
      e.target.value = "";
    }
  };

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      assertSmartQuoteUploadFile(file, { allow: ["excel"] });
      const { allRows, toProcess, autoSkipped, calcFileWarning } = await parseKtsBomExcel(file);

      if (calcFileWarning && allRows.length < 10) {
        notify.info(
          "⚠️ File này có vẻ là bảng tính toán kỹ thuật (cosφ, SQRT, Inm...) chứ không phải bảng khối lượng vật tư.\n\n" +
          "Hãy upload đúng file \"Bảng liệt kê khối lượng\" hoặc \"Bảng khối lượng vật tư\" từ KTS.\n\n" +
          "File đúng thường có các cột: STT | Tên vật tư | Đơn vị | Số lượng"
        );
        setStep("upload");
        return;
      }

      if (allRows.length === 0) {
        notify.warning("Không tìm thấy dòng vật tư nào hợp lệ trong file.\n\nFile cần có dạng bảng với cột: Tên vật tư | Đơn vị | Số lượng");
        setStep("upload");
        return;
      }

      if (toProcess.length === 0) {
        notify.info(`Không có vật tư nào phù hợp với catalog của công ty trong file này.\n\n` +
          `File có ${allRows.length} dòng nhưng đều là vật tư ngoài phạm vi (ống, cáp, điều hòa...).\n\n` +
          `Hãy upload file bảng khối lượng điện nhẹ / smarthome / camera.`);
        setStep("upload");
        return;
      }

      setRows(allRows);
      setIgnored(autoSkipped);
      setStep("parsing");
      await runAIMapping(toProcess);
    } catch (err) {
      console.error(err);
      notify.error("Không đọc được file. Đảm bảo đúng định dạng Excel (.xlsx/.xls).");
      setStep("upload");
    }
  };

  // Gọi Claude API qua legacy mapper để map từng batch rows sang catalog
  const runAIMapping = async (allRows) => {
    if (!allRows.length) return;
    if (!guardCapability(cloud, "ai_import", onUpgrade) || !guardFeature(cloud, "ai_claude_request", 1, onUpgrade)) {
      setUnmatched(allRows.map((row, idx) => ({ ...row, idx, reason: "Chưa mở AI hoặc hết quota AI — ghép thủ công" })));
      setMapped([]);
      setStep("review");
      return;
    }
    const results = await mapBomRowsWithClaude(allRows, products, setProgress);
    cloud?.refreshBilling?.();
    const mappedList = results.filter((r) => r.productId && (r.confidence === "high" || r.confidence === "medium"));
    const unmatchedList = results.filter((r) => !r.productId || r.confidence === "low");
    setMapped(mappedList);
    setUnmatched(unmatchedList);
    setStep("review");
    setProgress({ cur: allRows.length, total: allRows.length, msg: "Hoàn tất!" });
  };

  // Tạo báo giá từ kết quả đã review
  const buildQuote = () => {
    const solutionOrder = [
      "I./ Giải pháp chiếu sáng tự động thông minh\n(Điều khiển tắt/mở đèn từ xa qua Smart Phone, hẹn giờ, cảm ứng…)",
      "II./ Hệ thống cảm biến",
      "III./ Giải pháp cổng tự động thông minh",
      "IV./ Giải pháp camera an ninh",
      "V./ Hệ thống mạng nội bộ + Wifi",
      "VI./ Giải pháp âm thanh đa vùng",
    ];

    const roomMap = {};
    const addLine = (solutionName, productId, qty, note) => {
      if (!roomMap[solutionName]) roomMap[solutionName] = [];
      // Gộp dòng trùng productId
      const existing = roomMap[solutionName].find((l) => l.productId === productId);
      if (existing) { existing.qty += qty; }
      else roomMap[solutionName].push({ id: uid("ln"), productId, qty, note: note || "" });
    };

    // Thêm các dòng đã map
    mapped.forEach((r) => {
      const sol = r.solution || solutionOrder[0];
      addLine(sol, r.productId, r.qty, `${r.section}: ${r.qty}`);
    });

    // Thêm các dòng được chọn thủ công
    unmatched.forEach((r) => {
      const pid = manualMap[r.idx];
      if (pid) {
        const sol = sectionMap[r.idx] || solutionOrder[0];
        addLine(sol, pid, r.qty, `${r.section}: ${r.qty}`);
      }
    });

    // Sắp xếp theo thứ tự La Mã
    const romanOrder = (name) => {
      const m = name.match(/^(I{1,3}|IV|V|VI{0,3})\./);
      if (!m) return 99;
      const map = { "I": 1, "II": 2, "III": 3, "IV": 4, "V": 5, "VI": 6 };
      return map[m[1]] || 99;
    };

    const rooms = Object.entries(roomMap)
      .sort(([a], [b]) => romanOrder(a) - romanOrder(b))
      .map(([name, lines]) => ({ id: uid("room"), name, lines }))
      .filter((r) => r.lines.length > 0);

    if (!rooms.length) { notify.warning("Chưa có thiết bị nào được ghép. Hãy chọn thiết bị cho các dòng chưa map."); return; }
    onCreateQuote(rooms, {});
  };

  // ---- RENDER ----
  const pct = progress.total ? Math.round((progress.cur / progress.total) * 100) : 0;

  return (
    <div className="takeoff">
      {!embedded && (
        <>
          <h2 className="section-title">🤖 AI đọc file khối lượng KTS</h2>
          <p className="tab-intro">
            Upload file Excel khối lượng từ kiến trúc sư/kỹ sư điện. AI tự động nhận diện vật tư và ghép sang catalog của công ty.
            Không cần train nhân viên — AI xử lý trong vài giây.
          </p>
        </>
      )}

      {step === "upload" && (
        <section className="card">
          {embedded && onBack && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
              <div>
                <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>Bảng khối lượng từ KTS / kỹ sư</h2>
                <p className="tab-intro" style={{ margin: "4px 0 0" }}>AI đọc danh sách vật tư, tự ghép sang catalog. Không cần train nhân viên.</p>
              </div>
              <button className="btn-ghost" style={{ fontSize: 12, flexShrink: 0 }} onClick={onBack}>← Đổi loại file</button>
            </div>
          )}
          <div
            className="ai-drop-zone"
            onClick={() => (ktsFileRef || fileRef).current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) { handleFile({ target: { files: [f] } }); } }}
          >
            <div className="ai-drop-icon">📂</div>
            <div className="ai-drop-text">Kéo thả hoặc bấm để chọn file Excel (.xlsx)</div>
            <div className="ai-drop-sub">File bảng khối lượng điện / điện nhẹ / HVAC từ KTS</div>
          </div>
          {!embedded && <input ref={fileRef} type="file" accept=".xlsx,.xls" hidden onChange={handleFile} />}
          {embedded && <input ref={ktsFileRef || fileRef} type="file" accept=".xlsx,.xls" hidden onChange={handleFile} />}
        </section>
      )}

      {step === "parsing" && (
        <section className="card">
          {embedded && onBack && (
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
              <span style={{ fontSize: 14, fontWeight: 600 }}>Bảng khối lượng từ KTS / kỹ sư</span>
              <button className="btn-ghost" style={{ fontSize: 12 }} onClick={onBack}>← Đổi loại file</button>
            </div>
          )}
          <div className="ai-progress-wrap">
            <div className="ai-progress-bar">
              <div className="ai-progress-fill" style={{ width: `${pct}%` }} />
            </div>
            <div className="ai-progress-label">🤖 {progress.msg} ({pct}%)</div>
          </div>
          <p className="tab-intro" style={{ marginTop: 12 }}>
            AI đang đọc {progress.total} dòng vật tư và tìm sản phẩm tương đương trong catalog...
          </p>
        </section>
      )}

      {step === "review" && (
        <section className="card">
          <div className="ai-review-header">
            <h3>Kết quả phân tích — {rows.length} dòng vật tư</h3>
            <div style={{ display: "flex", gap: 8 }}>
              {embedded && onBack && (
                <button className="btn-ghost" style={{ fontSize: 12 }} onClick={() => { setStep("upload"); setRows([]); setMapped([]); setUnmatched([]); setManualMap({}); }}>
                  ← Upload lại
                </button>
              )}
              <button className="btn-primary" style={{ width: "auto" }} onClick={buildQuote}>
                ✓ Tạo báo giá ({mapped.length + Object.keys(manualMap).length} thiết bị)
              </button>
            </div>
          </div>

          {/* Đã map tự động */}
          {mapped.length > 0 && (
            <details open>
              <summary className="ai-section-title ai-ok">
                ✅ Đã tự động ghép — {mapped.length} dòng
              </summary>
              <table className="cat-table" style={{ marginTop: 8 }}>
                <thead><tr>
                  <th>Vật tư KTS</th><th>SL</th><th>→ Sản phẩm catalog</th><th>Phòng / nhóm</th><th>Độ tin cậy</th>
                </tr></thead>
                <tbody>
                  {mapped.map((r, i) => {
                    const p = products.find((x) => x.id === r.productId);
                    return (
                      <tr key={i}>
                        <td><div className="strong">{r.name}</div><div className="ln-sku">{r.section}</div></td>
                        <td className="num">{r.qty}</td>
                        <td>{p ? <><div className="strong">{p.name}</div><div className="ln-sku">{p.sku}</div></> : "—"}</td>
                        <td style={{ fontSize: 11 }}>{r.solution?.split("\n")[0]}</td>
                        <td><span className={`badge-conf-${r.confidence}`}>{r.confidence === "high" ? "Cao" : "Vừa"}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </details>
          )}

          {/* Cần chọn thủ công */}
          {unmatched.length > 0 && (
            <details open>
              <summary className="ai-section-title ai-warn">
                ⚠️ Cần chọn thủ công — {unmatched.length} dòng (bỏ qua hoặc ghép tay)
              </summary>
              <table className="cat-table" style={{ marginTop: 8 }}>
                <thead><tr>
                  <th>Vật tư KTS</th><th>SL</th><th>Lý do AI không ghép</th><th>Ghép với sản phẩm</th>
                </tr></thead>
                <tbody>
                  {unmatched.map((r, i) => (
                    <tr key={i} className={manualMap[r.idx] ? "" : "row-unmapped"}>
                      <td><div className="strong">{r.name}</div><div className="ln-sku">{r.section} · {r.qty} {r.unit}</div></td>
                      <td className="num">{r.qty}</td>
                      <td style={{ fontSize: 11, color: "#888" }}>{r.reason || "Không có trong catalog"}</td>
                      <td>
                        <select
                          className="map-select"
                          value={manualMap[r.idx] || ""}
                          onChange={(e) => setManualMap((m) => ({ ...m, [r.idx]: e.target.value }))}
                        >
                          <option value="">— Bỏ qua dòng này —</option>
                          {products.map((p) => (
                            <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}

          {/* Bỏ qua tự động */}
          {ignored.length > 0 && (
            <details>
              <summary className="ai-section-title" style={{ color: "var(--muted)" }}>
                ⊘ Bỏ qua tự động — {ignored.length} dòng (ống, cáp, điều hòa... ngoài phạm vi catalog)
              </summary>
              <div style={{ fontSize: 12, color: "#aaa", padding: "8px 0", lineHeight: 1.8 }}>
                {ignored.map((r, i) => (
                  <span key={i} style={{ display: "inline-block", background: "#f1f5f9", borderRadius: 4, padding: "2px 8px", margin: "2px" }}>
                    {r.name} ({r.qty} {r.unit})
                  </span>
                ))}
              </div>
            </details>
          )}

          <div style={{ marginTop: 16, display: "flex", gap: 10 }}>
            <button className="btn-primary" style={{ flex: 1 }} onClick={buildQuote}>
              ✓ Tạo báo giá ({mapped.length + Object.keys(manualMap).length} thiết bị)
            </button>
            <button className="btn-ghost" onClick={() => { setStep("upload"); setRows([]); setMapped([]); setUnmatched([]); setManualMap({}); }}>
              ↩ Upload file khác
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

function TakeoffReader({ products, nameMap, setNameMap, markups, company, cloud, onUpgrade, onCreateQuote }) {
  const [mode, setMode] = useState(""); // "" | "bom" | "matrix" | "kts"
  const [pendingOpen, setPendingOpen] = useState(""); // "bom" | "matrix" | "kts" — chờ render xong rồi click
  const [parsed, setParsed] = useState(null);
  const [mapping, setMapping] = useState({});
  const [aiStatus, setAiStatus] = useState("");
  const [bomPreview, setBomPreview] = useState(null);
  const [bomStatus, setBomStatus] = useState("");
  const [bomFilter, setBomFilter] = useState("all");
  const [bomError, setBomError] = useState("");
  const [bomResolutions, setBomResolutions] = useState({});
  const [bomIgnored, setBomIgnored] = useState({});
  const [bomQuoteGrouping, setBomQuoteGrouping] = useState("scope"); // "scope" | "area" | "pack"
  const [bomPackSelections, setBomPackSelections] = useState({});
  const [bomQuoteVariantId, setBomQuoteVariantId] = useState("standard");
  const [bomShowSupporting, setBomShowSupporting] = useState(false);
  const [bomPilotTableLimit, setBomPilotTableLimit] = useState(80);
  const fileRef = useRef();
  const ktsFileRef = useRef();
  const bomFileRef = useRef();

  // Sau khi mode render xong → trigger click file input
  useEffect(() => {
    if (!pendingOpen) return;
    const ref = pendingOpen === "matrix" ? fileRef : pendingOpen === "bom" ? bomFileRef : ktsFileRef;
    const timer = setTimeout(() => {
      ref.current?.click();
      setPendingOpen("");
    }, 50); // đủ để React flush DOM
    return () => clearTimeout(timer);
  }, [pendingOpen]);

  const buildInitialBomResolutions = (result) => {
    const next = {};
    (result?.lines || []).forEach((line) => {
      const top = line.suggestedMatch || line.matchSuggestions?.[0];
      if (top?.productId && (top.learned || top.confidence === "high" || Number(top.score) >= 0.5)) {
        next[line.id] = top.productId;
      }
    });
    return next;
  };

  const buildInitialBomPackSelections = (result) => {
    const next = {};
    (result?.solutionPacks || []).forEach((pack) => {
      const top = pack.recommendations?.[0];
      if (top?.id) next[pack.scopeId] = top.id;
    });
    return next;
  };

  const getSelectedBomPack = (scopeId) => {
    const pack = (bomPreview?.solutionPacks || []).find((p) => p.scopeId === scopeId);
    if (!pack) return null;
    const selectedId = bomPackSelections[scopeId] || pack.selectedRecommendationId || pack.recommendations?.[0]?.id;
    const recommendation = (pack.recommendations || []).find((r) => r.id === selectedId) || pack.recommendations?.[0] || null;
    return { pack, recommendation };
  };

  const applyBomPackRecommendation = (pack, recommendation) => {
    if (!pack || !recommendation) return;
    const allowedIds = new Set(recommendation.productIds || []);
    const vendorNorm = String(recommendation.vendor || "").toLowerCase();
    const next = {};
    let applied = 0;
    (bomPreview?.lines || []).forEach((line) => {
      const lineScopeId = line.scopeId || `scope_${String(line.solutionKey || "other").replace(/[^a-z0-9_-]/gi, "_")}`;
      if (lineScopeId !== pack.scopeId || bomIgnored[line.id]) return;
      if (getBomProductId(line)) return;
      const suggestion = (line.matchSuggestions || []).find((sg) => allowedIds.has(sg.productId))
        || (line.matchSuggestions || []).find((sg) => vendorNorm && String(sg.supplier || "").toLowerCase().includes(vendorNorm))
        || (line.matchSuggestions || [])[0];
      if (suggestion?.productId) {
        next[line.id] = suggestion.productId;
        const product = products.find((p) => p.id === suggestion.productId);
        if (product) saveBomMatchLearning(line, product);
        applied += 1;
      }
    });
    setBomPackSelections((prev) => ({ ...prev, [pack.scopeId]: recommendation.id }));
    if (applied) setBomResolutions((prev) => ({ ...prev, ...next }));
    else notify.info("Phương án này chưa có sản phẩm catalog đủ khớp để áp dụng tự động. Bạn vẫn có thể dùng nó như gợi ý nhà cung cấp/phương án.");
  };

  const getBomProductId = (line) => {
    if (Object.prototype.hasOwnProperty.call(bomResolutions, line.id)) {
      return bomResolutions[line.id] === "__none__" ? "" : bomResolutions[line.id];
    }
    return line.resolvedProductId || line.suggestedMatch?.productId || "";
  };

  const setBomLineProduct = (line, productId) => {
    setBomResolutions((prev) => ({ ...prev, [line.id]: productId || "__none__" }));
    if (productId) {
      setBomIgnored((prev) => ({ ...prev, [line.id]: false }));
      const p = products.find((x) => x.id === productId);
      if (p) saveBomMatchLearning(line, p);
    }
  };

  const ignoreBomLine = (line) => {
    setBomIgnored((prev) => ({ ...prev, [line.id]: true }));
    setBomResolutions((prev) => ({ ...prev, [line.id]: "__none__" }));
  };

  const restoreBomLine = (line) => {
    setBomIgnored((prev) => ({ ...prev, [line.id]: false }));
  };

  const getBomLineScopeId = (line) => line.scopeId || `scope_${String(line.solutionKey || "other").replace(/[^a-z0-9_-]/gi, "_")}`;

  const isSupportingBomLine = (line) => {
    const scope = (bomPreview?.scopes || []).find((s) => s.id === getBomLineScopeId(line));
    const text = `${line.solutionLabel || ""} ${line.category || ""} ${line.name || ""}`.toLowerCase();
    return !!scope?.supporting || !!line.supporting || line.solutionKey === "infrastructure" || /cáp|cap|dây|day|ống|ong|phụ kiện|phu kien|nhân công|nhan cong|hạ tầng|ha tang/.test(text);
  };

  const getBomTopSuggestion = (line) => line.suggestedMatch || (line.matchSuggestions || [])[0] || null;

  const applyHighConfidenceBomMatches = () => {
    if (!bomPreview) return;
    const next = {};
    let count = 0;
    (bomPreview.lines || []).forEach((line) => {
      if (bomIgnored[line.id] || getBomProductId(line) || isSupportingBomLine(line)) return;
      const top = getBomTopSuggestion(line);
      const score = Number(top?.score || 0);
      const strong = top?.learned || top?.confidence === "high" || score >= 0.52;
      if (top?.productId && strong) {
        next[line.id] = top.productId;
        const product = products.find((p) => p.id === top.productId);
        if (product) saveBomMatchLearning(line, product);
        count += 1;
      }
    });
    if (count) {
      setBomResolutions((prev) => ({ ...prev, ...next }));
      setBomFilter("unresolved");
    } else {
      notify.warning("Không còn match chắc nào để duyệt nhanh. Hãy chọn sản phẩm cho các dòng còn lại.");
    }
  };

  const ignoreSupportingBomLines = () => {
    if (!bomPreview) return;
    const ignoreNext = {};
    const resolutionNext = {};
    let count = 0;
    (bomPreview.lines || []).forEach((line) => {
      if (bomIgnored[line.id] || getBomProductId(line) || !isSupportingBomLine(line)) return;
      ignoreNext[line.id] = true;
      resolutionNext[line.id] = "__none__";
      count += 1;
    });
    if (count) {
      setBomIgnored((prev) => ({ ...prev, ...ignoreNext }));
      setBomResolutions((prev) => ({ ...prev, ...resolutionNext }));
      setBomShowSupporting(false);
    } else {
      notify.info("Không có dòng vật tư phụ chưa match nào để ẩn.");
    }
  };

  const focusBomUnresolved = () => {
    setBomShowSupporting(false);
    setBomFilter("unresolved");
    setBomPilotTableLimit(80);
  };

  const createQuoteFromBom = () => {
    if (!bomPreview) return;
    const variants = buildBomQuoteVariants({
      bomPreview,
      products,
      resolutionMap: bomResolutions,
      ignoredMap: bomIgnored,
      packSelections: bomPackSelections,
      grouping: bomQuoteGrouping,
      laborPercent: company?.laborPercent || 0,
    });
    const selected = variants.find((v) => v.id === bomQuoteVariantId) || variants.find((v) => v.id === "standard") || variants[0];
    if (selected?.id && selected.id !== "standard" && !guardCapability(cloud, "quote_variants_abc", onUpgrade)) return;
    if (!selected?.ready) {
      notify.warning("Chưa có dòng BOM nào đủ match để tạo báo giá. Hãy chọn sản phẩm catalog cho ít nhất một dòng.");
      return;
    }

    // Lưu học từ các dòng user/engine đã dùng vào báo giá.
    (bomPreview.lines || []).forEach((line) => {
      if (bomIgnored[line.id]) return;
      const productId = getBomProductId(line);
      const product = products.find((p) => p.id === productId);
      if (product) saveBomMatchLearning(line, product);
    });

    const rooms = quoteVariantToRooms(selected, uid);
    const projectName = (bomPreview.fileName || "BOM").replace(/\.(xlsx|xls)$/i, "");
    onCreateQuote(rooms, {
      project: `${projectName} · PA ${selected.shortLabel} - ${selected.label}`,
    });
  };

  const handleBomFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!guardCapability(cloud, "bom_import", onUpgrade)) { e.target.value = ""; return; }
    try { assertSmartQuoteUploadFile(file, { allow: ["excel"] }); }
    catch (error) { notify.error(error.message); e.target.value = ""; return; }
    setBomStatus("loading");
    setBomError("");
    try {
      const result = await parseBomPreviewFile(file, products);
      setBomPreview(result);
      setBomResolutions(buildInitialBomResolutions(result));
      setBomIgnored({});
      setBomPackSelections(buildInitialBomPackSelections(result));
      setBomQuoteGrouping("scope");
      setBomQuoteVariantId("standard");
      setBomShowSupporting(false);
      setBomPilotTableLimit(80);
      const unresolvedCount = result.lines.filter((line) => !line.resolvedProductId && !line.suggestedMatch?.productId).length;
      setBomFilter(unresolvedCount > 0 ? "unresolved" : result.matched > 0 ? "matched" : result.ready > 0 ? "ready" : "all");
      setBomStatus("done");
    } catch (err) {
      console.error("BOM preview parser lỗi:", err);
      setBomError("Không đọc được file BOM/dự toán. Hãy kiểm tra file Excel có bảng vật tư, số lượng và đơn vị.");
      setBomStatus("error");
    } finally {
      e.target.value = "";
    }
  };

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      assertSmartQuoteUploadFile(file, { allow: ["excel"] });
      const result = await parseTakeoffMatrixFile(file);
      if (result.error) { notify.error(result.error); return; }
      setParsed(result);

      // Bước 1: Map nhanh bằng nameMap đã nhớ + keyword (tức thì)
      const initMap = {};
      result.columns.forEach((col) => {
        const savedSku = nameMap[col.toLowerCase().trim()];
        if (savedSku) {
          const p = products.find((x) => x.sku === savedSku);
          if (p) { initMap[col] = p.id; return; }
        }
        const guess = guessProductForColumn(col, products);
        if (guess) initMap[col] = guess.id;
      });
      setMapping(initMap);

      // Bước 2: AI map các cột chưa ghép được (hoặc ghép không chắc)
      const unmapped = result.columns.filter((col) => !initMap[col]);
      if (unmapped.length > 0 && company?.googleApiKey) {
        if (!guardCapability(cloud, "ai_import", onUpgrade) || !guardFeature(cloud, "ai_claude_request", 1, onUpgrade)) {
          setAiStatus("error");
        } else {
          setAiStatus("loading");
          try {
            const aiResults = await mapTakeoffColumnsWithClaude({
              rows: result.rawRows || [],
              unmapped,
              products,
            });
            cloud?.refreshBilling?.();

          setMapping((prev) => {
            const next = { ...prev };
            aiResults.forEach(({ colIdx, productId, confidence }) => {
              if (productId && (confidence === "high" || confidence === "medium")) {
                const col = unmapped[colIdx];
                if (col && !next[col]) next[col] = productId;
              }
            });
            return next;
          });
            setAiStatus("done");
          } catch (err) {
            console.warn("AI mapping lỗi:", err);
            setAiStatus("error");
          }
        }
      } else {
        setAiStatus("done");
      }
    } catch (err) {
      console.error(err);
      notify.error("Không đọc được file. Đảm bảo đúng định dạng Excel bóc tách.");
    } finally {
      e.target.value = "";
    }
  };

  const setColMap = (col, productId) => setMapping((m) => ({ ...m, [col]: productId }));

  const mappedCount = parsed ? parsed.columns.filter((c) => mapping[c]).length : 0;
  const unmappedCols = parsed ? parsed.columns.filter((c) => !mapping[c]) : [];

  const buildQuote = () => {
    if (!parsed) return;
    const newNameMap = { ...nameMap };
    parsed.columns.forEach((col) => {
      const pid = mapping[col];
      if (pid) {
        const p = products.find((x) => x.id === pid);
        if (p) newNameMap[col.toLowerCase().trim()] = p.sku;
      }
    });
    setNameMap(newNameMap);

    const shared = parsed.sharedColumns || {};
    const columnGroups = parsed.columnGroups || [];

    // Mapping từ TÊN NHÓM trong file bóc tách (R1) → tên giải pháp chuẩn
    // Đây là mapping chính xác nhất vì dùng đúng cấu trúc file bóc tách
    const GROUP_TO_SOLUTION = {
      "công tắc thông minh": "I./ Giải pháp chiếu sáng tự động thông minh\n(Điều khiển tắt/mở đèn từ xa qua Smart Phone, hẹn giờ, cảm ứng…)",
      "công tắc":            "I./ Giải pháp chiếu sáng tự động thông minh\n(Điều khiển tắt/mở đèn từ xa qua Smart Phone, hẹn giờ, cảm ứng…)",
      "ổ cắm":               "I./ Giải pháp chiếu sáng tự động thông minh\n(Điều khiển tắt/mở đèn từ xa qua Smart Phone, hẹn giờ, cảm ứng…)",
      "chiếu sáng":          "I./ Giải pháp chiếu sáng tự động thông minh\n(Điều khiển tắt/mở đèn từ xa qua Smart Phone, hẹn giờ, cảm ứng…)",
      "đèn":                 "I./ Giải pháp chiếu sáng tự động thông minh\n(Điều khiển tắt/mở đèn từ xa qua Smart Phone, hẹn giờ, cảm ứng…)",
      "cb thông minh":       "II./ Hệ thống cảm biến",
      "cảm biến":            "II./ Hệ thống cảm biến",
      "cb":                  "II./ Hệ thống cảm biến",
      "cổng tự động":        "III./ Giải pháp cổng tự động thông minh",
      "cổng":                "III./ Giải pháp cổng tự động thông minh",
      "camera":              "IV./ Giải pháp camera an ninh",
      "an ninh":             "IV./ Giải pháp camera an ninh",
      "wifi":                "V./ Hệ thống mạng nội bộ + Wifi",
      "mạng":                "V./ Hệ thống mạng nội bộ + Wifi",
      "mạng/wifi":           "V./ Hệ thống mạng nội bộ + Wifi",
      "âm thanh":            "VI./ Giải pháp âm thanh đa vùng",
      "rèm":                 "VIII./ Giải pháp rèm thông minh",
    };

    // Dự phòng: map theo category thiết bị nếu file bóc tách không có nhóm R1
    const CAT_TO_SOLUTION = {
      "Công tắc":    "I./ Giải pháp chiếu sáng tự động thông minh\n(Điều khiển tắt/mở đèn từ xa qua Smart Phone, hẹn giờ, cảm ứng…)",
      "Ổ cắm":       "I./ Giải pháp chiếu sáng tự động thông minh\n(Điều khiển tắt/mở đèn từ xa qua Smart Phone, hẹn giờ, cảm ứng…)",
      "Chiếu sáng":  "I./ Giải pháp chiếu sáng tự động thông minh\n(Điều khiển tắt/mở đèn từ xa qua Smart Phone, hẹn giờ, cảm ứng…)",
      "Điều khiển":  "I./ Giải pháp chiếu sáng tự động thông minh\n(Điều khiển tắt/mở đèn từ xa qua Smart Phone, hẹn giờ, cảm ứng…)",
      "Cảm biến":    "II./ Hệ thống cảm biến",
      "Cổng tự động":"III./ Giải pháp cổng tự động thông minh",
      "Camera":      "IV./ Giải pháp camera an ninh",
      "An ninh":     "IV./ Giải pháp camera an ninh",
      "Mạng/Wifi":   "V./ Hệ thống mạng nội bộ + Wifi",
      "Module":      "V./ Hệ thống mạng nội bộ + Wifi",
      "Âm thanh":    "VI./ Giải pháp âm thanh đa vùng",
      "Rèm":         "VIII./ Giải pháp rèm thông minh",
    };

    const resolveSolution = (colIdx, p) => {
      // Ưu tiên 1: nhóm từ R1 của file bóc tách (chính xác nhất)
      const grp = (columnGroups[colIdx] || "").toLowerCase().trim();
      if (grp) {
        // Tìm khớp chính xác trước
        if (GROUP_TO_SOLUTION[grp]) return GROUP_TO_SOLUTION[grp];
        // Tìm khớp một phần
        const found = Object.entries(GROUP_TO_SOLUTION)
          .find(([k]) => grp.includes(k) || k.includes(grp));
        if (found) return found[1];
      }
      // Ưu tiên 2: category của thiết bị trong catalog
      const cat = p?.category || "";
      return CAT_TO_SOLUTION[cat]
        || Object.entries(CAT_TO_SOLUTION).find(([k]) => cat.toLowerCase().includes(k.toLowerCase()))?.[1]
        || GROUP_TO_SOLUTION["công tắc thông minh"]; // fallback về giải pháp I
    };

    // Tạo map: tên giải pháp → lines[]
    const solutionMap = {};
    const solutionOrder = [];
    const addToSolution = (solutionName, line) => {
      if (!solutionMap[solutionName]) {
        solutionMap[solutionName] = [];
        solutionOrder.push(solutionName);
      }
      solutionMap[solutionName].push(line);
    };

    // Xử lý từng cột: tính tổng số lượng, ghi note phân bổ tầng, xếp vào đúng giải pháp
    parsed.columns.forEach((col, colIdx) => {
      const pid = mapping[col];
      if (!pid) return;
      const p = products.find((x) => x.id === pid);
      if (!p) return;

      const isShared = !!shared[col];
      let totalQty = 0;
      const noteLines = [];

      if (isShared) {
        totalQty = shared[col] || 0;
        // Dùng chung không ghi note tầng
      } else {
        parsed.floors.forEach((floor) => {
          const q = floor.qtys[col];
          if (q && q > 0) {
            totalQty += q;
            noteLines.push(`${floor.name}: ${q}`);
          }
        });
      }

      if (totalQty <= 0) return;

      const note = noteLines.join("\n");
      const line = { id: uid("ln"), productId: pid, qty: totalQty, note };
      addToSolution(resolveSolution(colIdx, p), line);
    });

    // Sắp xếp theo thứ tự số La Mã (I < II < III < IV < V...) trong tên giải pháp
    const romanOrder = (name) => {
      const m = name.match(/^(I{1,3}|IV|V|VI{0,3}|IX|X)\./);
      if (!m) return 99;
      const map = { "I": 1, "II": 2, "III": 3, "IV": 4, "V": 5, "VI": 6, "VII": 7, "VIII": 8, "IX": 9, "X": 10 };
      return map[m[1]] || 99;
    };
    const rooms = solutionOrder
      .sort((a, b) => romanOrder(a) - romanOrder(b))
      .map((name) => ({
      id: uid("room"),
      name,
      lines: solutionMap[name],
    }));

    if (rooms.length === 0) {
      notify.warning("Chưa ghép được thiết bị nào. Hãy chọn thiết bị cho các cột bên dưới.");
      return;
    }
    onCreateQuote(rooms, { project: parsed.title || "" });
  };

  return (
    <div className="takeoff">

      {/* Chọn loại file — hiện khi chưa chọn mode hoặc muốn đổi */}
      {!mode && (
        <section className="card">
          <h2 style={{ margin: "0 0 4px", fontSize: 15, fontWeight: 600 }}>Chọn loại file muốn đọc</h2>
          <p className="tab-intro" style={{ margin: "0 0 16px" }}>
            AI hỗ trợ cả 2 loại file — chọn đúng loại để kết quả chính xác nhất.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12 }}>
            <button
              className="mode-pick-btn mode-pick-primary"
              onClick={() => { setMode("bom"); setPendingOpen("bom"); }}
            >
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16v16H4z"/><path d="M4 9h16"/><path d="M9 4v16"/><path d="M14 4v16"/></svg>
              <div className="mpb-title">BOM / dự toán công trình</div>
              <div className="mpb-sub">Đọc file bóc tách dạng danh sách: tên vật tư, model, số lượng, đơn vị, phòng/khu vực.</div>
              <div className="mpb-example">Phase 1: preview cấu trúc trước khi match catalog</div>
            </button>
            <button
              className="mode-pick-btn"
              onClick={() => { setMode("matrix"); setPendingOpen("matrix"); }}
            >
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>
              <div className="mpb-title">Bảng bóc tách (tầng × thiết bị)</div>
              <div className="mpb-sub">File bảng ma trận: hàng = tầng, cột = loại thiết bị, ô = số lượng. Thường do nội bộ lập.</div>
              <div className="mpb-example">Ví dụ: Tầng 1 · Công tắc 1 nút · 10</div>
            </button>
            <button
              className="mode-pick-btn"
              onClick={() => { setMode("kts"); setPendingOpen("kts"); }}
            >
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
              <div className="mpb-title">Bảng khối lượng từ KTS / kỹ sư</div>
              <div className="mpb-sub">File danh sách vật tư dạng cột: STT · Tên vật tư · ĐVT · Số lượng. Do kiến trúc sư / kỹ sư lập.</div>
              <div className="mpb-example">Ví dụ: ĐÈN DOWNLIGHT 9W · Cái · 222</div>
            </button>
          </div>
          <input ref={bomFileRef} type="file" accept=".xlsx,.xls" hidden onChange={handleBomFile} />
          <input ref={fileRef} type="file" accept=".xlsx,.xls" hidden onChange={(e) => { handleFile(e); }} />
          <input ref={ktsFileRef} type="file" accept=".xlsx,.xls" hidden onChange={() => {}} />
        </section>
      )}

      {/* BOM Preview Parser — Phase BOM-1 */}
      {mode === "bom" && (
        <section className="card bom-preview-card">
          <div className="bom-topline">
            <div>
              <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>BOM / dự toán công trình</h2>
              <p className="tab-intro" style={{ margin: "4px 0 0" }}>
                Phase 1 đọc file và tạo preview: phòng/khu vực, tên thiết bị, model, số lượng, đơn vị. Chưa ép user match catalog ngay.
              </p>
            </div>
            <button className="btn-ghost" style={{ fontSize: 12, flexShrink: 0 }} onClick={() => { setMode(""); setBomPreview(null); setBomStatus(""); setBomError(""); }}>
              ← Đổi loại file
            </button>
          </div>

          {!bomPreview && (
            <>
              <div
                className="bom-drop-zone"
                onClick={() => bomFileRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) handleBomFile({ target: { files: [f], value: "" } }); }}
              >
                <div className="ai-drop-icon">📋</div>
                <div className="ai-drop-text">Kéo thả hoặc bấm để chọn file BOM / dự toán Excel</div>
                <div className="ai-drop-sub">Hỗ trợ cột: Tên thiết bị · Model · Số lượng · ĐVT · Phòng/khu vực · Ghi chú</div>
              </div>
              <input ref={bomFileRef} type="file" accept=".xlsx,.xls" hidden onChange={handleBomFile} />
              {bomStatus === "loading" && <p className="tab-intro" style={{ marginTop: 12 }}>Đang đọc BOM và tách phòng/khu vực…</p>}
              {bomError && <div className="takeoff-warn" style={{ marginTop: 12 }}>{bomError}</div>}
            </>
          )}

          {bomPreview && (() => {
            const activeLines = bomPreview.lines.filter((l) => !bomIgnored[l.id]);
            const resolvedLines = activeLines.filter((l) => !!getBomProductId(l));
            const unresolvedLines = activeLines.filter((l) => !getBomProductId(l));
            const reviewLines = activeLines.filter((l) => l.status === "need_review" && !getBomProductId(l));
            const supportingLines = activeLines.filter((l) => isSupportingBomLine(l));
            const coreLines = activeLines.filter((l) => !isSupportingBomLine(l));
            const coreResolvedLines = coreLines.filter((l) => !!getBomProductId(l));
            const coreUnresolvedLines = coreLines.filter((l) => !getBomProductId(l));
            const highSuggestionLines = coreUnresolvedLines.filter((l) => {
              const top = getBomTopSuggestion(l);
              const score = Number(top?.score || 0);
              return !!top?.productId && (top.learned || top.confidence === "high" || score >= 0.52);
            });
            const ignoredCount = Object.values(bomIgnored).filter(Boolean).length;
            const scopes = bomPreview.scopes || [];
            const mainScopes = scopes.filter((s) => !s.supporting);
            const supportingScopes = scopes.filter((s) => s.supporting);
            const selectedScope = bomFilter.startsWith("scope:") ? bomFilter.slice(6) : "";
            const filtered = bomPreview.lines.filter((l) => {
              const pid = getBomProductId(l);
              const ignored = !!bomIgnored[l.id];
              const supporting = isSupportingBomLine(l);
              const lineScopeId = getBomLineScopeId(l);
              if (selectedScope) return !ignored && lineScopeId === selectedScope;
              if (bomFilter === "core") return !ignored && !supporting;
              if (bomFilter === "supporting") return !ignored && supporting;
              if (bomFilter === "ready") return !ignored && l.status === "ready" && (bomShowSupporting || !supporting);
              if (bomFilter === "review") return !ignored && l.status === "need_review" && (bomShowSupporting || !supporting);
              if (bomFilter === "matched") return !ignored && !!pid && (bomShowSupporting || !supporting);
              if (bomFilter === "unresolved") return !ignored && !pid && (bomShowSupporting || !supporting);
              if (bomFilter === "ignored") return ignored;
              if (!bomShowSupporting && !ignored && supporting) return false;
              return true;
            });
            const groupedAreas = bomPreview.areas.length ? bomPreview.areas.join(" · ") : "Chưa phân khu";
            const quoteVariants = buildBomQuoteVariants({
              bomPreview,
              products,
              resolutionMap: bomResolutions,
              ignoredMap: bomIgnored,
              packSelections: bomPackSelections,
              grouping: bomQuoteGrouping,
              laborPercent: company?.laborPercent || 0,
            });
            const selectedQuoteVariant = quoteVariants.find((v) => v.id === bomQuoteVariantId) || quoteVariants.find((v) => v.id === "standard") || quoteVariants[0];
            return (
              <>
                <div className="bom-summary-box bom-phase2-summary bom-pilot-summary">
                  <div>
                    <div className="bom-summary-title">BOM đã sẵn sàng để resolve nhanh</div>
                    <div className="bom-summary-sub">
                      {coreLines.length} dòng giải pháp chính · {coreResolvedLines.length} đã match · {coreUnresolvedLines.length} cần chọn · {supportingLines.length} vật tư phụ đang {bomShowSupporting ? "hiện" : "ẩn"}
                    </div>
                    <div className="bom-summary-areas">Khu vực/hạng mục: {groupedAreas}</div>
                  </div>
                  <div className="bom-summary-actions">
                    <button className="btn-ghost" onClick={() => bomFileRef.current?.click()}>Upload file khác</button>
                    <div className="bom-grouping-toggle" title="Chọn cách gom dòng khi tạo báo giá">
                      <button className={bomQuoteGrouping === "scope" ? "active" : ""} onClick={() => setBomQuoteGrouping("scope")}>Theo giải pháp</button>
                      <button className={bomQuoteGrouping === "pack" ? "active" : ""} onClick={() => setBomQuoteGrouping("pack")}>Theo phương án</button>
                      <button className={bomQuoteGrouping === "area" ? "active" : ""} onClick={() => setBomQuoteGrouping("area")}>Theo khu vực</button>
                    </div>
                    <button className="btn-primary" style={{ width: "auto" }} disabled={!selectedQuoteVariant?.ready} onClick={createQuoteFromBom}>
                      Tạo PA {selectedQuoteVariant?.shortLabel || "B"}: {selectedQuoteVariant?.label || "Tiêu chuẩn"} →
                    </button>
                  </div>
                </div>

                <div className="bom-pilot-actionbar">
                  <div>
                    <strong>Việc cần làm tiếp theo</strong>
                    <span>
                      {coreUnresolvedLines.length > 0
                        ? `Còn ${coreUnresolvedLines.length} dòng giải pháp chính cần chọn sản phẩm.`
                        : selectedQuoteVariant?.ready
                          ? `Đã đủ dữ liệu để tạo báo giá ${selectedQuoteVariant.shortLabel || "B"}.`
                          : "Chưa có dòng nào đủ match để tạo báo giá."}
                    </span>
                  </div>
                  <div className="bom-pilot-actions">
                    {highSuggestionLines.length > 0 && <button className="btn-mini" onClick={applyHighConfidenceBomMatches}>Duyệt {highSuggestionLines.length} match chắc</button>}
                    {supportingLines.length > 0 && <button className="btn-mini" onClick={() => setBomShowSupporting((v) => !v)}>{bomShowSupporting ? "Ẩn vật tư phụ" : `Hiện ${supportingLines.length} vật tư phụ`}</button>}
                    {supportingLines.some((l) => !getBomProductId(l) && !bomIgnored[l.id]) && <button className="btn-mini" onClick={ignoreSupportingBomLines}>Bỏ qua vật tư phụ chưa match</button>}
                    {coreUnresolvedLines.length > 0 && <button className="btn-mini" onClick={focusBomUnresolved}>Xử lý dòng chưa match</button>}
                  </div>
                </div>

                <input ref={bomFileRef} type="file" accept=".xlsx,.xls" hidden onChange={handleBomFile} />

                <div className="bom-metrics bom-phase2-metrics bom-pilot-metrics">
                  <div><strong>{mainScopes.length}</strong><span>Nhóm giải pháp chính</span></div>
                  <div><strong>{coreResolvedLines.length}</strong><span>Đã match catalog</span></div>
                  <div><strong>{coreUnresolvedLines.length}</strong><span>Cần xử lý</span></div>
                  <div><strong>{supportingLines.length}</strong><span>Vật tư phụ ẩn</span></div>
                </div>

                <div className="bom-quote-composer">
                  <div className="bom-scope-header">
                    <div>
                      <strong>Phương án báo giá A/B/C</strong>
                      <span>Chọn phương án để SmartQuote tạo báo giá nháp. Dòng đã user chọn sẽ được khóa, dòng còn lại chọn theo chiến lược từng phương án.</span>
                    </div>
                    <button className="btn-mini" onClick={() => setBomQuoteGrouping("pack")}>Gom theo phương án</button>
                  </div>
                  <div className="bom-variant-grid">
                    {quoteVariants.map((variant) => (
                      <button
                        key={variant.id}
                        className={`bom-variant-card ${bomQuoteVariantId === variant.id ? "active" : ""}`}
                        onClick={() => setBomQuoteVariantId(variant.id)}
                      >
                        <div className="bom-variant-head">
                          <span className="bom-variant-letter">{variant.shortLabel}</span>
                          <div>
                            <strong>{variant.label}</strong>
                            <small>{variant.subtitle}</small>
                          </div>
                        </div>
                        <div className="bom-variant-total">{VND(variant.grandTotal || 0)}</div>
                        <div className="bom-variant-meta">
                          <span>{variant.itemCount} dòng</span>
                          <span>{variant.coverage}% coverage</span>
                          <span>{variant.packTemplateLineCount || 0} template</span>
                          <span>margin {variant.marginPercent}%</span>
                        </div>
                        {variant.unmatchedCount > 0 && <div className="bom-variant-warn">Còn {variant.unmatchedCount} dòng chưa match</div>}
                      </button>
                    ))}
                  </div>
                  {selectedQuoteVariant?.packTemplateLineCount > 0 && (
                    <div className="bom-variant-note bom-template-note">
                      SmartQuote đã bổ sung {selectedQuoteVariant.packTemplateLineCount} dòng từ template cấu hình. Ví dụ: {selectedQuoteVariant.packTemplateSample?.slice(0, 3).join(" · ") || "—"}.
                    </div>
                  )}
                  {selectedQuoteVariant?.unmatchedCount > 0 && (
                    <div className="bom-variant-note">
                      Phương án đang chọn còn {selectedQuoteVariant.unmatchedCount} dòng chưa lên báo giá. Ví dụ: {selectedQuoteVariant.unmatchedSample?.slice(0, 3).join(" · ") || "—"}.
                    </div>
                  )}
                </div>

                {scopes.length > 0 && (
                  <div className="bom-scope-section">
                    <div className="bom-scope-header">
                      <div>
                        <strong>Phạm vi giải pháp phát hiện</strong>
                        <span>SmartQuote gom vật tư thành các hệ để sales/kỹ thuật duyệt nhanh trước khi tạo báo giá.</span>
                      </div>
                      {selectedScope && <button className="btn-mini" onClick={() => setBomFilter("all")}>Xem tất cả dòng</button>}
                    </div>
                    <div className="bom-scope-grid">
                      {(bomShowSupporting ? scopes : mainScopes).slice(0, 10).map((scope) => (
                        <button
                          key={scope.id}
                          className={`bom-scope-card ${scope.supporting ? "supporting" : ""} ${selectedScope === scope.id ? "active" : ""}`}
                          onClick={() => setBomFilter(`scope:${scope.id}`)}
                        >
                          <div className="bom-scope-title">{scope.label}</div>
                          <div className="bom-scope-meta">{scope.lineCount} dòng · {scope.matched} match · {scope.unresolved} cần chọn · {scope.confidence}%</div>
                          {scope.vendors?.length > 0 && <div className="bom-scope-vendors">Gợi ý nhà cung cấp: {scope.vendors.join(" / ")}</div>}
                          {scope.sampleItems?.length > 0 && <div className="bom-scope-samples">{scope.sampleItems.slice(0, 2).join(" · ")}</div>}
                        </button>
                      ))}
                    </div>
                    {!bomShowSupporting && supportingScopes.length > 0 && (
                      <button className="bom-supporting-toggle" onClick={() => { setBomShowSupporting(true); setBomFilter("supporting"); }}>
                        Đang ẩn {supportingScopes.reduce((sum, s) => sum + (s.lineCount || 0), 0)} dòng vật tư phụ/cáp/ống. Bấm để xem khi cần đưa vào báo giá chi tiết.
                      </button>
                    )}
                  </div>
                )}

                {(bomPreview.solutionPacks || []).length > 0 && (
                  <div className="bom-pack-section">
                    <div className="bom-scope-header">
                      <div>
                        <strong>Gợi ý phương án / bộ giải pháp</strong>
                        <span>Mỗi nhóm giải pháp có các phương án nhà cung cấp/brand để sales chọn nhanh trước khi tạo báo giá.</span>
                      </div>
                      <button className="btn-mini" onClick={() => setBomQuoteGrouping("pack")}>Tạo báo giá theo phương án</button>
                    </div>
                    <div className="bom-pack-list">
                      {(bomPreview.solutionPacks || []).slice(0, 8).map((pack) => {
                        const selectedId = bomPackSelections[pack.scopeId] || pack.selectedRecommendationId || pack.recommendations?.[0]?.id;
                        return (
                          <div key={pack.scopeId} className="bom-pack-row">
                            <div className="bom-pack-row-head">
                              <button className="bom-pack-scope" onClick={() => setBomFilter(`scope:${pack.scopeId}`)}>
                                <strong>{pack.scopeLabel}</strong>
                                <span>{pack.lineCount} dòng · {pack.matched} đã match · {pack.unresolved} cần chọn</span>
                              </button>
                            </div>
                            <div className="bom-pack-options">
                              {(pack.recommendations || []).map((rec) => (
                                <button
                                  key={rec.id}
                                  className={`bom-pack-card ${selectedId === rec.id ? "active" : ""}`}
                                  onClick={() => setBomPackSelections((prev) => ({ ...prev, [pack.scopeId]: rec.id }))}
                                >
                                  <div className="bom-pack-title">{rec.title}</div>
                                  <div className="bom-pack-meta">{rec.vendor} · {rec.tier} · {rec.score}%</div>
                                  <div className="bom-pack-rationale">{rec.rationale}</div>
                                  {rec.template && (
                                    <div className="bom-template-summary">
                                      <strong>{rec.template.label}</strong>
                                      <span>{rec.template.requiredMatched}/{rec.template.requiredCount} thành phần bắt buộc · {rec.template.coverage}%</span>
                                      <div className="bom-template-components">
                                        {rec.template.components.slice(0, 4).map((cmp) => (
                                          <em key={cmp.role} className={cmp.matched ? "ok" : cmp.required ? "missing" : "optional"}>
                                            {cmp.matched ? "✓" : cmp.required ? "!" : "○"} {cmp.label}
                                          </em>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                  {rec.sampleProducts?.length > 0 && <div className="bom-pack-products">{rec.sampleProducts.slice(0, 2).join(" · ")}</div>}
                                  <div className="bom-pack-actions">
                                    <span>{rec.catalogProductCount} SP catalog</span>
                                    <em>{rec.template?.status === "ready" ? "đủ bộ" : rec.confidence === "high" ? "chắc" : rec.confidence === "medium" ? "khá" : "gợi ý"}</em>
                                  </div>
                                </button>
                              ))}
                            </div>
                            <div className="bom-pack-row-actions">
                              {(() => {
                                const selected = (pack.recommendations || []).find((r) => r.id === selectedId) || pack.recommendations?.[0];
                                return selected ? <button className="btn-mini" onClick={() => applyBomPackRecommendation(pack, selected)}>Áp dụng match phù hợp</button> : null;
                              })()}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className="bom-resolve-hint">
                  <strong>Phase 6:</strong> SmartQuote đã có template cấu hình cho từng phương án. Template giúp bổ sung các thành phần bắt buộc như gateway, controller, màn hình, NVR, nguồn/phụ kiện nếu catalog có sản phẩm phù hợp.
                </div>

                <details className="bom-details">
                  <summary>Chi tiết parser</summary>
                  <div className="bom-detail-grid">
                    {bomPreview.sheets.map((sh) => (
                      <div key={sh.sheetName} className="bom-detail-chip">
                        <strong>{sh.sheetName}</strong><span>{sh.disciplineLabel || "BOM"} · {sh.parsedCount} dòng · header {sh.headerRow || "fallback"}</span>
                      </div>
                    ))}
                  </div>
                </details>

                <div className="bom-toolbar bom-pilot-toolbar">
                  {[
                    ["all", `Tổng quan (${bomShowSupporting ? activeLines.length : coreLines.length})`],
                    ["core", `Giải pháp chính (${coreLines.length})`],
                    ["unresolved", `Cần chọn (${coreUnresolvedLines.length})`],
                    ["matched", `Đã match (${coreResolvedLines.length})`],
                    ["supporting", `Vật tư phụ (${supportingLines.length})`],
                    ["ignored", `Bỏ qua (${ignoredCount})`],
                  ].map(([key, label]) => (
                    <button key={key} className={bomFilter === key ? "active" : ""} onClick={() => { if (key === "supporting") setBomShowSupporting(true); setBomFilter(key); setBomPilotTableLimit(80); }}>{label}</button>
                  ))}
                </div>

                <div className="bom-table-wrap">
                  <table className="bom-preview-table bom-match-table">
                    <thead>
                      <tr>
                        <th>#</th><th>Trạng thái</th><th>Vật tư trong BOM</th><th>SL</th><th>Khu vực</th><th>Match catalog</th><th>Vấn đề / thao tác</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.slice(0, bomPilotTableLimit).map((line, idx) => {
                        const selectedProductId = getBomProductId(line);
                        const selectedProduct = products.find((p) => p.id === selectedProductId);
                        const ignored = !!bomIgnored[line.id];
                        const supporting = isSupportingBomLine(line);
                        const topSuggestion = getBomTopSuggestion(line);
                        const statusLabel = ignored ? "Bỏ qua" : selectedProductId ? "Đã match" : supporting ? "Vật tư phụ" : line.status === "ready" ? "Cần chọn" : "Cần xem";
                        const statusClass = ignored ? "ignored" : selectedProductId ? "matched" : supporting ? "ignored" : line.status;
                        return (
                          <tr key={line.id} className={`${line.status === "need_review" && !selectedProductId ? "bom-row-review" : ""} ${supporting ? "bom-row-supporting" : ""}`}>
                            <td>{idx + 1}</td>
                            <td><span className={`bom-status ${statusClass}`}>{statusLabel}</span></td>
                            <td>
                              <div className="strong">{line.name}</div>
                              <div className="ln-sku">{line.model || "không có model"} · {line.solutionLabel || line.category} · {line.sourceSheet} dòng {line.sourceRow}</div>
                              {line.note && <div className="ln-sku">{line.note}</div>}
                            </td>
                            <td className="num">{line.qty} {line.unit}</td>
                            <td>{line.area || "—"}</td>
                            <td>
                              <SearchSelect
                                products={products}
                                value={selectedProductId || ""}
                                onChange={(pid) => setBomLineProduct(line, pid)}
                                placeholder="Chọn sản phẩm catalog..."
                                hasValue={!!selectedProductId}
                              />
                              {line.matchSuggestions?.length > 0 && (
                                <div className="bom-suggestions">
                                  {line.matchSuggestions.slice(0, 3).map((sg) => (
                                    <button
                                      key={sg.productId}
                                      className={selectedProductId === sg.productId ? "selected" : ""}
                                      onClick={() => setBomLineProduct(line, sg.productId)}
                                      title={sg.reason}
                                    >
                                      {sg.productName} <span>{Math.round((sg.score || 0) * 100)}%</span>
                                    </button>
                                  ))}
                                </div>
                              )}
                              {selectedProduct && <div className="ln-sku">Đang dùng: {selectedProduct.sku || "—"} · {selectedProduct.supplier || "Catalog"}</div>}
                            </td>
                            <td>
                              <div>{line.issues?.length ? line.issues.join("; ") : selectedProductId ? "Sẵn sàng tạo báo giá" : supporting ? "Vật tư phụ — ẩn mặc định, chỉ đưa vào báo giá chi tiết khi cần" : "Chọn sản phẩm trong catalog"}</div>
                              <div className="bom-row-actions">
                                {!selectedProductId && topSuggestion?.productId && !ignored && (
                                  <button className="btn-mini" onClick={() => setBomLineProduct(line, topSuggestion.productId)}>Chọn gợi ý đầu</button>
                                )}
                                {ignored ? (
                                  <button className="btn-mini" onClick={() => restoreBomLine(line)}>Khôi phục</button>
                                ) : (
                                  <button className="btn-mini danger" onClick={() => ignoreBomLine(line)}>Bỏ qua</button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {filtered.length > bomPilotTableLimit && (
                    <div className="bom-load-more">
                      <span>Đang hiển thị {bomPilotTableLimit}/{filtered.length} dòng để giữ UI nhẹ.</span>
                      <button className="btn-mini" onClick={() => setBomPilotTableLimit((n) => n + 80)}>Hiện thêm 80 dòng</button>
                    </div>
                  )}
                  {filtered.length === 0 && <div className="empty-hint">Không có dòng nào trong filter này.</div>}
                </div>
              </>
            );
          })()}
        </section>
      )}

      {/* Bảng ma trận — mode cũ */}
      {mode === "matrix" && (
      <section className="card">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>Bảng bóc tách (tầng × thiết bị)</h2>
            <p className="tab-intro" style={{ margin: "4px 0 0" }}>
              AI tự ghép cột với thiết bị trong catalog, nhớ lựa chọn cho lần sau.
            </p>
          </div>
          <button className="btn-ghost" style={{ fontSize: 12, flexShrink: 0 }} onClick={() => { setMode(""); setParsed(null); setMapping({}); setAiStatus(""); }}>
            ← Đổi loại file
          </button>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button className="btn-excel" onClick={() => fileRef.current?.click()}>
            ⬆ Tải file bóc tách Excel
          </button>
          {aiStatus === "loading" && <span style={{ fontSize: 12.5, color: "var(--brand)" }}>🤖 AI đang phân tích cột…</span>}
          {aiStatus === "done" && parsed && <span style={{ fontSize: 12.5, color: "var(--pos)" }}>✓ AI đã ghép xong</span>}
          {aiStatus === "error" && <span style={{ fontSize: 12.5, color: "var(--neg)" }}>⚠ AI lỗi — ghép thủ công bên dưới</span>}
        </div>
        <input ref={fileRef} type="file" accept=".xlsx,.xls" hidden onChange={handleFile} />
      </section>
      )}

      {parsed && (
        <>
          <section className="card">
            <div className="takeoff-head">
              <h2>{parsed.title || "Bảng bóc tách"}</h2>
              <span className="takeoff-stat">{parsed.floors.length} tầng · {parsed.columns.length} loại thiết bị · đã ghép {mappedCount}/{parsed.columns.length}</span>
            </div>

            <p className="tab-intro" style={{ margin: "0 0 10px" }}>
              Ghép mỗi cột trong file với thiết bị trong bảng giá. Cột đoán sẵn rồi, chỉ cần kiểm tra lại; cột chưa khớp tô vàng.
            </p>

            <table className="map-table">
              <thead>
                <tr><th>Tên cột trong file</th><th class="num">SL</th><th style={{width:110}}>Nhà cung cấp</th><th>Ghép với thiết bị trong catalog</th></tr>
              </thead>
              <tbody>
                {parsed.columns.map((col) => {
                  const totalQty = parsed.floors.reduce((s, f) => s + (f.qtys[col] || 0), 0);
                  if (totalQty === 0) return null;
                  const isShared = parsed.sharedColumns && parsed.sharedColumns[col];
                  const mappedProduct = products.find((p) => p.id === mapping[col]);
                  const tag = mappedProduct?.supplier?.toLowerCase();
                  const tagClass = tag?.includes("lumi") ? "tag-ncc tag-lumi"
                    : tag?.includes("hikvision") || tag?.includes("hik") ? "tag-ncc tag-hik"
                    : tag?.includes("ruijie") ? "tag-ncc tag-ruijie"
                    : tag?.includes("bisco") ? "tag-ncc tag-bisco"
                    : tag?.includes("roger") ? "tag-ncc tag-roger"
                    : null;
                  return (
                    <tr key={col} className={mapping[col] ? "" : "row-unmapped"}>
                      <td>
                        <span className="strong">{col}</span>
                        {isShared && <span className="badge-shared">dùng chung</span>}
                        {mapping[col] && <span className="badge-ai">AI</span>}
                      </td>
                      <td className="num">{totalQty}</td>
                      <td>{mappedProduct && tagClass && <span className={tagClass}>{mappedProduct.supplier}</span>}</td>
                      <td>
                        <SearchSelect
                          products={products}
                          value={mapping[col] || ""}
                          onChange={(pid) => setColMap(col, pid)}
                          hasValue={!!mapping[col]}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <p className="tab-intro" style={{ marginTop: 10 }}>
              Cột gắn nhãn <span className="badge-shared">dùng chung</span> là thiết bị chỉ điền 1 lần, dùng cho cả công trình
              (vd bộ trung tâm, đầu ghi, cân bằng tải) — sẽ gom vào khu vực “Thiết bị dùng chung” riêng, không thuộc tầng nào.
            </p>

            {unmappedCols.length > 0 && (
              <p className="takeoff-warn">
                Còn {unmappedCols.length} cột chưa ghép: {unmappedCols.join(", ")}. Các cột này sẽ bị bỏ qua nếu không chọn thiết bị.
              </p>
            )}

            <button className="btn-primary" style={{ marginTop: 14, width: "auto" }} onClick={buildQuote}>
              Tạo báo giá →
            </button>
          </section>

          {/* Xem trước bảng số lượng theo tầng */}
          <section className="card">
            <h2>Xem trước số lượng theo tầng</h2>
            <div className="takeoff-preview-scroll">
              <table className="cat-table">
                <thead>
                  <tr>
                    <th>Tầng</th>
                    {parsed.columns.map((c) => <th key={c} className="num">{c}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {parsed.floors.map((f) => (
                    <tr key={f.name}>
                      <td className="strong">{f.name}</td>
                      {parsed.columns.map((c) => <td key={c} className="num">{f.qtys[c] || ""}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {/* Mode KTS — nhúng AIReader vào đây */}
      {mode === "kts" && (
        <AIReader
          products={products}
          setProducts={() => {}}
          company={company}
          cloud={cloud}
          onUpgrade={onUpgrade}
          embedded={true}
          ktsFileRef={ktsFileRef}
          onBack={() => { setMode(""); }}
          onCreateQuote={onCreateQuote}
        />
      )}

    </div>
  );
}

// handleKTSFile là prop của AIReader — xử lý bên trong AIReader component

// ============================================================
// TAB 2 — Bảng giá thiết bị (catalog)
// ============================================================
// ============================================================
// CATALOG IMPORTER — Drag & drop Excel/PDF, AI nhận diện cột
// ============================================================
function CatalogImporter({ products, setProducts, company, onClose, cloud, onUpgrade,
  imgDragging, setImgDragging, imgStatus, setImgStatus, imgFolderRef, handleImgDrop, handleImgFiles,
  importSourceKind = "catalog" }) {
  const [step, setStep]           = useState("drop");
  const [file, setFile]           = useState(null);
  const [batchMode, setBatchMode] = useState(false);
  const [batchLog, setBatchLog]   = useState([]);
  const [rawRows, setRawRows]     = useState([]);
  const [manualStartRow, setManualStartRow] = useState(1); // 1-based, tính từ dòng data sau header
  const [manualEndRow, setManualEndRow] = useState("");  // rỗng = tới cuối
  const [headers, setHeaders]     = useState([]);       // tên cột trong file
  const [colMap, setColMap]       = useState({});       // fieldKey → colIndex
  const [parsed, setParsed]       = useState([]);       // [{name,sku,category,supplier,unit,costPrice,specs}]
  const [importResult, setImportResult] = useState(null); // ImportPreviewResult chuẩn Phase 2
  const [aiStatus, setAiStatus]   = useState("");
  const [mergeMode, setMergeMode] = useState("merge");  // merge | replace
  const [dragging, setDragging]   = useState(false);
  const [cacheHits, setCacheHits] = useState(0);
  const [editingIndex, setEditingIndex] = useState(null);
  const [editingDraft, setEditingDraft] = useState(null);
  const [previewFilter, setPreviewFilter] = useState("all");
  const [highlightedPreviewIndex, setHighlightedPreviewIndex] = useState(null);
  const [priceColumnConfirmed, setPriceColumnConfirmed] = useState(false);
  const [templateNotice, setTemplateNotice] = useState("");
  const [templateLibrary, setTemplateLibrary] = useState([]);
  const [templateSuggestions, setTemplateSuggestions] = useState([]);
  const [selectedTemplateKey, setSelectedTemplateKey] = useState("");
  const [learningNotice, setLearningNotice] = useState("");
  const [learningStats, setLearningStats] = useState(() => {
    try { return listCorrectionLearningStats(); } catch { return { skuRules: 0, rawRules: 0, supplierProfiles: 0 }; }
  });
  const [webUrl, setWebUrl] = useState("");
  const [webSupplier, setWebSupplier] = useState("");
  const [webImporting, setWebImporting] = useState(false);
  const [webStatus, setWebStatus] = useState("");
  const fileRef = useRef();
  const imgFilesInputRef = useRef(null);
  const imgFolderInputRef = useRef(null);
  const products_ref = useRef(products);
  useEffect(() => { products_ref.current = products; }, [products]);

  // ── LỚP 3: CACHE — không gọi AI lại cho file giống nhau ──
  const getCached = (hash) => {
    try {
      const c = tenantStorageGetItem("sq_pdf_cache_" + hash);
      return c ? JSON.parse(c) : null;
    } catch { return null; }
  };
  const setCached = (hash, items) => {
    try {
      const keys = tenantStorageKeysWithPrefix("sq_pdf_cache_");
      if (keys.length > 30) tenantStorageRemoveItem(keys[0]);
      tenantStorageSetItem("sq_pdf_cache_" + hash, JSON.stringify(items));
    } catch {}
  };

  // ── LỚP 2: QUOTA — đếm số file PDF dùng AI trong tháng ──
  const getQuota = () => {
    try {
      const month = new Date().toISOString().slice(0, 7);
      const data = JSON.parse(tenantStorageGetItem("sq_ai_quota") || "{}");
      if (data.month !== month) return { month, pdfCount: 0 };
      return data;
    } catch { return { month: new Date().toISOString().slice(0,7), pdfCount: 0 }; }
  };
  const incQuota = (n = 1) => {
    const q = getQuota();
    q.pdfCount = (q.pdfCount || 0) + n;
    tenantStorageSetItem("sq_ai_quota", JSON.stringify(q));
    return q.pdfCount;
  };
  const billingForImporter = getBillingFromCloud(cloud);
  const PDF_QUOTA_LIMIT = cloud?.enabled ? (billingForImporter?.limits?.pdf_extract ?? 0) : ((company?.pdfQuotaLimit) || 50);

  const hasCapabilityQuiet = (capabilityKey) => !cloud?.enabled || canAccessCapability(cloud.billing, capabilityKey).ok;
  const applyLearningIfAllowed = (items, meta = {}) => hasCapabilityQuiet("correction_learning")
    ? applyCorrectionLearning(items, meta)
    : { products: items || [], hits: 0 };

  // ── TEMPLATE MEMORY: centralized in import-engine/templateMemory.js ──
  const loadCatalogTemplate = (hdrs, fileName) => hasCapabilityQuiet("template_memory") ? loadStoredCatalogTemplate(hdrs, fileName) : null;
  const saveCatalogTemplate = (hdrs = headers, fileName = file?.name || "", extra = {}) => {
    if (!guardCapability(cloud, "template_memory", onUpgrade)) return false;
    const result = persistCatalogTemplate({
      headers: hdrs,
      fileName,
      colMap,
      manualStartRow,
      manualEndRow,
      extra,
    });
    if (result.ok) {
      setTemplateNotice(`✓ Đã lưu template mapping cho ${result.template?.name || "file này"}`);
      return true;
    }
    setTemplateNotice("Không lưu được template mapping trên trình duyệt này.");
    return false;
  };
  const refreshTemplateLibrary = (hdrs = headers, fileName = file?.name || "") => {
    if (!hasCapabilityQuiet("template_memory")) { setTemplateLibrary([]); setTemplateSuggestions([]); return; }
    try {
      const all = listStoredCatalogTemplates();
      setTemplateLibrary(all);
      setTemplateSuggestions(hdrs?.length ? suggestStoredCatalogTemplates(hdrs, fileName, 8) : all.slice(0, 8));
    } catch {
      setTemplateLibrary([]);
      setTemplateSuggestions([]);
    }
  };

  const refreshLearningStats = () => {
    try { setLearningStats(listCorrectionLearningStats()); } catch {}
  };

  const saveCurrentMappingTemplate = () => {
    if (!headers.length) { notify.warning("Chưa có file/header để lưu template."); return; }
    if (!colMap.name && !colMap.sku) { notify.warning("Cần map ít nhất cột Tên sản phẩm hoặc Mã SKU trước khi lưu template."); return; }
    const ok = saveCatalogTemplate(headers, file?.name || "");
    if (ok) refreshTemplateLibrary(headers, file?.name || "");
  };

  const applyCatalogTemplate = (tpl) => {
    if (!tpl?.colMap) return;
    setColMap(tpl.colMap || {});
    setManualStartRow(tpl.manualStartRow || 1);
    setManualEndRow(tpl.manualEndRow ?? "");
    setSelectedTemplateKey(tpl.key || "");
    setTemplateNotice(`✓ Đã áp dụng template: ${tpl.name || tpl.fileName || "mapping đã lưu"}`);
  };

  const applySelectedTemplate = () => {
    if (!guardCapability(cloud, "template_memory", onUpgrade)) return;
    const tpl = templateLibrary.find((t) => t.key === selectedTemplateKey) || templateSuggestions.find((t) => t.key === selectedTemplateKey);
    if (!tpl) { notify.warning("Chọn một template mapping trước."); return; }
    applyCatalogTemplate(tpl);
  };

  const deleteSelectedTemplate = async () => {
    if (!guardCapability(cloud, "template_memory", onUpgrade)) return;
    if (!selectedTemplateKey) { notify.warning("Chọn template cần xóa."); return; }
    const tpl = templateLibrary.find((t) => t.key === selectedTemplateKey) || templateSuggestions.find((t) => t.key === selectedTemplateKey);
    if (!(await confirmAction({ title: "Xóa template mapping?", message: `Bạn sắp xóa “${tpl?.name || "template này"}”.`, confirmLabel: "Xóa", tone: "danger" }))) return;
    if (deleteStoredCatalogTemplate(selectedTemplateKey)) {
      setSelectedTemplateKey("");
      refreshTemplateLibrary(headers, file?.name || "");
      setTemplateNotice("Đã xóa template mapping.");
    }
  };

  const learnFromProducts = (items, meta = {}) => {
    if (!hasCapabilityQuiet("correction_learning")) return 0;
    const valid = (items || []).filter((p) => p && (p.name || p.sku));
    if (!valid.length) return 0;
    const res = saveProductLearningBatch(valid, {
      fileName: file?.name || meta.fileName || "",
      detectedIndustry: importResult?.detectedIndustry || meta.detectedIndustry || "catalog",
      ...meta,
    });
    refreshLearningStats();
    return res.saved || 0;
  };

  const logCatalogImportIfCloud = (items, meta = {}) => {
    if (!cloud?.enabled || !cloud.dealerId || !(items || []).length) return;
    logCloudCatalogImport(cloud.dealerId, {
      sourceType: meta.sourceType || importResult?.importType || importResult?.engine || "catalog",
      sourceName: meta.sourceName || file?.name || importResult?.fileName || webUrl || "import",
      mergeMode: meta.mergeMode || mergeMode,
      products: items,
      reviewRows: Number(meta.reviewRows || importResult?.summary?.needReview || 0),
      status: meta.status || "applied",
    }).catch((error) => console.warn("Không ghi được import log catalog:", error));
  };

  // Các field cần map
  const FIELDS = [
    { key: "name",      label: "Tên sản phẩm",   required: true  },
    { key: "sku",       label: "Mã SKU",          required: false },
    { key: "category",  label: "Nhóm / Danh mục", required: false },
    { key: "supplier",  label: "Nhà cung cấp",    required: false },
    { key: "unit",      label: "Đơn vị tính",     required: false },
    { key: "costPrice", label: "Giá nhập / Giá gốc", required: false },
    { key: "currentListPrice", label: "Giá hiện hành / Điều chỉnh", required: false },
    { key: "listPrice", label: "Giá công bố / Niêm yết cũ", required: false },
    { key: "minRetailPrice", label: "Giá bán lẻ thấp nhất", required: false },
    { key: "specs",     label: "Thông số kỹ thuật", required: false },
    { key: "image",     label: "Ảnh URL", required: false },
  ];

  const isOldQuoteImportForFile = (fileName = "") => importSourceKind === "old_quote" || isLikelyOldQuoteFileName(fileName);
  const oldQuoteGuardSkipCount = (items = []) => (items || []).filter((p) => p?._meta?.oldQuoteGuardSkipped).length;
  const oldQuoteGuardWarnings = (items = [], fileName = "") => {
    const count = oldQuoteGuardSkipCount(items);
    if (!count) return [];
    const modeText = isOldQuoteImportForFile(fileName) ? "báo giá cũ" : "file có cấu trúc báo giá";
    return [`Đã bỏ qua ${count} dòng hạng mục/tổng nhóm từ ${modeText}; các dòng này không được lưu vào danh mục sản phẩm.`];
  };
  const sanitizeImportedProducts = (items, opts = {}) => {
    const sourceName = opts.sourceFileName || opts.fileName || file?.name || "";
    return sanitizeCatalogProducts(items, {
      ...opts,
      sourceFileName: sourceName,
      importSourceKind,
      oldQuoteMode: isOldQuoteImportForFile(sourceName),
    });
  };

  // Đọc file và detect headers
  // Xử lý nhiều file cùng lúc — mỗi file parse riêng, gộp kết quả
  const handleMultipleFiles = async (files) => {
    const { accepted: fileList, rejected } = filterSafeSmartQuoteFiles(
      Array.from(files).filter(f => /\.(xlsx|xls|pdf)$/i.test(f.name)),
      { allow: ["excel", "pdf"] }
    );
    if (rejected.length) notify.info("Một số file bị bỏ qua vì không an toàn/quá lớn:\n\n" + rejectedFilesMessage(rejected));
    if (!fileList.length) {
      notify.warning("Không tìm thấy file Excel hoặc PDF hợp lệ.");
      return;
    }

    setStep("mapping");
    setBatchMode(true);
    const fileLog = [];

    // Tách Excel (engine v2, deterministic) và PDF (cần AI)
    const excelFiles = fileList.filter(f => /\.(xlsx|xls)$/i.test(f.name));
    const pdfFiles   = fileList.filter(f => /\.pdf$/i.test(f.name));
    if (pdfFiles.length && (!guardCapability(cloud, "ai_import", onUpgrade) || !guardFeature(cloud, "pdf_extract", pdfFiles.length, onUpgrade))) {
      setStep("drop");
      return;
    }
    let allProducts = [];
    let filePreviews = [];
    let totalLearningHits = 0;

    // AI fallback chỉ dùng khi engine deterministic kém
    const aiExtract = async (payload) => {
      const quota = getQuota();
      if (quota.pdfCount >= PDF_QUOTA_LIMIT) return null;
      return null; // Excel không cần AI; để null = chỉ deterministic
    };

    // 1) Excel qua engine v2
    if (excelFiles.length) {
      setAiStatus(`Đang đọc ${excelFiles.length} file Excel (engine v2)...`);
      try {
        const { products, perFile, preview } = await importManyForUI(excelFiles, {
          catalog: products_ref.current || [],
          aiExtract,
        });
        const learned = applyLearningIfAllowed(products, { fileName: `${excelFiles.length} Excel files` });
        totalLearningHits += learned.hits || 0;
        allProducts = allProducts.concat(sanitizeImportedProducts(learned.products, { fileName: `${excelFiles.length} Excel files` }));
        perFile.forEach(pf => {
          fileLog.push(`✓ ${pf.name}: ${pf.count} SP (${pf.engine}${pf.domain ? ", " + pf.domain : ""})`);
          (pf.warnings || []).forEach(w => fileLog.push(`  ⚠ ${w}`));
        });
        setBatchLog([...fileLog]);
        if (preview) filePreviews.push(preview);
      } catch (e) {
        fileLog.push(`✗ Lỗi đọc Excel: ${e.message}`);
        setBatchLog([...fileLog]);
      }
    }

    // 2) PDF qua AI (giữ flow cũ: cache + quota)
    for (let i = 0; i < pdfFiles.length; i++) {
      const f = pdfFiles[i];
      setAiStatus(`Đang đọc PDF ${i + 1}/${pdfFiles.length}: ${f.name}...`);
      try {
        const items = await parsePDFToProducts(f);
        const learnedPdf = applyLearningIfAllowed(items, { fileName: f.name });
        totalLearningHits += learnedPdf.hits || 0;
        allProducts = allProducts.concat(sanitizeImportedProducts(learnedPdf.products, { fileName: f.name }));
        if (items.importPreview) filePreviews.push(items.importPreview);
        fileLog.push(`✓ ${f.name}: ${items.length} SP (AI)`);
      } catch (err) {
        fileLog.push(`✗ ${f.name}: ${err.message}`);
      }
      setBatchLog([...fileLog]);
    }

    // Khử trùng theo SKU (giữ bản cuối)
    const seen = {};
    const deduped = [];
    allProducts.forEach(p => {
      const key = (p.sku || p.name || "").toLowerCase().trim();
      if (key && seen[key] !== undefined) deduped[seen[key]] = p;
      else { seen[key] = deduped.length; deduped.push(p); }
    });

    const cleanDeduped = sanitizeImportedProducts(deduped, { fileName: `${fileList.length} files` });
    setParsed(cleanDeduped);
    setLearningNotice(totalLearningHits > 0 ? `✓ Áp dụng ${totalLearningHits} học từ lần sửa trước` : "");
    refreshLearningStats();
    const batchWarnings = [
      ...filePreviews.flatMap((p) => p?.warnings || []),
      ...oldQuoteGuardWarnings(cleanDeduped, `${fileList.length} files`),
    ];
    setImportResult(productsToImportPreviewResult({
      products: cleanDeduped,
      fileName: `${fileList.length} files`,
      engine: "mixed",
      importType: "catalog_batch",
      warnings: batchWarnings,
      summary: { skipped: filePreviews.reduce((sum, p) => sum + Number(p?.summary?.skipped || 0), 0) },
    }));
    const skippedByOldQuoteGuard = oldQuoteGuardSkipCount(cleanDeduped);
    setAiStatus(`✓ Đọc xong ${fileList.length} file — ${cleanDeduped.length - skippedByOldQuoteGuard} sản phẩm có thể nhập${skippedByOldQuoteGuard ? ` · bỏ qua ${skippedByOldQuoteGuard} dòng hạng mục/tổng nhóm` : ""}`);
    setStep("preview");
  };

  // Parse PDF → mảng sản phẩm (pipeline v2: text extraction → chunk AI → legacy fallback)
  const parsePDFToProducts = async (f) => {
    return parsePdfCatalogWithClaude(f, {
      getCached,
      setCached,
      getQuota,
      incQuota,
      quotaLimit: PDF_QUOTA_LIMIT,
      onCacheHit: () => setCacheHits(h => h + 1),
      onProgress: (event) => {
        if (event?.message) {
          setAiStatus(event.message);
          setBatchLog(prev => {
            const next = [...prev, event.message];
            return next.slice(-12);
          });
        }
      },
    });
  };

  const handleFile = async (f) => {
    if (!f) return;
    try { assertSmartQuoteUploadFile(f, { allow: ["excel", "pdf"] }); }
    catch (error) { notify.error(error.message); return; }
    setFile(f);
    const ext = f.name.split(".").pop().toLowerCase();
    if (ext === "pdf") await handlePDF(f);
    else await handleExcel(f);
  };

  const handleExcel = async (f) => {
    setStep("mapping");
    setBatchMode(true);
    setBatchLog([`Đang đọc ${f.name} (engine v2)...`]);
    try {
      const { result, preview, products: items } = await importFileForUI(f, {
        catalog: products_ref.current || [],
      });
      if (!items.length) {
        setAiStatus("Không trích được sản phẩm nào.");
        setBatchLog([`✗ ${f.name}: không có sản phẩm`]);
        return;
      }
      const learned = applyLearningIfAllowed(items, { fileName: f.name, detectedIndustry: preview?.detectedIndustry || result?.domain });
      const cleanItems = sanitizeImportedProducts(learned.products, { fileName: f.name });
      setLearningNotice(learned.hits > 0 ? `✓ Áp dụng ${learned.hits} học từ lần sửa trước` : "");
      refreshLearningStats();
      setParsed(cleanItems);
      const skippedByOldQuoteGuard = oldQuoteGuardSkipCount(cleanItems);
      setImportResult(productsToImportPreviewResult({
        products: cleanItems,
        fileName: f.name,
        engine: preview?.engine || "excel-v2",
        detectedIndustry: preview?.detectedIndustry || "unknown",
        detectedTemplateId: preview?.detectedTemplateId || null,
        templateKnown: !!preview?.templateKnown,
        warnings: [...(preview?.warnings || []), ...oldQuoteGuardWarnings(cleanItems, f.name)],
        summary: { skipped: (preview?.summary?.skipped || 0) + skippedByOldQuoteGuard, noteRows: preview?.summary?.noteRows || 0 },
      }));
      const s = result.stats;
      setBatchLog([
        `✓ ${f.name}: ${Math.max(0, cleanItems.length - skippedByOldQuoteGuard)} SP có thể nhập${skippedByOldQuoteGuard ? ` · bỏ qua ${skippedByOldQuoteGuard} dòng hạng mục/tổng nhóm` : ""} (${result.engine}${result.domain ? ", " + result.domain : ""})`,
        `   khớp catalog: ${s.matched} · mới: ${s.new} · cần xem: ${s.review} · loại: ${s.rejected}`,
        ...(result.warnings || []).map(w => `   ⚠ ${w}`),
        ...oldQuoteGuardWarnings(cleanItems, f.name).map(w => `   ⏭ ${w}`),
      ]);
      setAiStatus(`✓ Đọc xong — ${Math.max(0, cleanItems.length - skippedByOldQuoteGuard)} sản phẩm có thể nhập${skippedByOldQuoteGuard ? ` · bỏ qua ${skippedByOldQuoteGuard} dòng hạng mục/tổng nhóm` : ""}`);
      setStep("preview");
      cloud?.refreshBilling?.();
    } catch (e) {
      setAiStatus("Lỗi đọc file: " + e.message);
      setBatchLog([`✗ ${f.name}: ${e.message}`]);
    }
  };

  const handlePDF = async (f) => {
    if (!guardCapability(cloud, "ai_import", onUpgrade) || !guardFeature(cloud, "pdf_extract", 1, onUpgrade)) return;
    setAiStatus("🤖 AI đang đọc PDF — trích xuất tất cả sản phẩm...");
    setStep("mapping");
    setBatchMode(true);
    setBatchLog([`Đang xử lý: ${f.name}`]);
    try {
      const items = await parsePDFToProducts(f);
      if (!items.length) {
        setAiStatus("Không tìm thấy sản phẩm nào trong PDF.");
        setBatchLog([`✗ ${f.name}: không có sản phẩm`]);
        return;
      }
      const learned = applyLearningIfAllowed(items, { fileName: f.name, detectedIndustry: items.importPreview?.detectedIndustry || "pdf" });
      const cleanItems = sanitizeImportedProducts(learned.products, { fileName: f.name });
      setLearningNotice(learned.hits > 0 ? `✓ Áp dụng ${learned.hits} học từ lần sửa trước` : "");
      refreshLearningStats();
      setParsed(cleanItems);
      const skippedByOldQuoteGuard = oldQuoteGuardSkipCount(cleanItems);
      setImportResult(productsToImportPreviewResult({
        products: cleanItems,
        fileName: f.name,
        engine: items.importPreview?.engine || "pdf-v2",
        detectedIndustry: items.importPreview?.detectedIndustry || "pdf",
        warnings: [...(items.importPreview?.warnings || []), ...oldQuoteGuardWarnings(cleanItems, f.name)],
        summary: { skipped: (items.importPreview?.summary?.skipped || 0) + skippedByOldQuoteGuard },
      }));
      setBatchLog([`✓ ${f.name}: ${Math.max(0, cleanItems.length - skippedByOldQuoteGuard)} sản phẩm có thể nhập${skippedByOldQuoteGuard ? ` · bỏ qua ${skippedByOldQuoteGuard} dòng hạng mục/tổng nhóm` : ""}`]);
      setAiStatus(`✓ AI đọc xong — ${Math.max(0, cleanItems.length - skippedByOldQuoteGuard)} sản phẩm có thể nhập${skippedByOldQuoteGuard ? ` · bỏ qua ${skippedByOldQuoteGuard} dòng hạng mục/tổng nhóm` : ""}`);
      setStep("preview");
      cloud?.refreshBilling?.();
    } catch (e) {
      setAiStatus("Lỗi đọc PDF: " + e.message);
      setBatchLog([`✗ ${f.name}: ${e.message}`]);
    }
  };

  const handleWebImport = async () => {
    const url = String(webUrl || "").trim();
    if (!url) {
      setWebStatus("Nhập URL trang danh mục/trang sản phẩm trước.");
      return;
    }
    let normalizedUrl = url;
    if (!/^https?:\/\//i.test(normalizedUrl)) normalizedUrl = `https://${normalizedUrl}`;
    if (!guardFeature(cloud, "web_scrape", 1, onUpgrade)) return;

    setWebImporting(true);
    setWebStatus("");
    setAiStatus("Đang cào danh sách sản phẩm từ web...");
    setBatchMode(true);
    setStep("mapping");
    setBatchLog([`Đang đọc web: ${normalizedUrl}`]);

    try {
      const response = await smartQuoteFetch("/api/web-products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: normalizedUrl, supplier: webSupplier, limit: 300, crawl: true, maxPages: 32 }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);

      const webProducts = webScrapeItemsToProducts(payload, {
        sourceUrl: payload.sourceUrl || normalizedUrl,
        defaultSupplier: webSupplier || payload.siteName || payload.hostname || "Web",
      });
      if (!webProducts.length) {
        setAiStatus("Không trích được sản phẩm từ URL này.");
        setBatchLog([`✗ ${normalizedUrl}: không có sản phẩm rõ ràng`, ...(payload.warnings || []).map(w => `⚠ ${w}`)]);
        setWebStatus("Không trích được sản phẩm. Thử trang danh mục có HTML tĩnh, hoặc dùng Excel/PDF từ nhà cung cấp.");
        setStep("drop");
        return;
      }

      const learned = applyLearningIfAllowed(webProducts, { fileName: payload.sourceUrl || normalizedUrl, detectedIndustry: "web_catalog" });
      const cleanItems = sanitizeImportedProducts(learned.products, { defaultSupplier: webSupplier || payload.siteName || payload.hostname || "Web", fileName: payload.sourceUrl || normalizedUrl });
      setFile({ name: payload.sourceUrl || normalizedUrl });
      setLearningNotice(learned.hits > 0 ? `✓ Áp dụng ${learned.hits} học từ lần sửa trước` : "");
      refreshLearningStats();
      setParsed(cleanItems);
      setImportResult(productsToImportPreviewResult({
        products: cleanItems,
        fileName: payload.sourceUrl || normalizedUrl,
        engine: payload.engine || "web-scrape",
        detectedIndustry: "web_catalog",
        warnings: payload.warnings || [],
      }));
      const imageCount = cleanItems.filter((p) => p.image).length;
      setBatchLog([
        `✓ ${payload.hostname || normalizedUrl}: ${cleanItems.length} sản phẩm từ web · ${imageCount} ảnh`,
        payload.pagesScanned ? `   đã đọc ${payload.pagesScanned} trang category/pagination` : "",
        ...(payload.warnings || []).map(w => `⚠ ${w}`),
      ]);
      setWebStatus(`✓ Đã cào ${cleanItems.length} sản phẩm, lấy được ${imageCount} ảnh${payload.pagesScanned ? ` từ ${payload.pagesScanned} trang` : ""}.`);
      setAiStatus(`✓ Đã cào xong — ${cleanItems.length} sản phẩm · ${imageCount} ảnh${payload.pagesScanned ? ` · ${payload.pagesScanned} trang` : ""}`);
      setStep("preview");
      cloud?.refreshBilling?.();
    } catch (e) {
      setAiStatus("Lỗi cào web: " + e.message);
      setBatchLog([`✗ ${normalizedUrl}: ${e.message}`]);
      setWebStatus("Lỗi cào web: " + e.message);
      setStep("drop");
    } finally {
      setWebImporting(false);
    }
  };

  const processRows = (rows, fileName) => {
    if (!rows || rows.length < 2) {
      notify.warning("File không có đủ dữ liệu (cần ít nhất 1 dòng tiêu đề + dòng data).");
      return;
    }
    // Tìm hàng header — hàng có nhiều text nhất trong 10 dòng đầu
    let headerRowIdx = 0;
    let maxTextCells = 0;
    for (let i = 0; i < Math.min(10, rows.length); i++) {
      const textCount = (rows[i] || []).filter(c => c && String(c).trim().length > 1 && isNaN(c)).length;
      if (textCount > maxTextCells) { maxTextCells = textCount; headerRowIdx = i; }
    }
    const hdrs = (rows[headerRowIdx] || []).map((h, i) => ({ label: String(h ?? `Cột ${i+1}`).trim(), idx: i }));
    const dataRows = rows.slice(headerRowIdx + 1).filter(r => r.some(c => c !== null && c !== ""));
    setHeaders(hdrs);
    setRawRows(dataRows);
    setManualStartRow(1);
    setManualEndRow("");
    refreshTemplateLibrary(hdrs, fileName);

    // Template memory: nếu đã map file cùng format trước đó, tự dùng lại.
    const savedTemplate = loadCatalogTemplate(hdrs, fileName);
    if (savedTemplate?.colMap) {
      setColMap(savedTemplate.colMap || {});
      setManualStartRow(savedTemplate.manualStartRow || 1);
      setManualEndRow(savedTemplate.manualEndRow ?? "");
      setTemplateNotice(`✓ Đã dùng template đã lưu: ${savedTemplate.name || "catalog"}`);
      setAiStatus(`✓ Đã dùng template mapping đã lưu — kiểm tra lại nếu nhà cung cấp đổi file`);
    } else {
      setTemplateNotice("");
      // AI auto-map cột
      autoMapColumns(hdrs, rows.slice(headerRowIdx + 1, headerRowIdx + 6), fileName);
    }
    setStep("mapping");
  };

  // Đoán cột theo tên header — chạy ngay không cần AI
  const guessColumnsByName = (hdrs) => guessCatalogColumnsByName(hdrs);

  const autoMapColumns = async (hdrs, sampleRows, fileName) => {
    const guessed = guessColumnsByName(hdrs);
    setColMap(guessed);

    const isVercel = window.location.protocol === "https:";
    if (!isVercel) {
      setAiStatus(guessed.name ? "✓ Đã đoán cột theo tên — kiểm tra lại bên dưới" : "Chọn cột thủ công bên dưới");
      return;
    }

    if (!guardCapability(cloud, "ai_import", onUpgrade) || !guardFeature(cloud, "ai_claude_request", 1, onUpgrade)) {
      setAiStatus(guessed.name ? "✓ Đã đoán cột theo tên — AI chưa mở hoặc hết quota nên không auto-map" : "AI chưa mở hoặc hết quota — chọn cột thủ công bên dưới");
      return;
    }

    setAiStatus("AI đang nhận diện cột...");
    try {
      const mapping = await autoMapCatalogColumnsWithClaude({ headers: hdrs, sampleRows, fileName });
      cloud?.refreshBilling?.();
      const mapped = {};
      Object.entries(mapping || {}).forEach(([k, v]) => { if (v !== null && v !== undefined) mapped[k] = String(v); });
      setColMap(mapped);
      setAiStatus("✓ AI nhận diện xong");
    } catch {
      setAiStatus(guessed.name ? "✓ Đã đoán cột theo tên — kiểm tra lại bên dưới" : "Chọn cột thủ công bên dưới");
    }
  };

  const getManualSelectedRows = () => {
    const total = rawRows.length;
    const start = Math.max(1, Math.min(total || 1, Number(manualStartRow) || 1));
    const end = manualEndRow === "" || manualEndRow == null
      ? total
      : Math.max(start, Math.min(total, Number(manualEndRow) || total));
    return { start, end, rows: rawRows.slice(start - 1, end) };
  };

  const buildPreview = () => {
    const selected = getManualSelectedRows();
    const rawPreview = buildCatalogPreview(selected.rows, colMap, {
      startRowIndex: selected.start - 1,
      defaultSupplier: file?.name?.replace(/\.(xlsx|xls)$/i, "") || "",
      sheetName: file?.name || "manual-mapping.xlsx",
    });
    const learned = applyLearningIfAllowed(rawPreview, { fileName: file?.name || "manual-mapping.xlsx" });
    const result = sanitizeImportedProducts(learned.products, { fileName: file?.name || "manual-mapping.xlsx" });
    setLearningNotice(learned.hits > 0 ? `✓ Áp dụng ${learned.hits} học từ lần sửa trước` : "");
    refreshLearningStats();
    setParsed(result);
    const rangeWarnings = selected.start > 1 || selected.end < rawRows.length ? [`Chỉ import dòng ${selected.start}–${selected.end} trong ${rawRows.length} dòng data`] : [];
    setImportResult(productsToImportPreviewResult({
      products: result,
      fileName: file?.name || "manual-mapping.xlsx",
      engine: "manual-column-mapping",
      warnings: [...rangeWarnings, ...oldQuoteGuardWarnings(result, file?.name || "manual-mapping.xlsx")],
      summary: { skipped: oldQuoteGuardSkipCount(result) },
    }));
    setStep("preview");
  };

  const openManualMapping = async () => {
    if (!file || !/\.(xlsx|xls)$/i.test(file.name)) {
      notify.info("Sửa mapping hiện chỉ hỗ trợ file Excel. Với PDF, hãy sửa trực tiếp từng dòng trong preview hoặc upload file Excel nếu nhà cung cấp có.");
      return;
    }
    try {
      setAiStatus("Đang mở mapping cột thủ công...");
      const { rows, fileName } = await readCatalogRowsForManualMapping(file);
      setBatchMode(false);
      processRows(rows, fileName);
    } catch (e) {
      notify.error("Không mở được mapping thủ công: " + e.message);
    }
  };

  const rebuildImportResultFromParsed = (list, engine = "user-reviewed") => {
    setImportResult(productsToImportPreviewResult({
      products: list,
      fileName: file?.name || "import",
      engine,
      detectedIndustry: importResult?.detectedIndustry || "catalog",
      detectedTemplateId: importResult?.detectedTemplateId || null,
      templateKnown: !!importResult?.templateKnown,
      warnings: importResult?.warnings || [],
      summary: { skipped: importResult?.summary?.skipped || 0, noteRows: importResult?.summary?.noteRows || 0 },
    }));
  };

  const getProductLineId = (p) => p?._meta?.lineId || p?.lineId || "";
  const getLineForProductIndex = (index, product = parsed[index]) => {
    const id = getProductLineId(product);
    if (id && importResult?.lines?.length) {
      const byId = importResult.lines.find((l) => l.lineId === id);
      if (byId) return byId;
    }
    return importResult?.lines?.[index] || null;
  };
  const issueLevel = (it) => typeof it === "string" ? (/lỗi|error|thiếu tên|không phải|bất thường|không tách được/i.test(it) ? "error" : "warning") : (it?.level || "warning");
  const issueCode = (it) => typeof it === "string" ? String(it).toLowerCase() : String(it?.code || "").toLowerCase();
  const getPreviewIssues = (p, index = null) => {
    const productIssues = p?._meta?.issues || p?.issues || [];
    const line = Number.isInteger(index) ? getLineForProductIndex(index, p) : null;
    const lineIssues = line?.issues || [];
    return [...productIssues, ...lineIssues].filter(Boolean);
  };
  const isPriceColumnUncertainIssue = (it) => issueCode(it) === "price_column_uncertain";
  const isPriceSafetyIssue = (it) => ["price_column_uncertain", "price_scaled_from_header", "price_scale_suspect"].includes(issueCode(it));
  const hasPriceColumnUncertainIssue = (p, index) => getPreviewIssues(p, index).some(isPriceColumnUncertainIssue);
  const hasPriceSafetyIssue = (p, index) => getPreviewIssues(p, index).some(isPriceSafetyIssue);
  const priceSafetyRows = () => parsed
    .map((p, index) => ({ p, index, issues: getPreviewIssues(p, index).filter(isPriceSafetyIssue) }))
    .filter((r) => r.issues.length);
  const priceColumnUncertainRows = () => parsed
    .map((p, index) => ({ p, index, issues: getPreviewIssues(p, index).filter(isPriceColumnUncertainIssue) }))
    .filter((r) => r.issues.length);
  const isBlockingIssue = (it) => {
    const code = issueCode(it);
    const msg = typeof it === "string" ? it.toLowerCase() : String(it?.message || "").toLowerCase();
    if (issueLevel(it) === "error") return true;
    return /missing_product_name|price_parse_failed|price_unreasonable|non_product_row|name_too_long/.test(code)
      || /thiếu tên|không phải sản phẩm|giá nhập bất thường|không tách được giá|tên sản phẩm quá dài/.test(msg);
  };
  const isWarningOnlyProduct = (p, index = null) => {
    const issues = getPreviewIssues(p, index);
    if (!issues.length) return false;
    return !issues.some(isBlockingIssue);
  };
  const getPreviewCounts = (list = parsed) => {
    const rows = list.map((p, index) => ({ p, index }));
    const blocking = rows.filter(({ p, index }) => getPreviewIssues(p, index).some(isBlockingIssue)).length;
    const warningOnly = rows.filter(({ p, index }) => isWarningOnlyProduct(p, index)).length;
    const priceUncertain = rows.filter(({ p, index }) => hasPriceColumnUncertainIssue(p, index)).length;
    const priceSafety = rows.filter(({ p, index }) => hasPriceSafetyIssue(p, index)).length;
    const safeWarningOnly = rows.filter(({ p, index }) => isWarningOnlyProduct(p, index) && !hasPriceColumnUncertainIssue(p, index)).length;
    const clean = list.length - blocking - warningOnly;
    const skipped = importResult?.summary?.skipped || 0;
    return { clean: Math.max(0, clean), warningOnly, safeWarningOnly, blocking, priceUncertain, priceSafety, skipped, willImport: Math.max(0, clean), needFix: warningOnly + blocking };
  };

  const getPreviewStatusForRow = (p, index) => getLineForProductIndex(index, p)?.status || p?._meta?.canonicalStatus || p?._meta?.status || "auto_approved";
  const isCleanPreviewRow = (p, index) => {
    const issues = getPreviewIssues(p, index);
    const status = getPreviewStatusForRow(p, index);
    return !issues.length && !["failed", "need_review", "review", "rejected"].includes(status);
  };
  const isReviewPreviewRow = (p, index) => {
    const status = getPreviewStatusForRow(p, index);
    return isWarningOnlyProduct(p, index) || ["need_review", "review"].includes(status);
  };
  const isBlockingPreviewRow = (p, index) => {
    const status = getPreviewStatusForRow(p, index);
    return getPreviewIssues(p, index).some(isBlockingIssue) || ["failed", "rejected"].includes(status);
  };
  const getProblemRows = (kind = "blocking") => {
    const rows = parsed.map((p, index) => ({ p, index, line: getLineForProductIndex(index, p) }));
    if (kind === "review") return rows.filter(({ p, index }) => isReviewPreviewRow(p, index));
    if (kind === "any") return rows.filter(({ p, index }) => isBlockingPreviewRow(p, index) || isReviewPreviewRow(p, index));
    return rows.filter(({ p, index }) => isBlockingPreviewRow(p, index));
  };
  const scrollToPreviewIndex = (index) => {
    if (index == null || index < 0) return;
    setHighlightedPreviewIndex(index);
    window.setTimeout(() => {
      const el = document.querySelector(`[data-preview-index="${index}"]`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
    }, 80);
  };
  const goToPreviewIssue = (kind = "blocking", direction = "first") => {
    const rows = getProblemRows(kind);
    if (!rows.length) {
      notify.info(kind === "blocking" ? "Không còn dòng lỗi nặng." : "Không còn dòng cần kiểm tra.");
      return;
    }
    const filter = kind === "review" ? "review" : "blocking";
    setPreviewFilter(filter);
    let target = rows[0];
    if (direction === "next" || direction === "prev") {
      const currentPos = rows.findIndex(r => r.index === highlightedPreviewIndex);
      const nextPos = direction === "next"
        ? (currentPos < 0 ? 0 : (currentPos + 1) % rows.length)
        : (currentPos < 0 ? rows.length - 1 : (currentPos - 1 + rows.length) % rows.length);
      target = rows[nextPos];
    }
    scrollToPreviewIndex(target.index);
  };
  const getFilteredPreviewRows = () => {
    const rows = parsed.map((p, index) => ({ p, index, line: getLineForProductIndex(index, p) }));
    return rows.filter(({ p, index }) => {
      if (previewFilter === "all") return true;
      if (previewFilter === "clean") return isCleanPreviewRow(p, index);
      if (previewFilter === "review") return isReviewPreviewRow(p, index);
      if (previewFilter === "blocking") return isBlockingPreviewRow(p, index);
      if (previewFilter === "approved") return !!p?._meta?.userApproved || !!p?._meta?.userEdited;
      return true;
    });
  };
  const previewFilterCounts = (() => {
    const rows = parsed.map((p, index) => ({ p, index }));
    return {
      all: rows.length,
      clean: rows.filter(({ p, index }) => isCleanPreviewRow(p, index)).length,
      review: rows.filter(({ p, index }) => isReviewPreviewRow(p, index)).length,
      blocking: rows.filter(({ p, index }) => isBlockingPreviewRow(p, index)).length,
      approved: rows.filter(({ p }) => !!p?._meta?.userApproved || !!p?._meta?.userEdited).length,
    };
  })();
  const firstBlockingRow = getProblemRows("blocking")[0];
  const firstReviewRow = getProblemRows("review")[0];

  useEffect(() => {
    if (step !== "preview" || !parsed.length || previewFilter !== "all") return;
    if (previewFilterCounts.blocking > 0) setPreviewFilter("blocking");
    else if (previewFilterCounts.review > 0) setPreviewFilter("review");
    else if (previewFilterCounts.clean > 0) setPreviewFilter("clean");
  }, [step, parsed.length]);

  useEffect(() => {
    if (step !== "preview") setPriceColumnConfirmed(false);
  }, [step]);

  const approvePreviewRow = (index) => {
    const current = parsed[index];
    if (current && isBlockingPreviewRow(current, index)) {
      notify.warning("Dòng này là lỗi nặng nên không thể Duyệt nguyên dòng. Hãy bấm Sửa để chỉnh giá/tên/SKU hoặc bấm Xóa để bỏ qua.");
      goToPreviewIssue("blocking", "first");
      return;
    }
    setParsed(prev => {
      const next = prev.map((p, i) => i === index ? {
        ...p,
        _meta: {
          ...(p._meta || {}),
          issues: [],
          status: "new",
          canonicalStatus: "auto_approved",
          confidence: 0.9,
          userApproved: true,
        }
      } : p);
      if (next[index]) {
        if (hasCapabilityQuiet("correction_learning")) saveProductLearning(next[index], { fileName: file?.name || "", detectedIndustry: importResult?.detectedIndustry || "catalog", userApproved: true });
        refreshLearningStats();
      }
      rebuildImportResultFromParsed(next, "user-approved-preview");
      return next;
    });
  };

  const approveAllPreviewRows = async () => {
    const counts = getPreviewCounts(parsed);
    const safeWarningCount = counts.safeWarningOnly || 0;
    if (safeWarningCount <= 0) {
      if (counts.priceUncertain > 0 && !priceColumnConfirmed) {
        notify.info(`Có ${counts.priceUncertain} dòng cần xác nhận cột GIÁ MUA VÀO. Hãy bấm "Tôi đã kiểm tra cột giá" hoặc chọn lại mapping giá trước khi duyệt hàng loạt.`);
        const first = priceColumnUncertainRows()[0];
        if (first) { setPreviewFilter("review"); scrollToPreviewIndex(first.index); }
        return;
      }
      if (counts.blocking > 0) {
        const go = await confirmAction({
          title: "Còn dòng lỗi cần xử lý",
          message: `Không có cảnh báo nhẹ để duyệt hàng loạt. Còn ${counts.blocking} dòng lỗi nặng cần Sửa hoặc Xóa.`,
          confirmLabel: "Đi tới lỗi đầu tiên",
        });
        if (go) goToPreviewIssue("blocking", "first");
      } else {
        notify.info("Không có dòng nào cần duyệt hàng loạt.");
      }
      return;
    }
    const ok = await confirmAction({
      title: `Duyệt ${safeWarningCount} dòng cảnh báo nhẹ?`,
      message: [
        "SmartQuote chỉ duyệt các dòng cảnh báo nhẹ.",
        counts.priceUncertain && !priceColumnConfirmed ? `${counts.priceUncertain} dòng có rủi ro giá sẽ không được duyệt tự động.` : "",
        counts.blocking ? `${counts.blocking} dòng lỗi nặng vẫn được giữ lại để bạn Sửa/Xóa.` : "",
      ].filter(Boolean).join("\n\n"),
      confirmLabel: "Duyệt các dòng này",
    });
    if (!ok) return;
    setParsed(prev => {
      const rowsToLearn = prev.filter((p, i) => isWarningOnlyProduct(p, i) && !hasPriceColumnUncertainIssue(p, i));
      const next = prev.map((p, i) => {
        if (!isWarningOnlyProduct(p, i) || hasPriceColumnUncertainIssue(p, i)) return p;
        return {
          ...p,
          _meta: {
            ...(p._meta || {}),
            issues: [],
            status: "new",
            canonicalStatus: "auto_approved",
            confidence: Math.max(Number(p._meta?.confidence || 0), 0.9),
            userApproved: true,
            userApprovedAll: true,
          }
        };
      });
      learnFromProducts(rowsToLearn, { userApprovedAll: true });
      rebuildImportResultFromParsed(next, "user-approved-light-warnings");
      return next;
    });
  };

  const confirmPriceColumnSafety = async () => {
    const rows = priceColumnUncertainRows();
    if (!rows.length) {
      setPriceColumnConfirmed(true);
      return;
    }
    const ok = await confirmAction({
      title: `Xác nhận cột giá cho ${rows.length} dòng?`,
      message: "Chỉ xác nhận khi bạn đã kiểm tra đúng cột GIÁ MUA VÀO trong file. Sau bước này SmartQuote sẽ cho phép lưu các dòng này vào danh mục.",
      confirmLabel: "Tôi đã kiểm tra",
    });
    if (!ok) return;
    setPriceColumnConfirmed(true);
    setParsed(prev => {
      const next = prev.map((p, i) => {
        if (!hasPriceColumnUncertainIssue(p, i)) return p;
        return {
          ...p,
          _meta: {
            ...(p._meta || {}),
            acceptedAtPreview: true,
            priceColumnConfirmed: true,
            priceColumnConfirmedAt: new Date().toISOString(),
            status: p._meta?.status || "review",
          }
        };
      });
      rebuildImportResultFromParsed(next, "price-column-confirmed-preview");
      return next;
    });
  };

  const removePreviewRow = (index) => {
    setParsed(prev => {
      const next = prev.filter((_, i) => i !== index);
      rebuildImportResultFromParsed(next, "user-edited-preview");
      return next;
    });
    if (editingIndex === index) {
      setEditingIndex(null);
      setEditingDraft(null);
    }
  };

  const startEditPreviewRow = (index) => {
    setEditingIndex(index);
    setEditingDraft({ ...(parsed[index] || {}) });
  };

  const parseEditedPrice = (value) => {
    const n = parseSafePrice(value);
    return Number.isFinite(n) ? n : 0;
  };

  const saveEditedPreviewRow = () => {
    if (editingIndex == null || !editingDraft) return;
    const edited = {
      ...editingDraft,
      name: String(editingDraft.name || "").trim(),
      sku: String(editingDraft.sku || "").trim(),
      category: String(editingDraft.category || "Chung").trim() || "Chung",
      supplier: String(editingDraft.supplier || "").trim(),
      unit: String(editingDraft.unit || "Cái").trim() || "Cái",
      costPrice: parseEditedPrice(editingDraft.costPrice),
      listPrice: parseEditedPrice(editingDraft.listPrice || editingDraft.publicPrice),
      publicPrice: parseEditedPrice(editingDraft.listPrice || editingDraft.publicPrice),
      minRetailPrice: parseEditedPrice(editingDraft.minRetailPrice),
      priceMode: parseEditedPrice(editingDraft.listPrice || editingDraft.publicPrice) > 0 ? "fixed" : (editingDraft.priceMode || "markup"),
      specs: String(editingDraft.specs || "").trim(),
      image: String(editingDraft.image || "").trim(),
      _meta: {
        ...(editingDraft._meta || {}),
        issues: [],
        status: "new",
        canonicalStatus: "auto_approved",
        confidence: 0.92,
        userEdited: true,
      }
    };
    if (!edited.name) {
      notify.warning("Tên sản phẩm không được để trống.");
      return;
    }
    setParsed(prev => {
      const next = prev.map((p, i) => i === editingIndex ? edited : p);
      if (hasCapabilityQuiet("correction_learning")) saveProductLearning(edited, { fileName: file?.name || "", detectedIndustry: importResult?.detectedIndustry || "catalog", userEdited: true });
      refreshLearningStats();
      setLearningNotice("✓ Đã học từ dòng bạn vừa sửa");
      rebuildImportResultFromParsed(next, "user-edited-preview");
      return next;
    });
    setEditingIndex(null);
    setEditingDraft(null);
  };

  const applyImport = async () => {
    const priceDanger = priceColumnUncertainRows();
    if (priceDanger.length > 0 && !priceColumnConfirmed) {
      notify.info(`Chưa thể lưu catalog vì còn ${priceDanger.length} dòng chưa xác nhận cột GIÁ MUA VÀO.

Hãy bấm "Tôi đã kiểm tra cột giá" hoặc chọn lại cột giá trước khi lưu.`);
      setPreviewFilter("review");
      scrollToPreviewIndex(priceDanger[0].index);
      return;
    }
    const cleaned = sanitizeImportedProducts(parsed, { fileName: file?.name || "import" });
    const unsafe = cleaned.filter(isUnsafeImportedProduct);
    const safeItems = cleaned.filter(p => !isUnsafeImportedProduct(p));

    if (unsafe.length > 0) {
      const sample = unsafe.slice(0, 5).map(p => `• ${p.name || "(thiếu tên)"}: ${(p._meta?.issues || []).map(i => i.message || i).slice(0, 2).join(", ")}`).join("\n");
      const ok = await confirmAction({
        title: `${unsafe.length} dòng chưa đủ an toàn`,
        message: `${sample}${unsafe.length > 5 ? "\n..." : ""}\n\nSmartQuote có thể chỉ thêm ${safeItems.length} dòng sạch và giữ lại các dòng cần kiểm tra.`,
        confirmLabel: `Thêm ${safeItems.length} dòng sạch`,
      });
      if (!ok) {
        setParsed(cleaned);
        setImportResult(productsToImportPreviewResult({ products: cleaned, fileName: file?.name || "import", engine: "sanitized-preview" }));
        return;
      }
    }

    const finalItems = safeItems;
    if (!finalItems.length) {
      notify.warning("Không có dòng đủ sạch để nhập. Hãy sửa file nguồn hoặc import Excel thay vì PDF.");
      setParsed(cleaned);
      setImportResult(productsToImportPreviewResult({ products: cleaned, fileName: file?.name || "import", engine: "sanitized-preview" }));
      return;
    }

    const nextProductCount = (() => {
      if (mergeMode === "replace") return finalItems.length;
      const existingKeys = new Set(products.map((p) => String(p.sku || p.name || "").toLowerCase().trim()).filter(Boolean));
      const newItems = finalItems.filter((p) => {
        const key = String(p.sku || p.name || "").toLowerCase().trim();
        return key && !existingKeys.has(key);
      });
      return products.length + newItems.length;
    })();
    if (!guardProductCount(cloud, nextProductCount, onUpgrade)) return;

    const learnedCount = learnFromProducts(finalItems, { acceptedAtMerge: true });
    if (learnedCount > 0) setLearningNotice(`✓ Đã học ${learnedCount} dòng để lần sau đọc nhanh hơn`);

    if (mergeMode === "replace") {
      setProducts(finalItems);
    } else {
      // Merge: giữ cũ, cập nhật nếu trùng SKU, thêm mới nếu chưa có
      setProducts((prev) => {
        const skuMap = {};
        prev.forEach(p => { if (p.sku) skuMap[p.sku.toLowerCase()] = p.id; });
        const updated = [...prev];
        finalItems.forEach(np => {
          const key = (np.sku || "").toLowerCase();
          const existId = key ? skuMap[key] : null;
          if (existId) {
            // Cập nhật giá và thông số, giữ ảnh cũ
            const idx = updated.findIndex(p => p.id === existId);
            if (idx >= 0) updated[idx] = {
              ...updated[idx],
              costPrice: np.costPrice || updated[idx].costPrice,
              listPrice: np.listPrice || updated[idx].listPrice || 0,
              publicPrice: np.publicPrice || np.listPrice || updated[idx].publicPrice || 0,
              minRetailPrice: np.minRetailPrice || updated[idx].minRetailPrice || 0,
              priceMode: (np.listPrice || np.publicPrice) ? "fixed" : (updated[idx].priceMode || np.priceMode || "markup"),
              specs: np.specs || updated[idx].specs,
              image: updated[idx].image || np.image || "",
              category: np.category || updated[idx].category,
              supplier: np.supplier || updated[idx].supplier,
              unit: np.unit || updated[idx].unit,
            };
          } else {
            const newId = uid("p");
            updated.push({ ...np, id: newId, priceMode: (np.listPrice || np.publicPrice) ? "fixed" : (np.priceMode || "markup") });
            if (np.sku) skuMap[np.sku.toLowerCase()] = newId;
          }
        });
        return updated;
      });
    }
    logCatalogImportIfCloud(finalItems, {
      sourceType: importResult?.importType || importResult?.engine || (webUrl ? "web" : "catalog"),
      sourceName: file?.name || importResult?.fileName || webUrl || "import",
      mergeMode,
    });
    setParsed(finalItems);
    setStep("done");
  };

  const statusLabel = (status) => ({
    auto_approved: "Tự duyệt",
    need_review: "Cần kiểm tra",
    failed: "Lỗi",
    skipped: "Bỏ qua",
    matched: "Đã khớp",
    new: "Mới",
    review: "Cần xem",
    rejected: "Loại",
  }[status] || status || "—");
  const statusClass = (status) => ({
    auto_approved: "ok",
    need_review: "warn",
    failed: "err",
    skipped: "muted",
  }[status] || "");

  // Drag & drop handlers
  const onDragOver  = (e) => { e.preventDefault(); setDragging(true); };
  const onDragLeave = ()  => setDragging(false);
  const onDrop      = async (e) => {
    e.preventDefault();
    setDragging(false);
    // Thu thập file từ folder hoặc nhiều file
    const files = [];
    const items = e.dataTransfer.items;
    if (items && items.length && items[0].webkitGetAsEntry) {
      const traverse = async (entry) => {
        if (entry.isFile) {
          await new Promise(res => entry.file(f => { files.push(f); res(); }));
        } else if (entry.isDirectory) {
          const reader = entry.createReader();
          await new Promise(res => reader.readEntries(async (entries) => {
            for (const en of entries) await traverse(en);
            res();
          }));
        }
      };
      for (const item of items) {
        const entry = item.webkitGetAsEntry?.();
        if (entry) await traverse(entry);
      }
    }
    if (!files.length) Array.from(e.dataTransfer.files).forEach(f => files.push(f));

    const { accepted: valid, rejected } = filterSafeSmartQuoteFiles(files.filter(f => /\.(xlsx|xls|pdf)$/i.test(f.name)), { allow: ["excel", "pdf"] });
    if (rejected.length) notify.info("Một số file bị bỏ qua vì không an toàn/quá lớn:\n\n" + rejectedFilesMessage(rejected));
    if (valid.length === 1) handleFile(valid[0]);
    else if (valid.length > 1) handleMultipleFiles(valid);
    else notify.warning("Không tìm thấy file Excel/PDF hợp lệ.");
  };

  return (
    <div className="ci-overlay" onClick={(e) => e.target.className === "ci-overlay" && onClose()}>
      <div className="ci-modal">
        <div className="ci-head">
          <div>
            <h2 className="ci-title">{importSourceKind === "old_quote" ? "🧾 Lọc sản phẩm từ báo giá cũ" : "📥 Import catalog sản phẩm"}</h2>
            <p className="ci-sub">{importSourceKind === "old_quote" ? "Chỉ lấy sản phẩm thật vào danh mục — bỏ qua hạng mục, tổng nhóm, vật tư phụ gộp và nhân công." : "Hỗ trợ mọi ngành — nội thất, điện lạnh, smarthome, vệ sinh..."}</p>
          </div>
          <button className="ci-close" onClick={onClose}>✕</button>
        </div>

        {/* BƯỚC 1: DROP */}
        {step === "drop" && (
          <div
            className={`ci-drop${dragging ? " ci-dragging" : ""}`}
            onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}
          >
            <div className="ci-drop-icon">📂</div>
            <div className="ci-drop-title">{importSourceKind === "old_quote" ? "Kéo thả file báo giá cũ vào đây" : "Kéo thả nhiều file hoặc cả folder vào đây"}</div>
            <div className="ci-drop-sub">{importSourceKind === "old_quote" ? <>Hỗ trợ <strong>Excel (.xlsx/.xls)</strong> và <strong>PDF</strong> — SmartQuote sẽ lọc hạng mục/tổng nhóm trước khi lưu catalog</> : <>Hỗ trợ <strong>Excel (.xlsx/.xls)</strong> và <strong>PDF</strong> — import nhiều bảng giá cùng lúc</>}</div>
            <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 14 }}>
              <label htmlFor="ci-catalog-files" className="btn-primary" style={{ width: "auto", cursor: "pointer", display: "inline-flex", alignItems: "center" }}>
                📄 Chọn nhiều file
              </label>
              <label htmlFor="ci-catalog-folder" className="btn-ghost" style={{ cursor: "pointer", display: "inline-flex", alignItems: "center" }}>
                📁 Chọn cả folder
              </label>
            </div>
            <div className="ci-drop-examples" style={{ marginTop: 14 }}>
              {importSourceKind === "old_quote" ? (<>
                <span>✓ Báo giá khách hàng mẫu.xlsx</span>
                <span>✓ Báo giá căn hộ mẫu.xlsx</span>
                <span>✓ Báo giá công trình cũ.xlsx</span>
              </>) : (<>
                <span>✓ Bảng giá Lumi.xlsx</span>
                <span>✓ Catalog Bisco.pdf</span>
                <span>✓ Giá Roger 2026.xlsx</span>
              </>)}
            </div>

            <div className="ci-web-import-box" onClick={(e) => e.stopPropagation()}>
              <div className="ci-web-import-title">🌐 Cào danh sách sản phẩm từ web</div>
              <div className="ci-web-import-row">
                <input
                  type="url"
                  placeholder="Dán URL trang danh mục / trang sản phẩm"
                  value={webUrl}
                  onChange={(e) => setWebUrl(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleWebImport(); }}
                />
                <input
                  type="text"
                  placeholder="Nhà cung cấp/Brand (tuỳ chọn)"
                  value={webSupplier}
                  onChange={(e) => setWebSupplier(e.target.value)}
                />
                <button type="button" className="btn-primary" style={{ width: "auto" }} disabled={webImporting} onClick={handleWebImport}>
                  {webImporting ? "Đang cào..." : "Cào web"}
                </button>
              </div>
              <div className="ci-web-import-sub">Ưu tiên đọc schema.org/JSON-LD, sau đó dò card sản phẩm trong HTML. Kết quả vẫn qua preview để bạn sửa/xóa trước khi merge.</div>
              {webStatus && <div className="ci-web-import-status">{webStatus}</div>}
            </div>
            <input id="ci-catalog-files" type="file" accept=".xlsx,.xls,.pdf" multiple
              style={{ opacity:0, position:"absolute", width:0, height:0 }}
              onChange={(e) => { if (e.target.files.length === 1) handleFile(e.target.files[0]); else if (e.target.files.length > 1) handleMultipleFiles(e.target.files); }} />
            <input id="ci-catalog-folder" type="file" webkitdirectory="" multiple
              style={{ opacity:0, position:"absolute", width:0, height:0 }}
              onChange={(e) => handleMultipleFiles(e.target.files)} />
            {/* LỚP 1: gợi ý ưu tiên Excel */}
            <div className="ci-tip-excel">
              💡 <strong>Mẹo:</strong> {importSourceKind === "old_quote" ? <>Với báo giá cũ, hãy ưu tiên <strong>Excel</strong>. Các dòng kiểu “IV/ Hệ thống…”, “Vật tư phụ…”, “Tổng giá trị…” sẽ được đánh dấu bỏ qua để không vào catalog.</> : <>File <strong>Excel xử lý miễn phí & nhanh hơn</strong>. PDF cần AI đọc (có giới hạn {getQuota().pdfCount}/{PDF_QUOTA_LIMIT} lượt tháng này). Nếu nhà cung cấp có cả 2, hãy chọn Excel.</>}
            </div>
          </div>
        )}

        {/* BƯỚC 2: MAPPING CỘT (1 file) hoặc BATCH LOG (nhiều file) */}
        {step === "mapping" && batchMode && (
          <div className="ci-body">
            <div className="ci-ai-status">{aiStatus}</div>
            <div className="ci-batch-log">
              {batchLog.map((line, i) => (
                <div key={i} className={`ci-batch-line${line.startsWith("✓") ? " ok" : line.startsWith("✗") ? " err" : ""}`}>{line}</div>
              ))}
            </div>
            {cacheHits > 0 && (
              <div className="ci-cache-note">⚡ {cacheHits} file lấy từ bộ nhớ đệm (không tốn AI)</div>
            )}
          </div>
        )}
        {step === "mapping" && !batchMode && (
          <div className="ci-body">
            <div className="ci-file-badge">📄 {file?.name} · {rawRows.length} dòng dữ liệu</div>
            {aiStatus && <div className={`ci-ai-status${aiStatus.startsWith("✓") ? " ok" : ""}`}>{aiStatus}</div>}
            {templateNotice && <div className="ci-template-note">{templateNotice}</div>}
            <p className="ci-hint">Kiểm tra AI đã nhận diện đúng cột chưa, chỉnh nếu cần:</p>
            {(templateSuggestions.length > 0 || templateLibrary.length > 0) && (
              <div className="ci-template-library">
                <div className="ci-template-library-title">📚 Supplier Template Library</div>
                <div className="ci-template-library-row">
                  <select value={selectedTemplateKey} onChange={(e) => setSelectedTemplateKey(e.target.value)}>
                    <option value="">— Chọn template đã lưu —</option>
                    {(templateSuggestions.length ? templateSuggestions : templateLibrary.slice(0, 8)).map((tpl) => (
                      <option key={tpl.key} value={tpl.key}>
                        {(tpl.name || tpl.fileName || "Template")} {tpl.matchScore ? `· match ${Math.round(tpl.matchScore * 100)}%` : ""}
                      </option>
                    ))}
                  </select>
                  <button type="button" className="btn-ghost" onClick={applySelectedTemplate}>Áp dụng template</button>
                  <button type="button" className="btn-ghost danger" onClick={deleteSelectedTemplate}>Xóa template</button>
                </div>
                <div className="ci-template-library-sub">SmartQuote sẽ dùng lại mapping cột + khoảng dòng cho nhà cung cấp/file cùng format.</div>
              </div>
            )}
            <div className="ci-row-range-box">
              <div className="ci-row-range-title">Khoảng dòng cần import</div>
              <label>Dòng bắt đầu
                <input type="number" min="1" max={rawRows.length || 1} value={manualStartRow}
                  onChange={(e) => setManualStartRow(e.target.value)} />
              </label>
              <label>Dòng kết thúc
                <input type="number" min="1" max={rawRows.length || 1} placeholder={`Tới cuối (${rawRows.length})`} value={manualEndRow}
                  onChange={(e) => setManualEndRow(e.target.value)} />
              </label>
              <span>{getManualSelectedRows().rows.length} / {rawRows.length} dòng sẽ được xem trước</span>
            </div>
            <div className="ci-map-grid">
              {FIELDS.map(f => (
                <div key={f.key} className="ci-map-row">
                  <label className="ci-map-label">
                    {f.label}{f.required && <span className="ci-req">*</span>}
                  </label>
                  <select
                    className={`ci-map-select${!colMap[f.key] && f.required ? " ci-select-err" : ""}`}
                    value={colMap[f.key] ?? ""}
                    onChange={(e) => setColMap(c => ({ ...c, [f.key]: e.target.value }))}
                  >
                    <option value="">— Không có —</option>
                    {headers.map(h => (
                      <option key={h.idx} value={String(h.idx)}>{h.label}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>

            {/* Preview 3 dòng đầu */}
            {rawRows.length > 0 && colMap.name && (
              <div className="ci-preview-mini">
                <div className="ci-preview-title">Xem trước 3 dòng đầu:</div>
                <table className="ci-preview-table">
                  <thead><tr>
                    {FIELDS.filter(f => colMap[f.key]).map(f => <th key={f.key}>{f.label}</th>)}
                  </tr></thead>
                  <tbody>
                    {getManualSelectedRows().rows.slice(0,3).map((row, i) => (
                      <tr key={i}>
                        {FIELDS.filter(f => colMap[f.key]).map(f => (
                          <td key={f.key}>{String(row[parseInt(colMap[f.key])] ?? "").slice(0, 40)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="ci-footer">
              <button className="btn-ghost" onClick={() => { setStep("drop"); setFile(null); }}>← Chọn file khác</button>
              <div className="ci-footer-actions">
                <button className="btn-ghost" type="button" onClick={saveCurrentMappingTemplate}>💾 Lưu template mapping</button>
                <button className="btn-primary" style={{ width: "auto" }} onClick={buildPreview}
                  disabled={!colMap.name && !colMap.sku}>
                  Tiếp theo — Xem trước {getManualSelectedRows().rows.length} dòng →
                </button>
              </div>
            </div>
          </div>
        )}

        {/* BƯỚC 3: PREVIEW & CONFIRM */}
        {step === "preview" && (
          <div className="ci-body">
            {(() => {
              const c = getPreviewCounts(parsed);
              const hasPriceUnconfirmed = priceColumnUncertainRows().length > 0 && !priceColumnConfirmed;
              const hasBlocking = c.blocking > 0;
              const hasReview = c.warningOnly > 0;
              const readyCount = c.clean;
              const skippedCount = c.skipped;
              const title = hasBlocking
                ? `Có ${c.blocking} lỗi cần xử lý`
                : hasReview
                  ? `Cần xem lại ${c.warningOnly} dòng`
                  : `Đã sẵn sàng nhập`;
              const tone = hasBlocking ? "danger" : hasReview ? "warn" : "ok";
              const defaultAction = hasPriceUnconfirmed
                ? { label: "Cần xác nhận cột giá", onClick: () => {}, disabled: true }
                : hasBlocking
                  ? { label: `Đi tới lỗi đầu tiên`, onClick: () => goToPreviewIssue("blocking", "first") }
                  : hasReview
                    ? { label: `Duyệt ${c.warningOnly} dòng an toàn`, onClick: approveAllPreviewRows }
                    : { label: `Nhập ${readyCount} sản phẩm`, onClick: applyImport };
              return (
                <div className={`ci-import-hero ${tone}`}>
                  <div className="ci-import-hero-main">
                    <div className="ci-import-hero-kicker">Preview import</div>
                    <h3>{title}</h3>
                    <p>
                      <strong>{readyCount}</strong> sản phẩm sẵn sàng nhập · <strong>{c.warningOnly}</strong> cần xem lại · <strong>{skippedCount}</strong> dòng đã bỏ qua
                    </p>
                  </div>
                  <div className="ci-import-hero-actions">
                    {hasReview && !hasBlocking && <button type="button" className="btn-ghost" onClick={() => setPreviewFilter("review")}>Xem dòng cần duyệt</button>}
                    {hasReview && hasBlocking && <button type="button" className="btn-ghost" onClick={() => goToPreviewIssue("review", "first")}>Xem dòng cần xem</button>}
                    <button type="button" className={`ci-primary-action ${tone}`} disabled={defaultAction.disabled} title={defaultAction.disabled ? "Cần xác nhận cột GIÁ MUA VÀO trước khi lưu" : ""} onClick={defaultAction.onClick}>{defaultAction.label}</button>
                  </div>
                </div>
              );
            })()}

            {priceColumnUncertainRows().length > 0 && (
              <div className={`ci-price-confirm-strip ${priceColumnConfirmed ? "confirmed" : "danger"}`}>
                <div className="ci-price-confirm-icon">⚠️</div>
                <div className="ci-price-confirm-text">
                  <strong>{priceColumnConfirmed ? "Đã xác nhận cột giá mua vào" : "Chúng tôi chưa chắc cột nào là GIÁ MUA VÀO."}</strong>
                  <span>Hãy kiểm tra lại cột giá trước khi lưu catalog. SmartQuote sẽ chặn lưu cho tới khi bạn xác nhận.</span>
                </div>
                <div className="ci-price-confirm-actions">
                  <button type="button" className="btn-ghost" onClick={openManualMapping}>Chọn lại cột giá</button>
                  <button type="button" className={priceColumnConfirmed ? "btn-ghost" : "btn-primary"} style={{ width: "auto" }} onClick={confirmPriceColumnSafety}>
                    {priceColumnConfirmed ? "Xác nhận lại" : "Tôi đã kiểm tra cột giá"}
                  </button>
                </div>
              </div>
            )}

            {priceSafetyRows().length > 0 && priceColumnUncertainRows().length === 0 && (
              <div className="ci-price-confirm-strip soft">
                <div className="ci-price-confirm-icon">ℹ️</div>
                <div className="ci-price-confirm-text">
                  <strong>Có {priceSafetyRows().length} dòng cần kiểm tra giá.</strong>
                  <span>Dòng vàng là giá đã được SmartQuote nhân theo nhãn cột hoặc có đơn vị cần để ý. Hãy rà nhanh trước khi lưu.</span>
                </div>
              </div>
            )}

            <details className="ci-processing-details">
              <summary>Chi tiết xử lý</summary>
              <div className="ci-detail-grid">
                <div><span>Engine</span><strong>{importResult?.engine || "—"}</strong></div>
                <div><span>Ngành</span><strong>{importResult?.detectedIndustry || "unknown"}</strong></div>
                <div><span>Confidence</span><strong>{Math.round((importResult?.overallConfidence || 0) * 100)}%</strong></div>
                <div><span>Template</span><strong>{importResult?.templateKnown ? "đã nhớ" : (importResult?.detectedTemplateId ? "mới" : "—")}</strong></div>
                <div><span>Đã học</span><strong>{learningStats ? `${learningStats.skuRules} SKU · ${learningStats.rawRules} raw · ${learningStats.supplierProfiles} nhà cung cấp` : "—"}</strong></div>
                <div><span>Nguồn</span><strong>{file?.name || "import"}</strong></div>
              </div>
              {learningNotice && <div className="ci-learning-note compact">{learningNotice}</div>}
              {(importResult?.warnings || []).length > 0 && (
                <div className="ci-warnings compact">{importResult.warnings.slice(0, 3).map((w, i) => <div key={i}>⚠️ {w}</div>)}</div>
              )}
            </details>

            <div className="ci-import-controls">
              <div className="ci-merge-choice">
                <span>Xử lý catalog</span>
                <label className="ci-radio"><input type="radio" value="merge" checked={mergeMode==="merge"} onChange={()=>setMergeMode("merge")} /> Merge</label>
                <label className="ci-radio"><input type="radio" value="replace" checked={mergeMode==="replace"} onChange={()=>setMergeMode("replace")} /> Thay thế ({products.length} SP)</label>
              </div>
              <div className="ci-control-actions">
                {headers.length > 0 && <button type="button" className="ghost" onClick={saveCurrentMappingTemplate}>Lưu template</button>}
                <button type="button" className="ghost" onClick={openManualMapping}>Sửa mapping</button>
              </div>
            </div>

            <div className="ci-preview-tabs">
              {[
                ["all", `Tất cả`, previewFilterCounts.all],
                ["review", `Cần xem lại`, previewFilterCounts.review],
                ["clean", `Sạch`, previewFilterCounts.clean],
                ["blocking", `Lỗi`, previewFilterCounts.blocking],
                ["approved", `Đã duyệt/sửa`, previewFilterCounts.approved],
              ].map(([key, label, count]) => (
                <button key={key} type="button" className={`${previewFilter === key ? "active" : ""} ${key === "blocking" && count > 0 ? "danger" : ""}`} onClick={() => {
                  setPreviewFilter(key);
                  if (key === "blocking" && firstBlockingRow) scrollToPreviewIndex(firstBlockingRow.index);
                  if (key === "review" && firstReviewRow) scrollToPreviewIndex(firstReviewRow.index);
                }}>{label} <span>{count}</span></button>
              ))}
              <div className="ci-tab-spacer" />
              {firstBlockingRow && <button type="button" className="ci-mini-danger" onClick={() => goToPreviewIssue("blocking", "first")}>Đi tới lỗi</button>}
              {getPreviewCounts(parsed).warningOnly > 0 && <button type="button" className="ci-mini-ok secondary" onClick={() => { setPreviewFilter("review"); if (firstReviewRow) scrollToPreviewIndex(firstReviewRow.index); }}>Xem dòng cần kiểm tra</button>}
            </div>

            {importResult?.summary?.needReview > 0 && (
              <div className="ci-review-copy">
                <span>Dòng vàng là các dòng SmartQuote chưa chắc chắn. Bạn có thể <strong>Sửa</strong>, <strong>Duyệt</strong> hoặc <strong>Xóa</strong> ngay trong app.</span>
                {getPreviewCounts(parsed).warningOnly > 0 ? <button type="button" className="ci-inline-link" onClick={approveAllPreviewRows}>Duyệt nhanh cảnh báo nhẹ</button> : null}
              </div>
            )}

            <div className="ci-preview-scroll compact">
              <table className="ci-preview-table ci-preview-table-clean">
                <thead><tr><th style={{width:54}}>TT</th><th style={{width:72}}>Ảnh</th><th>Sản phẩm</th><th style={{width:140}}>Mã</th><th style={{width:160}}>Giá</th><th>Vấn đề</th><th style={{width:130}}>Thao tác</th></tr></thead>
                <tbody>
                  {getFilteredPreviewRows().map(({ p, index: i, line }) => {
                    const issues = getPreviewIssues(p, i);
                    const status = line?.status || p._meta?.status || "auto_approved";
                    const statusCls = statusClass(status);
                    const rowHasPriceSafety = hasPriceSafetyIssue(p, i);
                    const rowHasPriceDanger = hasPriceColumnUncertainIssue(p, i);
                    const source = line?.source?.sheet ? `${line.source.sheet} · dòng ${line.source.row}` : (line?.source?.page ? `PDF trang ${line.source.page}` : "");
                    return (
                    <tr key={p?._meta?.lineId || line?.lineId || i} data-preview-index={i} className={`${highlightedPreviewIndex === i ? "ci-row-focus" : ""} ${isBlockingPreviewRow(p, i) ? "ci-row-blocking" : isReviewPreviewRow(p, i) ? "ci-row-review" : ""} ${rowHasPriceSafety ? "ci-row-price-warn" : ""} ${rowHasPriceDanger && !priceColumnConfirmed ? "ci-row-price-danger" : ""}`}>
                      <td className="ci-row-num"><span>{i+1}</span><span className={`ci-dot ${statusCls}`}></span></td>
                      <td>
                        {p.image
                          ? <ImgWithFallback src={p.image} alt={p.name || ""} style={{ width: 44, height: 44, objectFit: "cover", borderRadius: 8, border: "1px solid var(--line)", background: "#fff" }} />
                          : <span className="muted">—</span>}
                      </td>
                      <td className="ci-product-cell">
                        <div className="ci-product-name">{p.name || "(thiếu tên)"}</div>
                        <div className="ci-product-meta">
                          {[p.category, p.unit, p.supplier].filter(Boolean).join(" · ")}
                          {source && <span> · {source}</span>}
                        </div>
                      </td>
                      <td className="ci-sku-cell">{p.sku || "—"}</td>
                      <td className="ci-price-cell">
                        <div>{p.costPrice > 0 ? p.costPrice.toLocaleString("vi-VN")+"đ" : "—"}</div>
                        {p.listPrice > 0 && <small>Công bố: {p.listPrice.toLocaleString("vi-VN")}đ</small>}
                      </td>
                      <td className="ci-issues clean">
                        {rowHasPriceSafety && <div className={`ci-price-tag ${rowHasPriceDanger && !priceColumnConfirmed ? "danger" : "warn"}`}>Kiểm tra giá</div>}
                        {issues.length ? issues.slice(0,3).map((it, k) => <div key={k}>• {it.message || it}</div>) : "—"}
                      </td>
                      <td>
                        <div className="ci-row-actions clean">
                          <button type="button" onClick={() => startEditPreviewRow(i)}>{isBlockingPreviewRow(p, i) ? "Sửa lỗi" : "Sửa"}</button>
                          {issues.length > 0 && !isBlockingPreviewRow(p, i) && <button type="button" onClick={() => approvePreviewRow(i)}>Duyệt</button>}
                          <button type="button" className="danger" onClick={() => removePreviewRow(i)}>Xóa</button>
                        </div>
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
              {getFilteredPreviewRows().length === 0 && <div className="ci-more">Không có dòng nào trong bộ lọc này.</div>}
              {getFilteredPreviewRows().length < parsed.length && <div className="ci-more">Đang hiển thị {getFilteredPreviewRows().length}/{parsed.length} dòng theo bộ lọc.</div>}
            </div>
            {editingDraft && (
              <div className="ci-edit-panel">
                <div className="ci-edit-title">Sửa dòng #{(editingIndex ?? 0) + 1}</div>
                <div className="ci-edit-grid">
                  <label>Tên sản phẩm<input value={editingDraft.name || ""} onChange={(e)=>setEditingDraft(d=>({...d, name:e.target.value}))} /></label>
                  <label>Mã SKU<input value={editingDraft.sku || ""} onChange={(e)=>setEditingDraft(d=>({...d, sku:e.target.value}))} /></label>
                  <label>Nhóm<input value={editingDraft.category || ""} onChange={(e)=>setEditingDraft(d=>({...d, category:e.target.value}))} /></label>
                  <label>Nhà cung cấp<input value={editingDraft.supplier || ""} onChange={(e)=>setEditingDraft(d=>({...d, supplier:e.target.value}))} /></label>
                  <label>ĐVT<input value={editingDraft.unit || ""} onChange={(e)=>setEditingDraft(d=>({...d, unit:e.target.value}))} /></label>
                  <label>Giá nhập<input value={editingDraft.costPrice || ""} onChange={(e)=>setEditingDraft(d=>({...d, costPrice:e.target.value}))} /></label>
                  <label>Giá công bố<input value={editingDraft.listPrice || ""} onChange={(e)=>setEditingDraft(d=>({...d, listPrice:e.target.value, publicPrice:e.target.value}))} /></label>
                  <label>Ảnh URL<input value={editingDraft.image || ""} onChange={(e)=>setEditingDraft(d=>({...d, image:e.target.value}))} /></label>
                </div>
                {editingDraft.image && (
                  <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "8px 0 0" }}>
                    <ImgWithFallback src={editingDraft.image} alt={editingDraft.name || ""} style={{ width: 56, height: 56, objectFit: "cover", borderRadius: 8, border: "1px solid var(--line)", background: "#fff" }} />
                    <span className="muted" style={{ fontSize: 12 }}>Preview ảnh lấy từ web</span>
                  </div>
                )}
                <label className="ci-edit-specs">Thông số / mô tả<textarea value={editingDraft.specs || ""} onChange={(e)=>setEditingDraft(d=>({...d, specs:e.target.value}))} /></label>
                <div className="ci-edit-actions">
                  <button className="btn-ghost" type="button" onClick={() => { setEditingIndex(null); setEditingDraft(null); }}>Hủy</button>
                  <button className="btn-primary" type="button" style={{ width: "auto" }} onClick={saveEditedPreviewRow}>Lưu dòng này</button>
                </div>
              </div>
            )}

            <div className="ci-footer">
              <button className="btn-ghost" onClick={openManualMapping}>← Sửa mapping</button>
              <div className="ci-footer-actions">
                {importResult?.summary?.needReview > 0 && <button className="ci-review-link" type="button" onClick={() => { setPreviewFilter("review"); if (firstReviewRow) scrollToPreviewIndex(firstReviewRow.index); }}>Xem {importResult.summary.needReview} dòng cần kiểm tra</button>}
                {firstBlockingRow && <button className="btn-ghost" type="button" onClick={() => goToPreviewIssue("blocking", "first")}>Đi tới lỗi</button>}
                <button
                  className="btn-primary"
                  style={{ width: "auto" }}
                  disabled={priceColumnUncertainRows().length > 0 && !priceColumnConfirmed}
                  title={priceColumnUncertainRows().length > 0 && !priceColumnConfirmed ? "Cần xác nhận cột GIÁ MUA VÀO trước khi lưu" : ""}
                  onClick={applyImport}
                >
                  {priceColumnUncertainRows().length > 0 && !priceColumnConfirmed
                    ? "Cần xác nhận cột giá"
                    : mergeMode === "replace"
                      ? `Thay thế danh mục bằng ${getPreviewCounts(parsed).clean} sản phẩm`
                      : `Thêm ${getPreviewCounts(parsed).clean} sản phẩm vào danh mục`}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* BƯỚC 4: DONE + tùy chọn import ảnh */}
        {step === "done" && (
          <div className="ci-body" style={{ textAlign: "center", padding: "32px 20px" }}>
            <div style={{ fontSize: 48 }}>✅</div>
            <h3 style={{ margin: "16px 0 8px", fontSize: 18 }}>Import thành công!</h3>
            <p style={{ color: "var(--muted)", fontSize: 14, marginBottom: 24 }}>
              {mergeMode === "replace" ? `Đã thay thế catalog bằng ${parsed.length} sản phẩm.` : `Đã thêm/cập nhật ${parsed.length} sản phẩm vào catalog.`}
            </p>

            {/* Import ảnh từ folder */}
            <div className="ci-img-import-box">
              <div className="ci-img-import-title">📁 Thêm ảnh sản phẩm (tuỳ chọn)</div>
              <p className="ci-img-import-sub">
                Kéo thả <strong>thư mục ảnh</strong> hoặc chọn nhiều file ảnh vào đây.<br/>
                App tự ghép theo tên file = mã SKU. Ví dụ: <code>LM-S1N.jpg</code> → sản phẩm SKU <code>LM-S1N/S</code>
              </p>
              <div
                className={`ci-img-drop${imgDragging ? " ci-dragging" : ""}`}
                role="button"
                tabIndex={0}
                onClick={() => imgFilesInputRef.current?.click()}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); imgFilesInputRef.current?.click(); } }}
                onDragOver={(e) => { e.preventDefault(); setImgDragging(true); }}
                onDragLeave={() => setImgDragging(false)}
                onDrop={handleImgDrop}
              >
                <span style={{ fontSize: 28 }}>🖼</span>
                <span style={{ fontWeight: 500 }}>Kéo thả folder hoặc file ảnh vào đây</span>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>JPG, PNG, WebP — tên file = mã SKU sản phẩm</span>
                <div style={{ display: "flex", gap: 8, marginTop: 8, justifyContent: "center", flexWrap: "wrap" }}>
                  <button
                    type="button"
                    className="btn-ghost"
                    style={{ fontSize: 12, padding: "5px 12px", cursor: "pointer" }}
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); imgFilesInputRef.current?.click(); }}
                  >
                    📄 Chọn nhiều file ảnh
                  </button>
                  <button
                    type="button"
                    className="btn-ghost"
                    style={{ fontSize: 12, padding: "5px 12px", cursor: "pointer" }}
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); imgFolderInputRef.current?.click(); }}
                  >
                    📁 Chọn cả folder
                  </button>
                </div>
              </div>
              <input
                ref={imgFilesInputRef}
                id="ci-files-input"
                type="file"
                accept="image/jpeg,image/png,image/webp,image/jpg"
                multiple
                style={{ display: "none" }}
                onChange={handleImgFiles}
              />
              <input
                ref={imgFolderInputRef}
                id="ci-folder-input"
                type="file"
                accept="image/jpeg,image/png,image/webp,image/jpg"
                webkitdirectory="true"
                directory="true"
                multiple
                style={{ display: "none" }}
                onChange={handleImgFiles}
              />
              {imgStatus && <div className="ci-img-status">{imgStatus}</div>}
            </div>

            <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 20 }}>
              <button className="btn-primary" style={{ width: "auto" }} onClick={onClose}>Xem catalog →</button>
                      <button className="btn-ghost" onClick={() => { setStep("drop"); setFile(null); setParsed([]); setImportResult(null); setImgStatus(""); setWebStatus(""); }}>Import thêm nguồn khác</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Catalog({ products, setProducts, company, markups = [], cloud, onUpgrade, onOpenImportHub, importOnly = false, onImportDone, importSourceKind = "catalog" }) {
  const [q, setQ] = useState("");
  const [supplierFilter, setSupplierFilter] = useState("");
  const [editing, setEditing] = useState(null);
  const [bulk, setBulk] = useState({ supplier: "", percent: "" });
  const [bulkError, setBulkError] = useState("");
  const [importPreview, setImportPreview] = useState(null);
  const [showEnricher, setShowEnricher] = useState(false);
  const [autoImg, setAutoImg] = useState({ running: false, done: 0, total: 0, errors: 0, log: "" });
  const importRef = useRef();

  const suppliers = useMemo(() => [...new Set(products.map((p) => p.supplier).filter(Boolean))], [products]);

  const parseBulkPercent = (value) => {
    const text = String(value || "")
      .trim()
      .replace(/%/g, "")
      .replace(/,/g, ".");
    if (!text) return NaN;
    if (!/^-?\d+(?:\.\d+)?$/.test(text)) return NaN;
    return Number(text);
  };

  const bulkPct = parseBulkPercent(bulk.percent);
  const bulkAffectedCount = bulk.supplier
    ? products.filter((p) => p.supplier === bulk.supplier).length
    : 0;

  const filtered = products.filter((p) => {
    const matchQ = p.name.toLowerCase().includes(q.toLowerCase()) || (p.sku || "").toLowerCase().includes(q.toLowerCase());
    const matchS = !supplierFilter || p.supplier === supplierFilter;
    return matchQ && matchS;
  });

  const saveProduct = (prod) => {
    if (prod.id) setProducts((ps) => ps.map((p) => (p.id === prod.id ? prod : p)));
    else {
      if (!guardProductCount(cloud, products.length + 1, onUpgrade)) return;
      setProducts((ps) => [...ps, { ...prod, id: uid("p") }]);
    }
    setEditing(null);
  };

  const deleteProduct = async (id) => {
    if (await confirmAction({ title: "Xóa sản phẩm?", message: "Sản phẩm này sẽ bị xóa khỏi danh mục hiện tại.", confirmLabel: "Xóa", tone: "danger" })) {
      setProducts((ps) => ps.filter((p) => p.id !== id));
      if (cloud?.enabled && cloud.dealerId) {
        deleteCloudCatalogItems(cloud.dealerId, [id]).catch((error) => console.warn("Không xóa được sản phẩm cloud:", error));
      }
    }
  };

  const clearAllProducts = async () => {
    const total = products.length;
    if (!total) {
      notify.info("Danh mục đã trống — không có sản phẩm để xóa.");
      return;
    }

    const confirmText = `XOA ${total}`;
    const firstConfirm = await confirmAction({
      title: `Xóa toàn bộ ${total} sản phẩm?`,
      message: "Thao tác này xóa danh mục hiện tại. Template mapping, correction learning và cài đặt vẫn được giữ, nhưng báo giá/gói cũ có thể hiển thị sản phẩm là đã xóa. SmartQuote sẽ tạo một bản sao lưu tạm trước khi xóa.",
      confirmLabel: "Xóa toàn bộ",
      tone: "danger",
      requireText: confirmText,
      inputLabel: "Để xác nhận, nhập chính xác",
    });
    if (!firstConfirm) return;

    try {
      tenantStorageSetItem("sq_products_backup_before_clear", JSON.stringify({
        clearedAt: new Date().toISOString(),
        count: total,
        products,
      }));
    } catch (e) {
      console.warn("Không lưu được backup tạm trước khi xóa catalog:", e);
    }

    setProducts([]);
    if (cloud?.enabled && cloud.dealerId) {
      replaceCloudCatalog(cloud.dealerId, [], { source_type: "manual", source_name: "clear_all_catalog", merge_mode: "replace", status: "cleared" })
        .then(() => { lastCatalogJsonRef.current = serializeProductsForCatalog([]); cloud.refreshBilling?.(); })
        .catch((error) => console.warn("Không xóa được catalog cloud:", error));
    }
    setQ("");
    setSupplierFilter("");
    setEditing(null);
    setImportPreview(null);
    setAutoImg({ running: false, done: 0, total: 0, errors: 0, log: "" });
    notify.success(`Đã xóa ${total} sản phẩm khỏi Danh mục.`);
  };

  // Tăng/giảm giá hàng loạt theo nhà cung cấp — giải quyết "nhà cung cấp đổi giá nhập"
  const applyBulk = async () => {
    const pct = parseBulkPercent(bulk.percent);
    setBulkError("");

    if (!bulk.supplier) {
      setBulkError("Chọn nhà cung cấp cần cập nhật giá.");
      return;
    }
    if (!bulkAffectedCount) {
      setBulkError(`Không tìm thấy sản phẩm nào của nhà cung cấp "${bulk.supplier}".`);
      return;
    }
    if (Number.isNaN(pct)) {
      setBulkError("Nhập % thay đổi dạng số, ví dụ 5, -3 hoặc 2.5.");
      return;
    }
    if (pct <= -100) {
      setBulkError("% giảm không thể nhỏ hơn hoặc bằng -100%.");
      return;
    }

    const direction = pct >= 0 ? `tăng ${pct}%` : `giảm ${Math.abs(pct)}%`;
    if (!(await confirmAction({ title: "Áp dụng điều chỉnh giá?", message: `Điều chỉnh giá nhập của ${bulkAffectedCount} sản phẩm từ “${bulk.supplier}” — ${direction}.`, confirmLabel: "Áp dụng" }))) return;

    setProducts((ps) =>
      ps.map((p) =>
        p.supplier === bulk.supplier
          ? { ...p, costPrice: Math.round((p.costPrice || 0) * (1 + pct / 100)) }
          : p
      )
    );
    setBulk({ supplier: "", percent: "" });
    setBulkError("");
  };

  // ---- Tự động tìm ảnh qua Serper.dev (2500 lượt miễn phí, đơn giản hơn Google) ----
  // Dọn dẹp catalog: phát hiện & xóa dòng điều khoản/ghi chú nhập nhầm
  const cleanupCatalog = async () => {
    const isJunk = (p) => {
      const name = (p.name || "").trim();
      const hasPrice = (p.costPrice || 0) > 0;
      const hasSku = !!(p.sku || "").trim();
      // Dòng rác: bắt đầu bằng gạch đầu dòng/số điều khoản
      if (/^[\-•*+]/.test(name) || /^\d+[\.\)]\s/.test(name)) return true;
      // Dòng hạng mục/tổng nhóm/vật tư phụ bị nhập nhầm từ báo giá cũ
      if (isLikelyOldQuoteAggregateProduct(p, { oldQuoteMode: true, sourceFileName: "catalog-cleanup" })) return true;
      // Chứa từ khóa điều khoản (và không có giá+mã)
      if (!hasPrice && !hasSku &&
          /miễn phí|vận chuyển|lắp đặt tại|bảo hành|chính sách|thanh toán|giao hàng|chuyển khoản|đổi trả|thay thế vô điều kiện|báo giá có|thời hạn|có hiệu lực|cảm ơn|trân trọng|kính gửi|ghi chú|lưu ý|điều kiện|cam kết|chiết khấu|hotline|liên hệ|website|địa chỉ/i.test(name)) return true;
      // Câu quá dài không mã không giá
      if (name.length > 80 && !hasPrice && !hasSku) return true;
      return false;
    };
    const junk = products.filter(isJunk);
    if (junk.length === 0) {
      notify.info("Catalog sạch — không tìm thấy dòng rác nào.");
      return;
    }
    const preview = junk.slice(0, 5).map(p => `• ${p.name.slice(0, 50)}`).join("\n");
    const more = junk.length > 5 ? `\n... và ${junk.length - 5} dòng khác` : "";
    if (await confirmAction({
      title: `Xóa ${junk.length} dòng có vẻ là dữ liệu rác?`,
      message: `${preview}${more}\n\nCác dòng này trông giống hạng mục, tổng nhóm hoặc điều khoản thay vì sản phẩm.`,
      confirmLabel: "Xóa các dòng này",
      tone: "danger",
    })) {
      const ids = junk.map((p) => p.id).filter(Boolean);
      setProducts(ps => ps.filter(p => !isJunk(p)));
      if (cloud?.enabled && cloud.dealerId && ids.length) {
        deleteCloudCatalogItems(cloud.dealerId, ids).catch((error) => console.warn("Không xóa được dòng rác cloud:", error));
      }
    }
  };

  const autoFetchImages = async () => {
    const apiKey = company?.googleApiKey?.trim();
    if (!apiKey) {
      notify.warning("Chưa có Serper API Key.\nVào tab Cài đặt → mục Tìm ảnh tự động để điền.");
      return;
    }
    const targets = products.filter((p) => !p.image);
    if (targets.length === 0) { notify.success("Tất cả thiết bị đã có ảnh rồi!"); return; }

    // Test kết nối
    setAutoImg({ running: true, done: 0, total: targets.length, errors: 0, log: "Đang kiểm tra kết nối API…" });
    try {
      const testRes = await fetch("https://google.serper.dev/images", {
        method: "POST",
        headers: { "X-API-KEY": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({ q: "test", num: 1 }),
      });
      const testData = await testRes.json();
      if (!testRes.ok) {
        setAutoImg({ running: false, done: 0, total: 0, errors: 1,
          log: `❌ Lỗi API (${testRes.status}): ${testData.message || "Kiểm tra lại API Key"}` });
        return;
      }
    } catch (e) {
      setAutoImg({ running: false, done: 0, total: 0, errors: 1,
        log: `❌ Không kết nối được: ${e.message}` });
      return;
    }

    if (!(await confirmAction({ title: "Tìm ảnh tự động?", message: `Kết nối API thành công. SmartQuote sẽ tìm ảnh cho ${targets.length} sản phẩm và sử dụng quota API của bạn.`, confirmLabel: "Bắt đầu tìm" }))) {
      setAutoImg({ running: false, done: 0, total: 0, errors: 0, log: "" });
      return;
    }

    setAutoImg({ running: true, done: 0, total: targets.length, errors: 0, log: "Đang tìm ảnh…" });
    let done = 0, errors = 0;

    for (const p of targets) {
      const query = `${p.name} ${p.sku || ""}`.replace(/[()]/g, " ").trim();
      try {
        const res = await fetch("https://google.serper.dev/images", {
          method: "POST",
          headers: { "X-API-KEY": apiKey, "Content-Type": "application/json" },
          body: JSON.stringify({ q: query, num: 1 }),
        });
        const data = await res.json();
        const rawUrl = data?.images?.[0]?.imageUrl;
        // Bỏ qua Google thumbnail (encrypted-tbn) — không load được cross-origin
        const imgUrl = rawUrl && !rawUrl.includes("encrypted-tbn") && !rawUrl.includes("gstatic.com/images?q=tbn")
          ? rawUrl : null;
        if (imgUrl) {
          setProducts((ps) => ps.map((x) => x.id === p.id ? { ...x, image: imgUrl } : x));
          done++;
        } else {
          errors++;
        }
      } catch {
        errors++;
      }
      setAutoImg({ running: true, done, total: targets.length, errors, log: `Đang tìm: ${p.name}…` });
      await new Promise((r) => setTimeout(r, 200));
    }
    setAutoImg({ running: false, done, total: targets.length, errors,
      log: `✓ Hoàn tất! Tìm được ${done} ảnh, ${errors} thiết bị không tìm thấy ảnh.` });
  };
  const handleExcelFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      assertSmartQuoteUploadFile(file, { allow: ["excel"] });
      const preview = await parseSupplierPriceFile(file, products);
      if (preview.error) {
        notify.error(preview.error);
        return;
      }
      setImportPreview(preview);
    } catch (err) {
      console.error(err);
      notify.error("Không đọc được file. Đảm bảo đúng định dạng Excel (.xlsx/.xls).");
    } finally {
      e.target.value = "";
    }
  };

  // Áp dụng cập nhật sau khi nhân viên xem preview và xác nhận.
  // Cập nhật giá gốc từ file nhà cung cấp. Giá bán không lưu cứng nữa (tính từ hệ số) nên chỉ sửa costPrice.
  const applyImport = (preview, opts) => {
    if (opts.addNew && preview?.newItems?.length && !guardProductCount(cloud, products.length + preview.newItems.length, onUpgrade)) return;
    setProducts((ps) => {
      let next = ps.map((p) => {
        const hit = preview.matched.find((m) => m.existing.id === p.id);
        if (!hit) return p;
        return { ...p, costPrice: Math.round(hit.newCost) };
      });
      if (opts.addNew) {
        const toAdd = preview.newItems.map((it) => ({
          id: uid("p"),
          name: it.name || it.sku,
          sku: it.sku,
          category: "",
          supplier: it.supplier || "",
          unit: "Cái",
          costPrice: Math.round(it.costPrice),
        }));
        next = [...next, ...toAdd];
      }
      return next;
    });
    setImportPreview(null);
  };

  const [showImporter, setShowImporter] = useState(Boolean(importOnly));
  useEffect(() => { if (importOnly) setShowImporter(true); }, [importOnly]);
  const openCatalogImport = () => {
    if (typeof onOpenImportHub === "function" && !importOnly) onOpenImportHub();
    else setShowImporter(true);
  };
  const closeCatalogImport = () => {
    setShowImporter(false);
    if (importOnly && typeof onImportDone === "function") onImportDone();
  };
  const [imgDragging, setImgDragging] = useState(false);
  const [imgStatus, setImgStatus] = useState("");
  const imgFolderRef = useRef();

  // Import ảnh từ folder — match tên file với SKU trong catalog
  const handleImgFiles = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    const { accepted, rejected } = filterSafeSmartQuoteFiles(files, { allow: ["image"], maxFiles: 500 });
    if (rejected.length) notify.info("Một số ảnh bị bỏ qua vì không an toàn/quá lớn:\n\n" + rejectedFilesMessage(rejected));
    await processImgFiles(accepted);
    e.target.value = "";
  };

  const handleImgDrop = async (e) => {
    e.preventDefault();
    setImgDragging(false);
    const files = [];
    const traverse = async (entry) => {
      if (entry.isFile) {
        await new Promise(res => entry.file(f => { files.push(f); res(); }));
      } else if (entry.isDirectory) {
        const reader = entry.createReader();
        await new Promise(res => reader.readEntries(async (entries) => {
          for (const en of entries) await traverse(en);
          res();
        }));
      }
    };
    for (const item of e.dataTransfer.items) {
      const entry = item.webkitGetAsEntry?.();
      if (entry) await traverse(entry);
    }
    if (!files.length) {
      Array.from(e.dataTransfer.files).forEach(f => files.push(f));
    }
    await processImgFiles(files.filter(f => f.type.startsWith("image/")));
  };

  const processImgFiles = async (files) => {
    if (!files.length) return;
    setImgStatus(`Đang xử lý ${files.length} ảnh...`);
    let matched = 0;

    // Build SKU lookup — normalize: bỏ /, -, _ và lowercase
    const normalize = (s) => String(s || "").toLowerCase().replace(/[\/\-_\s\.]/g, "");
    const skuIndex = {};
    products.forEach(p => {
      if (p.sku) skuIndex[normalize(p.sku)] = p.id;
    });

    const updates = {};
    for (const file of files) {
      try { assertSmartQuoteUploadFile(file, { allow: ["image"] }); }
      catch { errors++; continue; }
      // Tên file không có extension
      const baseName = file.name.replace(/\.[^.]+$/, "");
      const normName = normalize(baseName);

      // Tìm match: tên file = SKU hoặc tên file chứa SKU
      let matchId = skuIndex[normName];
      if (!matchId) {
        // Thử match một phần
        for (const [key, id] of Object.entries(skuIndex)) {
          if (normName.includes(key) || key.includes(normName)) {
            matchId = id; break;
          }
        }
      }

      if (matchId) {
        // Chuyển file thành data URL
        const dataUrl = await new Promise(res => {
          const reader = new FileReader();
          reader.onload = e => res(e.target.result);
          reader.readAsDataURL(file);
        });
        updates[matchId] = dataUrl;
        matched++;
      }
    }

    if (Object.keys(updates).length > 0) {
      setProducts(ps => ps.map(p => updates[p.id] ? { ...p, image: updates[p.id] } : p));
    }
    setImgStatus(`✓ Ghép được ${matched}/${files.length} ảnh với sản phẩm trong catalog`);
  };

  if (importOnly) {
    return (
      <div className="catalog">
        {showImporter && (
          <CatalogImporter
            products={products}
            setProducts={setProducts}
            company={company}
            cloud={cloud}
            onUpgrade={onUpgrade}
            onClose={closeCatalogImport}
            importSourceKind={importSourceKind}
            imgDragging={imgDragging}
            setImgDragging={setImgDragging}
            imgStatus={imgStatus}
            setImgStatus={setImgStatus}
            imgFolderRef={imgFolderRef}
            handleImgDrop={handleImgDrop}
            handleImgFiles={handleImgFiles}
          />
        )}
        <div className="catalog-import-only">
          <div className="catalog-import-only-icon">📥</div>
          <h3>{importSourceKind === "old_quote" ? "Bộ lọc báo giá cũ" : "Bộ nhập bảng giá nhà cung cấp"}</h3>
          <p>{importSourceKind === "old_quote" ? "Upload file báo giá cũ để lấy lại sản phẩm thật. SmartQuote sẽ bỏ qua hạng mục, tổng nhóm và vật tư phụ gộp trước khi lưu catalog." : "Upload Excel/PDF, dán link website hoặc import ảnh sản phẩm. Sau khi lưu, SmartQuote sẽ đưa bạn về Danh mục để kiểm tra."}</p>
          <div className="catalog-import-only-actions">
            <button className="btn-primary" style={{ width: "auto" }} onClick={() => setShowImporter(true)}>{importSourceKind === "old_quote" ? "Mở bộ lọc báo giá cũ" : "Mở bộ nhập bảng giá"}</button>
            <button className="btn-ghost" onClick={onImportDone}>Xem danh mục</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="catalog">
      {/* Import Catalog overlay */}
      {showImporter && (
        <CatalogImporter
          products={products}
          setProducts={setProducts}
          company={company}
          cloud={cloud}
          onUpgrade={onUpgrade}
          onClose={closeCatalogImport}
          importSourceKind={importSourceKind}
          imgDragging={imgDragging}
          setImgDragging={setImgDragging}
          imgStatus={imgStatus}
          setImgStatus={setImgStatus}
          imgFolderRef={imgFolderRef}
          handleImgDrop={handleImgDrop}
          handleImgFiles={handleImgFiles}
        />
      )}

      <div className="cat-toolbar">
        <input className="search" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={supplierFilter} onChange={(e) => setSupplierFilter(e.target.value)}>
          <option value="">Tất cả nhà cung cấp</option>
          {suppliers.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <button className="btn-import-catalog prominent" onClick={openCatalogImport}>
          📥 Nhập file
        </button>
        <button className="btn-ghost" onClick={() => setEditing({ name: "", sku: "", category: "", supplier: "", unit: "Cái", costPrice: 0 })}>
          + Thêm thủ công
        </button>
        <details className="cat-advanced-tools">
          <summary>⋯ Công cụ nâng cao</summary>
          <div className="cat-advanced-menu">
            <label htmlFor="cat-price-file" className="btn-ghost" style={{ cursor:"pointer", display:"inline-flex", alignItems:"center" }}>
              ⬆ Cập nhật giá
            </label>
            <input id="cat-price-file" ref={importRef} type="file" accept=".xlsx,.xls" style={{ display:"none" }} onChange={handleExcelFile} />
            <button className="btn-ghost" onClick={autoFetchImages} disabled={autoImg.running}>
              {autoImg.running ? `🔍 ${autoImg.done}/${autoImg.total}…` : "🔍 Tự động tìm ảnh"}
            </button>
            {/* Import ảnh: label htmlFor — cách duy nhất đáng tin để trigger file input */}
            <label htmlFor="cat-img-files" className="btn-ghost" style={{ cursor:"pointer" }}>
              🖼 Import ảnh
            </label>
            <input id="cat-img-files" type="file" accept="image/*" multiple style={{ opacity:0, position:"absolute", width:0, height:0 }} onChange={handleImgFiles} />
            <label htmlFor="cat-img-folder" className="btn-ghost" style={{ cursor:"pointer" }}>
              📁 Chọn folder
            </label>
            <input id="cat-img-folder" type="file" webkitdirectory="" multiple style={{ opacity:0, position:"absolute", width:0, height:0 }} onChange={handleImgFiles} />
            <button className="btn-ghost" onClick={cleanupCatalog} title="Xóa các dòng điều khoản, ghi chú, chính sách bị nhập nhầm thành sản phẩm">
              🧹 Dọn dẹp
            </button>
            <button
              className="btn-ghost danger"
              onClick={clearAllProducts}
              disabled={products.length === 0}
              title="Xóa toàn bộ sản phẩm trong Danh mục hiện tại"
            >
              🗑 Xóa tất cả
            </button>
          </div>
        </details>
      </div>

      {/* Drop zone kéo thả ảnh / folder thẳng từ Finder */}
      <div
        className={`cat-img-dropzone${imgDragging ? " dragging" : ""}`}
        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setImgDragging(true); }}
        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setImgDragging(false); }}
        onDrop={handleImgDrop}
      >
        <span style={{ fontSize: 18 }}>🖼</span>
        <span>Kéo thả folder hoặc nhiều file ảnh vào đây — tên file khớp SKU sẽ tự ghép</span>
        {imgStatus && <strong style={{ color: "var(--brand)" }}>{imgStatus}</strong>}
      </div>

      {/* Progress bar tìm ảnh */}
      {(autoImg.running || autoImg.log) && (
        <div className="auto-img-bar">
          {autoImg.running && (
            <div className="auto-img-progress">
              <div className="auto-img-fill" style={{ width: `${autoImg.total ? (autoImg.done / autoImg.total) * 100 : 0}%` }} />
            </div>
          )}
          <span className={autoImg.errors > 0 ? "warn" : ""}>{autoImg.log}</span>
          {!autoImg.running && autoImg.done > 0 && (
            <span className="muted" style={{ marginLeft: 8 }}>
              ({autoImg.errors} thiết bị không tìm được ảnh — có thể dán URL thủ công)
            </span>
          )}
          {!autoImg.running && (
            <button className="btn-ghost" style={{ marginLeft: 8, padding: "2px 10px", fontSize: 12 }}
              onClick={() => setAutoImg({ running: false, done: 0, total: 0, errors: 0, log: "" })}>
              Đóng
            </button>
          )}
        </div>
      )}

      {/* Công cụ điều chỉnh giá hàng loạt */}
      <div className="bulk-box">
        <span className="bulk-title">Cập nhật giá hàng loạt khi nhà cung cấp đổi giá:</span>
        <select value={bulk.supplier} onChange={(e) => { setBulk({ ...bulk, supplier: e.target.value }); setBulkError(""); }}>
          <option value="">Chọn nhà cung cấp</option>
          {suppliers.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <input
          className="bulk-pct"
          type="text"
          inputMode="decimal"
          placeholder="% vd 5 hoặc -3"
          value={bulk.percent}
          onChange={(e) => { setBulk({ ...bulk, percent: e.target.value }); setBulkError(""); }}
          onKeyDown={(e) => { if (e.key === "Enter") applyBulk(); }}
        />
        <button className="btn-ghost" onClick={applyBulk}>Áp dụng</button>
        {bulk.supplier && (
          <span className="bulk-hint">{bulkAffectedCount} sản phẩm sẽ được cập nhật</span>
        )}
        {bulkError && <span className="bulk-error">{bulkError}</span>}
      </div>

      {/* Empty state — người mới chưa có sản phẩm */}
      {products.length === 0 && (
        <div className="catalog-empty">
          <NewUserEmptyState context="catalog" onImport={openCatalogImport} />
          <div className="catalog-empty-secondary-actions">
            <button className="btn-ghost" onClick={() => setShowEnricher(true)}>
              ✨ Tìm sản phẩm từ web
            </button>
            <button className="btn-ghost" onClick={() => setEditing({ name: "", sku: "", category: "", supplier: "", unit: "Cái", costPrice: 0 })}>
              + Thêm thủ công
            </button>
          </div>
        </div>
      )}

      <table className="cat-table" style={{ display: products.length === 0 ? "none" : "table" }}>
        <thead>
          <tr><th style={{width:"52px"}}>Ảnh</th><th>Thiết bị</th><th>Mã</th><th>Nhà cung cấp</th><th className="num">Giá gốc/nhập</th><th className="num">Giá bán</th><th className="num">Lợi nhuận</th><th></th></tr>
        </thead>
        <tbody>
          {filtered.map((p) => {
            const publicPrice = Number(p.listPrice || p.publicPrice || 0) || 0;
            const isFixed = p.priceMode === "fixed" || publicPrice > 0;
            // Nếu catalog có giá công bố/niêm yết thì hiển thị đúng giá đó.
            // Nếu chưa có, chỉ preview theo hệ số mà chính đại lý đã cấu hình; mặc định trung lập là ×1.
            const configuredFactors = (markups || []).map((m) => Number(m.value)).filter((v) => Number.isFinite(v) && v > 0).slice(0, 2);
            const previewFactors = configuredFactors.length ? configuredFactors : [1];
            const sale = isFixed && publicPrice > 0
              ? VND(publicPrice)
              : previewFactors.map((factor) => VND(Math.round((p.costPrice * factor) / 1000) * 1000)).join(" / ");
            const profit = publicPrice > 0 ? publicPrice - (p.costPrice || 0) : null;
            return (
              <tr key={p.id}>
                <td>
                  {p.image
                    ? <ImgWithFallback src={p.image} className="cat-thumb" />
                    : null}
                  <div className="cat-thumb-empty" style={{ display: p.image ? "none" : "flex" }}>?</div>
                </td>
                <td className="strong">{p.name}{isFixed && <span className="badge-fixed">giá cố định</span>}</td>
                <td className="muted" style={{fontSize:11.5}}>{p.sku}</td>
                <td>
                  {p.supplier && (
                    <span className={`tag-ncc tag-${p.supplier.toLowerCase().replace(/[^a-z]/g,"")}`}>
                      {p.supplier}
                    </span>
                  )}
                </td>
                <td className="num strong">{VND(p.costPrice)}</td>
                <td className="num">{sale}{!isFixed && <span className="muted" style={{ fontSize: 11 }}> (theo hệ số đã cấu hình)</span>}</td>
                <td className="num">{profit !== null ? <span className="pos">{VND(profit)}</span> : <span className="muted">—</span>}</td>
                <td className="row-actions">
                  <button className="link" onClick={() => setEditing(p)}>Sửa</button>
                  <button className="link danger" onClick={() => deleteProduct(p.id)}>Xóa</button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {filtered.length === 0 && <p className="empty-hint pad">Không có thiết bị nào khớp.</p>}

      {editing && <ProductEditor product={editing} suppliers={suppliers} onSave={saveProduct} onCancel={() => setEditing(null)} />}

      {showEnricher && (
        <ProductEnrichmentModal
          products={products}
          setProducts={setProducts}
          company={company}
          cloud={cloud}
          onUpgrade={onUpgrade}
          onClose={() => setShowEnricher(false)}
        />
      )}

      {importPreview && (
        <ImportPreview preview={importPreview} onApply={applyImport} onCancel={() => setImportPreview(null)} />
      )}
    </div>
  );
}

function ProductEnrichmentModal({ products, setProducts, company, cloud, onUpgrade, onClose }) {
  const [query, setQuery] = useState("");
  const [preferredSite, setPreferredSite] = useState(company?.website || "");
  const [supplier, setSupplier] = useState("");
  const [category, setCategory] = useState("Nội thất");
  const [serperKey, setSerperKey] = useState(company?.googleApiKey || "");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [candidates, setCandidates] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [savedIds, setSavedIds] = useState({});

  const suppliers = useMemo(() => [...new Set(products.map((p) => p.supplier).filter(Boolean))].slice(0, 80), [products]);
  const canSearch = query.trim().length >= 2 && !busy;

  const candidateDraft = (candidate, index) => {
    const existing = drafts[index];
    if (existing) return existing;
    const price = Number(candidate.price || 0) || 0;
    return {
      name: candidate.name || query,
      sku: candidate.sku || "",
      category: candidate.category || category || "Nội thất",
      supplier: candidate.supplier || supplier || candidate.sourceDomain || "Web",
      unit: "Cái",
      costPrice: price,
      listPrice: price,
      publicPrice: price,
      priceMode: price > 0 ? "fixed" : "markup",
      image: candidate.imageUrl || "",
      sourceUrl: candidate.sourceUrl || "",
      specs: [
        candidate.description,
        candidate.sourceDomain ? `Nguồn: ${candidate.sourceDomain}` : "",
        candidate.warnings?.length ? `Cần kiểm tra: ${candidate.warnings.join("; ")}` : "",
      ].filter(Boolean).join("\n"),
    };
  };

  const setDraftField = (index, key, value) => {
    setDrafts((prev) => ({
      ...prev,
      [index]: { ...candidateDraft(candidates[index], index), [key]: value },
    }));
  };

  const search = async () => {
    if (!query.trim()) {
      setStatus("Nhập tên sản phẩm cần tìm trước.");
      return;
    }
    if (!guardFeature(cloud, "product_enrich", 1, onUpgrade)) return;
    setBusy(true);
    setStatus("Đang tìm ứng viên trên web…");
    setCandidates([]);
    setDrafts({});
    setSavedIds({});
    try {
      const preferredSites = preferredSite
        .split(/[\n,;]/g)
        .map((x) => x.trim())
        .filter(Boolean)
        .slice(0, 5);
      const response = await smartQuoteFetch("/api/product-enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: query.trim(),
          preferredSites,
          supplier: supplier.trim(),
          category: category.trim(),
          serperApiKey: serperKey.trim(),
          limit: 10,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
      setCandidates(payload.candidates || []);
      setStatus((payload.candidates || []).length
        ? `✓ Tìm thấy ${payload.candidates.length} ứng viên. Chọn kết quả đúng rồi bấm Lưu vào catalog.`
        : "Không tìm thấy ứng viên đủ rõ. Thử nhập tên cụ thể hơn hoặc thêm website nguồn.");
      cloud?.refreshBilling?.();
    } catch (error) {
      setStatus(`Lỗi tìm sản phẩm: ${error.message}`);
    } finally {
      setBusy(false);
    }
  };

  const saveCandidate = async (candidate, index) => {
    const draft = candidateDraft(candidate, index);
    const name = String(draft.name || "").trim();
    if (!name) { notify.warning("Tên sản phẩm không được để trống."); return; }
    if (!guardProductCount(cloud, products.length + 1, onUpgrade)) return;
    const product = {
      ...draft,
      id: uid("p"),
      name,
      sku: String(draft.sku || "").trim(),
      category: String(draft.category || "Nội thất").trim() || "Nội thất",
      supplier: String(draft.supplier || "Web").trim() || "Web",
      unit: String(draft.unit || "Cái").trim() || "Cái",
      costPrice: parseSafePrice(draft.costPrice),
      listPrice: parseSafePrice(draft.listPrice || draft.publicPrice),
      publicPrice: parseSafePrice(draft.listPrice || draft.publicPrice),
      minRetailPrice: 0,
      priceMode: parseSafePrice(draft.listPrice || draft.publicPrice) > 0 ? "fixed" : "markup",
      image: String(draft.image || "").trim(),
      sourceUrl: String(draft.sourceUrl || candidate.sourceUrl || "").trim(),
      _meta: {
        source: "product_enrichment",
        confidence: candidate.confidence || 0,
        sourceDomain: candidate.sourceDomain || "",
        warnings: candidate.warnings || [],
        createdAt: new Date().toISOString(),
      },
    };
    const duplicate = products.find((p) =>
      (product.sku && p.sku && String(p.sku).toLowerCase() === product.sku.toLowerCase())
      || (!product.sku && p.name && p.name.toLowerCase() === product.name.toLowerCase())
    );
    if (duplicate && !(await confirmAction({ title: "Có thể trùng sản phẩm", message: `Danh mục đã có sản phẩm giống “${duplicate.name}”. Bạn vẫn muốn thêm ứng viên này như một sản phẩm mới?`, confirmLabel: "Vẫn thêm" }))) return;
    setProducts((ps) => [...ps, product]);
    setSavedIds((prev) => ({ ...prev, [index]: product.id }));
    setStatus(`✓ Đã lưu “${product.name}” vào catalog.`);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <h2>✨ Tìm sản phẩm từ web</h2>
        <p className="tab-intro" style={{ marginBottom: 14 }}>
          Gõ tên sản phẩm, SmartQuote tìm ảnh/giá/mã từ web và trả về ứng viên để bạn duyệt. Không tự nhập thẳng để tránh sai biến thể hoặc giá khuyến mãi.
        </p>

        <div className="field-grid">
          <label className="field full">
            <span>Tên sản phẩm cần tìm</span>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="VD: Ghế ăn Grace bọc nỉ chân sắt" onKeyDown={(e) => { if (e.key === "Enter" && canSearch) search(); }} />
          </label>
          <label className="field full">
            <span>Website nguồn ưu tiên (tùy chọn, mỗi dòng hoặc cách nhau dấu phẩy)</span>
            <input value={preferredSite} onChange={(e) => setPreferredSite(e.target.value)} placeholder="VD: moho.com.vn, noithathoaphat.com.vn" />
          </label>
          <label className="field">
            <span>Nhà cung cấp/Brand mặc định</span>
            <input value={supplier} onChange={(e) => setSupplier(e.target.value)} list="enrich-suppliers" />
            <datalist id="enrich-suppliers">{suppliers.map((s) => <option key={s} value={s} />)}</datalist>
          </label>
          <label className="field">
            <span>Nhóm</span>
            <input value={category} onChange={(e) => setCategory(e.target.value)} />
          </label>
          <label className="field full">
            <span>Serper API Key</span>
            <input value={serperKey} onChange={(e) => setSerperKey(e.target.value)} placeholder="Để trống nếu server đã cấu hình SERPER_API_KEY" />
          </label>
        </div>

        <div className="modal-actions" style={{ justifyContent: "space-between" }}>
          <span className="muted" style={{ fontSize: 12 }}>{status || "Mẹo: thêm website nguồn giúp kết quả ít rác hơn."}</span>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn-ghost" onClick={onClose}>Đóng</button>
            <button className="btn-primary" style={{ width: "auto" }} disabled={!canSearch} onClick={search}>{busy ? "Đang tìm…" : "Tìm ứng viên"}</button>
          </div>
        </div>

        {candidates.length > 0 && (
          <div className="enrich-grid">
            {candidates.map((c, index) => {
              const d = candidateDraft(c, index);
              const saved = savedIds[index];
              return (
                <div className="enrich-card" key={`${c.sourceUrl || c.name}-${index}`}>
                  <div className="enrich-head">
                    {d.image
                      ? <ImgWithFallback src={d.image} alt={d.name} style={{ width: 82, height: 82, objectFit: "cover", borderRadius: 12, border: "1px solid var(--line)", background: "#fff" }} />
                      : <div className="cat-thumb-empty" style={{ width: 82, height: 82 }}>?</div>}
                    <div className="enrich-titlebox">
                      <strong>{c.name}</strong>
                      <span>{c.sourceDomain || "web"} · tin cậy {Math.round((c.confidence || 0) * 100)}%</span>
                      <span>{c.price ? VND(c.price) : "Chưa rõ giá"}{c.sku ? ` · ${c.sku}` : ""}</span>
                    </div>
                  </div>

                  <div className="field-grid enrich-edit-grid">
                    <label className="field full"><span>Tên</span><input value={d.name} onChange={(e) => setDraftField(index, "name", e.target.value)} /></label>
                    <label className="field"><span>SKU/Mã</span><input value={d.sku} onChange={(e) => setDraftField(index, "sku", e.target.value)} /></label>
                    <label className="field"><span>Giá</span><input type="number" value={d.listPrice || d.costPrice || 0} onChange={(e) => { const v = parseFloat(e.target.value) || 0; setDrafts((prev) => ({ ...prev, [index]: { ...candidateDraft(c, index), costPrice: v, listPrice: v, publicPrice: v, priceMode: v > 0 ? "fixed" : "markup" } })); }} /></label>
                    <label className="field"><span>Nhà cung cấp</span><input value={d.supplier} onChange={(e) => setDraftField(index, "supplier", e.target.value)} /></label>
                    <label className="field"><span>Nhóm</span><input value={d.category} onChange={(e) => setDraftField(index, "category", e.target.value)} /></label>
                    <label className="field full"><span>Ảnh URL</span><input value={d.image} onChange={(e) => setDraftField(index, "image", e.target.value)} /></label>
                  </div>

                  <div className="enrich-reasons">
                    {(c.reasons || []).slice(0, 4).map((r, i) => <span key={i}>✓ {r}</span>)}
                    {(c.warnings || []).slice(0, 2).map((w, i) => <span className="warn" key={`w${i}`}>⚠ {w}</span>)}
                  </div>

                  <div className="enrich-actions">
                    {c.sourceUrl && <a className="link" href={c.sourceUrl} target="_blank" rel="noreferrer">Mở nguồn</a>}
                    <button className="btn-primary" style={{ width: "auto" }} disabled={!!saved} onClick={() => saveCandidate(c, index)}>{saved ? "Đã lưu" : "Lưu vào catalog"}</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}


function ProductEditor({ product, suppliers, onSave, onCancel }) {
  const [f, setF] = useState(product);
  const set = (k, v) => setF({ ...f, [k]: v });
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{product.id ? "Sửa thiết bị" : "Thêm thiết bị"}</h2>
        <div className="field-grid">
          <Field label="Tên thiết bị" value={f.name} onChange={(v) => set("name", v)} />
          <Field label="Mã (SKU)" value={f.sku} onChange={(v) => set("sku", v)} />
          <Field label="Nhóm" value={f.category} onChange={(v) => set("category", v)} />
          <Field label="Nhà cung cấp" value={f.supplier} onChange={(v) => set("supplier", v)} list={suppliers} />
          <Field label="Đơn vị tính" value={f.unit} onChange={(v) => set("unit", v)} />
          <NumField label="Giá nhập/giá đại lý (đ)" value={f.costPrice} onChange={(v) => set("costPrice", v)} />
          <NumField label="Giá công bố/niêm yết (đ)" value={f.listPrice || 0} onChange={(v) => { setF({ ...f, listPrice: v, publicPrice: v, priceMode: v > 0 ? "fixed" : (f.priceMode || "markup") }); }} />
        </div>
        <label className="field full" style={{ marginTop: 12 }}>
          <span>Thông số kỹ thuật (hiện trong báo giá gửi khách)</span>
          <textarea
            className="specs-textarea"
            value={f.specs || ""}
            onChange={(e) => set("specs", e.target.value)}
            rows={4}
          />
        </label>
        <label className="field" style={{ marginTop: 12, display: "block" }}>
          <span>Ảnh sản phẩm (URL — dán link ảnh từ web hãng hoặc Imgur)</span>
          <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
            <input
              style={{ flex: 1 }}
              value={f.image || ""}
              onChange={(e) => set("image", e.target.value)}
            />
            {f.image && (
              <img
                src={f.image} alt="preview" loading="lazy"
                style={{ width: 56, height: 56, objectFit: "cover", borderRadius: 8, border: "1px solid var(--line)", flexShrink: 0 }}
                onError={(e) => { e.currentTarget.style.display = "none" }}
              />
            )}
          </div>
          <p className="side-note" style={{ marginTop: 4 }}>
            Không cần ảnh cho mọi sản phẩm — chỉ thêm những cái hay nhầm lẫn (công tắc 1/2/3 nút, các loại đèn...).
            Trình duyệt tự cache, app không bị nặng.
          </p>
        </label>
        <div className="modal-actions">
          <button className="btn-ghost" onClick={onCancel}>Hủy</button>
          <button className="btn-primary" onClick={() => { if (!f.name) { notify.warning("Nhập tên thiết bị."); return; } onSave(f); }}>Lưu</button>
        </div>
      </div>
    </div>
  );
}

function ImportPreview({ preview, onApply, onCancel }) {
  const [addNew, setAddNew] = useState(true);
  const { matched, unchanged, newItems, fileName } = preview;
  const importResult = preview.importPreview;

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <h2>Xem trước cập nhật giá</h2>
        <p className="tab-intro" style={{ marginBottom: 14 }}>
          Từ file <strong>{fileName}</strong>: <strong>{matched.length}</strong> thiết bị đổi giá,{" "}
          <strong>{unchanged.length}</strong> giữ nguyên, <strong>{newItems.length}</strong> thiết bị mới chưa có trong bảng giá.
        </p>
        {importResult && (
          <div className="ci-import-summary" style={{ marginBottom: 14 }}>
            <div><strong>ImportPreviewResult:</strong> {importResult.engine} · confidence {Math.round((importResult.overallConfidence || 0) * 100)}%</div>
            <div className="ci-summary-pills">
              <span className="ok">✅ {importResult.summary.autoApproved} tự duyệt</span>
              <span className="warn">⚠️ {importResult.summary.needReview} cần kiểm tra</span>
              <span className="err">❌ {importResult.summary.failed} lỗi</span>
              <span className="muted">⏭ {importResult.summary.skipped} bỏ qua</span>
            </div>
          </div>
        )}

        {matched.length > 0 && (
          <>
            <h4 className="imp-sub">Thiết bị thay đổi giá nhập</h4>
            <div className="imp-scroll">
              <table className="cat-table">
                <thead><tr><th>Thiết bị</th><th>Mã</th><th className="num">Giá nhập cũ</th><th className="num">Giá nhập mới</th><th className="num">Thay đổi</th></tr></thead>
                <tbody>
                  {matched.map((m) => {
                    const diff = m.newCost - (m.existing.costPrice || 0);
                    const pct = m.existing.costPrice ? Math.round((diff / m.existing.costPrice) * 100) : 0;
                    return (
                      <tr key={m.existing.id}>
                        <td className="strong">{m.existing.name}</td>
                        <td className="muted">{m.existing.sku}</td>
                        <td className="num muted">{VND(m.existing.costPrice)}</td>
                        <td className="num strong">{VND(m.newCost)}</td>
                        <td className="num"><span className={diff >= 0 ? "neg" : "pos"}>{diff >= 0 ? "+" : ""}{pct}%</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}

        {newItems.length > 0 && (
          <>
            <h4 className="imp-sub">Thiết bị mới (chưa có trong bảng giá)</h4>
            <div className="imp-scroll short">
              <table className="cat-table">
                <thead><tr><th>Tên / Mã</th><th className="num">Giá nhập</th></tr></thead>
                <tbody>
                  {newItems.map((it, i) => (
                    <tr key={i}><td>{it.name || it.sku} <span className="muted">({it.sku})</span></td><td className="num">{VND(it.costPrice)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {matched.length === 0 && newItems.length === 0 && (
          <p className="empty-hint">Không có thay đổi nào để áp dụng — giá trong file giống bảng giá hiện tại.</p>
        )}

        <div className="imp-options">
          {newItems.length > 0 && (
            <label className="chk">
              <input type="checkbox" checked={addNew} onChange={(e) => setAddNew(e.target.checked)} />
              <span>Thêm {newItems.length} thiết bị mới vào bảng giá</span>
            </label>
          )}
        </div>

        <div className="modal-actions">
          <button className="btn-ghost" onClick={onCancel}>Hủy</button>
          <button
            className="btn-primary"
            disabled={matched.length === 0 && !(addNew && newItems.length > 0)}
            onClick={() => onApply(preview, { addNew })}
          >
            Áp dụng cập nhật
          </button>
        </div>
      </div>
    </div>
  );
}
function Templates({ products, productById, templates, setTemplates, markups = [], createRequest = 0 }) {
  const [editing, setEditing] = useState(null);
  const lastCreateRequestRef = useRef(createRequest);

  useEffect(() => {
    if (!createRequest || createRequest === lastCreateRequestRef.current) return;
    lastCreateRequestRef.current = createRequest;
    setEditing({ name: "", items: [] });
  }, [createRequest]);

  const saveTpl = (tpl) => {
    if (tpl.id) setTemplates((ts) => ts.map((t) => (t.id === tpl.id ? tpl : t)));
    else setTemplates((ts) => [...ts, { ...tpl, id: uid("tpl") }]);
    setEditing(null);
  };
  const deleteTpl = async (id) => {
    if (await confirmAction({ title: "Xóa gói phòng?", message: "Gói phòng này sẽ bị xóa khỏi thư viện mẫu.", confirmLabel: "Xóa", tone: "danger" })) setTemplates((ts) => ts.filter((t) => t.id !== id));
  };

  const templateFactor = Number(markups?.[0]?.value) > 0 ? Number(markups[0].value) : 1;
  const tplTotal = (tpl) =>
    tpl.items.reduce((s, it) => s + Math.round(((productById[it.productId]?.costPrice || 0) * templateFactor) / 1000) * 1000 * it.qty, 0);

  return (
    <div className="templates">
      {templates.length > 0 ? (
        <div className="cat-toolbar">
          <p className="tab-intro">Gói phòng gom các sản phẩm thường dùng để bạn thêm cả nhóm vào báo giá chỉ trong một bước.</p>
          <button className="btn-primary" style={{ width: "auto" }} onClick={() => setEditing({ name: "", items: [] })}>+ Tạo gói phòng</button>
        </div>
      ) : null}

      {templates.length === 0 ? (
        <section className="room-pack-empty">
          <div className="room-pack-empty-icon" aria-hidden="true">▦</div>
          <div className="room-pack-empty-kicker">Thư viện gói phòng</div>
          <h2>Chưa có gói phòng</h2>
          <p>Gom các sản phẩm thường đi cùng nhau thành một gói, ví dụ “Phòng ngủ tiêu chuẩn” hoặc “Căn hộ 2 phòng ngủ”. Khi báo giá, bạn chỉ cần thêm cả gói thay vì chọn từng sản phẩm.</p>
          <div className="room-pack-example"><strong>Ví dụ:</strong> 1 bộ điều khiển + 2 công tắc + 1 cảm biến + phụ kiện</div>
          <button className="btn-primary" style={{ width: "auto" }} onClick={() => setEditing({ name: "", items: [] })}>+ Tạo gói đầu tiên</button>
        </section>
      ) : (
      <div className="tpl-grid">
        {templates.map((t) => (
          <div className="tpl-card" key={t.id}>
            <div className="tpl-card-head">
              <h3>{t.name}</h3>
              <span className="tpl-total">{VND(tplTotal(t))}</span>
            </div>
            <ul className="tpl-items">
              {t.items.map((it, i) => {
                const p = productById[it.productId];
                return <li key={i}><span>{p ? p.name : "(thiết bị đã xóa)"}</span><span className="muted">×{it.qty}</span></li>;
              })}
              {t.items.length === 0 && <li className="muted">Chưa có thiết bị</li>}
            </ul>
            <div className="tpl-card-actions">
              <button className="link" onClick={() => setEditing(t)}>Sửa</button>
              <button className="link danger" onClick={() => deleteTpl(t.id)}>Xóa</button>
            </div>
          </div>
        ))}
      </div>
      )}

      {editing && (
        <TemplateEditor template={editing} products={products} productById={productById} onSave={saveTpl} onCancel={() => setEditing(null)} />
      )}
    </div>
  );
}

function TemplateEditor({ template, products, productById, onSave, onCancel }) {
  const [f, setF] = useState({ ...template, items: [...template.items] });
  const [q, setQ] = useState("");

  const addItem = (pid) => {
    const ex = f.items.find((i) => i.productId === pid);
    if (ex) setF({ ...f, items: f.items.map((i) => (i.productId === pid ? { ...i, qty: i.qty + 1 } : i)) });
    else setF({ ...f, items: [...f.items, { productId: pid, qty: 1 }] });
  };
  const setQty = (pid, qty) => setF({ ...f, items: f.items.map((i) => (i.productId === pid ? { ...i, qty: Math.max(1, qty) } : i)) });
  const removeItem = (pid) => setF({ ...f, items: f.items.filter((i) => i.productId !== pid) });

  const filtered = products.filter((p) => p.name.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <h2>{template.id ? "Sửa gói phòng" : "Tạo gói phòng"}</h2>
        <Field label="Tên gói" value={f.name} onChange={(v) => setF({ ...f, name: v })} />

        <div className="tpl-editor-cols">
          <div>
            <h4>Thiết bị trong gói</h4>
            {f.items.length === 0 && <p className="empty-hint">Chọn thiết bị từ danh sách bên phải.</p>}
            <ul className="tpl-edit-items">
              {f.items.map((it) => {
                const p = productById[it.productId];
                return (
                  <li key={it.productId}>
                    <span className="tei-name">{p ? p.name : "(đã xóa)"}</span>
                    <input type="text" inputMode="numeric" value={it.qty} className="qty-input" onChange={(e) => setQty(it.productId, parseInt(e.target.value.replace(/\D/g, "")) || 1)} />
                    <button className="x-btn" onClick={() => removeItem(it.productId)}>×</button>
                  </li>
                );
              })}
            </ul>
          </div>
          <div>
            <h4>Thêm thiết bị</h4>
            <input className="search" value={q} onChange={(e) => setQ(e.target.value)} />
            <div className="tpl-pick-list">
              {filtered.map((p) => (
                <button key={p.id} className="picker-item" onClick={() => addItem(p.id)}>
                  {p.image && <img src={imgSrc(p.image)} alt="" loading="lazy" className="pi-thumb" onError={(e)=>{e.currentTarget.style.display="none"}} />}
                  <span className="pi-name">{p.name}</span>
                  <span className="pi-meta">{VND(p.costPrice)} gốc</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="modal-actions">
          <button className="btn-ghost" onClick={onCancel}>Hủy</button>
          <button className="btn-primary" onClick={() => { if (!f.name) { notify.warning("Nhập tên gói."); return; } onSave(f); }}>Lưu gói</button>
        </div>
      </div>
    </div>
  );
}


// ============================================================
// TAB 4A — Mẫu báo giá theo từng công ty
// ============================================================
function QuoteTemplateSettings({ company, setCompany, products, rooms, productById }) {
  const cfg = normalizeQuoteTemplateConfig(company?.quoteTemplate || {});
  const setCfg = (next) => setCompany({ ...company, quoteTemplate: normalizeQuoteTemplateConfig(next) });
  const setPath = (section, key, value) => setCfg({ ...cfg, [section]: { ...(cfg[section] || {}), [key]: value } });
  const setNested = (section, group, key, value) => setCfg({ ...cfg, [section]: { ...(cfg[section] || {}), [group]: { ...((cfg[section] || {})[group] || {}), [key]: value } } });
  const updateColumn = (key, value) => setPath("columns", key, value);
  const updateSection = (key, value) => setPath("sections", key, value);
  const updateLabel = (key, value) => setPath("labels", key, value);
  const updateTerm = (key, value) => setPath("terms", key, value);
  const applyPreset = (presetId) => setCfg(applyQuoteTemplatePreset(cfg, presetId));

  const logoFileRef = useRef(null);
  const uploadLogo = (file) => {
    if (!file) return;
    if (!/^image\//.test(file.type || "")) { notify.warning("Vui lòng chọn file ảnh logo."); return; }
    if (file.size > 700 * 1024) { notify.warning("Logo nên dưới 700KB để báo giá xuất nhanh hơn."); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const logoUrl = String(reader.result || "");
      setCompany({ ...company, logoUrl, quoteTemplate: normalizeQuoteTemplateConfig({ ...cfg, brand: { ...cfg.brand, logoUrl } }) });
    };
    reader.readAsDataURL(file);
  };

  const sampleRooms = rooms?.some((r) => r.lines?.length) ? rooms : [{ id: "sample-room", name: "Phòng khách / Demo", lines: products.slice(0, 2).map((p, idx) => ({ id: `sample-${idx}`, productId: p.id, qty: idx + 1, factor: 1, note: idx === 0 ? "Khu vực chính" : "Hạng mục bổ sung" })) }];
  const sampleProductById = productById || Object.fromEntries((products || []).map((p) => [p.id, p]));
  const sampleLineSalePrice = (p, l) => Number(p?.priceMode === "fixed" ? (p.publicPrice || p.listPrice || p.costPrice || 0) : (p.costPrice || p.listPrice || p.publicPrice || 0) * (l?.factor || 1)) || 0;
  const sampleCalc = { deviceTotal: 0, laborTotal: 0, grand: 0, pointCount: 0 };
  sampleRooms.forEach((r) => (r.lines || []).forEach((l) => {
    const p = sampleProductById[l.productId];
    if (!p) return;
    const total = sampleLineSalePrice(p, l) * (Number(l.qty) || 0);
    sampleCalc.deviceTotal += total;
    sampleCalc.pointCount += Number(l.qty) || 0;
  }));
  sampleCalc.laborTotal = Math.round(sampleCalc.deviceTotal * ((Number(company?.laborPercent) || 0) / 100));
  sampleCalc.grand = sampleCalc.deviceTotal + sampleCalc.laborTotal;

  const previewPdf = () => {
    const html = buildQuotePrintHTML({
      company,
      customer: { name: "Khách hàng mẫu", phone: "090xxxxxxx", address: "Khu vực mẫu", project: "Công trình mẫu", quoteNumber: "SQ-DEMO", category: "Demo" },
      rooms: sampleRooms,
      productById: sampleProductById,
      lineSalePrice: sampleLineSalePrice,
      calc: sampleCalc,
      quoteTemplateConfig: cfg,
    });
    const w = window.open("", "_blank");
    if (!w) { notify.warning("Trình duyệt chặn cửa sổ preview. Cho phép pop-up rồi thử lại."); return; }
    w.document.write(html);
    w.document.close();
    w.focus();
  };

  const excelTemplateFileRef = useRef(null);
  const excelTemplates = normalizeExcelQuoteTemplates(company?.excelQuoteTemplates);
  const defaultExcelTplId = company?.defaultExcelQuoteTemplateId
    || excelTemplates.find((t) => t.isActive)?.id
    || excelTemplates[0]?.id
    || "";
  const [selectedExcelTplId, setSelectedExcelTplId] = useState(defaultExcelTplId);
  const selectedExcelTemplate = excelTemplates.find((t) => t.id === selectedExcelTplId)
    || excelTemplates.find((t) => t.id === defaultExcelTplId)
    || excelTemplates[0]
    || null;
  const [excelPickTarget, setExcelPickTarget] = useState(null);
  const excelPreviewRows = useMemo(() => buildExcelTemplatePreview(selectedExcelTemplate), [selectedExcelTemplate?.id, selectedExcelTemplate?.dataUrl, selectedExcelTemplate?.mapping?.sheetName]);

  useEffect(() => {
    const selectedStillExists = excelTemplates.some((t) => t.id === selectedExcelTplId);
    if (!selectedStillExists) setSelectedExcelTplId(defaultExcelTplId);
  }, [selectedExcelTplId, defaultExcelTplId, excelTemplates]);

  const saveExcelTemplates = (next, defaultId = company?.defaultExcelQuoteTemplateId || "") => setCompany({
    ...company,
    excelQuoteTemplates: normalizeExcelQuoteTemplates(next),
    defaultExcelQuoteTemplateId: defaultId,
  });
  const setDefaultExcelTemplate = () => {
    if (!selectedExcelTemplate) return;
    saveExcelTemplates(excelTemplates, selectedExcelTemplate.id);
    notify.success(`Đã đặt “${selectedExcelTemplate.name}” làm mẫu Excel mặc định.`);
  };
  const updateSelectedExcelTemplate = (patch) => {
    if (!selectedExcelTemplate) return;
    saveExcelTemplates(excelTemplates.map((tpl) => tpl.id === selectedExcelTemplate.id ? normalizeExcelQuoteTemplate({ ...tpl, ...patch }) : tpl));
  };
  const updateExcelMapping = (section, key, value) => {
    if (!selectedExcelTemplate) return;
    const mapping = selectedExcelTemplate.mapping || normalizeExcelQuoteTemplate(selectedExcelTemplate).mapping;
    updateSelectedExcelTemplate({ mapping: { ...mapping, [section]: { ...(mapping[section] || {}), [key]: value } } });
  };
  const updateExcelColumnMapping = (key, value) => {
    if (!selectedExcelTemplate) return;
    const mapping = selectedExcelTemplate.mapping || normalizeExcelQuoteTemplate(selectedExcelTemplate).mapping;
    updateSelectedExcelTemplate({
      mapping: {
        ...mapping,
        items: { ...(mapping.items || {}), columns: { ...((mapping.items || {}).columns || {}), [key]: value } },
      },
    });
  };
  const updateExcelStructureMapping = (patch = {}) => {
    if (!selectedExcelTemplate) return;
    const mapping = selectedExcelTemplate.mapping || normalizeExcelQuoteTemplate(selectedExcelTemplate).mapping;
    updateSelectedExcelTemplate({
      mapping: { ...mapping, structureMode: "manual_v2", items: { ...(mapping.items || {}), ...patch } },
    });
  };
  const excelPickerTargets = [
    { type: "field", key: "customerName", label: "Tên khách" },
    { type: "field", key: "customerPhone", label: "Số điện thoại" },
    { type: "field", key: "projectAddress", label: "Địa chỉ" },
    { type: "field", key: "projectName", label: "Hạng mục" },
    { type: "field", key: "quoteDate", label: "Ngày" },
    { type: "field", key: "quoteNumber", label: "Số báo giá" },
    { type: "row", key: "startRow", label: "Dòng sản phẩm" },
    { type: "row", key: "clearUntilRow", label: "Dọn tới dòng" },
    { type: "column", key: "name", label: "Cột tên SP" },
    { type: "column", key: "sku", label: "Cột mã" },
    { type: "column", key: "qty", label: "Cột SL" },
    { type: "column", key: "unitPrice", label: "Cột đơn giá" },
    { type: "column", key: "lineTotal", label: "Cột thành tiền" },
    { type: "total", key: "grandTotal", label: "Ô tổng thanh toán" },
  ];
  const applyExcelPreviewPick = (cell) => {
    if (!selectedExcelTemplate || !excelPickTarget || !cell) return;
    const mapping = selectedExcelTemplate.mapping || normalizeExcelQuoteTemplate(selectedExcelTemplate).mapping;
    if (excelPickTarget.type === "field") {
      updateExcelMapping("fields", excelPickTarget.key, cell.ref);
    } else if (excelPickTarget.type === "total") {
      updateExcelMapping("totals", excelPickTarget.key, cell.ref);
    } else if (excelPickTarget.type === "column") {
      updateExcelColumnMapping(excelPickTarget.key, cell.col);
    } else if (excelPickTarget.type === "row") {
      updateExcelStructureMapping({ [excelPickTarget.key]: cell.row, ...(excelPickTarget.key === "startRow" ? { templateRow: cell.row } : {}) });
    }
    setExcelPickTarget(null);
  };

  const analyzeExcelTemplateOnServer = async (template) => {
    if (typeof window === "undefined" || window.location.protocol === "file:") return null;
    try {
      const res = await smartQuoteFetch("/api/excel-template", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "analyze", template }),
      });
      if (!res.ok) return null;
      return await res.json();
    } catch (e) {
      console.warn("Lossless XML analyzer chưa khả dụng, dùng mapper local:", e);
      return null;
    }
  };

  const uploadExcelTemplateFile = async (file) => {
    if (!file) return;
    if (!/\.xlsx$/i.test(file.name)) { notify.warning("Phase 12 chỉ nhận file .xlsx. Không dùng PDF hoặc .xls cũ ở phase này."); return; }
    if (file.size > 4 * 1024 * 1024) { notify.warning("Mẫu Excel nên dưới 4MB để lưu và xuất nhanh hơn."); return; }
    try {
      const [dataUrl, buffer] = await Promise.all([readFileAsDataUrl(file), file.arrayBuffer()]);
      const sourceChecksum = await sha256HexArrayBuffer(buffer);
      let sheetNames = [];
      let detected = null;
      try {
        const wb = XLSX.read(buffer, { type: "array", bookSheets: true });
        sheetNames = wb.SheetNames || [];
      } catch {}
      try {
        detected = detectExcelQuoteTemplateMapping(buffer, file.name);
        sheetNames = sheetNames.length ? sheetNames : [detected?.mapping?.sheetName].filter(Boolean);
      } catch (e) {
        console.warn("Smart Excel mapper không tự nhận diện được, dùng mapping mặc định:", e);
      }
      const serverDetected = await analyzeExcelTemplateOnServer({
        fileName: file.name, dataUrl, mapping: detected?.mapping || { sheetName: sheetNames[0] || "" },
      });
      const authoritative = serverDetected || detected;
      const tpl = normalizeExcelQuoteTemplate({
        name: file.name.replace(/\.xlsx$/i, ""),
        fileName: file.name,
        dataUrl,
        sheetNames,
        sourceChecksum: serverDetected?.sourceChecksum || sourceChecksum,
        manifestVersion: serverDetected?.manifestVersion || 3,
        engineVersion: serverDetected?.engineVersion || "lossless_xml_v3",
        manifest: serverDetected?.manifest || authoritative?.mapping || null,
        mapping: authoritative?.mapping || { ...DEFAULT_EXCEL_QUOTE_TEMPLATE_MAPPING, sheetName: sheetNames[0] || "" },
        detection: authoritative?.detection || null,
      });
      const nextTemplates = [...excelTemplates, tpl];
      saveExcelTemplates(nextTemplates, company?.defaultExcelQuoteTemplateId || tpl.id);
      setSelectedExcelTplId(tpl.id);
      if (detected?.detection?.confidence >= 70) {
        notify.success("Đã upload và SmartQuote đã tự nhận diện mẫu. Bạn chỉ cần bấm Xuất thử file demo để kiểm tra.");
      } else {
        notify.success("Đã upload mẫu Excel. SmartQuote đã đoán một phần; hãy mở Chỉnh tay nếu cần.");
      }
    } catch (e) {
      console.error(e);
      notify.error(e.message || "Không đọc được file mẫu Excel.");
    } finally {
      if (excelTemplateFileRef.current) excelTemplateFileRef.current.value = "";
    }
  };
  const rerunExcelTemplateDetection = async () => {
    if (!selectedExcelTemplate?.dataUrl) { notify.warning("Mẫu này chưa có file Excel gốc để tự nhận diện lại."); return; }
    try {
      const detected = detectExcelQuoteTemplateMapping(dataUrlToArrayBuffer(selectedExcelTemplate.dataUrl), selectedExcelTemplate.fileName || selectedExcelTemplate.name || "template.xlsx");
      const serverDetected = await analyzeExcelTemplateOnServer({ fileName: selectedExcelTemplate.fileName, dataUrl: selectedExcelTemplate.dataUrl, mapping: detected.mapping });
      const authoritative = serverDetected || detected;
      updateSelectedExcelTemplate({
        mapping: authoritative.mapping, detection: authoritative.detection,
        manifest: serverDetected?.manifest || authoritative.mapping,
        sourceChecksum: serverDetected?.sourceChecksum || selectedExcelTemplate.sourceChecksum || "",
        manifestVersion: serverDetected?.manifestVersion || 3, engineVersion: serverDetected?.engineVersion || "lossless_xml_v3",
      });
      notify.success("Đã tự nhận diện lại mẫu Excel. Hãy kiểm tra phần tóm tắt bên dưới.");
    } catch (e) {
      console.error(e);
      notify.error(e.message || "Không tự nhận diện được mẫu Excel này.");
    }
  };

  const deleteExcelTemplate = async () => {
    if (!selectedExcelTemplate) return;
    if (!(await confirmAction({ title: "Xóa mẫu Excel?", message: `Bạn sắp xóa “${selectedExcelTemplate.name}”.`, confirmLabel: "Xóa", tone: "danger" }))) return;
    const next = excelTemplates.filter((tpl) => tpl.id !== selectedExcelTemplate.id);
    const nextDefaultId = company?.defaultExcelQuoteTemplateId === selectedExcelTemplate.id
      ? (next[0]?.id || "")
      : (company?.defaultExcelQuoteTemplateId || next[0]?.id || "");
    saveExcelTemplates(next, nextDefaultId);
    setSelectedExcelTplId(nextDefaultId);
  };
  const previewExcelTemplate = async () => {
    if (!selectedExcelTemplate) { notify.warning("Chưa có mẫu Excel."); return; }
    try {
      await exportQuoteExcelWithTemplate({
        template: selectedExcelTemplate,
        company,
        customer: { name: "Khách hàng mẫu", phone: "090xxxxxxx", address: "Khu vực mẫu", project: "Công trình mẫu", quoteNumber: "SQ-DEMO" },
        rooms: sampleRooms,
        productById: sampleProductById,
        lineSalePrice: sampleLineSalePrice,
        calc: sampleCalc,
      });
    } catch (e) {
      console.error(e);
      notify.error(e.message || "Không xuất được file demo theo mẫu Excel.");
    }
  };

  const columnLabels = {
    stt: "STT", note: "Khu vực/Ghi chú", image: "Ảnh", sku: "Mã/SKU", name: "Tên sản phẩm", spec: "Thông số/Mô tả", supplier: "Hãng/Nguồn", unit: "ĐVT", qty: "SL", unitPrice: "Đơn giá", total: "Thành tiền",
  };

  return (
    <div className="settings quote-template-page">
      <section className="section-card">
        <div className="section-card-head">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><line x1="7" y1="8" x2="17" y2="8"/><line x1="7" y1="12" x2="17" y2="12"/><line x1="7" y1="16" x2="13" y2="16"/></svg>
          <span>Mẫu báo giá công ty</span>
        </div>
        <div className="section-card-body">
          <p className="tab-intro" style={{ margin: "0 0 12px" }}>
            Mỗi đại lý có thể chọn mẫu theo ngành, đổi logo/màu/cột hiển thị/điều khoản. Mẫu này sẽ được dùng khi bấm <strong>Xuất PDF</strong>.
          </p>
          <div className="quote-template-presets">
            {QUOTE_TEMPLATE_PRESET_LIST.map((preset) => (
              <button key={preset.id} className={cfg.presetId === preset.id ? "active" : ""} onClick={() => applyPreset(preset.id)}>
                <strong>{preset.name}</strong>
                <span>{preset.description}</span>
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="section-card excel-template-section">
        <div className="section-card-head"><span>Mẫu Excel báo giá của đại lý</span></div>
        <div className="section-card-body">
          <p className="tab-intro" style={{ margin: "0 0 12px" }}>
            Upload file <strong>.xlsx</strong> gốc. SmartQuote giữ nguyên package Excel và chỉ patch vùng dữ liệu động, nên logo, style, border, kích thước dòng/cột, drawing và thiết lập in của mẫu được giữ nguyên.
          </p>
          <div className="excel-template-actions">
            <button className="btn-primary" onClick={() => excelTemplateFileRef.current?.click()}>+ Upload mẫu Excel</button>
            <input ref={excelTemplateFileRef} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden onChange={(e) => uploadExcelTemplateFile(e.target.files?.[0])} />
            {selectedExcelTemplate && <button className="btn-ghost" onClick={previewExcelTemplate}>Xuất thử file demo</button>}
            {selectedExcelTemplate && selectedExcelTemplate.id !== company?.defaultExcelQuoteTemplateId && <button className="btn-ghost" onClick={setDefaultExcelTemplate}>Đặt làm mẫu mặc định</button>}
            {selectedExcelTemplate && selectedExcelTemplate.id === company?.defaultExcelQuoteTemplateId && <span className="tag">Mẫu mặc định</span>}
            {selectedExcelTemplate && <button className="btn-ghost danger" onClick={deleteExcelTemplate}>Xóa mẫu</button>}
          </div>

          {excelTemplates.length === 0 ? (
            <div className="excel-template-empty">
              Chưa có mẫu Excel nào. Upload file báo giá mẫu .xlsx của đại lý, SmartQuote sẽ giữ file gốc và chỉ điền dữ liệu vào các ô/dòng đã map.
            </div>
          ) : (
            <div className="excel-template-editor">
              <label className="field full"><span>Đang chỉnh mẫu</span>
                <select value={selectedExcelTemplate?.id || ""} onChange={(e) => setSelectedExcelTplId(e.target.value)}>
                  {excelTemplates.map((tpl) => <option key={tpl.id} value={tpl.id}>{tpl.name}</option>)}
                </select>
              </label>
              <div className="field-grid">
                <Field label="Tên mẫu" value={selectedExcelTemplate?.name || ""} onChange={(v) => updateSelectedExcelTemplate({ name: v })} />
                <label className="field"><span>Sheet xuất báo giá</span>
                  <select value={selectedExcelTemplate?.mapping?.sheetName || ""} onChange={(e) => updateSelectedExcelTemplate({ mapping: { ...selectedExcelTemplate.mapping, sheetName: e.target.value } })}>
                    <option value="">Sheet đầu tiên</option>
                    {(selectedExcelTemplate?.sheetNames || []).map((name) => <option key={name} value={name}>{name}</option>)}
                  </select>
                </label>
              </div>

              <div className="excel-smart-detect-card">
                <div className="excel-smart-top">
                  <div>
                    <strong>SmartQuote đã đoán mẫu này</strong>
                    <span>{selectedExcelTemplate?.detection ? `Lossless v3 · Độ tin cậy ${selectedExcelTemplate.detection.confidence || 0}% · Sheet ${selectedExcelTemplate.detection.sheetName || selectedExcelTemplate.mapping?.sheetName || "đầu tiên"}` : "Upload file báo giá đã điền sẵn để SmartQuote tự nhận diện."}</span>
                  </div>
                  <button className="btn-ghost" onClick={rerunExcelTemplateDetection}>Tự nhận diện lại</button>
                </div>
                {selectedExcelTemplate?.detection ? (
                  <div className="excel-detect-summary">
                    <div><b>{selectedExcelTemplate.detection.headerRow || "—"}</b><span>Dòng header</span></div>
                    <div><b>{selectedExcelTemplate.detection.sectionRow || "—"}</b><span>Dòng nhóm mẫu</span></div>
                    <div><b>{selectedExcelTemplate.detection.templateRow || "—"}</b><span>Dòng sản phẩm mẫu</span></div>
                    <div><b>{selectedExcelTemplate.detection.clearUntilRow || "—"}</b><span>Dữ liệu cũ tới dòng</span></div>
                  </div>
                ) : null}
                {selectedExcelTemplate?.detection?.notes?.length ? (
                  <ul className="excel-detect-notes">
                    {selectedExcelTemplate.detection.notes.map((note, idx) => <li key={idx}>✓ {note}</li>)}
                  </ul>
                ) : null}
              </div>

              <div className="excel-click-map-card">
                <div className="excel-click-map-head">
                  <div><strong>Click để sửa nhanh</strong><span>Chọn thứ cần map, rồi bấm vào ô/dòng/cột trong preview. Không cần nhớ A6 hay J15.</span></div>
                </div>
                <div className="excel-picker-buttons">
                  {excelPickerTargets.map((target) => (
                    <button key={`${target.type}-${target.key}`} className={excelPickTarget?.type === target.type && excelPickTarget?.key === target.key ? "active" : ""} onClick={() => setExcelPickTarget(target)}>{target.label}</button>
                  ))}
                </div>
                {excelPickTarget && <div className="excel-pick-hint">Đang chọn: <b>{excelPickTarget.label}</b>. Bấm vào ô phù hợp trong bảng bên dưới.</div>}
                {excelPreviewRows.length ? (
                  <div className="excel-preview-grid-wrap">
                    <table className="excel-preview-grid">
                      <tbody>
                        {excelPreviewRows.map((row) => (
                          <tr key={row.row}>
                            <th>{row.row}</th>
                            {row.cells.map((cell) => (
                              <td key={cell.ref} title={cell.ref} onClick={() => applyExcelPreviewPick(cell)} className={excelPickTarget ? "pickable" : ""}>
                                <small>{cell.ref}</small>{cell.text ? <span>{cell.text}</span> : <i>·</i>}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : <div className="excel-template-empty">Không tạo được preview Excel. Bạn vẫn có thể chỉnh tay bên dưới.</div>}
              </div>

              <details className="excel-advanced-map">
                <summary>Chỉnh tay nếu SmartQuote đoán sai <span>vẫn có thể nhập ô/cột nâng cao</span></summary>
                <div className="excel-map-grid">
                  <div>
                    <h4>Ô thông tin khách hàng</h4>
                    <div className="field-grid compact">
                      <Field label="Tên khách" value={selectedExcelTemplate?.mapping?.fields?.customerName || ""} onChange={(v) => updateExcelMapping("fields", "customerName", cleanExcelCellRef(v))} />
                      <Field label="Số điện thoại" value={selectedExcelTemplate?.mapping?.fields?.customerPhone || ""} onChange={(v) => updateExcelMapping("fields", "customerPhone", cleanExcelCellRef(v))} />
                      <Field label="Địa chỉ" value={selectedExcelTemplate?.mapping?.fields?.projectAddress || ""} onChange={(v) => updateExcelMapping("fields", "projectAddress", cleanExcelCellRef(v))} />
                      <Field label="Tên dự án/Hạng mục" value={selectedExcelTemplate?.mapping?.fields?.projectName || ""} onChange={(v) => updateExcelMapping("fields", "projectName", cleanExcelCellRef(v))} />
                      <Field label="Ngày báo giá" value={selectedExcelTemplate?.mapping?.fields?.quoteDate || ""} onChange={(v) => updateExcelMapping("fields", "quoteDate", cleanExcelCellRef(v))} />
                      <Field label="Số báo giá" value={selectedExcelTemplate?.mapping?.fields?.quoteNumber || ""} onChange={(v) => updateExcelMapping("fields", "quoteNumber", cleanExcelCellRef(v))} />
                    </div>
                  </div>

                  <div>
                    <h4>Vùng bảng sản phẩm</h4>
                    <div className="field-grid compact">
                      <NumField label="Dòng header" value={selectedExcelTemplate?.mapping?.items?.headerRow || 0} onChange={(v) => updateSelectedExcelTemplate({ mapping: { ...selectedExcelTemplate.mapping, items: { ...selectedExcelTemplate.mapping.items, headerRow: v } } })} />
                      <NumField label="Dòng nhóm mẫu" value={selectedExcelTemplate?.mapping?.items?.sectionRow || 0} onChange={(v) => updateExcelStructureMapping({ sectionRow: v })} />
                      <NumField label="Dòng bắt đầu dữ liệu" value={selectedExcelTemplate?.mapping?.items?.startRow || 15} onChange={(v) => updateExcelStructureMapping({ startRow: v })} />
                      <NumField label="Dòng sản phẩm mẫu" value={selectedExcelTemplate?.mapping?.items?.templateRow || 15} onChange={(v) => updateExcelStructureMapping({ templateRow: v })} />
                      <NumField label="Xoá dữ liệu cũ tới dòng" value={selectedExcelTemplate?.mapping?.items?.clearUntilRow || selectedExcelTemplate?.mapping?.items?.startRow || 15} onChange={(v) => updateExcelStructureMapping({ clearUntilRow: v })} />
                      <Field label="Cột tên nhóm" value={selectedExcelTemplate?.mapping?.items?.sectionLabelColumn || ""} onChange={(v) => updateSelectedExcelTemplate({ mapping: { ...selectedExcelTemplate.mapping, items: { ...selectedExcelTemplate.mapping.items, sectionLabelColumn: cleanExcelCellRef(v) } } })} />
                      <Field label="Cột STT" value={selectedExcelTemplate?.mapping?.items?.columns?.no || ""} onChange={(v) => updateExcelColumnMapping("no", cleanExcelCellRef(v))} />
                      <Field label="Cột tên SP" value={selectedExcelTemplate?.mapping?.items?.columns?.name || ""} onChange={(v) => updateExcelColumnMapping("name", cleanExcelCellRef(v))} />
                      <Field label="Cột mã/SKU" value={selectedExcelTemplate?.mapping?.items?.columns?.sku || ""} onChange={(v) => updateExcelColumnMapping("sku", cleanExcelCellRef(v))} />
                      <Field label="Cột thông số" value={selectedExcelTemplate?.mapping?.items?.columns?.specs || ""} onChange={(v) => updateExcelColumnMapping("specs", cleanExcelCellRef(v))} />
                      <Field label="Cột hình ảnh" value={selectedExcelTemplate?.mapping?.items?.columns?.image || ""} onChange={(v) => updateExcelColumnMapping("image", cleanExcelCellRef(v))} />
                      <Field label="Cột hãng" value={selectedExcelTemplate?.mapping?.items?.columns?.supplier || ""} onChange={(v) => updateExcelColumnMapping("supplier", cleanExcelCellRef(v))} />
                      <Field label="Cột ĐVT" value={selectedExcelTemplate?.mapping?.items?.columns?.unit || ""} onChange={(v) => updateExcelColumnMapping("unit", cleanExcelCellRef(v))} />
                      <Field label="Cột SL" value={selectedExcelTemplate?.mapping?.items?.columns?.qty || ""} onChange={(v) => updateExcelColumnMapping("qty", cleanExcelCellRef(v))} />
                      <Field label="Cột đơn giá" value={selectedExcelTemplate?.mapping?.items?.columns?.unitPrice || ""} onChange={(v) => updateExcelColumnMapping("unitPrice", cleanExcelCellRef(v))} />
                      <Field label="Cột thành tiền" value={selectedExcelTemplate?.mapping?.items?.columns?.lineTotal || ""} onChange={(v) => updateExcelColumnMapping("lineTotal", cleanExcelCellRef(v))} />
                      <Field label="Cột ghi chú/phòng" value={selectedExcelTemplate?.mapping?.items?.columns?.note || ""} onChange={(v) => updateExcelColumnMapping("note", cleanExcelCellRef(v))} />
                    </div>
                  </div>
                </div>

                <div className="excel-map-totals">
                  <h4>Vùng tổng hợp theo nhóm</h4>
                  <div className="field-grid compact">
                    <NumField label="Dòng tiêu đề tổng hợp" value={selectedExcelTemplate?.mapping?.summary?.titleRow || 0} onChange={(v) => updateExcelMapping("summary", "titleRow", v)} />
                    <NumField label="Dòng tổng hợp mẫu" value={selectedExcelTemplate?.mapping?.summary?.templateRow || 0} onChange={(v) => updateExcelMapping("summary", "templateRow", v)} />
                    <Field label="Cột nhãn nhóm" value={selectedExcelTemplate?.mapping?.summary?.labelColumn || ""} onChange={(v) => updateExcelMapping("summary", "labelColumn", cleanExcelCellRef(v))} />
                    <Field label="Cột tiền nhóm" value={selectedExcelTemplate?.mapping?.summary?.totalColumn || ""} onChange={(v) => updateExcelMapping("summary", "totalColumn", cleanExcelCellRef(v))} />
                  </div>
                </div>

                <div className="excel-map-totals">
                  <h4>Ô tổng tiền</h4>
                  <div className="field-grid compact">
                    <Field label="Tạm tính" value={selectedExcelTemplate?.mapping?.totals?.subtotal || ""} onChange={(v) => updateExcelMapping("totals", "subtotal", cleanExcelCellRef(v))} />
                    <Field label="Nhân công" value={selectedExcelTemplate?.mapping?.totals?.labor || ""} onChange={(v) => updateExcelMapping("totals", "labor", cleanExcelCellRef(v))} />
                    <Field label="VAT" value={selectedExcelTemplate?.mapping?.totals?.vat || ""} onChange={(v) => updateExcelMapping("totals", "vat", cleanExcelCellRef(v))} />
                    <Field label="Tổng thanh toán" value={selectedExcelTemplate?.mapping?.totals?.grandTotal || ""} onChange={(v) => updateExcelMapping("totals", "grandTotal", cleanExcelCellRef(v))} />
                  </div>
                </div>
              </details>
            </div>
          )}
        </div>
      </section>

      <section className="section-card">
        <div className="section-card-head"><span>Nhận diện thương hiệu</span></div>
        <div className="section-card-body">
          <div className="field-grid">
            <Field label="Logo URL" value={cfg.brand?.logoUrl || company.logoUrl || ""} onChange={(v) => { setCompany({ ...company, logoUrl: v, quoteTemplate: normalizeQuoteTemplateConfig({ ...cfg, brand: { ...cfg.brand, logoUrl: v } }) }); }} full />
            <Field label="Chữ logo nếu chưa có ảnh" value={cfg.brand?.logoText || ""} onChange={(v) => setPath("brand", "logoText", v)} />
            <label className="field"><span>Màu chủ đạo</span><input type="color" value={cfg.brand?.primaryColor || "#1A7A4A"} onChange={(e) => setPath("brand", "primaryColor", e.target.value)} /></label>
            <label className="field"><span>Màu nền nhấn</span><input type="color" value={cfg.brand?.accentColor || "#D1FAE5"} onChange={(e) => setPath("brand", "accentColor", e.target.value)} /></label>
            <label className="field"><span>Font</span><select value={cfg.brand?.fontFamily || "Arial"} onChange={(e) => setPath("brand", "fontFamily", e.target.value)}><option value="Arial">Arial</option><option value="Times New Roman">Times New Roman</option><option value="Verdana">Verdana</option><option value="Tahoma">Tahoma</option></select></label>
          </div>
          <div className="settings-actions" style={{ marginTop: 10 }}>
            <button className="btn-ghost" onClick={() => logoFileRef.current?.click()}>Upload logo từ máy</button>
            <input ref={logoFileRef} type="file" accept="image/*" hidden onChange={(e) => uploadLogo(e.target.files?.[0])} />
            <button className="btn-primary" onClick={previewPdf}>Preview mẫu PDF</button>
          </div>
        </div>
      </section>

      <section className="section-card">
        <div className="section-card-head"><span>Cột hiển thị trong bảng sản phẩm</span></div>
        <div className="section-card-body">
          <div className="quote-template-toggles">
            {Object.entries(columnLabels).map(([key, label]) => (
              <label key={key} className="qt-toggle"><input type="checkbox" checked={!!cfg.columns?.[key]} onChange={(e) => updateColumn(key, e.target.checked)} disabled={["stt", "name", "qty", "total"].includes(key)} /> <span>{label}</span></label>
            ))}
          </div>
        </div>
      </section>

      <section className="section-card">
        <div className="section-card-head"><span>Nhãn, section và điều khoản</span></div>
        <div className="section-card-body">
          <div className="field-grid">
            <Field label="Tiêu đề báo giá" value={cfg.labels?.title || ""} onChange={(v) => updateLabel("title", v)} full />
            <Field label="Tên cột sản phẩm" value={cfg.labels?.itemName || ""} onChange={(v) => updateLabel("itemName", v)} />
            <Field label="Tên cột khu vực" value={cfg.labels?.note || ""} onChange={(v) => updateLabel("note", v)} />
            <Field label="Tên cột thông số" value={cfg.labels?.spec || ""} onChange={(v) => updateLabel("spec", v)} />
            <Field label="Tên bảng tổng hợp" value={cfg.labels?.summaryTitle || ""} onChange={(v) => updateLabel("summaryTitle", v)} full />
          </div>
          <div className="quote-template-toggles" style={{ marginTop: 12 }}>
            <label className="qt-toggle"><input type="checkbox" checked={!!cfg.sections?.showSummary} onChange={(e) => updateSection("showSummary", e.target.checked)} /> <span>Hiện bảng tổng hợp</span></label>
            <label className="qt-toggle"><input type="checkbox" checked={!!cfg.sections?.showLabor} onChange={(e) => updateSection("showLabor", e.target.checked)} /> <span>Hiện dòng nhân công</span></label>
            <label className="qt-toggle"><input type="checkbox" checked={!!cfg.sections?.showTerms} onChange={(e) => updateSection("showTerms", e.target.checked)} /> <span>Hiện điều khoản</span></label>
            <label className="qt-toggle"><input type="checkbox" checked={!!cfg.sections?.showSignature} onChange={(e) => updateSection("showSignature", e.target.checked)} /> <span>Hiện chữ ký</span></label>
          </div>
          <div className="field-grid" style={{ marginTop: 12 }}>
            <label className="field full"><span>Lời mở đầu</span><textarea value={cfg.terms?.intro || ""} rows={2} onChange={(e) => updateTerm("intro", e.target.value)} /></label>
            <label className="field full"><span>Hiệu lực báo giá</span><textarea value={cfg.terms?.validity || ""} rows={2} onChange={(e) => updateTerm("validity", e.target.value)} /></label>
            <label className="field full"><span>Thanh toán</span><textarea value={cfg.terms?.payment || ""} rows={2} onChange={(e) => updateTerm("payment", e.target.value)} /></label>
            <label className="field full"><span>Bảo hành</span><textarea value={cfg.terms?.warranty || ""} rows={2} onChange={(e) => updateTerm("warranty", e.target.value)} /></label>
          </div>
        </div>
      </section>
    </div>
  );
}

// ============================================================
// TAB 4 — Cài đặt + Xuất/Nhập dữ liệu
// ============================================================
function Settings({ company, setCompany, markups, setMarkups, data, onImport }) {
  const fileRef = useRef();
  const set = (k, v) => setCompany({ ...company, [k]: v });

  const exportData = () => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `smartquote-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
  };

  const importData = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const d = JSON.parse(reader.result);
        onImport(d);
        notify.success("Đã nhập dữ liệu thành công.");
      } catch {
        notify.error("File không hợp lệ.");
      }
    };
    reader.readAsText(file);
  };

  const updateMarkup = (id, key, val) =>
    setMarkups((ms) => ms.map((m) => (m.id === id ? { ...m, [key]: key === "value" ? parseFloat(val) || 0 : val } : m)));
  const addMarkup = () => setMarkups((ms) => [...ms, { id: uid("mk"), label: "Mức mới", value: 1.5 }]);
  const removeMarkup = (id) => setMarkups((ms) => ms.filter((m) => m.id !== id));

  return (
    <div className="settings">

      <section className="section-card">
        <div className="section-card-head">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
          <span>Thông tin công ty</span>
        </div>
        <div className="section-card-body">
          <div className="field-grid">
            <Field label="Tên công ty" value={company.name} onChange={(v) => set("name", v)} />
            <Field label="Mã số thuế" value={company.taxCode} onChange={(v) => set("taxCode", v)} />
            <Field label="Điện thoại công ty" value={company.phone} onChange={(v) => set("phone", v)} />
            <NumField label="Nhân công, lập trình (% tiền hàng)" value={company.laborPercent} onChange={(v) => set("laborPercent", v)} />
            <Field label="Địa chỉ" value={company.address} onChange={(v) => set("address", v)} full />
            <Field label="Website" value={company.website || ""} onChange={(v) => set("website", v)} full />
            <Field label="Người báo giá" value={company.salesPerson || ""} onChange={(v) => set("salesPerson", v)} />
            <Field label="SĐT người báo giá" value={company.salesPhone || ""} onChange={(v) => set("salesPhone", v)} />
          </div>
        </div>
      </section>

      <section className="section-card">
        <div className="section-card-head">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
          <span>Tìm ảnh tự động (Serper.dev)</span>
        </div>
        <div className="section-card-body">
          <p className="tab-intro" style={{ margin: "0 0 10px" }}>
            2.500 lượt miễn phí — không cần billing. Sau khi điền key, vào tab <strong>Danh mục</strong> → bấm <strong>"Tự động tìm ảnh"</strong>.
          </p>
          <div className="field-grid">
            <Field label="Serper API Key" value={company.googleApiKey || ""} onChange={(v) => set("googleApiKey", v)} full />
          </div>
          <details style={{ marginTop: 10 }}>
            <summary style={{ cursor: "pointer", fontSize: 13, color: "var(--brand)", fontWeight: 600 }}>Cách lấy key (1 phút)</summary>
            <div className="api-guide">
              <ol>
                <li>Vào <a href="https://serper.dev" target="_blank" rel="noreferrer">serper.dev</a> → đăng ký Gmail</li>
                <li>Dashboard → copy <strong>API Key</strong> → dán vào ô trên</li>
              </ol>
            </div>
          </details>
        </div>
      </section>

      <section className="section-card">
        <div className="section-card-head">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
          <span>Hệ số giá theo khách</span>
        </div>
        <div className="section-card-body">
          <p className="tab-intro" style={{ margin: "0 0 10px" }}>Giá bán = giá gốc × hệ số. Khi tạo báo giá chọn mức phù hợp cho từng khách.</p>
          {markups.map((m) => (
            <div className="markup-row" key={m.id}>
              <input className="markup-name-input" value={m.label} onChange={(e) => updateMarkup(m.id, "label", e.target.value)} />
              <span className="markup-x">×</span>
              <input className="markup-val-input" type="number" step="0.05" value={m.value} onChange={(e) => updateMarkup(m.id, "value", e.target.value)} />
              {markups.length > 1 && <button className="x-btn" onClick={() => removeMarkup(m.id)}>×</button>}
            </div>
          ))}
          <button className="btn-ghost" style={{ marginTop: 8, fontSize: 12 }} onClick={addMarkup}>+ Thêm mức hệ số</button>
        </div>
      </section>

      <section className="section-card">
        <div className="section-card-head">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
          <span>Sao lưu &amp; khôi phục dữ liệu</span>
        </div>
        <div className="section-card-body">
          <div className="backup-warning">
            ⚠️ <strong>Quan trọng:</strong> Dữ liệu (catalog, gói, cài đặt) hiện lưu trong trình duyệt máy này. Nếu xóa lịch sử trình duyệt hoặc đổi máy, dữ liệu sẽ mất. <strong>Hãy tải file sao lưu định kỳ</strong> (vd cuối mỗi ngày) và giữ ở nơi an toàn (Google Drive, email...).
          </div>
          <div className="backup-stats">
            <span>📦 {data.products?.length || 0} sản phẩm</span>
            <span>📋 {data.templates?.length || 0} gói</span>
            <span>🏢 {data.suppliers?.length || 0} nhà cung cấp</span>
          </div>
          <div className="settings-actions">
            <button className="btn-primary" onClick={exportData}>⬇ Tải file sao lưu (.json)</button>
            <button className="btn-ghost" onClick={() => fileRef.current?.click()}>⬆ Nhập từ file sao lưu</button>
            <input ref={fileRef} type="file" accept="application/json" hidden onChange={importData} />
          </div>
          <p className="tab-intro" style={{ margin: "10px 0 0", fontSize: 12 }}>
            💡 Khi chuyển máy mới: mở SmartQuote → vào đây → "Nhập từ file sao lưu" → chọn file .json đã tải.
          </p>
        </div>
      </section>

    </div>
  );
}

// ============================================================
// Thành phần dùng chung
// ============================================================
function Field({ label, value, onChange, placeholder, full, list }) {
  const listId = list ? uid("dl") : undefined;
  return (
    <label className={`field ${full ? "full" : ""}`}>
      <span>{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} list={listId} />
      {list && (
        <datalist id={listId}>
          {list.map((o) => <option key={o} value={o} />)}
        </datalist>
      )}
    </label>
  );
}

function NumField({ label, value, onChange }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input type="number" value={value} onChange={(e) => onChange(parseFloat(e.target.value) || 0)} />
    </label>
  );
}

function Row({ label, value }) {
  return <div className="sum-row"><span>{label}</span><span>{value}</span></div>;
}

// ============================================================
// Tạo trang HTML đẹp để in/lưu PDF (đúng dấu tiếng Việt, có màu/viền)
// ============================================================
function buildQuotePrintHTML({ company, customer, rooms, productById, lineSalePrice, calc, quoteTemplateConfig, watermark = false }) {
  const template = normalizeQuoteTemplateConfig(quoteTemplateConfig || company?.quoteTemplate || {});
  const today = new Date();
  const dateStr = `${String(today.getDate()).padStart(2,"0")}/${String(today.getMonth()+1).padStart(2,"0")}/${today.getFullYear()}`;
  const vnd = (n) => (Number(n)||0).toLocaleString("vi-VN");
  const esc = (s) => String(s??"").replace(/[&<>\"]/g,(c)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]||c));
  const primary = template.brand?.primaryColor || "#1A7A4A";
  const accent = template.brand?.accentColor || "#D1FAE5";
  const font = template.brand?.fontFamily || "Arial";
  const isVisual = template.layoutType === "visual";
  const isMinimal = template.layoutType === "minimal";
  const cols = { ...(template.columns || {}) };
  cols.stt = true; cols.name = true; cols.qty = true; cols.total = true;
  if (isMinimal) { cols.image = false; cols.spec = false; }

  const columnDefs = [
    { key: "stt", label: "STT", cls: "c", style: "width:30px", render: (_p, _l, i) => String(i + 1) },
    { key: "note", label: template.labels?.note || "Khu vực", style: "width:100px", render: (_p, l) => l.note ? esc(l.note).replace(/\n/g,"<br>") : "" },
    { key: "image", label: "Hình ảnh", cls: "c", style: isVisual ? "width:95px" : "width:68px", render: (p) => {
      const imgProxySrc = (url) => {
        if (!url) return "";
        if (url.includes("encrypted-tbn") || url.includes("gstatic.com/images?q=tbn")) return "";
        return window.location.protocol === "https:" ? `/api/img?url=${encodeURIComponent(url)}` : url;
      };
      const proxiedImg = imgProxySrc(p.image);
      const size = isVisual ? 82 : 56;
      return proxiedImg
        ? `<img src="${esc(proxiedImg)}" style="width:${size}px;height:${size}px;object-fit:cover;border-radius:6px;display:block;margin:0 auto;border:1px solid #e5e7eb;" onerror="this.parentNode.innerHTML='<span style=color:#ccc;font-size:9px>—</span>'" />`
        : `<span style="color:#ccc;font-size:10px">—</span>`;
    }},
    { key: "sku", label: template.labels?.sku || "Mã", style: "width:65px", render: (p) => esc(p.sku || "") },
    { key: "name", label: template.labels?.itemName || "Tên hàng hoá / Mô tả", render: (p) => `<strong>${esc(p.name)}</strong>${isVisual && p.specs ? `<div class="desc">${esc(p.specs)}</div>` : ""}` },
    { key: "spec", label: template.labels?.spec || "Thông số", render: (p) => `<span class="muted-small">${p.specs ? esc(p.specs) : ""}</span>` },
    { key: "supplier", label: template.labels?.supplier || "Hãng", style: "width:56px", render: (p) => esc(p.supplier || "") },
    { key: "unit", label: "ĐVT", cls: "c", style: "width:38px", render: (p) => esc(p.unit || "Cái") },
    { key: "qty", label: "SL", cls: "c", style: "width:32px", render: (_p, l) => String(l.qty || 0) },
    { key: "unitPrice", label: "Đơn giá", cls: "r", style: "width:78px", render: (p, l) => vnd(lineSalePrice(p, l)) },
    { key: "total", label: "Thành tiền", cls: "r", style: "width:88px", render: (p, l) => vnd(lineSalePrice(p, l) * (Number(l.qty) || 0)) },
  ].filter((c) => cols[c.key]);
  const colCount = columnDefs.length;
  const thHtml = columnDefs.map((c) => `<th class="${c.cls || ""}" style="${c.style || ""}">${esc(c.label)}</th>`).join("");

  const sectionSums = [];
  const sections = rooms.map((room) => {
    const valid = (room.lines || []).filter((l) => productById[l.productId]);
    if (valid.length === 0) return "";
    let sectionSum = 0;
    const rowsHtml = valid.map((l, i) => {
      const p = productById[l.productId];
      const total = lineSalePrice(p, l) * (Number(l.qty) || 0);
      sectionSum += total;
      const tds = columnDefs.map((c) => `<td class="${c.cls || ""}">${c.render(p, l, i)}</td>`).join("");
      return `<tr>${tds}</tr>`;
    }).join("");
    sectionSums.push({ name: (room.name || "Hạng mục").replace(/\n/g," "), total: sectionSum });
    return template.sections?.showRoomGroups === false
      ? rowsHtml
      : `<tr class="section-row"><td colspan="${Math.max(1, colCount - 1)}">${esc((room.name || "Hạng mục").replace(/\n/g," "))}</td><td class="r">${vnd(sectionSum)}</td></tr>${rowsHtml}`;
  }).join("");

  const summaryRows = sectionSums.map((s) => `<tr><td class="sl">${esc(s.name)}</td><td class="sr">${vnd(s.total)}</td></tr>`).join("");
  const logoUrl = template.brand?.logoUrl || company?.logoUrl || "";
  const logoHtml = logoUrl
    ? `<img class="logo-img" src="${esc(logoUrl)}" onerror="this.style.display='none';this.nextElementSibling.style.display='block'"/><div class="logo-placeholder" style="display:none">${esc(template.brand?.logoText || company?.name || "LOGO")}</div>`
    : `<div class="logo-placeholder">${esc(template.brand?.logoText || (company?.name || "LOGO").slice(0,18))}</div>`;
  const terms = [template.terms?.validity, template.terms?.payment, template.terms?.warranty, company?.bankInfo ? `Thông tin chuyển khoản: ${company.bankInfo}` : ""].filter(Boolean);
  const summaryBlock = template.sections?.showSummary === false ? "" : `
    <div class="sum-title">${esc(template.labels?.summaryTitle || "TỔNG HỢP")}</div>
    <table class="summary">
      ${summaryRows}
      <tr><td class="sl lbl">Tổng tiền hàng:</td><td class="sr">${vnd(calc.deviceTotal)}</td></tr>
      ${template.sections?.showLabor === false ? "" : `<tr><td class="sl lbl">Nhân công / thi công (${company.laborPercent || 0}%)</td><td class="sr">${vnd(calc.laborTotal)}</td></tr>`}
      <tr class="grand-row"><td class="sl lbl">Tổng giá trị hợp đồng</td><td class="sr">${vnd(calc.grand)}</td></tr>
    </table>`;
  const termsBlock = template.sections?.showTerms === false || !terms.length ? "" : `<div class="foot"><strong>Điều khoản:</strong><ul>${terms.map((t) => `<li>${esc(t)}</li>`).join("")}</ul></div>`;
  const signBlock = template.sections?.showSignature === false ? "" : `<div class="sign"><div><div class="role">KHÁCH HÀNG<br>(Ký xác nhận &amp; Ghi rõ họ và tên)</div></div><div><div class="role">${esc(company.name || "ĐƠN VỊ BÁO GIÁ")}<br>(Ký và ghi rõ họ tên)</div></div></div>`;

  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>Báo giá ${esc(customer.name||"")}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0;}
    body{font-family:${esc(font)},Arial,sans-serif;color:#1a1a1a;padding:20px 24px;font-size:12px;}
    .hdr{display:table;width:100%;border:1.5px solid #333;border-collapse:collapse;margin-bottom:0;}
    .hdr-left,.hdr-right{display:table-cell;vertical-align:middle;padding:10px 14px;}
    .hdr-left{width:32%;border-right:1.5px solid #333;text-align:center;}
    .hdr-right{width:68%;text-align:center;}
    .logo-placeholder{font-size:24px;font-weight:900;color:${primary};letter-spacing:1px;line-height:1.1;text-transform:uppercase;}
    .logo-img{max-width:150px;max-height:70px;object-fit:contain;display:block;margin:0 auto;}
    .co-name-big{font-size:14px;font-weight:bold;color:${primary};text-transform:uppercase;line-height:1.4;}
    .co-detail{font-size:11px;color:#222;line-height:1.8;margin-top:4px;}
    .co-web{font-size:10px;color:#555;margin-top:2px;}
    .info-table{width:100%;border-collapse:collapse;border:1.5px solid #333;border-top:none;margin-bottom:0;}
    .info-table td{padding:5px 10px;font-size:11.5px;border:1px solid #ccc;vertical-align:top;}
    .info-table .lbl{font-weight:bold;}
    .title-bar{text-align:center;font-size:14px;font-weight:bold;border:1.5px solid #333;border-top:none;padding:8px;letter-spacing:.5px;background:#f8f8f8;}
    .intro-bar{border:1.5px solid #333;border-top:none;padding:8px 10px;font-size:11px;color:#333;margin-bottom:0;}
    table.main{width:100%;border-collapse:collapse;font-size:${isVisual ? "11px" : "11.5px"};margin-top:0;}
    .main th{background:${primary};color:#fff;padding:7px 6px;text-align:left;border:1px solid ${primary};font-size:11px;}
    .main th.c,.main td.c{text-align:center;}.main th.r,.main td.r{text-align:right;}
    .main td{padding:${isVisual ? "8px 6px" : "6px"};border:1px solid #ccc;vertical-align:top;line-height:1.35;}
    .section-row td{background:${accent};font-weight:bold;color:${primary};font-size:11.5px;}
    .muted-small,.desc{font-size:9.8px;color:#444;line-height:1.45;margin-top:3px;}
    .sum-title{text-align:center;font-weight:bold;font-size:12px;border:1.5px solid #333;border-top:none;padding:6px;background:#f0f0f0;letter-spacing:.3px;}
    table.summary{width:100%;border-collapse:collapse;font-size:12px;border:1.5px solid #333;border-top:none;}
    .summary td{padding:6px 12px;border:1px solid #ccc;}.summary .sl{width:85%;}.summary .sr{text-align:right;font-weight:600;white-space:nowrap;}.summary .grand-row td{font-weight:bold;font-size:13px;border-top:2px solid #333;}
    .foot{margin-top:14px;font-size:10.5px;color:#555;line-height:1.6;}.foot ul{margin-left:18px;margin-top:4px;}
    .sign{display:flex;justify-content:space-between;margin-top:28px;text-align:center;font-size:11.5px;}.sign div{width:45%;}.sign .role{font-weight:bold;margin-bottom:55px;}
    .sq-watermark{position:fixed;left:24px;right:24px;bottom:10px;text-align:center;font-size:10px;color:#94a3b8;border-top:1px dashed #cbd5e1;padding-top:6px;}
    @media print{body{padding:0;}@page{margin:${esc(template.page?.margin || "12mm")};size:A4;}}
  </style></head><body>
    <div class="hdr"><div class="hdr-left">${logoHtml}</div><div class="hdr-right"><div class="co-name-big">${esc(company.name || "")}</div><div class="co-detail">${esc(company.address || "")}<br>Mã số thuế: ${esc(company.taxCode||"")} &nbsp;&nbsp; Số điện thoại: ${esc(company.phone || "")}</div><div class="co-web">${esc(company.website||"")}</div></div></div>
    <table class="info-table"><tr><td class="lbl" style="width:50%">Khách hàng: <strong>${esc(customer.name||"")}</strong></td><td class="lbl">Số báo giá: ${esc(customer.quoteNumber||"")}</td></tr><tr><td>Điện thoại: ${esc(customer.phone||"")}</td><td>Ngày: ${dateStr}</td></tr><tr><td>Địa điểm công trình: <strong>${esc(customer.address||"")}</strong></td><td>Người báo giá: <strong>${esc(company.salesPerson||"")}</strong> ${company.salesPhone ? `· ${esc(company.salesPhone)}` : ""}</td></tr><tr><td>Công trình: ${esc(customer.project||"")}</td><td>Hạng mục: ${esc(customer.category||"")}</td></tr></table>
    <div class="title-bar">${esc(template.labels?.title || "BẢNG BÁO GIÁ")}</div>
    <div class="intro-bar">${esc(template.terms?.intro || company.introText || "Xin trân trọng gửi tới Quý Khách hàng Bảng báo giá với những chi tiết như sau:")}</div>
    <table class="main"><thead><tr>${thHtml}</tr></thead><tbody>${sections||`<tr><td colspan="${colCount}" class="c" style="padding:18px;color:#999">Chưa có sản phẩm</td></tr>`}</tbody></table>
    ${summaryBlock}
    ${termsBlock}
    ${signBlock}
    ${watermark ? `<div class="sq-watermark">Tạo bởi SmartQuote Free · nâng cấp để xuất PDF thương hiệu riêng không watermark</div>` : ""}
  </body></html>`;
}

// ============================================================
// Phase 12 — Xuất báo giá theo file Excel mẫu của đại lý (.xlsx only)
// ============================================================
async function exportQuoteExcelWithTemplate({ template, company, customer, rooms, productById, lineSalePrice, calc }) {
  const tpl = normalizeExcelQuoteTemplate(template || {});
  if (!tpl.dataUrl) throw new Error("Mẫu Excel chưa có file .xlsx gốc.");
  const exportRows = buildQuoteExportRows({ rooms, productById, lineSalePrice });
  if (!exportRows.length) throw new Error("Báo giá chưa có dòng sản phẩm để xuất.");

  const exportSections = buildQuoteExportSections({ rooms, productById, lineSalePrice });
  const payload = { template: tpl, company, customer, rooms, calc, rows: exportRows, sections: exportSections, exportMode: "lossless_xml_v3" };
  const canUseServer = typeof window !== "undefined" && window.location.protocol !== "file:";
  if (canUseServer) {
    try {
      const res = await smartQuoteFetch("/api/excel-template", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        let message = `API lỗi ${res.status}`;
        try { message = (await res.json())?.error || message; } catch {}
        throw new Error(message);
      }
      const engine = String(res.headers.get("X-SmartQuote-Excel-Engine") || "").trim();
      if (engine !== "lossless_xml_v3") {
        throw new Error(`Vercel đang trả Excel từ engine cũ (${engine || "không xác định"}). SmartQuote đã chặn tải file để tránh xuất sai định dạng. Hãy redeploy API Phase 12.4.2.`);
      }
      const manifestVersion = String(res.headers.get("X-SmartQuote-Excel-Manifest") || "").trim();
      if (manifestVersion !== "3") {
        throw new Error(`Excel API chưa xác nhận manifest v3 (nhận: ${manifestVersion || "trống"}). Không tải file fidelity thấp.`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `BaoGia_${safeExcelFileName(customer?.name || tpl.name)}_theo_mau.xlsx`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
      return;
    } catch (e) {
      console.error("Lossless Excel export failed:", e);
      throw new Error(e?.message || "Không xuất được mẫu Excel lossless. SmartQuote không fallback sang SheetJS vì sẽ làm sai định dạng mẫu.");
    }
  }
  throw new Error("Xuất Excel lossless cần SmartQuote API. Không thể dùng chế độ file:// hoặc export local làm mất định dạng.");
}


// ============================================================
// Xuất báo giá ra file Excel theo mẫu công ty (gom theo phòng/khu vực)
// ============================================================
async function exportQuoteExcel({ company, customer, rooms, productById, lineSalePrice, calc }) {
  // Nếu đang chạy trên Vercel (HTTPS) → dùng Python API để xuất Excel có ảnh
  const isVercel = typeof window !== "undefined" && window.location.protocol === "https:";
  if (isVercel) {
    try {
      // Chuẩn bị data gửi lên Python API
      const payload = {
        company,
        customer,
        calc,
        rooms: rooms
          .filter((r) => r.lines.some((l) => productById[l.productId]))
          .map((r) => ({
            name: r.name,
            lines: r.lines
              .filter((l) => productById[l.productId])
              .map((l) => {
                const p = productById[l.productId];
                const price = lineSalePrice(p, l);
                return {
                  productId: l.productId,
                  qty: l.qty,
                  price,
                  note: l.note || "",
                  product: {
                    name: p.name,
                    sku: p.sku || "",
                    supplier: p.supplier || "",
                    unit: p.unit || "Cái",
                    specs: p.specs || "",
                    image: p.image || "",
                  },
                };
              }),
          })),
      };

      const res = await smartQuoteFetch("/api/excel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) throw new Error(`API lỗi ${res.status}`);

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `BaoGia_${customer.name || "SmartQuote"}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      return;
    } catch (err) {
      console.warn("Excel API lỗi, fallback SheetJS:", err);
      // Tiếp tục dùng SheetJS bên dưới nếu API lỗi
    }
  }

  // Fallback: SheetJS (không có ảnh, dùng khi local hoặc API lỗi)
  const today = new Date();
  const dateStr = `${String(today.getDate()).padStart(2, "0")}/${String(today.getMonth() + 1).padStart(2, "0")}/${today.getFullYear()}`;

  const aoa = [];
  const merges = [];
  const money = [];       // [r,c] ô cần format tiền
  const formulas = [];    // {r,c,f} công thức set sau khi tạo sheet
  let R = 0;
  const push = (row) => { aoa.push(row); R++; };

  // --- Header công ty (mẫu mặc định) ---
  push([company.name, "", "", "", `Số báo giá: ${customer.quoteNumber || ""}`, "", "", ""]);
  merges.push({ s: { r: R-1, c: 0 }, e: { r: R-1, c: 3 } });
  push([`Showroom và VPGD: ${company.address}`, "", "", "", `Mã số thuế: ${company.taxCode || ""}`, "", "", ""]);
  merges.push({ s: { r: R-1, c: 0 }, e: { r: R-1, c: 3 } });
  push([`Mã số thuế: ${company.taxCode || ""} · Số điện thoại: ${company.phone}`, "", "", "", `Ngày: ${dateStr}`, "", "", ""]);
  merges.push({ s: { r: R-1, c: 0 }, e: { r: R-1, c: 3 } });
  push([company.website || "", "", "", "", `Người báo giá: ${company.salesPerson || ""}`, "", "", ""]);
  merges.push({ s: { r: R-1, c: 0 }, e: { r: R-1, c: 3 } });
  push([]);

  // --- Thông tin khách ---
  push([`Khách hàng: ${customer.name || ""}`, "", "", "", `Điện thoại NB: ${company.salesPhone || ""}`, "", "", ""]);
  push([`Điện thoại: ${customer.phone || ""}`, "", "", "", "", "", "", ""]);
  push([`Email:`, "", "", "", "", "", "", ""]);
  push([`Địa điểm công trình: ${customer.address || ""}`, "", "", "", "", "", "", ""]);
  push([`Hạng mục: ${customer.category || "Giải pháp nhà thông minh Lumi"}`, "", "", "", "", "", "", ""]);
  push([]);

  // --- Tiêu đề ---
  push(["BẢNG BÁO GIÁ TỔNG HỢP"]);
  merges.push({ s: { r: R-1, c: 0 }, e: { r: R-1, c: 7 } });
  push([company.introText||"Xin trân trọng gửi tới Quý Khách hàng Bảng báo giá với những chi tiết như sau:"]);
  merges.push({ s: { r: R-1, c: 0 }, e: { r: R-1, c: 7 } });
  push([]);

  // --- Header bảng ---
  push(["STT", "Khu vực lắp đặt", "Tên hàng hoá/Mô tả", "Thông số kỹ thuật", "Hình ảnh", "Mã thiết bị", "Xuất xứ", "ĐVT", "SL", "Đơn giá", "Thành tiền"]);

  // --- Từng khu vực ---
  const sectionTotalRows = [];
  const sectionNames = [];
  let sttGlobal = 0; // STT toàn bảng
  rooms.forEach((room, idx) => {
    const validLines = room.lines.filter((l) => productById[l.productId]);
    if (validLines.length === 0) return;

    const secRow = R;
    push([`${room.name.replace(/\n/g," ")}`, "", "", "", "", "", "", "", "", ""]);
    merges.push({ s: { r: secRow, c: 0 }, e: { r: secRow, c: 9 } });

    const firstItemExcelRow = R + 1;
    let sectionSum = 0;
    validLines.forEach((l) => {
      sttGlobal++;
      const p = productById[l.productId];
      const sp = lineSalePrice(p, l);
      const lineTotal = sp * l.qty;
      sectionSum += lineTotal;
      const er = R + 1;
      push([sttGlobal, l.note || "", p.name, p.specs || "", p.image || "", p.sku || "", p.supplier || "", p.unit || "Cái", l.qty, sp, ""]);
      formulas.push({ r: R-1, c: 10, f: `I${er}*J${er}`, v: lineTotal });
      money.push([R-1, 9]); money.push([R-1, 10]);
    });
    const lastItemExcelRow = R;

    formulas.push({ r: secRow, c: 10, f: `SUM(K${firstItemExcelRow}:K${lastItemExcelRow})`, v: sectionSum });
    money.push([secRow, 9]);
    sectionTotalRows.push(secRow);
    sectionNames.push(room.name.replace(/\n/g," "));
  });

  push([]);

  // --- BẢNG TỔNG HỢP CÁC GIẢI PHÁP ---
  push(["TỔNG HỢP CÁC GIẢI PHÁP NHÀ THÔNG MINH", "", "", "", "", "", "", "", "", ""]);
  merges.push({ s: { r: R-1, c: 0 }, e: { r: R-1, c: 9 } });

  // Từng phòng/khu vực
  sectionTotalRows.forEach((secRow, i) => {
    push([sectionNames[i], "", "", "", "", "", "", "", "", ""]);
    merges.push({ s: { r: R-1, c: 0 }, e: { r: R-1, c: 9 } });
    const ref = `K${secRow + 1}`;
    const v = aoa[secRow]?.[9] || 0;
    formulas.push({ r: R-1, c: 9, f: ref, v: typeof v === "number" ? v : 0 });
    money.push([R-1, 9]);
  });

  // Tổng tiền hàng
  const sumRefs2 = sectionTotalRows.map((r) => `K${r + 1}`).join("+");
  const hangRow = R;
  push(["Tổng tiền hàng:", "", "", "", "", "", "", "", "", ""]);
  merges.push({ s: { r: hangRow, c: 0 }, e: { r: hangRow, c: 9 } });
  formulas.push({ r: hangRow, c: 10, f: sumRefs2 || "0", v: calc.deviceTotal });
  money.push([hangRow, 9]);

  const ncRow = R;
  push([`Nhân công thi công lắp đặt và cài đặt lập trình cấu hình và set theo ngữ cảnh CĐT (${company.laborPercent}%):`, "", "", "", "", "", "", "", "", ""]);
  merges.push({ s: { r: ncRow, c: 0 }, e: { r: ncRow, c: 9 } });
  formulas.push({ r: ncRow, c: 10, f: `K${hangRow+1}*${(company.laborPercent||0)/100}`, v: calc.laborTotal });
  money.push([ncRow, 9]);

  const hdRow = R;
  push(["Tổng giá trị hợp đồng", "", "", "", "", "", "", "", "", ""]);
  merges.push({ s: { r: hdRow, c: 0 }, e: { r: hdRow, c: 9 } });
  formulas.push({ r: hdRow, c: 10, f: `K${hangRow+1}+K${ncRow+1}`, v: calc.grand });
  money.push([hdRow, 9]);

  push([]);
  push(["* Lưu ý: Báo giá chỉ có giá trị trong vòng 14 ngày kể từ ngày báo giá, sau thời gian này giá sẽ thay đổi theo nhà sản xuất."]);
  merges.push({ s: { r: R-1, c: 0 }, e: { r: R-1, c: 9 } });

  // --- Tạo worksheet ---
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!merges"] = merges;
  ws["!cols"] = [
    { wch: 5 },  // STT
    { wch: 22 }, // Khu vực
    { wch: 28 }, // Tên hàng hoá
    { wch: 28 }, // Thông số
    { wch: 40 }, // Hình ảnh (URL)
    { wch: 18 }, // Mã
    { wch: 10 }, // Xuất xứ
    { wch: 7 },  // ĐVT
    { wch: 6 },  // SL
    { wch: 14 }, // Đơn giá
    { wch: 16 }, // Thành tiền
  ];

  // Set công thức ĐÚNG CÁCH: cell cần type 'n', thuộc tính f (công thức) VÀ v (giá trị cache).
  // Thiếu v thì SheetJS community không ghi ô công thức ra file.
  formulas.forEach(({ r, c, f, v }) => {
    const addr = XLSX.utils.encode_cell({ r, c });
    ws[addr] = { t: "n", f, v: v ?? 0 };
  });

  // Format số tiền (cả ô giá trị và ô công thức)
  money.forEach(([r, c]) => {
    const addr = XLSX.utils.encode_cell({ r, c });
    if (ws[addr]) ws[addr].z = "#,##0";
  });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "BÁO GIÁ");

  const fileName = `BaoGia_${(customer.name || "KhachHang").replace(/\s+/g, "_")}_${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}${String(today.getDate()).padStart(2, "0")}.xlsx`;
  XLSX.writeFile(wb, fileName);
}

function toRoman(num) {
  const map = [["X", 10], ["IX", 9], ["V", 5], ["IV", 4], ["I", 1]];
  let r = "";
  for (const [sym, val] of map) while (num >= val) { r += sym; num -= val; }
  return r;
}

const CSS = `
*{box-sizing:border-box;}
.app{min-height:100vh;background:var(--canvas);color:var(--ink);font-family:var(--f);font-size:var(--fs-md);}
.topbar{position:sticky;top:0;z-index:20;display:flex;align-items:center;background:var(--surface);border-bottom:1px solid var(--line);padding:0 20px;height:52px;gap:0;}
.brand{display:flex;align-items:center;gap:7px;font-weight:700;font-size:var(--fs-lg);color:var(--ink);margin-right:20px;flex-shrink:0;}
.brand-mark{color:var(--brand);font-size:18px;}
.tabs{display:flex;height:100%;gap:0;}
.tabs button{display:flex;align-items:center;gap:6px;background:none;border:none;border-bottom:2px solid transparent;padding:0 13px;height:100%;font-size:13px;font-weight:500;color:var(--muted);cursor:pointer;white-space:nowrap;font-family:inherit;transition:color .15s;}
.tabs button:hover{color:var(--ink);background:var(--bg);}
.tabs button.on{color:var(--brand);border-bottom-color:var(--brand);}
.sub-nav{position:sticky;top:52px;z-index:19;display:flex;align-items:center;gap:8px;background:rgba(255,255,255,.96);border-bottom:1px solid var(--line);padding:8px 20px;box-shadow:0 1px 0 rgba(15,23,42,.02);}
.sub-nav button{border:1px solid var(--line);background:var(--surface);color:var(--muted);border-radius:999px;padding:7px 12px;font-size:12.5px;font-weight:700;font-family:inherit;cursor:pointer;transition:all .15s;}
.sub-nav button:hover{color:var(--ink);border-color:#cbd5e1;background:#f8fafc;}
.sub-nav button.on{color:var(--brand);border-color:rgba(27,79,216,.28);background:rgba(27,79,216,.08);}
.cloud-box{margin-left:auto;display:flex;align-items:center;gap:8px;font-size:12px;color:var(--muted);white-space:nowrap;}
.cloud-dot{width:8px;height:8px;border-radius:999px;background:#CBD5E1;display:inline-block;}
.cloud-dot.on{background:#22C55E;box-shadow:0 0 0 3px rgba(34,197,94,.12);}
.cloud-email{max-width:180px;overflow:hidden;text-overflow:ellipsis;color:#334155;}
.cloud-logout{border:1px solid var(--line2);background:#fff;border-radius:8px;padding:5px 8px;font-size:12px;font-weight:700;color:#334155;cursor:pointer;}
.cloud-logout:hover{border-color:var(--brand);color:var(--brand);}
.cloud-upgrade{border:1px solid var(--c-primary);background:#fff;color:var(--c-primary);border-radius:8px;padding:5px 9px;font-size:12px;font-weight:800;cursor:pointer;font-family:inherit;}
.cloud-upgrade:hover{background:#EFF6FF;}
.main{max-width:1180px;margin:0 auto;padding:20px;}
.card{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius-lg);padding:18px 20px;margin-bottom:14px;}
.card h2{margin:0 0 var(--sp-4);font-size:var(--fs-lg);font-weight:600;}
.quote-grid{display:grid;grid-template-columns:1fr 300px;gap:16px;align-items:start;}
.quote-side{position:sticky;top:68px;}
.field-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;}
.field{display:flex;flex-direction:column;gap:5px;font-size:13px;}
.field.full{grid-column:1/-1;}
.field span{font-size:11.5px;font-weight:600;color:var(--muted);letter-spacing:.03em;}
.field input{padding:8px 10px;border:1px solid var(--line);border-radius:8px;font-size:13px;font-family:inherit;color:var(--ink);background:var(--surface);}
.field input:focus{outline:none;border-color:var(--brand);}
.specs-textarea{width:100%;padding:8px 10px;border:1px solid var(--line);border-radius:8px;font-family:inherit;font-size:13px;line-height:1.5;resize:vertical;}
.specs-textarea:focus{outline:none;border-color:var(--brand);}
.room-card{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius-lg);margin-bottom:12px;overflow:hidden;}
.room-card .room-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;padding:12px 16px;border-bottom:1px solid var(--line);background:var(--bg);}
.room-name{font-size:14px;font-weight:600;border:none;background:transparent;padding:0;width:100%;font-family:inherit;resize:none;line-height:1.4;color:var(--ink);}
.room-name:focus{outline:none;}
.room-head-actions{display:flex;gap:6px;align-items:center;flex-shrink:0;}
.tpl-select{padding:6px 9px;border:1px solid var(--line);border-radius:7px;font-size:12px;font-family:inherit;color:var(--brand);font-weight:600;cursor:pointer;background:var(--surface);}
.btn-ghost{background:var(--surface);border:1px solid var(--line2);padding:6px 12px;border-radius:var(--r-md);font-size:var(--fs-sm);cursor:pointer;font-weight:600;color:var(--c-text);font-family:inherit;transition:all .15s;}
.btn-ghost:hover{border-color:var(--brand);color:var(--brand);}
.btn-ghost.danger{color:var(--neg);}
.btn-ghost.danger:hover{border-color:var(--neg);}
.btn-primary{background:var(--c-primary);color:#fff;border:none;padding:9px 16px;border-radius:var(--r-md);font-size:var(--fs-sm);font-weight:700;cursor:pointer;font-family:inherit;width:100%;transition:background .15s;}
.btn-primary:hover{background:var(--c-primary-dark);}
.btn-primary:disabled{background:#93AEED;cursor:not-allowed;}
.btn-pdf{flex:1;background:var(--c-primary);color:#fff;border:none;padding:9px 16px;border-radius:var(--r-md);font-size:var(--fs-sm);font-weight:800;cursor:pointer;font-family:inherit;}
.btn-pdf:hover{background:var(--c-primary-dark);}
.btn-excel{background:var(--surface);color:var(--c-text);border:1px solid var(--line2);padding:9px 14px;border-radius:var(--r-md);font-size:var(--fs-sm);font-weight:700;cursor:pointer;font-family:inherit;white-space:nowrap;}
.btn-excel:hover{border-color:var(--c-primary);color:var(--c-primary);background:var(--c-primary-soft);}
.btn-add-room{background:none;color:var(--c-primary);border:1.5px dashed var(--line2);padding:11px;border-radius:var(--r-lg);font-size:var(--fs-sm);font-weight:700;cursor:pointer;width:100%;font-family:inherit;transition:all .15s;}
.btn-add-room:hover{border-color:var(--brand);background:var(--brand-soft);}
.add-bar-room{display:flex;gap:8px;padding:10px 12px;border-top:1px solid var(--line);background:var(--bg);}
.add-bar-room .btn-ghost{font-size:12px;padding:5px 10px;}
.x-btn{background:none;border:none;color:var(--muted);font-size:16px;cursor:pointer;line-height:1;padding:0 3px;}
.x-btn:hover{color:var(--neg);}
.line-table,.cat-table{width:100%;border-collapse:collapse;font-size:var(--fs-sm);}
.line-table th,.cat-table th{text-align:left;color:var(--muted);font-size:var(--fs-xs);font-weight:600;padding:7px 8px;border-bottom:1px solid var(--line);background:var(--bg);}
.line-table td,.cat-table td{padding:8px;border-bottom:1px solid var(--line);vertical-align:middle;}
.line-table tr:last-child td,.cat-table tr:last-child td{border-bottom:none;}
.line-table tr:hover td{background:var(--bg);}
.num{text-align:right;}
.qty-col{width:64px;}
.ln-name{font-weight:600;font-size:13px;}
.ln-sku{font-size:11px;color:var(--muted);margin-top:2px;}
.strong{font-weight:600;}
.muted{color:var(--muted);}
.qty-input{width:54px;padding:5px 6px;border:1px solid var(--line);border-radius:6px;text-align:center;font-family:inherit;font-size:13px;}
.qty-input::-webkit-outer-spin-button,.qty-input::-webkit-inner-spin-button{-webkit-appearance:none;margin:0;}
.qty-input[type=number]{-moz-appearance:textfield;}
.note-col{width:120px;}
.stt-col{width:40px;text-align:center;}
.stt-cell{display:flex;flex-direction:column;align-items:center;gap:2px;}
.stt-num{font-size:12px;font-weight:600;color:var(--muted);}
.stt-move{display:flex;flex-direction:column;gap:1px;}
.move-btn{background:none;border:1px solid var(--line);border-radius:3px;font-size:9px;padding:1px 4px;cursor:pointer;color:var(--muted);line-height:1.2;font-family:inherit;}
.move-btn:hover:not(:disabled){background:var(--brand-soft);border-color:var(--brand);color:var(--brand);}
.move-btn:disabled{opacity:.25;cursor:default;}
.note-input{width:100%;min-width:100px;padding:5px 7px;border:1px solid var(--line);border-radius:6px;font-family:inherit;font-size:11px;color:var(--muted);resize:none;line-height:1.4;background:var(--bg);}
.note-input:focus{outline:none;border-color:var(--brand);background:var(--surface);}
.ln-actions{display:flex;gap:3px;align-items:center;white-space:nowrap;}
.ln-edit{background:none;border:none;color:var(--brand);font-size:14px;cursor:pointer;padding:0 3px;}
.ln-edit:hover{color:var(--brand-d);}
.empty-hint{color:var(--muted);font-size:13px;font-style:italic;padding:6px 2px;}
.empty-hint.pad{padding:20px;text-align:center;}
.summary .sum-row{display:flex;justify-content:space-between;padding:7px 0;font-size:13.5px;border-bottom:1px solid var(--line);}
.summary .grand{display:flex;justify-content:space-between;padding:12px 0;font-size:18px;font-weight:700;color:var(--brand);border-top:2px solid var(--brand);margin-top:4px;margin-bottom:10px;}
.export-btns{display:flex;gap:8px;align-items:center;flex-wrap:wrap;}
.export-btns .btn-pdf{flex:1;}
.export-btns .btn-ghost{min-width:96px;justify-content:center;}
.quote-manage-card{padding:14px 16px;}
.quote-manage-bar{border:1px solid var(--c-line);background:#fff;border-radius:var(--r-lg);padding:10px 12px;margin-bottom:12px;box-shadow:0 4px 14px rgba(15,23,42,.04);}
.quote-manage-head{display:flex;align-items:center;justify-content:space-between;gap:12px;}
.quote-manage-head h2{margin:0;font-size:var(--fs-md);}
.quote-manage-head p{margin:4px 0 0;color:var(--muted);font-size:12.5px;}
.quote-manage-toggle{white-space:nowrap;}
.quote-manage-body{border-top:1px solid var(--line);margin-top:10px;padding-top:10px;}
.quote-manage-actions{display:flex;gap:8px;align-items:end;flex-wrap:wrap;margin-bottom:10px;}
.quote-status-field{display:flex;flex-direction:column;gap:4px;font-size:11.5px;color:var(--muted);font-weight:700;}
.quote-status-field .quote-status-select{min-width:110px;}
.hs-inline-note{display:block;font-size:10.5px;line-height:1.2;margin-top:2px;}
.line-detail-factor{border:1px solid var(--line);background:var(--bg);border-radius:10px;padding:10px 12px;margin:0 0 12px;}
.line-detail-factor label{display:flex;align-items:center;justify-content:space-between;gap:12px;font-size:13px;font-weight:700;color:var(--text);}
.line-detail-factor input{width:86px;padding:6px 8px;border:1px solid var(--line);border-radius:8px;font-family:inherit;text-align:center;}
.line-detail-factor .hs-quick{justify-content:flex-end;margin-top:8px;}
.line-detail-factor p{margin:8px 0 0;color:var(--muted);font-size:12px;line-height:1.4;}
.side-note{font-size:11.5px;color:var(--muted);margin:10px 0 0;line-height:1.5;}
.quote-actions-bottom{display:flex;gap:10px;margin-top:4px;}
.quote-actions-bottom .btn-add-room{flex:1;}
.hs-col{width:110px;}
.hs-cell{display:flex;flex-direction:column;align-items:flex-end;gap:3px;}
.hs-input{width:58px;padding:4px 6px;border:1px solid var(--line);border-radius:6px;text-align:center;font-family:inherit;font-size:12px;}
.hs-quick{display:flex;gap:3px;}
.hs-quick button{border:1px solid var(--line);background:var(--surface);border-radius:5px;font-size:11px;padding:2px 6px;cursor:pointer;font-family:inherit;color:var(--muted);font-weight:600;}
.hs-quick button:hover{border-color:var(--brand);color:var(--brand);}
.hs-quick button.on{background:var(--brand);color:#fff;border-color:var(--brand);}
.hs-fixed{font-size:11px;}
.row-missing-price{background:var(--warn-bg);}
.price-missing-cell{display:flex;flex-direction:column;align-items:flex-end;gap:2px;}
.price-inline-input{width:100px;padding:4px 7px;border:1.5px solid var(--warn);border-radius:6px;font-family:inherit;font-size:13px;text-align:right;}
.price-inline-input:focus{outline:none;border-color:#EA580C;}
.price-missing-hint{font-size:10.5px;color:#EA580C;font-weight:600;}
.picker{background:var(--brand-soft);border-radius:10px;padding:12px;margin-bottom:12px;}
.picker-bar{display:flex;gap:8px;margin-bottom:10px;}
.picker-bar input{flex:1;padding:8px 10px;border:1px solid var(--line);border-radius:8px;font-family:inherit;font-size:13px;}
.picker-list{display:grid;grid-template-columns:1fr 1fr;gap:6px;max-height:220px;overflow:auto;}
.picker-item{display:flex;flex-direction:row;align-items:center;gap:8px;background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:7px 10px;cursor:pointer;text-align:left;font-family:inherit;transition:border-color .15s;}
.picker-item:hover{border-color:var(--brand);background:#fff;}
.pi-thumb{width:38px;height:38px;object-fit:cover;border-radius:6px;background:var(--bg);flex-shrink:0;border:1px solid var(--line);}
.pi-name{font-weight:600;font-size:12.5px;}
.pi-meta{font-size:11px;color:var(--muted);}
.picker-create-btn{width:100%;margin-top:8px;background:var(--surface);border:1px dashed var(--brand);color:var(--brand);padding:10px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;}
.picker-create-btn:hover{background:var(--brand-soft);}
.picker-create-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;font-size:14px;}
.picker-create-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;}
.price-preview{padding:8px 10px;background:var(--brand-soft);border-radius:8px;font-weight:700;color:var(--brand);font-size:13px;}
.cat-thumb{width:40px;height:40px;object-fit:cover;border-radius:6px;background:var(--bg);border:1px solid var(--line);}
.cat-thumb-empty{width:40px;height:40px;border-radius:6px;background:var(--bg);border:1px solid var(--line);display:flex;align-items:center;justify-content:center;color:#CBD5E1;font-size:16px;}
.cat-toolbar{display:flex;gap:8px;margin-bottom:12px;align-items:center;flex-wrap:wrap;}
.cat-toolbar .search,.search{flex:1;min-width:180px;padding:8px 12px;border:1px solid var(--line);border-radius:8px;font-family:inherit;font-size:13px;}
.cat-toolbar select{padding:8px 10px;border:1px solid var(--line);border-radius:8px;font-family:inherit;font-size:13px;}
.cat-advanced-tools{position:relative;}
.cat-advanced-tools>summary{list-style:none;border:1px solid var(--c-line);background:#fff;color:var(--c-text);border-radius:var(--r-md);padding:8px 12px;font-size:var(--fs-sm);font-weight:800;cursor:pointer;white-space:nowrap;}
.cat-advanced-tools>summary::-webkit-details-marker{display:none;}
.cat-advanced-tools[open]>summary{border-color:#C7D2FE;background:#EEF2FF;color:var(--c-primary);}
.cat-advanced-menu{position:absolute;right:0;top:calc(100% + 6px);z-index:20;display:flex;flex-direction:column;gap:6px;min-width:220px;background:#fff;border:1px solid var(--c-line);border-radius:var(--r-lg);box-shadow:0 18px 42px rgba(15,23,42,.16);padding:8px;}
.cat-advanced-menu .btn-ghost{width:100%;justify-content:flex-start;text-align:left;}
@media(max-width:860px){.cat-advanced-menu{position:static;margin-top:6px;box-shadow:none;width:100%;}}
.tab-intro{flex:1;color:var(--muted);font-size:12.5px;margin:0;line-height:1.5;min-width:200px;}
.unified-import{display:flex;flex-direction:column;gap:14px;}
.import-choice-hero,.import-panel-head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;background:var(--surface);border:1px solid var(--line);border-radius:var(--radius-lg);padding:18px 20px;}
.import-choice-hero h1,.import-panel-head h2{margin:2px 0 8px;font-size:22px;line-height:1.2;}
.import-choice-hero p,.import-panel-head p{margin:0;color:var(--muted);line-height:1.55;max-width:720px;}
.import-choice-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;}
.import-choice-card{text-align:left;background:var(--surface);border:1px solid var(--line);border-radius:16px;padding:20px;display:flex;flex-direction:column;gap:10px;cursor:pointer;font-family:inherit;box-shadow:0 1px 2px rgba(15,23,42,.04);transition:all .15s;}
.import-choice-card:hover{border-color:var(--brand);box-shadow:0 10px 24px rgba(15,23,42,.08);transform:translateY(-1px);}
.import-choice-icon{font-size:28px;width:52px;height:52px;border-radius:14px;background:var(--brand-soft);display:flex;align-items:center;justify-content:center;}
.import-choice-card strong{font-size:17px;color:var(--ink);}
.import-choice-card small{font-size:13px;color:var(--muted);line-height:1.55;}
.import-choice-card em{font-style:normal;font-size:13px;font-weight:700;color:var(--brand);margin-top:4px;}
.import-choice-note{background:var(--warn-bg);border:1px solid #FCD34D;color:#92400E;border-radius:12px;padding:12px 14px;font-size:13px;line-height:1.5;}
.catalog-import-only{background:var(--surface);border:1px dashed var(--line2);border-radius:16px;padding:24px;text-align:center;display:flex;flex-direction:column;align-items:center;gap:10px;}
.catalog-import-only-icon{font-size:32px;width:62px;height:62px;border-radius:18px;background:var(--brand-soft);display:flex;align-items:center;justify-content:center;}
.catalog-import-only h3{margin:0;font-size:18px;}
.catalog-import-only p{margin:0;color:var(--muted);max-width:620px;line-height:1.55;}
.catalog-import-only-actions{display:flex;gap:10px;justify-content:center;margin-top:6px;flex-wrap:wrap;}
.btn-import-catalog.prominent{background:var(--c-primary);color:#fff;border:none;}
.btn-import-catalog.prominent:hover{background:var(--c-primary-dark);color:#fff;}
@media(max-width:760px){.import-choice-grid{grid-template-columns:1fr}.import-choice-hero,.import-panel-head{flex-direction:column}.import-panel-head .btn-ghost:last-child{align-self:flex-start}}
.bulk-box{display:flex;gap:8px;align-items:center;background:var(--warn-bg);border:1px solid #FCD34D;border-radius:10px;padding:10px 12px;margin-bottom:14px;flex-wrap:wrap;}
.bulk-title{font-size:13px;font-weight:600;color:var(--warn);}
.bulk-box select,.bulk-pct{padding:6px 9px;border:1px solid var(--line);border-radius:8px;font-family:inherit;font-size:13px;}
.bulk-pct{width:150px;background:#fff;}
.bulk-pct:focus{outline:none;border-color:var(--brand);box-shadow:0 0 0 3px var(--brand-soft);}
.bulk-hint{font-size:12px;color:var(--muted);}
.bulk-error{font-size:12px;color:var(--neg);font-weight:600;}
.cat-table{background:var(--surface);}
.cat-table .pos{color:var(--pos);font-weight:600;}
.cat-table .neg{color:var(--neg);font-weight:600;}
.badge-fixed{display:inline-block;margin-left:6px;font-size:10px;background:var(--brand-soft);color:var(--brand);padding:1px 6px;border-radius:999px;font-weight:600;}
.badge-shared{display:inline-block;margin-left:6px;font-size:10px;background:var(--warn-bg);color:#92400E;padding:1px 6px;border-radius:999px;font-weight:600;}
.hidden-nav{display:none !important;}
.tabs button svg{flex-shrink:0;}
.tag-ncc{display:inline-flex;align-items:center;font-size:10.5px;border-radius:999px;padding:2px 8px;font-weight:600;line-height:1.4;}
.tag-lumi{background:#ECFDF5;color:#1A7A4A;}
.tag-hik{background:#FEF2F2;color:#991B1B;}
.tag-ruijie,.tag-aptek{background:#F0FDF4;color:#166534;}
.tag-bisco,.tag-roger{background:#FFF7ED;color:#92400E;}
.settings{max-width:780px;}
.section-card{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius-lg);margin-bottom:14px;overflow:hidden;}
.section-card-head{display:flex;align-items:center;gap:8px;padding:12px 16px;border-bottom:1px solid var(--line);font-size:14px;font-weight:600;}
.section-card-body{padding:16px;}
.ss-wrap{position:relative;width:100%;}
.ss-trigger{display:flex;align-items:center;gap:7px;width:100%;padding:7px 10px;border:1px solid var(--line);border-radius:8px;background:var(--surface);cursor:pointer;font-family:inherit;font-size:13px;text-align:left;transition:border-color .15s;}
.ss-trigger:hover{border-color:var(--line2);}
.ss-trigger.ss-unmapped{border-color:var(--neg);background:var(--neg-bg);}
.ss-icon{flex-shrink:0;color:var(--muted);}
.ss-val{flex:1;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.ss-placeholder{flex:1;color:var(--muted);}
.ss-dropdown{position:absolute;top:calc(100% + 4px);left:0;right:0;min-width:320px;background:var(--surface);border:1px solid var(--line2);border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.12);z-index:100;overflow:hidden;}
.ss-search-bar{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid var(--line);background:var(--bg);}
.ss-search-inp{flex:1;border:none;background:transparent;font-family:inherit;font-size:13px;color:var(--ink);outline:none;}
.ss-clear{background:none;border:none;color:var(--muted);cursor:pointer;font-size:16px;padding:0 2px;line-height:1;}
.ss-list{max-height:260px;overflow-y:auto;}
.ss-item{display:flex;align-items:center;gap:9px;padding:8px 12px;cursor:pointer;font-size:13px;transition:background .1s;}
.ss-item:hover{background:var(--bg);}
.ss-item.ss-selected{background:var(--brand-soft);}
.ss-item.ss-item-empty{color:var(--muted);font-style:italic;border-bottom:1px solid var(--line);}
.ss-no-result{padding:12px;text-align:center;color:var(--muted);font-size:13px;}
.ss-thumb{width:32px;height:32px;object-fit:cover;border-radius:5px;flex-shrink:0;border:1px solid var(--line);}
.ss-item-info{flex:1;min-width:0;}
.ss-item-name{display:block;font-weight:500;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.row-actions{text-align:right;white-space:nowrap;}
.link{background:none;border:none;color:var(--brand);font-size:12.5px;font-weight:600;cursor:pointer;padding:0 5px;font-family:inherit;}
.link.danger{color:var(--neg);}
.swap-list{max-height:320px;overflow:auto;display:flex;flex-direction:column;gap:6px;margin-bottom:6px;}
.swap-list .picker-item.cur{border-color:var(--brand);background:var(--brand-soft);}
.takeoff{padding:0;}
.takeoff-head{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:8px;}
.takeoff-head h2{margin:0;font-size:15px;font-weight:600;}
.takeoff-stat{font-size:12px;color:var(--muted);font-weight:600;}
.map-table{width:100%;border-collapse:collapse;font-size:13px;}
.map-table th{text-align:left;color:var(--muted);font-size:11.5px;font-weight:600;padding:7px 8px;border-bottom:1px solid var(--line);background:var(--bg);}
.map-table td{padding:8px;border-bottom:1px solid var(--line);vertical-align:middle;}
.map-table .row-unmapped{background:var(--warn-bg);}
.map-select{width:100%;max-width:400px;padding:6px 9px;border:1px solid var(--line);border-radius:7px;font-family:inherit;font-size:13px;background:var(--surface);}
.takeoff-warn{font-size:12.5px;color:#9A3412;background:var(--warn-bg);border:1px solid #FCD34D;border-radius:8px;padding:8px 12px;margin-top:10px;line-height:1.5;}
.takeoff-preview-scroll{overflow-x:auto;}
.takeoff-preview-scroll .cat-table th,.takeoff-preview-scroll .cat-table td{white-space:nowrap;font-size:12px;padding:5px 8px;}
.mode-pick-btn{display:flex;flex-direction:column;align-items:flex-start;gap:8px;padding:16px;border:1.5px solid var(--line2);border-radius:var(--radius-lg);background:var(--surface);cursor:pointer;text-align:left;font-family:inherit;transition:all .15s;}
.mode-pick-btn:hover{border-color:var(--brand);background:var(--brand-soft);}
.mode-pick-btn:hover svg{stroke:var(--brand);}
.mode-pick-btn svg{color:var(--muted);transition:stroke .15s;}
.mpb-title{font-size:14px;font-weight:600;color:var(--ink);}
.mpb-sub{font-size:12.5px;color:var(--muted);line-height:1.5;}
.ai-drop-zone{border:2px dashed var(--line2);border-radius:var(--radius-lg);padding:36px 24px;text-align:center;cursor:pointer;background:var(--bg);transition:all .2s;}
.ai-drop-zone:hover{border-color:var(--brand);background:var(--brand-soft);}
.ai-drop-icon{font-size:32px;margin-bottom:8px;}
.ai-drop-text{font-size:14px;font-weight:600;color:var(--ink);margin-bottom:4px;}
.ai-drop-sub{font-size:12.5px;color:var(--muted);}
.ai-progress-wrap{margin:14px 0;}
.ai-progress-bar{height:8px;background:var(--line);border-radius:999px;overflow:hidden;}
.ai-progress-fill{height:100%;background:var(--brand);border-radius:999px;transition:width .4s;}
.ai-progress-label{margin-top:6px;font-size:12.5px;color:var(--muted);text-align:center;}
.ai-review-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;}
.ai-review-header h3{font-size:14px;font-weight:600;}
.ai-section-title{font-size:13px;font-weight:600;padding:8px 0;cursor:pointer;list-style:none;}
.ai-section-title::marker{display:none;}
.ai-ok{color:var(--pos);}
.ai-warn{color:var(--warn);}
.badge-conf-high{background:var(--pos-bg);color:var(--pos);padding:1px 7px;border-radius:999px;font-size:11px;font-weight:600;}
.badge-conf-medium{background:var(--warn-bg);color:var(--warn);padding:1px 7px;border-radius:999px;font-size:11px;font-weight:600;}
.badge-conf-low{background:var(--neg-bg);color:var(--neg);padding:1px 7px;border-radius:999px;font-size:11px;font-weight:600;}
.badge-ai{display:inline-block;font-size:10px;background:var(--brand-soft);color:var(--brand);border-radius:999px;padding:1px 6px;font-weight:600;margin-left:4px;}
.stats-strip{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:12px;}
.stat-mini{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);padding:10px;text-align:center;}
.stat-mini .n{font-size:20px;font-weight:700;}
.stat-mini .l{font-size:11px;color:var(--muted);margin-top:2px;}
.n-blue{color:var(--brand);}
.n-green{color:var(--pos);}
.n-red{color:var(--neg);}
.n-gray{color:var(--muted);}
.cat-img-dropzone{display:flex;align-items:center;gap:10px;padding:10px 14px;border:1.5px dashed var(--line2);border-radius:10px;font-size:13px;color:var(--muted);margin-bottom:12px;transition:all .2s;background:var(--bg);cursor:default;}
.cat-img-dropzone.dragging{border-color:var(--brand);background:var(--brand-soft);color:var(--brand);}
.cat-img-dropzone strong{color:var(--brand);margin-left:4px;}
.ci-tip-excel{margin-top:16px;padding:10px 14px;background:#FEF9E7;border:1px solid #FDE68A;border-radius:8px;font-size:12.5px;color:#92660E;line-height:1.5;max-width:480px;}
.ci-web-import-box{margin:18px auto 0;padding:14px;background:#F8FAFC;border:1px solid var(--line);border-radius:12px;max-width:760px;text-align:left;}
.ci-web-import-title{font-weight:700;font-size:14px;margin-bottom:10px;color:var(--text);}
.ci-web-import-row{display:grid;grid-template-columns:minmax(220px,1fr) 180px auto;gap:8px;align-items:center;}
.ci-web-import-row input{border:1px solid var(--line);border-radius:8px;padding:9px 10px;font-size:13px;font-family:inherit;background:#fff;color:var(--text);}
.ci-web-import-row input:focus{outline:none;border-color:var(--brand);box-shadow:0 0 0 3px rgba(37,99,235,.08);}
.ci-web-import-sub{font-size:12px;color:var(--muted);line-height:1.45;margin-top:8px;}
.ci-web-import-status{font-size:12px;color:#B45309;background:#FFFBEB;border:1px solid #FDE68A;border-radius:8px;padding:8px 10px;margin-top:8px;}
@media (max-width:760px){.ci-web-import-row{grid-template-columns:1fr}.ci-web-import-row .btn-primary{justify-content:center}}
.ci-cache-note{margin-top:10px;padding:8px 12px;background:#EFF6FF;border-radius:7px;font-size:13px;color:#1E40AF;}
.ci-batch-log{margin-top:14px;display:flex;flex-direction:column;gap:6px;}
.ci-batch-line{font-size:13px;padding:8px 12px;border-radius:7px;background:var(--bg);color:var(--text2);}
.ci-batch-line.ok{background:#F0FDF4;color:#166534;}
.ci-batch-line.err{background:var(--neg-bg);color:var(--neg);}
.ci-img-import-box{background:var(--bg);border:1px solid var(--line);border-radius:12px;padding:20px;margin-bottom:16px;text-align:left;}
.ci-img-import-title{font-size:14px;font-weight:600;margin-bottom:6px;}
.ci-img-import-sub{font-size:13px;color:var(--muted);margin-bottom:12px;line-height:1.6;}
.ci-img-import-sub code{background:var(--surface2);padding:1px 5px;border-radius:4px;font-size:12px;}
.ci-img-drop{border:1.5px dashed var(--line2);border-radius:10px;padding:20px;text-align:center;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:6px;font-size:13px;color:var(--muted);transition:all .2s;}
.ci-img-drop:hover,.ci-img-drop.ci-dragging{border-color:var(--brand);background:var(--brand-soft);color:var(--brand);}
.ci-img-status{margin-top:10px;font-size:13px;color:var(--brand);font-weight:500;}
.catalog-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;padding:56px 24px;text-align:center;gap:14px;}
.catalog-empty-secondary-actions{display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-top:-4px;}
.new-user-empty{background:var(--surface);border:1px solid var(--line);border-radius:18px;padding:28px;display:flex;flex-direction:column;align-items:center;text-align:center;gap:12px;box-shadow:0 1px 2px rgba(15,23,42,.04);}
.new-user-empty.quote-empty{min-height:460px;justify-content:center;}
.new-user-empty.catalog-empty-state{border-style:dashed;max-width:760px;width:100%;}
.new-user-empty-icon{font-size:42px;width:72px;height:72px;border-radius:20px;background:var(--brand-soft);display:flex;align-items:center;justify-content:center;}
.new-user-empty-kicker{font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:var(--brand);}
.new-user-empty h1{font-size:26px;line-height:1.15;margin:0;color:var(--ink);}
.new-user-empty p{font-size:14px;color:var(--muted);margin:0;max-width:580px;line-height:1.6;}
.new-user-steps{display:grid;grid-template-columns:1fr 1fr;gap:12px;width:min(720px,100%);margin-top:6px;}
.new-user-step{display:flex;gap:12px;text-align:left;border:1px solid var(--line);border-radius:14px;padding:14px;background:#fff;}
.new-user-step span{width:30px;height:30px;border-radius:999px;display:flex;align-items:center;justify-content:center;font-weight:800;flex-shrink:0;background:var(--brand);color:#fff;}
.new-user-step strong{display:block;font-size:14px;margin-bottom:4px;color:var(--ink);}
.new-user-step small{display:block;font-size:12.5px;color:var(--muted);line-height:1.45;}
.new-user-step.disabled{opacity:.58;background:#f8fafc;}
.new-user-step.disabled span{background:#cbd5e1;color:#475569;}
.new-user-actions{display:flex;align-items:center;gap:12px;justify-content:center;flex-wrap:wrap;margin-top:4px;}
.new-user-hint{font-size:12.5px;color:var(--muted);}
@media(max-width:760px){.new-user-steps{grid-template-columns:1fr}.new-user-empty{padding:22px}.new-user-empty h1{font-size:22px}}
.btn-cleanup{background:#FEF3F2;color:#B42318;border:1px solid #FECDCA;padding:7px 12px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;white-space:nowrap;}
.btn-cleanup:hover{background:#FEE4E2;}
.btn-import-catalog{background:#F0FDF4;color:#166534;border:1px solid #86EFAC;padding:8px 14px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;white-space:nowrap;}
.btn-import-catalog:hover{background:#DCFCE7;}
.ci-overlay{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:1000;display:flex;align-items:center;justify-content:center;padding:20px;}
.ci-modal{background:var(--surface);border-radius:16px;width:min(1180px,96vw);height:min(900px,92vh);min-width:min(760px,96vw);min-height:560px;max-width:98vw;max-height:96vh;display:flex;flex-direction:column;overflow:hidden;resize:both;box-shadow:0 24px 64px rgba(0,0,0,.18);}
.ci-head{display:flex;align-items:flex-start;justify-content:space-between;padding:20px 24px 16px;border-bottom:1px solid var(--line);}
.ci-title{font-size:17px;font-weight:700;margin:0 0 2px;}
.ci-sub{font-size:13px;color:var(--muted);margin:0;}
.ci-close{background:none;border:none;font-size:18px;color:var(--muted);cursor:pointer;padding:4px 8px;border-radius:6px;}
.ci-close:hover{background:var(--bg);color:var(--ink);}
.ci-drop{border:2px dashed var(--line2);border-radius:12px;padding:40px 24px;text-align:center;cursor:pointer;margin:20px 24px;transition:all .2s;}
.ci-drop:hover,.ci-dragging{border-color:var(--brand);background:var(--brand-soft);}
.ci-drop-icon{font-size:40px;margin-bottom:12px;}
.ci-drop-title{font-size:16px;font-weight:600;margin-bottom:6px;}
.ci-drop-sub{font-size:13px;color:var(--muted);margin-bottom:14px;}
.ci-drop-examples{display:flex;gap:12px;justify-content:center;flex-wrap:wrap;font-size:12px;color:var(--brand);}
.ci-body{padding:20px 24px;overflow:auto;flex:1;}
.ci-file-badge{background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:8px 12px;font-size:13px;font-weight:500;margin-bottom:12px;display:inline-block;}
.ci-ai-status{font-size:13px;padding:8px 12px;border-radius:8px;background:var(--brand-soft);color:var(--brand);margin-bottom:12px;}
.ci-ai-status.ok{background:#F0FDF4;color:#166534;}
.ci-hint{font-size:13px;color:var(--muted);margin-bottom:12px;}
.ci-row-range-box{display:flex;align-items:end;gap:10px;flex-wrap:wrap;background:#F8FAFC;border:1px solid var(--line);border-radius:10px;padding:10px 12px;margin:0 0 14px;}
.ci-row-range-title{font-size:12px;font-weight:800;color:var(--text2);margin-right:4px;align-self:center;}
.ci-row-range-box label{display:flex;flex-direction:column;gap:4px;font-size:11px;font-weight:700;color:var(--text2);}
.ci-row-range-box input{width:110px;border:1px solid var(--line);border-radius:7px;padding:7px 9px;font-family:inherit;font-size:13px;background:#fff;color:var(--text);}
.ci-row-range-box span{font-size:12px;color:var(--muted);align-self:center;}
.ci-import-plan{background:#EFF6FF;border:1px solid #BFDBFE;color:#1E3A8A;border-radius:8px;padding:9px 12px;font-size:12.5px;line-height:1.5;margin:-2px 0 12px;display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;}
.ci-jump-btn{border:1px solid #BFDBFE;background:#fff;color:#1D4ED8;border-radius:8px;padding:7px 10px;font-size:12px;font-weight:800;cursor:pointer;font-family:inherit;white-space:nowrap;}
.ci-jump-btn.danger{border-color:#FCA5A5;background:#FEF2F2;color:#B42318;}
.ci-jump-btn:hover{filter:brightness(.98);}
.ci-map-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px;}
.ci-map-row{display:flex;flex-direction:column;gap:4px;}
.ci-map-label{font-size:12px;font-weight:500;color:var(--text2);}
.ci-req{color:var(--neg);margin-left:2px;}
.ci-map-select{padding:7px 10px;border:1px solid var(--line);border-radius:7px;font-family:inherit;font-size:13px;background:var(--surface);}
.ci-select-err{border-color:var(--neg);}
.ci-preview-mini{background:var(--bg);border-radius:8px;padding:12px;margin-bottom:16px;overflow-x:auto;}
.ci-preview-title{font-size:12px;font-weight:500;color:var(--muted);margin-bottom:8px;}
.ci-preview-table{width:100%;border-collapse:collapse;font-size:12px;}
.ci-preview-table th{background:var(--brand);color:#fff;padding:6px 8px;text-align:left;font-weight:500;position:sticky;top:0;z-index:1;}
.ci-preview-table td{padding:5px 8px;border-bottom:1px solid var(--line);vertical-align:top;}
.ci-preview-table tr:last-child td{border-bottom:none;}
.ci-stats-row{display:flex;gap:12px;margin-bottom:16px;}
.ci-stat{flex:1;background:var(--bg);border-radius:10px;padding:14px;text-align:center;display:flex;flex-direction:column;gap:4px;}
.ci-stat-n{font-size:26px;font-weight:700;color:var(--brand);}
.ci-stat span{font-size:12px;color:var(--muted);}
.ci-import-summary{border:1px solid var(--line);background:#F8FAFC;border-radius:10px;padding:10px 12px;margin:-4px 0 14px;font-size:12.5px;color:var(--text2);display:flex;flex-direction:column;gap:8px;}
.ci-summary-pills{display:flex;gap:8px;flex-wrap:wrap;}
.ci-summary-pills span,.ci-summary-pills button{padding:3px 8px;border-radius:999px;font-weight:600;font-size:11.5px;border:0;font-family:inherit;}
.ci-summary-pills button{cursor:pointer;}
.ci-summary-pills button:hover{filter:brightness(.96);}
.ci-summary-pills .ok,.ci-status.ok{background:#F0FDF4;color:#166534;}
.ci-summary-pills .warn,.ci-status.warn{background:#FEF9E7;color:#92660E;}
.ci-summary-pills .err,.ci-status.err{background:#FEF2F2;color:#B42318;}
.ci-summary-pills .muted,.ci-status.muted{background:var(--bg);color:var(--muted);}
.ci-error-nav{display:flex;gap:6px;margin-left:auto;}
.ci-error-nav button{border:1px solid #FCA5A5;background:#FEF2F2;color:#B42318;border-radius:999px;padding:7px 10px;font-size:12px;font-weight:800;cursor:pointer;font-family:inherit;}
.ci-error-nav button:disabled{opacity:.45;cursor:not-allowed;background:#F8FAFC;color:var(--muted);border-color:var(--line);}
.ci-row-blocking td{background:#FFF1F2;}
.ci-row-review td{background:#FFFBEB;}
.ci-row-focus td{box-shadow:inset 0 2px 0 #EF4444, inset 0 -2px 0 #EF4444;}
.ci-row-focus td:first-child{box-shadow:inset 3px 0 0 #EF4444, inset 0 2px 0 #EF4444, inset 0 -2px 0 #EF4444;}
.ci-warnings{font-size:12px;color:#92660E;display:flex;flex-direction:column;gap:3px;}
.ci-status{display:inline-block;padding:2px 7px;border-radius:999px;font-size:11px;font-weight:700;white-space:nowrap;background:var(--bg);color:var(--text2);}
.ci-source{font-size:10.5px;color:var(--muted);font-weight:400;margin-top:2px;}
.ci-issues{font-size:11px;color:var(--muted);min-width:110px;}

.ci-review-help{background:#FFFBEB;border:1px solid #FDE68A;color:#7C4A03;border-radius:8px;padding:10px 12px;font-size:12.5px;line-height:1.55;margin:-2px 0 12px;}
.ci-review-help-actions{display:flex;align-items:center;justify-content:space-between;gap:12px;}
.btn-approve-all{border:1px solid #86EFAC;background:#F0FDF4;color:#166534;border-radius:8px;padding:7px 12px;font-size:12px;font-weight:800;cursor:pointer;font-family:inherit;white-space:nowrap;}
.btn-approve-all:hover{background:#DCFCE7;}
.ci-footer-actions{display:flex;align-items:center;justify-content:flex-end;gap:10px;flex-wrap:wrap;}
.btn-approve-all-footer{color:#166534;border-color:#86EFAC;background:#F0FDF4;}
.ci-row-actions{display:flex;gap:5px;flex-wrap:wrap;min-width:118px;}
.ci-row-actions button{border:1px solid var(--line);background:#fff;color:var(--brand);border-radius:6px;padding:4px 7px;font-size:11px;font-weight:700;cursor:pointer;font-family:inherit;}
.ci-row-actions button:hover{background:var(--brand-soft);}
.ci-row-actions button.danger{color:var(--neg);}
.ci-row-actions button.danger:hover{background:#FEF2F2;border-color:#FECACA;}
.ci-edit-panel{border:1px solid var(--line);background:#F8FAFC;border-radius:10px;padding:12px;margin:12px 0 16px;}
.ci-edit-title{font-weight:800;font-size:13px;margin-bottom:10px;color:var(--text);}
.ci-edit-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:10px;}
.ci-edit-grid label,.ci-edit-specs{display:flex;flex-direction:column;gap:5px;font-size:11px;font-weight:700;color:var(--text2);}
.ci-edit-grid input,.ci-edit-specs textarea{border:1px solid var(--line);border-radius:7px;padding:8px 9px;font-family:inherit;font-size:13px;background:#fff;color:var(--text);}
.ci-edit-specs textarea{min-height:64px;resize:vertical;}
.ci-edit-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:10px;}
.ci-merge-toggle{display:flex;align-items:center;gap:16px;padding:12px 14px;background:var(--bg);border-radius:8px;margin-bottom:14px;flex-wrap:wrap;}
.ci-radio{display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer;}
.ci-preview-scroll{max-height:48vh;min-height:300px;overflow:auto;border:1px solid var(--line);border-radius:8px;margin-bottom:16px;}
.ci-more{text-align:center;padding:10px;font-size:13px;color:var(--muted);background:var(--bg);}
.ci-footer{display:flex;justify-content:space-between;align-items:center;padding-top:14px;border-top:1px solid var(--line);margin-top:4px;}
.btn-img-auto{background:var(--pos-bg);color:var(--pos);border:1px solid #86EFAC;padding:7px 12px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;white-space:nowrap;}
.btn-img-auto:hover:not(:disabled){background:#DCFCE7;}
.btn-img-auto:disabled{opacity:.6;cursor:wait;}
.auto-img-bar{background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:9px 12px;margin-bottom:10px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:13px;}
.auto-img-progress{flex:1;min-width:100px;height:6px;background:var(--line);border-radius:999px;overflow:hidden;}
.auto-img-fill{height:100%;background:var(--pos);border-radius:999px;transition:width .3s;}
.api-guide{background:var(--bg);border-left:3px solid var(--brand);padding:12px 14px;margin-top:10px;font-size:12.5px;line-height:1.9;}
.api-guide ol{margin:4px 0 10px 16px;}
.api-guide p{margin-bottom:4px;}
.api-guide a{color:var(--brand);}
details summary::-webkit-details-marker{color:var(--brand);}
.backup-warning{padding:12px 14px;background:#FEF9E7;border:1px solid #FDE68A;border-radius:8px;font-size:13px;color:#92660E;line-height:1.6;margin-bottom:12px;}
.backup-stats{display:flex;gap:14px;margin-bottom:12px;flex-wrap:wrap;}
.backup-stats span{font-size:13px;color:var(--text2);background:var(--bg);padding:6px 12px;border-radius:7px;}
.settings-actions{display:flex;gap:10px;flex-wrap:wrap;}
.settings-actions .btn-primary{width:auto;}
.markup-box{background:var(--warn-bg);border:1px solid #FCD34D;border-radius:10px;padding:10px 12px;margin-bottom:12px;}
.markup-label{font-size:12px;font-weight:600;color:var(--warn);margin-bottom:6px;}
.markup-select{width:100%;padding:7px 9px;border:1px solid var(--line);border-radius:8px;font-family:inherit;font-size:13px;font-weight:600;color:var(--brand);cursor:pointer;background:var(--surface);}
.markup-row{display:flex;align-items:center;gap:8px;margin-bottom:8px;}
.markup-name-input{flex:1;padding:7px 10px;border:1px solid var(--line);border-radius:8px;font-family:inherit;font-size:13px;}
.markup-x{color:var(--muted);font-weight:600;}
.markup-val-input{width:72px;padding:7px 9px;border:1px solid var(--line);border-radius:8px;font-family:inherit;font-size:13px;text-align:center;}
.imp-sub{margin:16px 0 6px;font-size:13px;color:var(--muted);}
.imp-scroll{max-height:240px;overflow:auto;border:1px solid var(--line);border-radius:8px;}
.imp-scroll.short{max-height:140px;}
.imp-scroll .cat-table th{position:sticky;top:0;background:var(--surface);}
.imp-options{margin-top:14px;display:flex;flex-direction:column;gap:10px;}
.chk{display:flex;align-items:center;gap:9px;font-size:13px;cursor:pointer;}
.chk input{width:16px;height:16px;cursor:pointer;}
.modal-backdrop{position:fixed;inset:0;background:rgba(15,23,42,.4);display:flex;align-items:center;justify-content:center;z-index:50;padding:20px;}
.modal{background:var(--surface);border-radius:14px;padding:22px;width:100%;max-width:480px;max-height:90vh;overflow:auto;}
.modal.wide{max-width:740px;}
.modal h2{margin:0 0 16px;font-size:17px;font-weight:600;}
.modal-actions{display:flex;justify-content:flex-end;gap:10px;margin-top:18px;}
.modal-actions .btn-primary{width:auto;}
.tpl-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px;}
.tpl-card{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius-lg);padding:14px;}
.tpl-card-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;}
.tpl-card-head h3{margin:0;font-size:14px;font-weight:600;}
.tpl-total{font-weight:700;color:var(--brand);font-size:13px;}
.tpl-items{list-style:none;padding:0;margin:0;font-size:12.5px;}
.tpl-items li{display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--line);}
.tpl-card-actions{margin-top:10px;display:flex;gap:6px;justify-content:flex-end;}
.tpl-editor-cols{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-top:14px;}
.tpl-editor-cols h4{margin:0 0 8px;font-size:12.5px;color:var(--muted);}
.tpl-edit-items{list-style:none;padding:0;margin:0;}
.tpl-edit-items li{display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid var(--line);}
.tei-name{flex:1;font-size:12.5px;}
.tpl-pick-list{max-height:260px;overflow:auto;display:flex;flex-direction:column;gap:6px;margin-top:8px;}
.ask-grid{display:grid;grid-template-columns:1fr 280px;gap:16px;align-items:start;}
.ask-side{position:sticky;top:68px;}
.ask-add-row{display:flex;gap:8px;margin-bottom:10px;}
.ask-catalog-search{margin-bottom:4px;}
.ask-chips{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px;}
.ask-chip{display:inline-flex;align-items:center;gap:6px;background:var(--brand-soft);color:var(--brand);border-radius:999px;padding:4px 6px 4px 11px;font-size:12.5px;font-weight:600;}
.ask-chip button{background:none;border:none;color:var(--brand);font-size:15px;cursor:pointer;line-height:1;padding:0 2px;}
.ask-msg{width:100%;border:1px solid var(--line);border-radius:9px;padding:10px 12px;font-size:13px;font-family:inherit;line-height:1.6;resize:vertical;background:var(--bg);}
.ask-actions{display:flex;gap:8px;margin-top:10px;}
.ask-actions .btn-primary,.ask-actions .btn-excel{width:auto;flex:1;}
.ncc-info{font-size:13px;line-height:1.7;padding:10px 0;border-top:1px solid var(--line);}
.ncc-info-actions{display:flex;gap:8px;margin-top:6px;}
.section-title{font-size:var(--fs-lg);font-weight:700;margin:0 0 var(--sp-4);}
@media (max-width:900px){
  .ask-grid,.quote-grid{grid-template-columns:1fr;}
  .ask-side,.quote-side{position:static;}
  .field-grid{grid-template-columns:1fr;}
  .tpl-editor-cols{grid-template-columns:1fr;}
  .picker-list{grid-template-columns:1fr;}
  .tabs{overflow-x:auto;}
  .main{padding:12px;}
}

.ci-template-library{border:1px solid #D6E4FF;background:#F8FBFF;border-radius:12px;padding:12px 14px;margin:12px 0;}
.ci-template-library-title{font-weight:900;color:#1E3A8A;font-size:14px;margin-bottom:8px;}
.ci-template-library-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;}
.ci-template-library-row select{min-width:280px;flex:1;border:1px solid #CBD5E1;border-radius:10px;padding:8px 10px;background:#fff;font-family:inherit;}
.ci-template-library-sub{margin-top:6px;font-size:12px;color:var(--muted);}
.ci-learning-note{border:1px solid #86EFAC;background:var(--c-success-bg);color:#166534;border-radius:var(--r-md);padding:10px 12px;margin:10px 0;font-weight:800;}
.ci-learning-mini{border:1px solid #E0E7FF;background:var(--c-primary-soft);color:#3730A3;border-radius:var(--r-md);padding:8px 12px;margin:10px 0;font-size:var(--fs-sm);font-weight:700;}
.btn-ghost.danger{color:var(--c-danger);border-color:#FECACA;background:#FFF7F7;}
.btn-ghost.danger:hover{background:#FEE2E2;}

/* Phase 3.16 — clean import preview redesign */
.ci-body{padding:18px 20px;}
.ci-import-hero{display:flex;align-items:center;justify-content:space-between;gap:16px;border:1px solid var(--line);border-radius:16px;padding:16px 18px;margin-bottom:12px;background:#F8FAFC;}
.ci-import-hero.ok{background:linear-gradient(180deg,#F0FDF4,#FFFFFF);border-color:#BBF7D0;}
.ci-import-hero.warn{background:linear-gradient(180deg,var(--c-warn-bg),#FFFFFF);border-color:var(--c-warn-line);}
.ci-import-hero.danger{background:linear-gradient(180deg,var(--c-danger-bg),#FFFFFF);border-color:#FECACA;}
.ci-import-hero-kicker{text-transform:uppercase;letter-spacing:.05em;font-size:11px;font-weight:800;color:var(--muted);margin-bottom:3px;}
.ci-import-hero h3{font-size:var(--fs-xl);line-height:1.25;margin:0 0 6px;color:var(--ink);}
.ci-import-hero p{margin:0;font-size:var(--fs-sm);color:var(--text2);line-height:1.55;}
.ci-import-hero-actions{display:flex;align-items:center;justify-content:flex-end;gap:8px;flex-wrap:wrap;}
.ci-primary-action{border:0;border-radius:var(--r-md);padding:10px 14px;font-size:var(--fs-sm);font-weight:900;cursor:pointer;font-family:inherit;white-space:nowrap;color:#fff;background:var(--c-primary);box-shadow:0 8px 20px rgba(27,79,216,.16);}
.ci-primary-action.ok{background:var(--c-primary);}
.ci-primary-action.warn{background:var(--c-warn);}
.ci-primary-action.danger{background:var(--c-danger);}
.ci-primary-action:hover{filter:brightness(.97);transform:translateY(-1px);}
.ci-primary-action:disabled{background:#94A3B8!important;cursor:not-allowed;box-shadow:none;transform:none;filter:none;}
.ci-processing-details{border:1px solid var(--line);border-radius:12px;background:#fff;margin:0 0 12px;overflow:hidden;}
.ci-processing-details summary{cursor:pointer;list-style:none;padding:10px 12px;font-size:13px;font-weight:800;color:var(--text2);display:flex;align-items:center;gap:8px;}
.ci-processing-details summary:before{content:'▸';font-size:11px;color:var(--muted);transition:transform .15s;}
.ci-processing-details[open] summary:before{transform:rotate(90deg);}
.ci-processing-details summary::-webkit-details-marker{display:none;}
.ci-detail-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;border-top:1px solid var(--line);padding:12px;}
.ci-detail-grid div{background:#F8FAFC;border:1px solid #EEF2F7;border-radius:9px;padding:8px 10px;min-width:0;}
.ci-detail-grid span{display:block;font-size:11px;color:var(--muted);margin-bottom:2px;}
.ci-detail-grid strong{display:block;font-size:12px;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.ci-learning-note.compact,.ci-warnings.compact{margin:0 12px 12px;font-size:12px;padding:8px 10px;}
.ci-import-controls{display:flex;align-items:center;justify-content:space-between;gap:12px;background:#F8FAFC;border:1px solid #EEF2F7;border-radius:12px;padding:10px 12px;margin-bottom:10px;}
.ci-merge-choice{display:flex;align-items:center;gap:12px;flex-wrap:wrap;}
.ci-merge-choice>span{font-size:12px;font-weight:900;color:var(--text2);}
.ci-control-actions{display:flex;gap:8px;align-items:center;}
.ci-preview-tabs{display:flex;align-items:center;gap:6px;margin-bottom:10px;flex-wrap:wrap;}
.ci-preview-tabs button{border:1px solid var(--line);background:#fff;color:var(--text2);border-radius:999px;padding:6px 10px;font-size:12px;font-weight:800;cursor:pointer;font-family:inherit;display:inline-flex;align-items:center;gap:6px;}
.ci-preview-tabs button span{display:inline-flex;align-items:center;justify-content:center;min-width:20px;height:20px;border-radius:999px;background:#F1F5F9;color:var(--muted);font-size:11px;padding:0 5px;}
.ci-preview-tabs button.active{border-color:var(--brand);background:var(--brand-soft);color:var(--brand);}
.ci-preview-tabs button.active span{background:#fff;color:var(--brand);}
.ci-preview-tabs button.danger{border-color:#FECACA;color:#B42318;background:#FFF7F7;}
.ci-tab-spacer{flex:1;}
.ci-mini-danger,.ci-mini-ok{border-radius:999px!important;font-weight:900!important;}
.ci-mini-danger{border-color:#FCA5A5!important;background:#FEF2F2!important;color:#B42318!important;}
.ci-mini-ok{border-color:#86EFAC!important;background:#F0FDF4!important;color:#166534!important;}
.ci-review-copy{background:#FFFBEB;border:1px solid #FDE68A;color:#7C4A03;border-radius:12px;padding:9px 11px;font-size:12.5px;line-height:1.5;margin-bottom:10px;}

.ci-row-price-warn td{background:#FFF8E1!important;}
.ci-row-price-danger td{background:#FFF3CD!important;box-shadow:inset 3px 0 0 #F0C000;}
.ci-price-tag{display:inline-flex;align-items:center;gap:4px;width:max-content;border-radius:999px;padding:3px 8px;margin:0 0 5px;font-size:11px;font-weight:900;letter-spacing:.01em;}
.ci-price-tag.warn{background:#FEF3C7;color:#92400E;border:1px solid #FDE68A;}
.ci-price-tag.danger{background:#FFFBEB;color:#7C4A03;border:1px solid #F0C000;}
.ci-price-confirm-strip{border:1px solid #FDE68A;background:#FFFBEB;color:#7C4A03;border-radius:12px;padding:12px;margin:0 0 12px;display:flex;align-items:center;gap:12px;box-shadow:0 1px 2px rgba(146,102,14,.08);}
.ci-price-confirm-strip.danger{border-color:#F0C000;background:#FFF8E1;}
.ci-price-confirm-strip.confirmed{border-color:#86EFAC;background:#F0FDF4;color:#166534;}
.ci-price-confirm-strip.soft{border-color:#FDE68A;background:#FFFBEB;}
.ci-price-confirm-icon{font-size:22px;line-height:1;}
.ci-price-confirm-text{display:flex;flex-direction:column;gap:3px;flex:1;min-width:220px;font-size:13px;line-height:1.45;}
.ci-price-confirm-text strong{font-size:13.5px;}
.ci-price-confirm-text span{color:inherit;opacity:.9;}
.ci-price-confirm-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:flex-end;}
.ci-preview-scroll.compact{max-height:54vh;min-height:360px;border-radius:12px;}
.ci-preview-table-clean{font-size:12.5px;}
.ci-preview-table-clean th{background:#0F7D4F;padding:9px 10px;font-size:12px;font-weight:900;}
.ci-preview-table-clean td{padding:10px;border-bottom:1px solid #EAF0F5;}
.ci-row-num{display:flex;align-items:center;gap:8px;color:var(--muted);font-size:12px;font-weight:800;}
.ci-dot{width:9px;height:9px;border-radius:50%;background:#CBD5E1;display:inline-block;}
.ci-dot.ok{background:#22C55E;}
.ci-dot.warn{background:#F59E0B;}
.ci-dot.err{background:#EF4444;}
.ci-dot.muted{background:#94A3B8;}
.ci-product-cell{min-width:280px;}
.ci-product-name{font-weight:900;color:var(--ink);line-height:1.35;margin-bottom:3px;}
.ci-product-meta{font-size:11.5px;color:var(--muted);line-height:1.35;}
.ci-sku-cell{font-size:12px;color:#475569;font-weight:700;white-space:nowrap;}
.ci-price-cell{text-align:right;white-space:nowrap;font-weight:900;color:var(--ink);}
.ci-price-cell small{display:block;color:var(--muted);font-size:11px;font-weight:700;margin-top:2px;}
.ci-issues.clean{font-size:12px;line-height:1.45;color:#64748B;min-width:170px;max-width:320px;}
.ci-row-actions.clean{min-width:104px;gap:5px;}
.ci-row-actions.clean button{padding:5px 8px;border-radius:8px;font-size:11.5px;background:#fff;}
.ci-footer{position:sticky;bottom:0;background:var(--surface);z-index:2;padding:12px 0 0;margin-top:10px;}
@media (max-width:900px){
  .ci-import-hero,.ci-import-controls{align-items:flex-start;flex-direction:column;}
  .ci-import-hero-actions,.ci-control-actions{width:100%;justify-content:flex-start;}
  .ci-detail-grid{grid-template-columns:1fr 1fr;}
  .ci-preview-table-clean th:nth-child(3),.ci-preview-table-clean td:nth-child(3){display:none;}
}


/* BOM Phase 1 — preview parser */
.mode-pick-primary{border-color:#86EFAC!important;background:linear-gradient(180deg,#F0FDF4,#FFFFFF)!important;}
.bom-preview-card{display:flex;flex-direction:column;gap:14px;}
.bom-topline{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;}
.bom-drop-zone{border:1.5px dashed #CBD5E1;background:#F8FAFC;border-radius:14px;padding:34px 20px;text-align:center;cursor:pointer;transition:.16s;}
.bom-drop-zone:hover{border-color:var(--brand);background:#F0FDF4;}
.bom-summary-box{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;border:1px solid #BBF7D0;background:linear-gradient(180deg,#F0FDF4,#FFFFFF);border-radius:16px;padding:16px;}
.bom-summary-title{font-size:18px;font-weight:900;color:#14532D;margin-bottom:4px;}
.bom-summary-sub{font-size:13px;color:#166534;line-height:1.5;}
.bom-summary-areas{font-size:12px;color:#64748B;margin-top:6px;line-height:1.5;}
.bom-summary-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:flex-end;}
.bom-summary-actions .btn-primary:disabled{opacity:.75;cursor:not-allowed;background:#94A3B8;}
.bom-metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;}
.bom-metrics div{border:1px solid #EEF2F7;background:#F8FAFC;border-radius:12px;padding:12px;text-align:center;}
.bom-metrics strong{display:block;font-size:24px;color:var(--ink);}
.bom-metrics span{display:block;font-size:12px;color:var(--muted);margin-top:2px;}
.bom-details{border:1px solid var(--line);border-radius:12px;background:#fff;overflow:hidden;}
.bom-details summary{cursor:pointer;padding:10px 12px;font-size:13px;font-weight:800;color:var(--text2);}
.bom-detail-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;padding:12px;border-top:1px solid var(--line);}
.bom-detail-chip{background:#F8FAFC;border:1px solid #EEF2F7;border-radius:9px;padding:8px 10px;}
.bom-detail-chip strong{display:block;font-size:12px;color:var(--text);}
.bom-detail-chip span{display:block;font-size:11px;color:var(--muted);margin-top:2px;}
.bom-toolbar{display:flex;gap:6px;align-items:center;flex-wrap:wrap;}
.bom-toolbar button{border:1px solid var(--line);background:#fff;border-radius:999px;padding:7px 11px;font-size:12px;font-weight:800;color:var(--text2);cursor:pointer;font-family:inherit;}
.bom-toolbar button.active{border-color:var(--brand);background:var(--brand-soft);color:var(--brand);}
.bom-table-wrap{border:1px solid var(--line);border-radius:12px;overflow:auto;max-height:56vh;background:#fff;}
.bom-preview-table{width:100%;border-collapse:collapse;font-size:12.5px;}
.bom-preview-table th{position:sticky;top:0;background:#0F7D4F;color:#fff;text-align:left;padding:10px;font-size:12px;z-index:1;}
.bom-preview-table td{padding:10px;border-bottom:1px solid #EAF0F5;vertical-align:top;}
.bom-row-review td{background:#FFFBEB;}
.bom-status{display:inline-block;border-radius:999px;padding:3px 8px;font-size:11px;font-weight:900;white-space:nowrap;}
.bom-status.ready{background:#F0FDF4;color:#166534;}
.bom-status.need_review{background:#FEF3C7;color:#92400E;}
.bom-preview-table .muted{color:var(--muted);font-size:11.5px;}
@media (max-width:900px){
  .bom-summary-box,.bom-topline{flex-direction:column;}
  .bom-metrics,.bom-detail-grid{grid-template-columns:1fr 1fr;}
  .bom-preview-table th:nth-child(6),.bom-preview-table td:nth-child(6),.bom-preview-table th:nth-child(7),.bom-preview-table td:nth-child(7){display:none;}
}

/* BOM Phase 2 — catalog matching + resolve UI */
.bom-phase2-summary{border-color:#BFDBFE;background:linear-gradient(180deg,#EFF6FF,#FFFFFF);} 
.bom-phase2-summary .bom-summary-title{color:#1E3A8A;}
.bom-phase2-summary .bom-summary-sub{color:#1D4ED8;}
.bom-phase2-metrics{grid-template-columns:repeat(4,minmax(0,1fr));}
.bom-resolve-hint{border:1px solid #FDE68A;background:#FFFBEB;color:#92400E;border-radius:12px;padding:11px 12px;font-size:13px;line-height:1.45;}
.bom-status.matched{background:#DBEAFE;color:#1D4ED8;}
.bom-status.ignored{background:#F1F5F9;color:#64748B;}
.bom-match-table th:nth-child(6),.bom-match-table td:nth-child(6){min-width:310px;}
.bom-suggestions{display:flex;gap:6px;flex-wrap:wrap;margin-top:7px;}
.bom-suggestions button{border:1px solid #DDE7F0;background:#fff;border-radius:999px;padding:4px 8px;font-size:11px;font-weight:750;color:#334155;cursor:pointer;max-width:260px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.bom-suggestions button:hover{border-color:var(--brand);background:#F0FDF4;color:var(--brand);}
.bom-suggestions button.selected{border-color:#2563EB;background:#EFF6FF;color:#1D4ED8;}
.bom-suggestions span{color:#64748B;margin-left:4px;}
.bom-row-actions{margin-top:8px;display:flex;gap:6px;}
.btn-mini{border:1px solid var(--line);background:#fff;border-radius:8px;padding:4px 7px;font-size:11px;font-weight:850;cursor:pointer;font-family:inherit;color:var(--text2);}
.btn-mini.danger{border-color:#FECACA;color:#B91C1C;background:#FEF2F2;}
@media(max-width:720px){.bom-match-table th:nth-child(5),.bom-match-table td:nth-child(5){display:none}.bom-phase2-metrics{grid-template-columns:1fr 1fr;}}

/* BOM Phase 3 — discipline + scope extraction */
.bom-scope-section{border:1px solid #DDEAFE;background:#F8FBFF;border-radius:14px;padding:13px;display:flex;flex-direction:column;gap:11px;}
.bom-scope-header{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;}
.bom-scope-header strong{display:block;font-size:14px;color:#0F172A;margin-bottom:2px;}
.bom-scope-header span{display:block;font-size:12px;color:#64748B;line-height:1.4;}
.bom-scope-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px;}
.bom-scope-card{text-align:left;border:1px solid #DDEAFE;background:#fff;border-radius:12px;padding:11px;cursor:pointer;font-family:inherit;display:flex;flex-direction:column;gap:4px;min-height:108px;transition:.16s;}
.bom-scope-card:hover{border-color:#2563EB;box-shadow:0 6px 20px rgba(37,99,235,.08);transform:translateY(-1px);}
.bom-scope-card.active{border-color:#2563EB;background:#EFF6FF;box-shadow:0 0 0 2px rgba(37,99,235,.08) inset;}
.bom-scope-card.supporting{background:#F8FAFC;border-color:#E2E8F0;}
.bom-scope-title{font-size:13px;font-weight:900;color:#0F172A;line-height:1.25;}
.bom-scope-card.supporting .bom-scope-title{color:#475569;}
.bom-scope-meta{font-size:11.5px;color:#1D4ED8;font-weight:800;}
.bom-scope-vendors{font-size:11.5px;color:#166534;line-height:1.3;}
.bom-scope-samples{font-size:11px;color:#64748B;line-height:1.35;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}
.bom-grouping-toggle{display:inline-flex;border:1px solid #DDE7F0;background:#fff;border-radius:999px;padding:3px;gap:2px;}
.bom-grouping-toggle button{border:0;background:transparent;border-radius:999px;padding:6px 9px;font-size:11.5px;font-weight:850;color:#64748B;cursor:pointer;font-family:inherit;white-space:nowrap;}
.bom-grouping-toggle button.active{background:#DBEAFE;color:#1D4ED8;}
@media(max-width:960px){.bom-scope-grid{grid-template-columns:1fr 1fr;}.bom-summary-actions{align-items:flex-start;justify-content:flex-start;}}
@media(max-width:640px){.bom-scope-grid{grid-template-columns:1fr;}.bom-scope-header{flex-direction:column;}.bom-grouping-toggle{width:100%;}.bom-grouping-toggle button{flex:1;}}

/* BOM Phase 4 — solution pack matching */
.bom-pack-section{border:1px solid #C7D2FE;background:linear-gradient(180deg,#EEF2FF,#FFFFFF);border-radius:14px;padding:13px;display:flex;flex-direction:column;gap:11px;}
.bom-pack-list{display:flex;flex-direction:column;gap:10px;}
.bom-pack-row{border:1px solid #E0E7FF;background:#fff;border-radius:13px;padding:10px;display:grid;grid-template-columns:180px minmax(0,1fr) auto;gap:10px;align-items:start;}
.bom-pack-scope{border:0;background:transparent;text-align:left;font-family:inherit;cursor:pointer;padding:2px;}
.bom-pack-scope strong{display:block;font-size:13px;color:#1E1B4B;line-height:1.25;margin-bottom:3px;}
.bom-pack-scope span{display:block;font-size:11.5px;color:#64748B;line-height:1.35;}
.bom-pack-options{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;}
.bom-pack-card{border:1px solid #E0E7FF;background:#FAFBFF;border-radius:11px;padding:10px;text-align:left;font-family:inherit;cursor:pointer;min-height:118px;display:flex;flex-direction:column;gap:4px;transition:.16s;}
.bom-pack-card:hover{border-color:#6366F1;box-shadow:0 6px 18px rgba(99,102,241,.10);transform:translateY(-1px);}
.bom-pack-card.active{border-color:#4F46E5;background:#EEF2FF;box-shadow:0 0 0 2px rgba(79,70,229,.08) inset;}
.bom-pack-title{font-size:13px;font-weight:950;color:#111827;line-height:1.25;}
.bom-pack-meta{font-size:11.5px;color:#4338CA;font-weight:850;}
.bom-pack-rationale{font-size:11px;color:#64748B;line-height:1.35;min-height:30px;}
.bom-pack-products{font-size:11px;color:#166534;line-height:1.35;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}
.bom-pack-actions{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:auto;font-size:10.5px;color:#64748B;}
.bom-pack-actions em{font-style:normal;border-radius:999px;background:#E0E7FF;color:#3730A3;padding:2px 6px;font-weight:850;}
.bom-pack-row-actions{display:flex;align-items:flex-start;justify-content:flex-end;}
@media(max-width:1080px){.bom-pack-row{grid-template-columns:1fr;}.bom-pack-row-actions{justify-content:flex-start}.bom-pack-options{grid-template-columns:1fr 1fr;}}
@media(max-width:720px){.bom-pack-options{grid-template-columns:1fr;}}


/* BOM Phase 5 — quote composer A/B/C */
.bom-quote-composer{border:1px solid #FED7AA;background:linear-gradient(180deg,#FFF7ED,#FFFFFF);border-radius:14px;padding:13px;display:flex;flex-direction:column;gap:11px;}
.bom-variant-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;}
.bom-variant-card{border:1px solid #FDBA74;background:#fff;border-radius:13px;padding:12px;text-align:left;font-family:inherit;cursor:pointer;display:flex;flex-direction:column;gap:8px;transition:.16s;min-height:150px;}
.bom-variant-card:hover{border-color:#F97316;box-shadow:0 8px 22px rgba(249,115,22,.10);transform:translateY(-1px);}
.bom-variant-card.active{border-color:#EA580C;background:#FFF7ED;box-shadow:0 0 0 2px rgba(234,88,12,.10) inset;}
.bom-variant-head{display:flex;gap:10px;align-items:flex-start;}
.bom-variant-letter{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:10px;background:#FFEDD5;color:#9A3412;font-weight:950;font-size:14px;flex:0 0 auto;}
.bom-variant-head strong{display:block;font-size:14px;color:#111827;line-height:1.2;}
.bom-variant-head small{display:block;font-size:11.5px;color:#64748B;line-height:1.35;margin-top:2px;}
.bom-variant-total{font-size:20px;font-weight:950;color:#9A3412;margin-top:2px;}
.bom-variant-meta{display:flex;gap:6px;flex-wrap:wrap;font-size:11px;color:#64748B;}
.bom-variant-meta span{border:1px solid #FED7AA;background:#FFF7ED;border-radius:999px;padding:3px 7px;font-weight:800;}
.bom-variant-warn{font-size:11.5px;color:#92400E;background:#FEF3C7;border:1px solid #FDE68A;border-radius:8px;padding:6px 8px;margin-top:auto;}
.bom-variant-note{font-size:12.5px;color:#92400E;background:#FFFBEB;border:1px solid #FDE68A;border-radius:10px;padding:9px 10px;line-height:1.45;}
@media(max-width:960px){.bom-variant-grid{grid-template-columns:1fr;}}


/* BOM Phase 6 — pack template builder */
.bom-template-summary{border:1px solid #D1FAE5;background:#F0FDF4;border-radius:9px;padding:7px 8px;margin-top:4px;display:flex;flex-direction:column;gap:3px;}
.bom-template-summary strong{font-size:11.5px;color:#14532D;line-height:1.25;}
.bom-template-summary span{font-size:10.5px;color:#166534;font-weight:800;}
.bom-template-components{display:flex;gap:4px;flex-wrap:wrap;margin-top:2px;}
.bom-template-components em{font-style:normal;border-radius:999px;padding:2px 6px;font-size:10px;font-weight:850;max-width:160px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.bom-template-components em.ok{background:#DCFCE7;color:#166534;}
.bom-template-components em.missing{background:#FEE2E2;color:#991B1B;}
.bom-template-components em.optional{background:#F1F5F9;color:#64748B;}
.bom-template-note{border-color:#BBF7D0;background:#F0FDF4;color:#166534;}


/* BOM Phase 8 — pilot UX & resolve speed */
.bom-pilot-summary{position:sticky;top:0;z-index:4;box-shadow:0 12px 30px rgba(15,23,42,.06);} 
.bom-pilot-actionbar{border:1px solid #BBF7D0;background:linear-gradient(180deg,#F0FDF4,#FFFFFF);border-radius:14px;padding:12px;display:flex;justify-content:space-between;gap:12px;align-items:center;}
.bom-pilot-actionbar strong{display:block;font-size:14px;color:#14532D;margin-bottom:2px;}
.bom-pilot-actionbar span{display:block;font-size:12.5px;color:#166534;line-height:1.4;}
.bom-pilot-actions{display:flex;gap:7px;flex-wrap:wrap;justify-content:flex-end;}
.bom-pilot-metrics div:nth-child(4){background:#F8FAFC;color:#64748B;}
.bom-pilot-toolbar{position:sticky;top:74px;z-index:3;background:#fff;padding:8px;border:1px solid #E2E8F0;border-radius:13px;box-shadow:0 10px 28px rgba(15,23,42,.05);} 
.bom-supporting-toggle{border:1px dashed #CBD5E1;background:#fff;border-radius:11px;padding:9px 11px;font-size:12px;font-weight:850;color:#475569;text-align:left;cursor:pointer;font-family:inherit;}
.bom-supporting-toggle:hover{border-color:#64748B;background:#F8FAFC;}
.bom-row-supporting td{background:#F8FAFC;color:#475569;}
.bom-row-supporting .strong{color:#475569;}
.bom-load-more{display:flex;align-items:center;justify-content:center;gap:10px;padding:10px 12px;font-size:12px;color:#64748B;background:#F8FAFC;border-top:1px solid #E2E8F0;}
@media(max-width:860px){.bom-pilot-actionbar{align-items:flex-start;flex-direction:column}.bom-pilot-actions{justify-content:flex-start}.bom-pilot-toolbar{position:static}}


/* Phase 4 — cloud quotes */
.quote-cloud-card{border-color:#BFDBFE;background:linear-gradient(180deg,#EFF6FF,#FFFFFF);}
.quote-cloud-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;}
.quote-cloud-head h2{margin:0;color:#0F172A;}
.quote-cloud-head p{margin:4px 0 0;color:#64748B;font-size:13px;}
.quote-cloud-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:flex-end;}
.quote-status-select{border:1px solid #CBD5E1;border-radius:10px;padding:9px 10px;font-size:13px;font-weight:800;color:#334155;background:#fff;}
.quote-cloud-meta{display:flex;gap:10px;flex-wrap:wrap;margin-top:10px;font-size:12px;color:#475569;}
.quote-cloud-meta span{border:1px solid #DBEAFE;background:#fff;border-radius:999px;padding:5px 9px;font-weight:800;}
.quote-list-panel{margin-top:12px;border:1px solid #DDEAFE;background:#fff;border-radius:13px;overflow:hidden;}
.quote-list-head{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 12px;background:#F8FAFC;border-bottom:1px solid #E2E8F0;}
.quote-list-items{display:flex;flex-direction:column;max-height:380px;overflow:auto;}
.quote-list-item{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;border-bottom:1px solid #EEF2F7;padding:9px;align-items:stretch;}
.quote-list-item:last-child{border-bottom:0;}
.quote-list-item.active{background:#EFF6FF;}
.quote-list-main{border:0;background:transparent;text-align:left;padding:4px;cursor:pointer;font-family:inherit;min-width:0;}
.quote-list-title{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:4px;}
.quote-list-title strong{font-size:13.5px;color:#0F172A;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.quote-list-title span{font-size:11px;font-weight:900;color:#1D4ED8;background:#DBEAFE;border-radius:999px;padding:3px 7px;white-space:nowrap;}
.quote-list-sub{display:flex;gap:8px;flex-wrap:wrap;font-size:11.5px;color:#64748B;margin-bottom:5px;}
.quote-list-total{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:12px;color:#64748B;}
.quote-list-total strong{font-size:13px;color:#0F172A;}
.quote-delete-btn{border:1px solid #FECACA;background:#FEF2F2;color:#B91C1C;border-radius:9px;width:30px;font-weight:900;cursor:pointer;font-size:18px;}
.quote-delete-btn:hover{background:#FEE2E2;}
@media(max-width:860px){.quote-cloud-head{flex-direction:column}.quote-cloud-actions{justify-content:flex-start}.quote-cloud-actions .btn-primary,.quote-cloud-actions .btn-ghost{width:auto}.quote-list-title,.quote-list-total{align-items:flex-start;flex-direction:column}}


/* Phase 6 — manual billing */
.manual-payment-card,.billing-events-card{border:1px solid #E0E7FF;background:linear-gradient(180deg,#F8FAFF,#FFFFFF);border-radius:16px;padding:16px;margin:14px 0;display:flex;align-items:flex-start;justify-content:space-between;gap:16px;}
.manual-payment-card h2,.billing-events-card h2{margin:0 0 4px;color:#0F172A;}
.manual-payment-card p,.billing-events-card p{margin:0;color:#64748B;font-size:13px;line-height:1.45;}
.manual-payment-form{display:flex;flex-direction:column;gap:8px;min-width:320px;max-width:460px;flex:1;}
.manual-payment-form input{border:1px solid #CBD5E1;border-radius:11px;padding:10px 11px;font-size:13px;font-family:inherit;background:#fff;}
.cycle-toggle{display:inline-flex;border:1px solid #DDE7F0;background:#fff;border-radius:999px;padding:3px;gap:3px;width:max-content;}
.cycle-toggle button{border:0;background:transparent;border-radius:999px;padding:7px 11px;font-size:12px;font-weight:900;color:#64748B;cursor:pointer;font-family:inherit;}
.cycle-toggle button.active{background:#DCFCE7;color:#166534;}
.price-sub{margin:0 0 8px;color:#64748B;font-size:12px;font-weight:800;}
.payment-code{border:1px solid #FDE68A;background:#FFFBEB;color:#92400E;border-radius:10px;padding:8px 9px;font-size:12px;line-height:1.4;}
.payment-code b{display:block;color:#7C2D12;font-size:13px;margin-top:2px;}
.upgrade-status{border:1px solid #BBF7D0;background:#F0FDF4;color:#166534;border-radius:12px;padding:10px 12px;font-size:13px;font-weight:850;margin:12px 0;}
.billing-events-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;width:100%;}
.billing-events-card{flex-direction:column;}
.billing-events-list{display:flex;flex-direction:column;gap:8px;width:100%;}
.billing-event-row{display:flex;align-items:center;justify-content:space-between;gap:12px;border:1px solid #EEF2F7;background:#fff;border-radius:12px;padding:10px 12px;}
.billing-event-row strong{display:block;font-size:13px;color:#0F172A;margin-bottom:3px;}
.billing-event-row span{display:block;font-size:12px;color:#64748B;}
.billing-event-row em{display:block;font-style:normal;font-size:12px;color:#92400E;background:#FFFBEB;border-radius:8px;padding:5px 7px;margin-top:5px;}
.billing-event-right{text-align:right;display:flex;flex-direction:column;gap:5px;align-items:flex-end;}
.billing-event-right b{font-size:14px;color:#0F172A;}
.billing-status{font-style:normal;border-radius:999px;padding:3px 7px;font-size:11px;font-weight:950;background:#F1F5F9;color:#475569;text-transform:uppercase;}
.billing-status.pending{background:#FEF3C7;color:#92400E;}
.billing-status.paid{background:#DBEAFE;color:#1D4ED8;}
.billing-status.approved,.billing-status.activated{background:#DCFCE7;color:#166534;}
.billing-status.rejected,.billing-status.canceled{background:#FEE2E2;color:#991B1B;}
@media(max-width:860px){.manual-payment-card{flex-direction:column}.manual-payment-form{min-width:0;width:100%}.billing-event-row{align-items:flex-start;flex-direction:column}.billing-event-right{text-align:left;align-items:flex-start}.cycle-toggle{width:100%;}.cycle-toggle button{flex:1;}}
/* Phase 10 — capability gate */
.capability-mini-list{display:flex;flex-direction:column;gap:4px;margin:8px 0 12px;font-size:11.5px;color:#475569;line-height:1.35;}
.capability-mini-list span{display:block;}



/* Phase 8 — Product Enrichment */
.enrich-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(360px,1fr));gap:12px;margin-top:14px;max-height:62vh;overflow:auto;padding-right:4px;}
.enrich-card{border:1px solid #E2E8F0;background:#fff;border-radius:16px;padding:12px;box-shadow:0 10px 28px rgba(15,23,42,.04);}
.enrich-head{display:flex;gap:12px;align-items:flex-start;margin-bottom:10px;}
.enrich-titlebox{min-width:0;display:flex;flex-direction:column;gap:4px;}
.enrich-titlebox strong{font-size:14px;color:#0F172A;line-height:1.3;}
.enrich-titlebox span{font-size:12px;color:#64748B;}
.enrich-edit-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:8px;}
.enrich-edit-grid .field span{font-size:11px;}
.enrich-edit-grid input{padding:8px 9px;font-size:12.5px;}
.enrich-reasons{display:flex;gap:5px;flex-wrap:wrap;margin:10px 0 8px;}
.enrich-reasons span{font-size:11px;font-weight:850;color:#166534;background:#F0FDF4;border:1px solid #BBF7D0;border-radius:999px;padding:4px 7px;}
.enrich-reasons span.warn{color:#92400E;background:#FFFBEB;border-color:#FDE68A;}
.enrich-actions{display:flex;align-items:center;justify-content:space-between;gap:10px;border-top:1px solid #F1F5F9;padding-top:9px;}
@media(max-width:860px){.enrich-grid{grid-template-columns:1fr;max-height:none}.enrich-edit-grid{grid-template-columns:1fr}.enrich-actions{align-items:flex-start;flex-direction:column}.enrich-actions .btn-primary{width:100%!important}}



/* Phase 9 — Quote Template Customization */
.quote-template-page .section-card{border-color:#E9D5FF;background:linear-gradient(180deg,#FAF5FF,#FFFFFF);}
.quote-template-presets{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:10px;}
.quote-template-presets button{border:1px solid #E2E8F0;background:#fff;border-radius:14px;padding:12px;text-align:left;cursor:pointer;font-family:inherit;display:flex;flex-direction:column;gap:5px;min-height:94px;}
.quote-template-presets button strong{font-size:13px;color:#0F172A;}
.quote-template-presets button span{font-size:12px;color:#64748B;line-height:1.35;}
.quote-template-presets button.active{border-color:#7C3AED;background:#F3E8FF;box-shadow:0 10px 24px rgba(124,58,237,.08);}
.quote-template-toggles{display:flex;flex-wrap:wrap;gap:8px;}
.qt-toggle{display:inline-flex;align-items:center;gap:7px;border:1px solid #E2E8F0;background:#fff;border-radius:999px;padding:8px 10px;font-size:12.5px;font-weight:800;color:#334155;cursor:pointer;}
.qt-toggle input{accent-color:#7C3AED;}
.quote-template-page textarea{border:1px solid #CBD5E1;border-radius:10px;padding:9px 10px;font-size:13px;font-family:inherit;resize:vertical;background:#fff;}
.quote-template-page select{border:1px solid #CBD5E1;border-radius:10px;padding:9px 10px;font-size:13px;font-family:inherit;background:#fff;}
@media(max-width:860px){.quote-template-presets{grid-template-columns:1fr}.quote-template-toggles{gap:6px}.qt-toggle{width:100%;border-radius:12px}}

/* UpgradePage redesign — Gói & Sử dụng */
.plan-page{max-width:1080px;margin:0 auto;padding:26px 20px 60px;}
.pp-head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin-bottom:22px;}
.pp-head h1{font-size:var(--fs-2xl,28px);margin:0 0 4px;letter-spacing:-.02em;}
.pp-head p{margin:0;color:var(--c-muted);font-size:var(--fs-md);max-width:520px;}
.pp-back{border:1px solid var(--c-line);background:#fff;color:var(--c-text,#1a2233);border-radius:10px;padding:8px 14px;font-size:var(--fs-sm);font-weight:600;cursor:pointer;font-family:inherit;white-space:nowrap;}
.pp-back:hover{background:var(--c-bg,#f7f8fb);}
.pp-locked{background:var(--c-warn-bg,#fff8e6);border:1px solid var(--c-warn-line,#f0c000);color:#8a5a00;border-radius:10px;padding:12px 16px;font-size:var(--fs-sm);margin-bottom:18px;}

.pp-current{background:#fff;border:1px solid var(--c-line);border-radius:16px;padding:20px 22px;margin-bottom:26px;box-shadow:0 1px 2px rgba(20,30,60,.04);}
.pp-current-top{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:16px;}
.pp-lbl{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--c-muted);font-weight:700;}
.pp-plan{font-size:22px;font-weight:750;margin-top:2px;}
.pp-renew{font-size:var(--fs-sm);color:var(--c-muted);}
.pp-meters{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:16px 26px;}
.pp-meter-top{display:flex;justify-content:space-between;font-size:var(--fs-sm);margin-bottom:6px;}
.pp-meter-top span{color:var(--c-muted);}
.pp-meter-top b{font-variant-numeric:tabular-nums;}
.pp-bar{height:7px;border-radius:99px;background:#eef0f4;overflow:hidden;}
.pp-bar>i{display:block;height:100%;border-radius:99px;background:var(--c-primary);}
.pp-bar.warn>i{background:var(--c-warn,#c98a00);}
.pp-meter.unlimited b{color:var(--c-ok,#1a9e6a);}
.pp-meter.unlimited .pp-bar>i{opacity:.35;}

.pp-cycle-row{display:flex;justify-content:center;margin-bottom:20px;}
.pp-cycle{display:inline-flex;background:#eef0f4;border-radius:99px;padding:4px;gap:2px;}
.pp-cycle button{border:none;background:transparent;padding:8px 18px;border-radius:99px;font-size:var(--fs-sm);font-weight:650;color:var(--c-muted);cursor:pointer;font-family:inherit;}
.pp-cycle button.active{background:#fff;color:var(--c-text,#1a2233);box-shadow:0 1px 2px rgba(20,30,60,.12);}
.pp-save{color:var(--c-ok,#1a9e6a);font-weight:700;font-size:11px;margin-left:6px;}

.pp-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;}
@media(max-width:900px){.pp-grid{grid-template-columns:repeat(2,1fr);}}
@media(max-width:560px){.pp-grid{grid-template-columns:1fr;}.pp-head{flex-direction:column;}}
.pp-card{background:#fff;border:1px solid var(--c-line);border-radius:16px;padding:22px 20px;display:flex;flex-direction:column;position:relative;box-shadow:0 1px 2px rgba(20,30,60,.04);}
.pp-card.popular{border-color:var(--c-primary);box-shadow:0 6px 24px rgba(27,79,216,.12);}
.pp-badge{position:absolute;top:-11px;left:20px;background:var(--c-primary);color:#fff;font-size:11px;font-weight:700;padding:3px 10px;border-radius:99px;}
.pp-badge.cur{left:auto;right:20px;background:var(--c-text,#1a2233);}
.pp-card h3{margin:0;font-size:var(--fs-lg);font-weight:750;}
.pp-tag{color:var(--c-muted);font-size:11px;margin:2px 0 14px;min-height:14px;}
.pp-price{display:flex;align-items:baseline;gap:4px;}
.pp-num{font-size:25px;font-weight:800;letter-spacing:-.02em;font-variant-numeric:tabular-nums;}
.pp-per{color:var(--c-muted);font-size:var(--fs-sm);}
.pp-price-sub{color:var(--c-muted);font-size:12px;min-height:15px;margin:2px 0 16px;}
.pp-feats{list-style:none;padding:0;margin:0 0 18px;display:flex;flex-direction:column;gap:9px;flex:1;}
.pp-feats li{font-size:var(--fs-sm);line-height:1.35;}
.pp-feats li.off{color:#aab0bd;}
.pp-cta{border:none;border-radius:10px;padding:11px;font-size:var(--fs-sm);font-weight:700;cursor:pointer;font-family:inherit;width:100%;}
.pp-cta.primary{background:var(--c-primary);color:#fff;}
.pp-cta.primary:hover{background:var(--c-primary-dark);}
.pp-cta.ghost{background:#fff;border:1px solid var(--c-line);color:var(--c-text,#1a2233);}
.pp-cta.ghost:hover{background:var(--c-bg,#f7f8fb);}
.pp-cta:disabled{background:var(--c-bg,#f7f8fb);color:var(--c-muted);border:1px solid var(--c-line);cursor:default;}

.pp-status{margin-top:16px;background:var(--c-primary-soft,#EEF4FF);border:1px solid var(--c-primary);color:var(--c-primary-dark,#143AA6);border-radius:10px;padding:10px 14px;font-size:var(--fs-sm);}

.pp-more{margin-top:28px;background:#fff;border:1px solid var(--c-line);border-radius:12px;}
.pp-more>summary{cursor:pointer;list-style:none;padding:15px 20px;font-weight:650;font-size:var(--fs-md);display:flex;justify-content:space-between;align-items:center;}
.pp-more>summary::-webkit-details-marker{display:none;}
.pp-chev{color:var(--c-muted);transition:transform .2s;}
.pp-more[open]>summary .pp-chev{transform:rotate(180deg);}
.pp-more-body{padding:4px 20px 20px;border-top:1px solid var(--c-line);}
.pp-pay{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin:14px 0;font-size:var(--fs-sm);}
.pp-pay .k{color:var(--c-muted);font-size:11px;}
.pp-note{font-size:12px;color:var(--c-muted);margin-top:6px;}
.pp-hist-head{display:flex;justify-content:space-between;align-items:center;margin:16px 0 8px;font-weight:650;font-size:var(--fs-sm);}
.pp-hist{display:flex;flex-direction:column;gap:8px;}
.pp-hist-row{display:flex;justify-content:space-between;align-items:center;padding:10px 12px;background:var(--c-bg,#f7f8fb);border-radius:10px;font-size:var(--fs-sm);}
.pp-hist-row span{display:block;color:var(--c-muted);font-size:12px;margin-top:2px;}
.pp-hist-right{text-align:right;}
.pp-st{font-size:11px;font-weight:700;padding:2px 8px;border-radius:99px;font-style:normal;display:inline-block;margin-top:2px;}
.pp-st.paid,.pp-st.active{background:#e7f6ee;color:var(--c-ok,#1a9e6a);}
.pp-st.pending{background:var(--c-warn-bg,#fff8e6);color:var(--c-warn,#c98a00);}

.pp-modal-bg{position:fixed;inset:0;background:rgba(20,28,50,.4);display:flex;align-items:center;justify-content:center;padding:20px;z-index:100;}
.pp-modal{background:#fff;border-radius:16px;padding:24px;width:100%;max-width:400px;box-shadow:0 20px 60px rgba(20,30,60,.25);}
.pp-modal h3{margin:0 0 4px;font-size:var(--fs-xl,20px);}
.pp-modal-price{font-size:22px;font-weight:800;}
.pp-modal-price span{font-size:14px;color:var(--c-muted);font-weight:500;}
.pp-modal input{width:100%;border:1px solid var(--c-line);border-radius:10px;padding:10px 12px;font-size:var(--fs-sm);margin-top:8px;font-family:inherit;}
.pp-modal-actions{display:flex;gap:10px;margin-top:14px;}

/* === SmartQuote SaaS Design System refresh — source: smartquote_saas_redesign.html === */
:root{
  /* màu — có chức năng, không trang trí */
  --ink:#16181D;--ink-2:#3A3F49;--muted:#6B7280;--faint:#9AA1AD;
  --line:#E8EAED;--hair:#F0F2F5;--canvas:#F6F7F9;--card:#FFFFFF;--rail:#FBFBFC;
  --primary:#2947E0;--primary-d:#1E37B8;--primary-soft:#EDF0FE;--primary-ring:rgba(41,71,224,.18);
  --amber:#B7791F;--amber-bg:#FDF6E7;--amber-line:#F2D999;
  --green:#0F9D63;--green-bg:#E9F7F0;
  --red:#D64545;--red-bg:#FEF2F2;

  /* font + type scale */
  --f:"Be Vietnam Pro",-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
  --fs-xs:11.5px;--fs-sm:13px;--fs-md:14px;--fs-lg:16px;--fs-xl:20px;--fs-2xl:26px;--fs-3xl:32px;

  /* spacing + geometry */
  --sp-1:4px;--sp-2:8px;--sp-3:12px;--sp-4:16px;--sp-5:24px;--sp-6:32px;
  --r-sm:6px;--r-md:12px;--r-lg:14px;--r-btn:10px;--r-card:14px;--r-pill:999px;
  --sh-1:0 1px 2px rgba(20,25,45,.05);--sh-2:0 8px 28px rgba(20,25,45,.10);

  /* aliases cho code cũ — giữ tương thích nhưng chỉ còn một nguồn token */
  --c-primary:var(--primary);--c-primary-dark:var(--primary-d);--c-primary-soft:var(--primary-soft);
  --c-text:var(--ink);--c-muted:var(--muted);--c-line:var(--line);--c-bg:var(--canvas);
  --c-ok:var(--green);--c-success:var(--green);--c-success-bg:var(--green-bg);
  --c-warn:var(--amber);--c-warn-bg:var(--amber-bg);--c-warn-line:var(--amber-line);
  --c-danger:var(--red);--c-danger-bg:var(--red-bg);
  --bg:var(--canvas);--surface:var(--card);--surface2:#FCFCFD;--line2:#D8DCE3;
  --text:var(--ink);--text2:var(--muted);--brand:var(--primary);--brand-d:var(--primary-d);--brand-soft:var(--primary-soft);
  --pos:var(--green);--pos-bg:var(--green-bg);--neg:var(--red);--neg-bg:var(--red-bg);--warn:var(--amber);--warn-bg:var(--amber-bg);
  --radius:var(--r-md);--radius-lg:var(--r-card);
}
html,body{margin:0;background:var(--canvas);color:var(--ink);font-family:var(--f);font-size:var(--fs-md);-webkit-font-smoothing:antialiased;line-height:1.5;}
button,input,select,textarea{font-family:inherit;}
button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible{outline:none;box-shadow:0 0 0 3px var(--primary-ring);border-color:var(--primary)!important;}
.num,.line-table .num,.cat-table .num,.s-total,.pp-num,.pp-price,.money{font-variant-numeric:tabular-nums;font-feature-settings:"tnum" 1;}

.app.app-shell{display:grid;grid-template-columns:236px minmax(0,1fr);min-height:100vh;background:var(--canvas);color:var(--ink);font-family:var(--f);font-size:var(--fs-md);}
.app-shell .rail{background:var(--rail);border-right:1px solid var(--line);display:flex;flex-direction:column;padding:16px 12px;position:sticky;top:0;height:100vh;z-index:30;}
.app-shell .brand{display:flex;align-items:center;gap:9px;padding:6px 8px 18px;margin:0;color:var(--ink);}
.app-shell .brand-mark{width:28px;height:28px;border-radius:8px;background:linear-gradient(135deg,var(--primary),#5B76F0);display:grid;place-items:center;color:#fff;box-shadow:0 2px 8px var(--primary-ring);flex:none;}
.app-shell .brand-name{font-weight:800;font-size:var(--fs-lg);letter-spacing:-.02em;}
.app-shell .brand-name span{color:var(--primary);}
.app-shell .nav{display:flex;flex-direction:column;gap:2px;margin-top:4px;}
.app-shell .nav-group{display:flex;flex-direction:column;gap:1px;}
.app-shell .nav button{display:flex;align-items:center;gap:10px;padding:9px 10px;border-radius:9px;color:var(--ink-2);background:transparent;border:0;text-decoration:none;font-size:var(--fs-sm);font-weight:600;text-align:left;cursor:pointer;}
.app-shell .nav button svg{color:var(--faint);flex:none;width:17px;height:17px;}
.app-shell .nav button:hover{background:#fff;}
.app-shell .nav button.active{background:var(--primary-soft);color:var(--primary-d);}
.app-shell .nav button.active svg{color:var(--primary);}
.app-shell .nav .sub-nav{position:static;box-shadow:none;border:0;background:transparent;margin:2px 0 6px 34px;padding:0;display:flex;flex-direction:column;gap:1px;}
.app-shell .nav .sub-nav button{padding:6px 10px;font-weight:500;font-size:12.5px;color:var(--muted);border-radius:8px;background:transparent;border:0;}
.app-shell .nav .sub-nav button.active{background:transparent;color:var(--primary-d);font-weight:700;}
.app-shell .spacer{flex:1;}
.usage-mini{background:#fff;border:1px solid var(--line);border-radius:12px;padding:12px;box-shadow:var(--sh-1);}
.usage-mini .um-top{display:flex;justify-content:space-between;align-items:center;margin-bottom:9px;gap:8px;}
.usage-mini .plan{font-weight:700;font-size:var(--fs-sm);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.usage-mini .tag{font-size:10.5px;font-weight:700;color:var(--primary);background:var(--primary-soft);padding:2px 7px;border-radius:var(--r-pill);white-space:nowrap;}
.um-row{font-size:11.5px;color:var(--muted);display:flex;justify-content:space-between;margin-bottom:4px;gap:8px;}
.um-bar{height:5px;background:#EEF0F4;border-radius:99px;overflow:hidden;margin-bottom:9px;}
.um-bar>i{display:block;height:100%;background:var(--primary);border-radius:99px;}
.um-bar.warn>i{background:var(--amber);}
.usage-mini .up{width:100%;margin-top:4px;border:none;background:var(--ink);color:#fff;border-radius:8px;padding:8px;font-size:12px;font-weight:700;cursor:pointer;}

.app-shell>.main.shell-main{display:flex;flex-direction:column;min-width:0;max-width:none;margin:0;padding:0;background:var(--canvas);}
.app-shell .topbar{height:60px;background:rgba(246,247,249,.85);backdrop-filter:blur(8px);border-bottom:1px solid var(--line);display:flex;align-items:center;justify-content:space-between;padding:0 24px;position:sticky;top:0;z-index:20;gap:16px;}
.topbar .crumb{font-size:var(--fs-lg);font-weight:750;letter-spacing:-.01em;white-space:nowrap;}
.topbar .crumb small{color:var(--faint);font-weight:500;margin-left:8px;font-size:13px;}
.topbar-right{display:flex;align-items:center;gap:10px;min-width:0;}
.cloud-status{font-size:12px;color:var(--muted);max-width:170px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.btn{border-radius:var(--r-btn);font-weight:700;font-size:var(--fs-sm);padding:9px 15px;border:1px solid transparent;cursor:pointer;white-space:nowrap;}
.btn.primary{background:var(--primary);color:#fff;}
.btn.primary:hover{background:var(--primary-d);}
.btn.ghost{background:#fff;border-color:var(--line);color:var(--ink);}
.btn.ghost:hover{background:var(--hair);}
.avatar{width:32px;height:32px;border-radius:50%;background:linear-gradient(135deg,#0F9D63,#5BD3A0);color:#fff;display:grid;place-items:center;font-weight:700;font-size:13px;flex:none;}
.smartquote-content{padding:24px;display:block;max-width:1180px;width:100%;margin:0;}
.smartquote-content>.plan-banner{margin-bottom:16px;}

.card{background:var(--card);border:1px solid var(--line);border-radius:var(--r-card);box-shadow:var(--sh-1);}
.card h2,.sec-title{font-size:12px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--faint);margin:0 0 12px;}
.field input,.field select,.field textarea,input,select,textarea{border-color:var(--line);border-radius:10px;}
.line-table,.cat-table{width:100%;border-collapse:collapse;}
.line-table th,.cat-table th{text-align:left;font-size:11px;font-weight:650;color:var(--faint);text-transform:uppercase;letter-spacing:.04em;padding:9px 12px;border-bottom:1px solid var(--hair);background:#FCFCFD;}
.line-table th.num,.cat-table th.num,.line-table td.num,.cat-table td.num{text-align:right;}
.line-table td,.cat-table td{padding:11px 12px;border-bottom:1px solid var(--hair);font-size:var(--fs-sm);vertical-align:middle;}
.import-warning-badge,.flag,.ci-status.warn{color:var(--amber);background:var(--amber-bg);border:1px solid var(--amber-line);}

.quote-grid{display:grid;grid-template-columns:minmax(0,1fr) 320px;gap:20px;align-items:start;max-width:1180px;}
.quote-side{position:sticky;top:84px;}
.quote-main>.card:first-child{padding:18px 20px;}
.room-card{border-radius:var(--r-card);box-shadow:var(--sh-1);overflow:hidden;}
.room-card .room-head{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;background:#FCFCFD;border-bottom:1px solid var(--hair);}
.room-card .room-head:before{content:"";width:8px;height:8px;border-radius:3px;background:var(--primary);margin-right:10px;flex:none;}
.room-name{font-size:var(--fs-md);font-weight:700;color:var(--ink);}
.btn-add-room{margin-top:14px;width:100%;border:1.5px dashed var(--line);background:#fff;color:var(--primary);border-radius:12px;padding:12px;font-weight:700;font-size:var(--fs-sm);}
.btn-add-room:hover{border-color:var(--primary);background:var(--primary-soft);}
.summary{padding:0;margin:0;overflow:hidden;}
.summary .s-body{padding:20px;}
.s-lbl{font-size:12px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--faint);}
.s-total{font-size:var(--fs-3xl);font-weight:800;letter-spacing:-.02em;margin:2px 0;line-height:1.12;color:var(--ink);}
.s-total small{font-size:16px;color:var(--muted);font-weight:600;}
.s-margin{display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:700;color:var(--green);background:var(--green-bg);padding:3px 9px;border-radius:var(--r-pill);}
.s-rows{margin:16px 0;border-top:1px solid var(--hair);padding-top:14px;}
.s-row,.summary .sum-row{display:flex;justify-content:space-between;font-size:13px;color:var(--muted);padding:5px 0;border:0;}
.s-row b,.summary .sum-row b{color:var(--ink);font-weight:600;}
.s-row.big{font-size:var(--fs-md);color:var(--ink);font-weight:700;border-top:1px solid var(--hair);margin-top:6px;padding-top:12px;}
.s-actions{display:flex;flex-direction:column;gap:9px;}
.s-actions .btn.primary{width:100%;padding:12px;font-size:var(--fs-md);}
.s-actions .row2{display:flex;gap:9px;}
.s-actions .row2 .btn{flex:1;}
.side-note{font-size:12px;color:var(--muted);line-height:1.5;margin:12px 0 0;}

@media(max-width:1080px){
  .app.app-shell{grid-template-columns:64px minmax(0,1fr);}
  .app-shell .rail{padding:14px 8px;}
  .app-shell .brand-name,.app-shell .nav button span,.app-shell .nav .sub-nav,.usage-mini{display:none;}
  .app-shell .brand{justify-content:center;padding:6px 0 18px;}
  .app-shell .nav button{justify-content:center;padding:10px;}
  .smartquote-content{padding:20px;}
  .quote-grid{grid-template-columns:1fr;}
  .quote-side{position:static;}
}
@media(max-width:640px){
  .app.app-shell{grid-template-columns:1fr;}
  .app-shell .rail{position:static;height:auto;flex-direction:row;align-items:center;overflow:auto;border-right:0;border-bottom:1px solid var(--line);}
  .app-shell .brand{padding:0 8px 0 0;}
  .app-shell .nav{flex-direction:row;}
  .topbar{padding:0 14px;}
  .topbar .crumb small,.cloud-status,.plan-pill{display:none;}
  .topbar-right{gap:6px;}
  .btn{padding:8px 10px;}
  .smartquote-content{padding:14px;}
}


/* Phase 11 — Solution Family / Brand Option Engine */
.solution-page{display:flex;flex-direction:column;gap:16px;}
.solution-hero .section-card-head{display:flex;justify-content:space-between;align-items:center;gap:12px;}
.solution-head-actions{display:flex;gap:8px;flex-wrap:wrap;}
.solution-layout{display:grid;grid-template-columns:280px minmax(0,1fr);gap:16px;align-items:start;}
.solution-list{padding:12px;position:sticky;top:84px;}
.solution-list-title{font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:var(--faint);margin:2px 4px 10px;}
.solution-card{width:100%;display:flex;flex-direction:column;align-items:flex-start;gap:3px;text-align:left;border:1px solid transparent;background:#fff;border-radius:12px;padding:11px 12px;margin-bottom:7px;color:var(--ink);cursor:pointer;}
.solution-card:hover{border-color:var(--line);background:#FCFCFD;}
.solution-card.active{border-color:var(--primary);background:var(--primary-soft);}
.solution-card strong{font-size:13.5px;}
.solution-card span{font-size:12px;color:var(--muted);}
.solution-card em{font-style:normal;font-size:11px;color:var(--primary-d);font-weight:700;}
.solution-editor{padding:18px 20px;overflow:hidden;}
.solution-editor-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:14px;}
.solution-editor-head h2{font-size:var(--fs-xl);font-weight:800;color:var(--ink);text-transform:none;letter-spacing:-.02em;margin:0 0 3px;}
.solution-editor-head p{margin:0;color:var(--muted);font-size:var(--fs-sm);}
.solution-editor-actions{display:flex;gap:8px;}
.solution-meta-grid{margin-bottom:18px;}
.solution-matrix-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin:8px 0 10px;}
.solution-matrix-head h3{margin:0 0 3px;font-size:var(--fs-lg);}
.solution-matrix-head p{margin:0;color:var(--muted);font-size:var(--fs-sm);}
.sf-badge{display:inline-flex;align-items:center;border-radius:999px;padding:4px 9px;font-size:11.5px;font-weight:800;white-space:nowrap;}
.sf-badge.ok{color:var(--green);background:var(--green-bg);}
.sf-badge.warn{color:var(--amber);background:var(--amber-bg);border:1px solid var(--amber-line);}
.solution-table-wrap{overflow:auto;border:1px solid var(--line);border-radius:12px;}
.solution-table{width:100%;min-width:980px;border-collapse:collapse;background:#fff;}
.solution-table th{font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:var(--faint);text-align:left;background:#FCFCFD;border-bottom:1px solid var(--hair);padding:9px 10px;}
.solution-table td{border-bottom:1px solid var(--hair);padding:9px 10px;font-size:var(--fs-sm);vertical-align:top;}
.solution-table tr:last-child td{border-bottom:0;}
.solution-table tr.missing{background:var(--amber-bg);}
.solution-table input,.solution-table select{width:100%;border:1px solid var(--line);border-radius:8px;padding:7px 8px;font-size:12.5px;background:#fff;}
.solution-table .qty-mini{width:64px;text-align:right;}
.solution-match-cell{min-width:180px;}
.solution-match-cell b{display:block;font-size:12.5px;line-height:1.25;}
.solution-match-cell span{display:block;font-size:11.5px;color:var(--muted);margin-top:2px;}
.missing-text{color:var(--amber)!important;font-weight:800;}
.btn-solution-family{border:1.5px dashed var(--primary);background:var(--primary-soft);color:var(--primary-d);border-radius:12px;padding:12px 14px;font-weight:800;font-size:var(--fs-sm);cursor:pointer;}
.btn-solution-family:hover{background:#fff;border-color:var(--primary-d);}
.solution-apply-modal{width:min(1080px,96vw);max-width:1080px;max-height:86vh;overflow:auto;}
.solution-modal-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;margin-bottom:12px;}
.solution-modal-head h2{margin:0 0 4px;}
.solution-modal-head p{margin:0;color:var(--muted);font-size:var(--fs-sm);}
.solution-apply-grid{display:grid;grid-template-columns:260px minmax(0,1fr);gap:16px;}
.solution-apply-list{display:flex;flex-direction:column;gap:8px;}
.solution-family-pick{border:1px solid var(--line);background:#fff;border-radius:12px;padding:11px 12px;text-align:left;display:flex;flex-direction:column;gap:3px;}
.solution-family-pick.active{border-color:var(--primary);background:var(--primary-soft);}
.solution-family-pick strong{font-size:13.5px;}
.solution-family-pick span{font-size:12px;color:var(--muted);}
.solution-family-pick em{font-style:normal;font-size:11px;color:var(--primary-d);font-weight:700;}
.solution-apply-preview{border:1px solid var(--line);border-radius:14px;padding:14px;background:#fff;min-width:0;}
.solution-preview-title{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;border-bottom:1px solid var(--hair);padding-bottom:12px;margin-bottom:10px;}
.solution-preview-title h3{font-size:var(--fs-lg);margin:0 0 3px;}
.solution-preview-title p{margin:0;color:var(--muted);font-size:var(--fs-sm);}
.solution-preview-rows{display:flex;flex-direction:column;gap:6px;max-height:420px;overflow:auto;}
.solution-preview-row{display:grid;grid-template-columns:210px minmax(0,1fr);gap:12px;border:1px solid var(--hair);border-radius:10px;padding:9px 10px;}
.solution-preview-row.missing{background:var(--amber-bg);border-color:var(--amber-line);}
.solution-preview-row strong{display:block;font-size:13px;}
.solution-preview-row span,.solution-preview-product small{display:block;color:var(--muted);font-size:12px;margin-top:2px;}
.solution-preview-product b{display:block;font-size:13px;line-height:1.3;}
.solution-warning{margin-top:10px;border:1px solid var(--amber-line);background:var(--amber-bg);color:var(--amber);border-radius:10px;padding:9px 11px;font-size:12.5px;font-weight:700;}
.solution-modal-actions{display:flex;justify-content:flex-end;gap:9px;margin-top:14px;}
@media(max-width:900px){.solution-layout,.solution-apply-grid{grid-template-columns:1fr}.solution-list{position:static}.solution-preview-row{grid-template-columns:1fr}.solution-modal-actions{flex-direction:column}.solution-modal-actions button{width:100%;}}


/* Phase 12 — Excel Quote Template Import */
.excel-template-section .section-card-body{display:flex;flex-direction:column;gap:14px;}
.excel-template-actions{display:flex;gap:9px;flex-wrap:wrap;align-items:center;}
.excel-template-empty{border:1px dashed var(--line);background:var(--canvas);border-radius:12px;padding:14px 16px;color:var(--muted);font-size:var(--fs-sm);}
.excel-template-editor{border:1px solid var(--line);border-radius:14px;padding:14px;background:#fff;display:flex;flex-direction:column;gap:14px;}
.excel-map-grid{display:grid;grid-template-columns:1fr 1.2fr;gap:16px;align-items:start;}
.excel-map-grid h4,.excel-map-totals h4{margin:0 0 8px;font-size:var(--fs-sm);font-weight:800;color:var(--ink);}
.field-grid.compact{gap:9px;}
.field-grid.compact .field span{font-size:11px;}
.excel-template-export-box{border:1px solid var(--line);background:var(--canvas);border-radius:12px;padding:10px;display:flex;flex-direction:column;gap:7px;margin-top:2px;}
.excel-template-export-box label{font-size:11.5px;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;}
.excel-template-export-box select{width:100%;border:1px solid var(--line);border-radius:9px;padding:8px 10px;font-size:var(--fs-sm);font-family:inherit;background:#fff;}
.excel-template-export-hint{font-size:11.5px;color:var(--muted);line-height:1.4;}
.excel-smart-detect-card{border:1px solid var(--line);background:var(--primary-soft);border-radius:14px;padding:13px 14px;display:flex;flex-direction:column;gap:10px;}
.excel-smart-top{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;}
.excel-smart-top strong{display:block;font-size:var(--fs-md);font-weight:800;color:var(--ink);}
.excel-smart-top span{display:block;color:var(--muted);font-size:var(--fs-sm);margin-top:2px;}
.excel-detect-summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;}
.excel-detect-summary>div{background:#fff;border:1px solid var(--line);border-radius:10px;padding:9px;}
.excel-detect-summary b{display:block;font-size:18px;font-weight:850;color:var(--primary-d);font-variant-numeric:tabular-nums;}
.excel-detect-summary span{display:block;font-size:11.5px;color:var(--muted);}
.excel-detect-notes{margin:0;padding-left:18px;color:var(--ink-2);font-size:var(--fs-sm);}
.excel-advanced-map{border:1px solid var(--line);border-radius:12px;background:#fff;overflow:hidden;}
.excel-advanced-map>summary{cursor:pointer;padding:12px 14px;font-size:var(--fs-sm);font-weight:800;display:flex;justify-content:space-between;gap:12px;align-items:center;}
.excel-advanced-map>summary span{font-weight:600;color:var(--muted);font-size:12px;}
.excel-advanced-map[open]>summary{border-bottom:1px solid var(--line);}
.excel-advanced-map .excel-map-grid,.excel-advanced-map .excel-map-totals{padding:14px;}
@media(max-width:760px){.excel-detect-summary{grid-template-columns:repeat(2,minmax(0,1fr));}.excel-smart-top{flex-direction:column;}}
.excel-click-map-card{border:1px solid var(--line);border-radius:14px;background:#fff;padding:13px 14px;display:flex;flex-direction:column;gap:10px;}
.excel-click-map-head strong{display:block;font-size:var(--fs-md);font-weight:800;color:var(--ink);}
.excel-click-map-head span{display:block;font-size:var(--fs-sm);color:var(--muted);margin-top:2px;}
.excel-picker-buttons{display:flex;flex-wrap:wrap;gap:7px;}
.excel-picker-buttons button{border:1px solid var(--line);background:#fff;color:var(--ink);border-radius:999px;padding:6px 10px;font-size:12px;font-weight:750;}
.excel-picker-buttons button.active{background:var(--primary);border-color:var(--primary);color:#fff;}
.excel-pick-hint{background:var(--amber-bg);border:1px solid var(--amber-line);color:#7a4d00;border-radius:10px;padding:8px 10px;font-size:var(--fs-sm);}
.excel-preview-grid-wrap{max-height:320px;overflow:auto;border:1px solid var(--line);border-radius:12px;background:var(--canvas);}
.excel-preview-grid{border-collapse:separate;border-spacing:0;width:max-content;min-width:100%;font-size:12px;}
.excel-preview-grid th{position:sticky;left:0;background:var(--rail);z-index:1;color:var(--faint);font-weight:800;border-right:1px solid var(--line);min-width:42px;}
.excel-preview-grid th,.excel-preview-grid td{border-bottom:1px solid var(--hair);border-right:1px solid var(--hair);padding:5px 7px;vertical-align:top;max-width:190px;}
.excel-preview-grid td small{display:block;color:var(--faint);font-size:10px;margin-bottom:2px;}
.excel-preview-grid td span{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.excel-preview-grid td i{color:#cbd5e1;font-style:normal;}
.excel-preview-grid td.pickable{cursor:pointer;background:#fff;}
.excel-preview-grid td.pickable:hover{outline:2px solid var(--primary);outline-offset:-2px;background:var(--primary-soft);}

@media(max-width:900px){.excel-map-grid{grid-template-columns:1fr;}}


/* Phase 12.3 — Interaction Polish & Action Hierarchy */
.new-user-empty-kicker{text-transform:none;letter-spacing:.01em;font-weight:750;}
.topbar .crumb small{color:var(--muted);}
.ci-mini-ok.secondary{color:var(--ink-2);border-color:var(--line2);background:var(--surface);}
.ci-mini-ok.secondary:hover{border-color:var(--primary);color:var(--primary);background:var(--primary-soft);}
.ci-review-copy{display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;}
.ci-inline-link,.ci-review-link{border:0;background:transparent;color:var(--primary);font:inherit;font-size:12.5px;font-weight:750;padding:4px 2px;cursor:pointer;text-decoration:none;}
.ci-inline-link:hover,.ci-review-link:hover{text-decoration:underline;}
.room-pack-empty{min-height:420px;border:1px dashed var(--line2);border-radius:18px;background:var(--surface);display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:34px 28px;gap:11px;box-shadow:var(--sh-1);}
.room-pack-empty-icon{width:68px;height:68px;border-radius:18px;background:var(--primary-soft);color:var(--primary);display:grid;place-items:center;font-size:30px;font-weight:800;}
.room-pack-empty-kicker{font-size:12px;font-weight:750;color:var(--primary);}
.room-pack-empty h2{margin:0;font-size:24px;color:var(--ink);letter-spacing:-.02em;text-transform:none;}
.room-pack-empty p{margin:0;max-width:610px;color:var(--muted);font-size:14px;line-height:1.65;}
.room-pack-example{font-size:12.5px;color:var(--ink-2);background:var(--hair);border-radius:10px;padding:9px 12px;max-width:560px;}
.sq-toast-region{position:fixed;top:76px;right:20px;z-index:10050;display:flex;flex-direction:column;gap:10px;width:min(390px,calc(100vw - 28px));pointer-events:none;}
.sq-toast{pointer-events:auto;display:grid;grid-template-columns:30px minmax(0,1fr) 24px;gap:10px;align-items:start;background:#fff;border:1px solid var(--line);border-radius:14px;padding:12px 12px 12px 11px;box-shadow:0 16px 38px rgba(15,23,42,.16);animation:sqToastIn .18s ease-out;}
.sq-toast.success{border-left:4px solid var(--pos);}.sq-toast.error{border-left:4px solid var(--neg);}.sq-toast.warning{border-left:4px solid var(--amber);}.sq-toast.info{border-left:4px solid var(--primary);}
.sq-toast-mark{width:28px;height:28px;border-radius:9px;background:var(--hair);display:grid;place-items:center;font-weight:850;color:var(--ink-2);}
.sq-toast.success .sq-toast-mark{background:var(--pos-bg);color:var(--pos);}.sq-toast.error .sq-toast-mark{background:var(--neg-bg);color:var(--neg);}.sq-toast.warning .sq-toast-mark{background:var(--amber-bg);color:var(--amber);}.sq-toast.info .sq-toast-mark{background:var(--primary-soft);color:var(--primary);}
.sq-toast-body{min-width:0;display:flex;flex-direction:column;gap:3px;}.sq-toast-body strong{font-size:13px;color:var(--ink);}.sq-toast-body span{font-size:12.5px;color:var(--muted);line-height:1.45;white-space:pre-line;overflow-wrap:anywhere;}.sq-toast-body button{align-self:flex-start;border:0;background:none;color:var(--primary);font:inherit;font-size:12px;font-weight:800;padding:4px 0 0;cursor:pointer;}
.sq-toast-close{border:0;background:transparent;color:var(--faint);font-size:20px;line-height:1;cursor:pointer;padding:1px;}.sq-toast-close:hover{color:var(--ink);}
.sq-confirm-backdrop{position:fixed;inset:0;z-index:10060;background:rgba(15,23,42,.38);backdrop-filter:blur(3px);display:grid;place-items:center;padding:20px;}
.sq-confirm-modal{width:min(480px,100%);background:#fff;border:1px solid var(--line);border-radius:18px;box-shadow:0 24px 70px rgba(15,23,42,.24);padding:22px;display:grid;grid-template-columns:42px minmax(0,1fr);gap:14px;animation:sqModalIn .16s ease-out;}
.sq-confirm-icon{width:40px;height:40px;border-radius:12px;background:var(--primary-soft);color:var(--primary);display:grid;place-items:center;font-size:19px;font-weight:850;}.sq-confirm-icon.danger{background:var(--neg-bg);color:var(--neg);}
.sq-confirm-copy h2{margin:1px 0 7px;font-size:18px;letter-spacing:-.01em;text-transform:none;color:var(--ink);}.sq-confirm-copy p{margin:0;color:var(--muted);font-size:13.5px;line-height:1.6;white-space:pre-line;overflow-wrap:anywhere;}
.sq-confirm-type{grid-column:1/-1;display:grid;gap:7px;padding:12px;background:var(--hair);border-radius:12px;}.sq-confirm-type span{font-size:12px;color:var(--muted);font-weight:650;}.sq-confirm-type code{font-size:12px;color:var(--ink);font-weight:800;}.sq-confirm-type input{width:100%;background:#fff;}
.sq-confirm-actions{grid-column:1/-1;display:flex;justify-content:flex-end;gap:9px;padding-top:4px;}.sq-confirm-primary{border:0;background:var(--primary);color:#fff;border-radius:9px;padding:9px 14px;font:inherit;font-size:13px;font-weight:800;cursor:pointer;}.sq-confirm-primary:hover{background:var(--primary-d);}.sq-confirm-primary.danger{background:var(--neg);}.sq-confirm-primary:disabled{opacity:.45;cursor:not-allowed;}
@keyframes sqToastIn{from{opacity:0;transform:translateY(-6px) scale(.985)}to{opacity:1;transform:none}}@keyframes sqModalIn{from{opacity:0;transform:translateY(5px) scale(.985)}to{opacity:1;transform:none}}
@media(max-width:760px){.sq-toast-region{top:66px;right:14px}.sq-confirm-modal{padding:18px;grid-template-columns:36px minmax(0,1fr)}.sq-confirm-icon{width:34px;height:34px}.room-pack-empty{min-height:360px;padding:28px 20px}.ci-footer{align-items:flex-end;gap:12px}.ci-footer-actions{width:100%;}.ci-footer-actions .btn-primary{flex:1;}}
`;
