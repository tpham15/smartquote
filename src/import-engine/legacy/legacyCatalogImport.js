// ============================================================
// Legacy catalog/price import helpers — tách khỏi React component.
// ============================================================
import * as XLSX from "xlsx";
import { parsePdfCatalogWithPipeline } from "../pdf/pdfCatalogPipeline.js";
import { priceUpdatePreviewFromLegacy, productsToImportPreviewResult } from "../previewResult.js";
import { parseSafePrice, isLikelyNonProductRow, extractSkuFromText, cleanSupplierName } from "../productSanitizer.js";
import { inferCategory } from "../categoryInference.js";

const uid = (p = "imp") => `${p}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

/** Đoán cột theo header catalog hiện tại. */
export function guessCatalogColumnsByName(headers) {
  const m = {};
  const norm = (s) => String(s || "").toLowerCase().trim();
  headers.forEach(h => {
    const label = norm(h.label);
    const idx = String(h.idx);
    if (!m.name && /tên|sản phẩm|hàng hoá|hàng hóa|mô tả|thiết bị|vật tư|product|name|diễn giải/.test(label)) m.name = idx;
    else if (!m.sku && /mã|sku|code|model|part|mã hàng|mã sp|mã vt/.test(label)) m.sku = idx;
    else if (!m.category && /nhóm|loại|danh mục|category|phân loại|chủng loại/.test(label)) m.category = idx;
    else if (!m.supplier && /nhà cung cấp|ncc|hãng|supplier|brand|thương hiệu|xuất xứ|nsx/.test(label)) m.supplier = idx;
    else if (!m.unit && /đơn vị|đvt|unit|dvt|đv/.test(label)) m.unit = idx;
    else if (!m.currentListPrice && /(điều\s*chỉnh\s*(tăng|giá)?|dieu\s*chinh\s*(tang|gia)?|giá\s*(mới|moi|điều\s*chỉnh|dieu\s*chinh)|giá\s*áp\s*dụng|gia\s*ap\s*dung|áp\s*dụng\s*từ|ap\s*dung\s*tu)/.test(label)) m.currentListPrice = idx;
    else if (!m.listPrice && /(giá\s*(công bố|cong bo|niêm yết|niem yet)|giá\s*bán\s*lẻ\s*công\s*bố|gia\s*ban\s*le\s*cong\s*bo|public|list\s*price|msrp)/.test(label)) m.listPrice = idx;
    else if (!m.minRetailPrice && /(giá\s*bán\s*lẻ\s*thấp\s*nhất|gia\s*ban\s*le\s*thap\s*nhat|map|minimum|retail\s*min)/.test(label)) m.minRetailPrice = idx;
    else if (!m.costPrice && /(giá\s*(đại lý|dai ly|nhập|nhap|gốc|goc|vốn|von)|cost|dealer|wholesale|đơn giá nhập)/.test(label)) m.costPrice = idx;
    else if (!m.costPrice && /giá|price|đơn giá|thành tiền/.test(label)) m.costPrice = idx;
    else if (!m.specs && /thông số|kỹ thuật|spec|mô tả|tính năng|đặc điểm|quy cách/.test(label)) m.specs = idx;
    else if (!m.image && /hình\s*ảnh|hinh\s*anh|^ảnh$|^anh$|image|photo|thumbnail|url\s*ảnh|link\s*ảnh/.test(label)) m.image = idx;
  });
  return m;
}

/** Build preview catalog từ rows + colMap thủ công. */
export function buildCatalogPreview(rawRows, colMap, opts = {}) {
  return rawRows.map((row, rowOffset) => {
    const get = (key) => {
      const idx = parseInt(colMap[key]);
      if (isNaN(idx)) return "";
      return String(row[idx] ?? "").trim();
    };
    const rowText = (row || []).join(" ");
    if (isLikelyNonProductRow(rowText)) return null;
    const sku = get("sku") || extractSkuFromText(rowText);
    const supplier = cleanSupplierName(get("supplier"), opts.defaultSupplier || "");
    const category = inferCategory({ category: get("category"), name: get("name"), sku, specs: get("specs"), supplier, rawText: rowText, sheetName: opts.sheetName }, "Chung");
    const displayName = get("name") || (sku ? `${category !== "Chung" ? category : "Sản phẩm"} ${sku}` : "");
    const oldListPrice = parseSafePrice(get("listPrice"), rowText);
    const currentListPrice = parseSafePrice(get("currentListPrice"), rowText);
    const effectiveListPrice = currentListPrice || oldListPrice;
    let specs = get("specs");
    if (currentListPrice > 0 && oldListPrice > 0 && oldListPrice !== currentListPrice) {
      specs = (specs ? specs + " · " : "") + `Giá niêm yết cũ: ${oldListPrice.toLocaleString("vi-VN")}đ`;
    }
    let costPrice = parseSafePrice(get("costPrice"), rowText);
    if (!costPrice && currentListPrice > 0) costPrice = currentListPrice;
    return {
      id: uid("imp"),
      name: displayName,
      sku,
      category,
      supplier,
      unit: get("unit") || "Cái",
      costPrice,
      listPrice: effectiveListPrice,
      publicPrice: effectiveListPrice,
      minRetailPrice: parseSafePrice(get("minRetailPrice"), rowText),
      priceMode: effectiveListPrice > 0 ? "fixed" : "markup",
      specs,
      image: get("image"),
      _meta: {
        source: {
          rawText: rowText,
          rowIndex: opts.startRowIndex != null ? opts.startRowIndex + rowOffset + 1 : rowOffset + 1,
          sheet: opts.sheetName || "",
        }
      }
    };
  }).filter(p => p && p.name && p.name.length > 1);
}

/** Đọc Excel thô để mở lại màn hình mapping cột thủ công. */
export async function readCatalogRowsForManualMapping(file) {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const sheetName = wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false });
  return { rows, sheetName, fileName: file?.name || "catalog.xlsx" };
}

/** Đọc file giá NCC để cập nhật giá nhập theo SKU/tên. */
export async function parseSupplierPriceFile(file, products) {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false });
  const parsed = parseSupplierSheetRows(rows);
  if (parsed.error) return { error: parsed.error };

  const skuMap = {};
  products.forEach((p) => { if (p.sku) skuMap[p.sku.trim().toLowerCase()] = p; });

  const matched = [];
  const unchanged = [];
  const newItems = [];
  parsed.items.forEach((it) => {
    const key = (it.sku || "").trim().toLowerCase();
    const existing = key ? skuMap[key] : null;
    if (existing) {
      if (Math.round(existing.costPrice || 0) !== Math.round(it.costPrice)) {
        matched.push({ existing, newCost: it.costPrice, name: it.name || existing.name });
      } else {
        unchanged.push(existing);
      }
    } else if (it.sku) {
      newItems.push(it);
    }
  });

  const importPreview = priceUpdatePreviewFromLegacy({ fileName: file.name, matched, unchanged, newItems });
  return { matched, unchanged, newItems, fileName: file.name, importPreview };
}

/** Parse rows file giá NCC. */
export function parseSupplierSheetRows(rows) {
  if (!rows || rows.length < 2) return { error: "File trống hoặc không có dữ liệu." };

  const SKU_KEYS = ["sku", "mã", "ma", "code", "mã sp", "mã hàng", "mã thiết bị"];
  const NAME_KEYS = ["tên", "ten", "name", "sản phẩm", "san pham", "thiết bị", "mô tả", "diễn giải"];
  const PRICE_KEYS = ["giá nhập", "gia nhap", "giá", "gia", "price", "cost", "đơn giá", "don gia", "giá sỉ", "giá đại lý"];

  const norm = (s) => String(s ?? "").trim().toLowerCase();
  const findCol = (headerRow, keys) => {
    for (let i = 0; i < headerRow.length; i++) {
      const cell = norm(headerRow[i]);
      if (keys.some((k) => cell === k || cell.includes(k))) return i;
    }
    return -1;
  };

  let headerIdx = -1, skuCol = -1, nameCol = -1, priceCol = -1;
  for (let r = 0; r < Math.min(rows.length, 10); r++) {
    const row = rows[r] || [];
    const sc = findCol(row, SKU_KEYS);
    const pc = findCol(row, PRICE_KEYS);
    if (pc !== -1 && (sc !== -1 || findCol(row, NAME_KEYS) !== -1)) {
      headerIdx = r;
      skuCol = sc;
      nameCol = findCol(row, NAME_KEYS);
      priceCol = pc;
      break;
    }
  }

  if (headerIdx === -1 || priceCol === -1) return { error: "Không tìm thấy cột giá trong file. Cần có cột tiêu đề như 'Mã', 'Tên', 'Giá nhập'." };
  if (skuCol === -1 && nameCol === -1) return { error: "Không tìm thấy cột Mã (SKU) để đối chiếu thiết bị." };

  const parsePrice = (v, rowText = "") => {
    const n = parseSafePrice(v, rowText);
    return n > 0 ? n : NaN;
  };

  const items = [];
  for (let r = headerIdx + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const sku = skuCol !== -1 ? String(row[skuCol] ?? "").trim() : "";
    const name = nameCol !== -1 ? String(row[nameCol] ?? "").trim() : "";
    const cost = parsePrice(row[priceCol], row.join(" "));
    if ((!sku && !name) || isNaN(cost) || cost <= 0) continue;
    items.push({ sku, name, costPrice: cost });
  }

  if (items.length === 0) return { error: "Không đọc được dòng thiết bị hợp lệ nào trong file." };
  return { items };
}

/** Hash file dùng cho cache PDF. */
export async function hashFileSHA256(file) {
  const buf = await file.arrayBuffer();
  const hashBuf = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, "0")).join("").slice(0, 24);
}

/** Parse PDF catalog qua Claude, kèm cache/quota callbacks từ host app. */
export async function parsePdfCatalogWithClaude(file, opts = {}) {
  const {
    getCached,
    setCached,
    getQuota,
    incQuota,
    quotaLimit = 50,
    onCacheHit,
    onProgress,
  } = opts;

  const hash = await hashFileSHA256(file);
  const cached = getCached?.(hash);
  if (cached) {
    onCacheHit?.();
    return cached.map(it => ({ ...it, id: uid("imp") }));
  }

  const quota = getQuota?.() || { pdfCount: 0 };
  if ((quota.pdfCount || 0) >= quotaLimit) {
    throw new Error(`Đã dùng hết ${quotaLimit} lượt đọc PDF tháng này. Dùng file Excel (miễn phí) hoặc nâng cấp gói.`);
  }

  const supplierGuess = file.name.replace(/\.pdf$/i, "").replace(/[_\-]/g, " ").slice(0, 30);
  const finalItems = await parsePdfCatalogWithPipeline({
    file,
    supplierGuess,
    onProgress,
  });

  const importPreview = productsToImportPreviewResult({
    products: finalItems,
    fileName: file.name,
    engine: finalItems?.[0]?._meta?.engine || "pdf-v2",
    detectedIndustry: "catalog",
    importType: "catalog_pdf",
  });
  finalItems.forEach((item, index) => {
    item._meta = { ...(item._meta || {}), importId: importPreview.importId, lineId: importPreview.lines[index]?.lineId };
  });

  setCached?.(hash, finalItems.map(({ id, ...rest }) => rest));
  // Tính quota theo số file PDF, không theo số chunk.
  incQuota?.(1);
  finalItems.importPreview = importPreview;
  return finalItems;
}
