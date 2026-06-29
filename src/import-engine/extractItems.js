// ============================================================
// extractItems — trích ImportItem từ các dòng đã phân loại là product
// ============================================================
import * as XLSX from "xlsx";
import { classifyRow } from "./classifyRows.js";
import { ROW_CLASS } from "./types.js";
import { parseSafePrice, extractSkuFromText, extractSkuCandidatesFromText } from "./productSanitizer.js";
import { inferCategory } from "./categoryInference.js";

/** Parse số tiền từ chuỗi, trả 0 nếu không hợp lệ (>=100) */
function parsePrice(s) {
  return parseSafePrice(s);
}


function compactText(v) {
  return String(v ?? "").replace(/\s+/g, " ").trim();
}

function normalizeAscii(v) {
  return compactText(v).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase();
}

function cleanSkuForDisplay(sku) {
  return compactText(sku).replace(/\s+/g, " ").replace(/\s*[-–—]\s*/g, "-");
}

function cleanModelText(sku) {
  // Giữ model chính, bỏ bớt cân nặng/notes phụ phía sau trong cùng cell.
  const s = cleanSkuForDisplay(sku);
  if (/^(n\/?a|na|null|none)$/i.test(s)) return "";
  return s
    .replace(/\s*\|\s*\d+(?:[.,]\d+)?\s*(kg|kgs|g|gram)\b.*$/i, "")
    .replace(/\s+\d+(?:[.,]\d+)?\s*(kg|kgs|g|gram)\b.*$/i, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function inferBrandFromContext(sheetName = "", sectionName = "", supplier = "") {
  const raw = [sheetName, sectionName, supplier].join(" ");
  const norm = normalizeAscii(raw);
  if (/philips/.test(norm)) return "Philips";
  if (/kaadas/.test(norm)) return "Kaadas";
  if (/hexa/.test(norm)) return "Hexa";
  if (/lumi/.test(norm)) return "Lumi";
  if (/aqara/.test(norm)) return "Aqara";
  if (/sse\s*home|ssehome/.test(norm)) return "SSEHOME";
  return "";
}

// Suy luận loại sản phẩm. Ưu tiên: category đã infer đúng → pattern SKU → context.
function inferProductTypeFromContext(sheetName = "", sectionName = "", specs = "", sku = "", category = "") {
  // 1) Category đã được infer đúng (vd "Két an toàn") → dùng luôn, độ tin cậy cao nhất.
  const catNorm = normalizeAscii(category);
  if (catNorm) {
    if (/ket\s*an\s*toan|safe/.test(catNorm)) return "Két an toàn";
    if (/khoa|lock/.test(catNorm)) return "Khóa thông minh";
    if (/cong\s*tac|switch/.test(catNorm)) return "Công tắc thông minh";
    if (/den|downlight|spotlight|lighting|chieu\s*sang/.test(catNorm)) return "Đèn";
    if (/camera|nvr|dvr/.test(catNorm)) return "Camera";
    if (/cam\s*bien|sensor/.test(catNorm)) return "Cảm biến";
    if (/rem|curtain|thanh\s*ray/.test(catNorm)) return "Rèm";
    if (/cong\b|gate|motor/.test(catNorm)) return "Cổng tự động";
  }

  // 2) Pattern SKU/model — đặc trưng từng dòng, chính xác hơn sheet/section.
  const skuNorm = normalizeAscii(sku);
  if (skuNorm) {
    if (/^sbx|^valis/.test(skuNorm)) return "Két an toàn";
    if (/^ddl|^k20|^p100|^r100|^kbt|^ktp/.test(skuNorm)) return "Khóa thông minh";
  }

  // 3) Context (sheet/section/specs) — fallback. Két ưu tiên trước khóa
  //    để sheet "KÉT PHILIPS" không bị specs "Mã khóa..." kéo sang khóa.
  const raw = [sectionName, sheetName].join(" ");
  const ctxNorm = normalizeAscii(raw);
  const specNorm = normalizeAscii(specs);
  if (/safe|sbx|valis|k[eé]t\b|ket\b|ket\s*an\s*toan/.test(ctxNorm)) return "Két an toàn";
  if (/khoa|door|lock|ddl|kaadas|hexa/.test(ctxNorm)) return "Khóa thông minh";
  if (/cong\s*tac|switch/.test(ctxNorm)) return "Công tắc thông minh";
  if (/den|downlight|spotlight|lighting/.test(ctxNorm)) return "Đèn";
  if (/camera|nvr|dvr/.test(ctxNorm)) return "Camera";
  if (/cam\s*bien|sensor/.test(ctxNorm)) return "Cảm biến";
  // chỉ dùng specs khi context không quyết định được
  if (/safe|sbx|valis|ket\s*an\s*toan/.test(specNorm)) return "Két an toàn";
  if (/khoa|door|lock/.test(specNorm)) return "Khóa thông minh";
  return "Sản phẩm";
}

function looksLikeColorOnly(v) {
  const s = compactText(v);
  if (!s) return false;
  return /^(đen|trắng|xám|bạc|vàng|đồng|đỏ|xanh|tím|nâu|hồng|cam|gold|silver|black|white|gray|grey|red|blue|green|champagne)([\s\/,\-]*(đen|trắng|xám|bạc|vàng|đồng|đỏ|xanh|tím|nâu|hồng|cam|gold|silver|black|white|gray|grey|red|blue|green|champagne))*$/i.test(s);
}

function looksLikeSpecsOnly(v) {
  const s = compactText(v);
  if (!s) return false;
  return /Phương thức|mở khóa|Vân tay|Mật mã|Thẻ từ|Chìa cơ|Bluetooth|Gateway|Wifi|Camera|Face|Nguồn|Công suất|Kích thước|Qui cách|Quy cách|Chất liệu|Màu sắc/i.test(s) || /(?:^|\b)[LWH]?\s*\d{2,4}(?:[.,]\d+)?\s*[*x×]\s*[LWH]?\s*\d{2,4}/i.test(s) || s.length > 115;
}

// Tên chỉ là LOẠI sản phẩm chung (không có model/chi tiết) → nghi là dòng tổng nhóm.
// Vd: "Công tắc thông minh", "Camera", "Khóa thông minh", "Cảm biến", "Két an toàn".
// KHÔNG tính các tên có thêm chi tiết: "Công tắc cơ thông minh 1 nút", "Camera DS-2CD...".
function isGenericCategoryName(name) {
  const n = compactText(name).toLowerCase().replace(/[.\s]+$/, "").trim();
  if (!n) return false;
  const GENERIC = [
    "cong tac thong minh", "cong tac", "cong tac dien thong minh",
    "camera", "khoa thong minh", "khoa", "cam bien", "ket an toan",
    "wifi", "o cam", "rem", "den", "bo dieu khien trung tam",
    "cong tu dong", "motor", "dau ghi", "switch", "san pham",
  ];
  const ascii = n.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d");
  return GENERIC.includes(ascii);
}

function escapeRegExp(s) {
  return String(s || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function cleanFeatureText(v) {
  let s = compactText(v)
    .replace(/(?:^|[;|,])\s*(mã\s*khóa\s*sử\s*dụng|ma\s*khoa\s*su\s*dung|model|sku|mã\s*sp|ma\s*sp)\s*[:：]?\s*[^;|,]+/gi, " ")
    .replace(/\b\d{1,3}(?:[.,]\d{3}){1,4}\b/g, " ")
    .replace(/\b\d{5,10}\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  for (const sku of extractSkuCandidatesFromText(s)) {
    s = s.replace(new RegExp(escapeRegExp(sku), "gi"), " ");
  }
  return s.replace(/\s*[,;|]\s*/g, "/").replace(/\/{2,}/g, "/").replace(/^\/+|\/+$/g, "").trim();
}

function firstTextFromCols(row, cols = []) {
  for (const c of cols || []) {
    const t = compactText(row.text[c]);
    if (t) return t;
  }
  return "";
}

function textsFromCols(row, cols = []) {
  return (cols || []).map((c) => compactText(row.text[c])).filter(Boolean);
}

function extractSkuFromHiddenCells(row, map) {
  const hiddenTexts = textsFromCols(row, map?._hiddenSkuCols || []);
  for (const t of hiddenTexts) {
    const candidates = extractSkuCandidatesFromText(t);
    if (candidates.length) {
      // Trong ô hình ảnh, SKU/model thường nằm cuối ô sau nhiều dòng trắng.
      return cleanModelText(candidates[candidates.length - 1]);
    }
  }
  return "";
}

function buildFeatureDisplayName({ row, map, sku, sheetName, sectionName, supplier, specs, category }) {
  const featureRaw = firstTextFromCols(row, map?._featureCols || []) || firstTextFromCols(row, map?._nameSourceCols || []);
  const feature = cleanFeatureText(featureRaw);
  const model = cleanModelText(sku || extractSkuFromHiddenCells(row, map) || extractSkuFromText(row.joined));
  const type = inferProductTypeFromContext(sheetName, sectionName, [specs, feature].filter(Boolean).join(" "), model || sku, category);
  const brand = inferBrandFromContext(sheetName, sectionName, supplier);

  // ƯU TIÊN tên NGẮN khi có SKU/model tốt: type + brand + model.
  // Feature/thông số KHÔNG nhét vào name (sẽ nằm ở specs).
  if (model && model.length >= 4) {
    const parts = [];
    parts.push(type && type !== "Sản phẩm" ? type : "Sản phẩm");
    if (brand && !normalizeAscii(model).includes(normalizeAscii(brand))) parts.push(brand);
    parts.push(model);
    return parts.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  }

  // KHÔNG có SKU/model: mới dùng feature làm tên (đây là trường hợp duy nhất feature vào name).
  const parts = [];
  parts.push(type && type !== "Sản phẩm" ? type : "Sản phẩm");
  if (brand) parts.push(brand);
  if (feature && feature.length >= 4 && !looksLikeColorOnly(feature)) {
    // giới hạn feature trong name ở mức ngắn để tên không quá dài
    parts.push(shortenFeatureForName(feature));
  }
  return parts.filter(Boolean).join(" - ").replace(/\s+/g, " ").trim();
}

// Rút gọn feature khi buộc phải đưa vào name (không có SKU): lấy 2-3 tính năng đầu.
function shortenFeatureForName(feature) {
  const parts = String(feature || "").split("/").map((s) => s.trim()).filter(Boolean);
  if (parts.length <= 3) return feature.slice(0, 50);
  return parts.slice(0, 3).join("/") + "...";
}

function shouldDeriveName(name, sku, map) {
  const n = compactText(name);
  if (map?._deriveNameFromSku) return true;
  if (!n && sku) return true;
  if (!sku) return false;
  if (n === compactText(sku)) return true;
  if (looksLikeColorOnly(n) || looksLikeSpecsOnly(n)) return true;
  return false;
}

function buildDisplayName({ name, sku, sheetName, sectionName, supplier, specs, category }) {
  const cleanName = compactText(name);
  const model = cleanModelText(sku || extractSkuFromText([cleanName, specs].filter(Boolean).join(" ")));
  const brand = inferBrandFromContext(sheetName, sectionName, supplier);
  const type = inferProductTypeFromContext(sheetName, sectionName, specs, model || sku, category);

  if (model) {
    const parts = [type];
    if (brand && !normalizeAscii(model).includes(normalizeAscii(brand))) parts.push(brand);
    parts.push(model);
    return parts.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  }
  return cleanName;
}


function formatVnd(n) {
  const num = Number(n || 0) || 0;
  return num > 0 ? num.toLocaleString("vi-VN") + "đ" : "";
}

function appendSpecLine(specs, text) {
  const t = compactText(text);
  if (!t) return specs || "";
  const current = specs || "";
  if (normalizeAscii(current).includes(normalizeAscii(t))) return current;
  return (current ? current + " · " : "") + t;
}

function priceCandidatesFromCols(row, cols = []) {
  return [...new Set(cols || [])]
    .map((c) => parsePrice(row.text[c]))
    .filter((n) => n > 0);
}

function isExplicitCostColumn(map) {
  return map?.price != null && map.price !== map.currentListPrice && map.price !== map.listPrice && map.price !== map.minRetailPrice;
}

/**
 * @param {import('./types').NormalizedRow} row
 * @param {import('./types').ColumnMap} map
 * @param {string} sheetName
 * @param {string} sectionName
 * @param {string} fileSupplier
 * @returns {?Object} raw item (chưa validate/match)
 */
function rowToItem(row, map, sheetName, sectionName, fileSupplier) {
  const get = (key) => {
    const idx = map[key];
    return idx != null && row.text[idx] != null ? String(row.text[idx]).trim() : "";
  };

  let name = get("name");
  let sku = cleanModelText(get("sku"));
  const hiddenSku = extractSkuFromHiddenCells(row, map);
  if (!sku && hiddenSku) sku = hiddenSku;
  let price = parsePrice(get("price"));
  const oldListPrice = parsePrice(get("listPrice"));
  const currentListPrice = parsePrice(get("currentListPrice"));
  let listPrice = currentListPrice || oldListPrice;
  let minRetailPrice = parsePrice(get("minRetailPrice"));
  let specs = get("specs");

  const tierPrices = priceCandidatesFromCols(row, map._tierPriceCols || [])
    .filter((n) => n >= 1000 && (!currentListPrice || n <= currentListPrice * 1.05));
  const explicitCost = isExplicitCostColumn(map) && price > 0;

  // Cột "Điều chỉnh tăng/Giá mới/Áp dụng từ" là giá công bố hiện tại, KHÔNG phải giá nhập.
  // Nếu có giá tier theo số lượng thì dùng tier thấp nhất làm giá nhập; nếu không, để giá nhập = giá công bố
  // để tránh cảnh báo âm margin giả.
  if (currentListPrice > 0) {
    listPrice = currentListPrice;
    if (!explicitCost) {
      price = tierPrices.length ? Math.min(...tierPrices) : currentListPrice;
    }
    if (oldListPrice > 0 && oldListPrice !== currentListPrice) {
      specs = appendSpecLine(specs, `Giá niêm yết cũ: ${formatVnd(oldListPrice)}`);
    }
    const label = map._effectivePriceLabel || "Giá điều chỉnh";
    specs = appendSpecLine(specs, `${label}: ${formatVnd(currentListPrice)}`);
  } else if (price === 0 && tierPrices.length) {
    price = Math.min(...tierPrices);
  }

  // Nếu cột price chỉ định trả 0, quét các cột số khác nhưng bỏ qua giá công bố/giá điều chỉnh/giá bán lẻ.
  // Chọn giá hợp lý thấp nhất làm giá nhập, không ghép toàn bộ cột giá thành một số lớn.
  if (price === 0) {
    const priceCandidates = [];
    for (let c = 0; c < row.text.length; c++) {
      if (c === map.name || c === map.sku || c === map.listPrice || c === map.currentListPrice || c === map.minRetailPrice || (map._tierPriceCols || []).includes(c)) continue;
      const n = parsePrice(row.text[c]);
      if (n > 0) priceCandidates.push(n);
    }
    if (priceCandidates.length) price = Math.min(...priceCandidates);
  }

  // Nếu chưa map được giá công bố, thử lấy giá lớn nhất trong các cột giá phụ đã biết.
  if (listPrice === 0 && Array.isArray(map._otherPriceCols)) {
    const candidates = map._otherPriceCols.map((c) => parsePrice(row.text[c])).filter((n) => n > 0);
    if (candidates.length) listPrice = Math.max(...candidates);
  }

  // Giá bán lẻ thấp nhất/MAP chỉ để lưu tham khảo, không hiển thị kiểu ×1.6/1.7 nữa.
  // Gộp cả feature col và name-source col vào specs để không mất thông tin
  // khi tên được dựng ngắn (type + brand + SKU).
  const specSourceCols = [...new Set([...(map._nameSourceCols || []), ...(map._featureCols || [])])];
  const extraSpecTexts = textsFromCols(row, specSourceCols)
    .filter((t) => t && t !== specs && t !== name)
    .slice(0, 3);
  if (extraSpecTexts.length) specs = [specs, ...extraSpecTexts].filter(Boolean).join(" | ");
  if (minRetailPrice > 0) {
    specs = (specs ? specs + " · " : "") + "Giá bán lẻ thấp nhất: " + minRetailPrice.toLocaleString("vi-VN") + "đ";
  }

  if (!sku) {
    sku = cleanModelText(extractSkuFromHiddenCells(row, map) || extractSkuFromText([name, specs, row.joined].filter(Boolean).join(" ")));
  }

  // Tính category SỚM (trước khi dựng name) để type ưu tiên category đã infer đúng.
  // Vd: Két an toàn SBX nằm cùng sheet khóa → category="Két an toàn" giúp name đúng.
  const earlyCategory = inferCategory(
    { category: get("category"), name, sku, specs, sectionName, sheetName, supplier: fileSupplier, rawText: row.joined },
    sectionName || inferProductTypeFromContext(sheetName, sectionName, specs, sku, "")
  );

  // Nếu file không có cột tên sản phẩm thật nhưng có cột Tính năng/Thông số,
  // dựng tên từ feature trước; phù hợp file có header: STT | Hình ảnh | Thông số | Tính năng | Giá.
  let featureNameDerived = false;
  if ((!name || map._deriveNameFromFeature) && (map._featureCols || map._nameSourceCols)) {
    const derivedFeatureName = buildFeatureDisplayName({ row, map, sku, sheetName, sectionName, supplier: fileSupplier, specs, category: earlyCategory });
    if (derivedFeatureName && derivedFeatureName.length >= 6) {
      name = derivedFeatureName;
      featureNameDerived = true;
    }
  }

  // Nếu file không có cột tên sản phẩm thật (chỉ có Mã sản phẩm + specs/màu),
  // dựng tên thân thiện từ loại sheet + brand + model. Không dùng màu/thông số làm name.
  if (!featureNameDerived && shouldDeriveName(name, sku, map)) {
    const derived = buildDisplayName({ name, sku, sheetName, sectionName, supplier: fileSupplier, specs, category: earlyCategory });
    if (derived) name = derived;
  }

  if (!name && specs && !sku) name = specs.slice(0, 60);
  if (name && name.length < 6 && sku) name = buildDisplayName({ name, sku, sheetName, sectionName, supplier: fileSupplier, specs, category: earlyCategory });

  if (!name || name.length < 2) return null;
  if (!sku && /^sản phẩm$/i.test(compactText(name))) return null;

  // Generic subtotal guard: tên chỉ là LOẠI sản phẩm chung + KHÔNG có SKU + specs rỗng
  // → nghi là dòng tổng nhóm (category subtotal), không phải sản phẩm thật.
  // Vd Bùi Viện: "Công tắc thông minh | 11.016.000đ" (tổng các công tắc bên dưới).
  const noRealSpecs = !compactText(specs) || compactText(specs).length < 4;
  const isSubtotalSuspect = !sku && noRealSpecs && isGenericCategoryName(name);

  const cellRefs = row.cells.map((c) => c.ref);

  return {
    name,
    sku,
    category: earlyCategory,
    supplier: get("supplier") || inferBrandFromContext(sheetName, sectionName, fileSupplier) || fileSupplier,
    unit: get("unit") || "Cái",
    price,
    costPrice: price,
    listPrice,
    minRetailPrice,
    priceMode: listPrice > 0 ? "fixed" : "markup",
    specs,
    _priceStrategy: currentListPrice > 0 ? {
      type: "effective_list_price",
      currentListPrice,
      oldListPrice,
      effectivePriceLabel: map._effectivePriceLabel || "",
      effectivePriceDate: map._effectivePriceDate || "",
      usedTierPrice: tierPrices.length > 0 && price === Math.min(...tierPrices),
      costEqualsList: price === currentListPrice,
    } : null,
    _subtotalSuspect: isSubtotalSuspect,
    source: {
      sheet: sheetName,
      rowIndex: row.r,
      cellRefs,
      rawText: row.joined,
    },
  };
}

/**
 * Trích items từ 1 region.
 * @param {import('./types').NormalizedSheet} sheet
 * @param {import('./types').Region} region
 * @param {import('./types').ColumnMap} map
 * @param {number} headerIndex - chỉ số dòng header (loại trừ)
 * @param {string} fileSupplier
 * @returns {Object[]}
 */
export function extractItemsWithStats(sheet, region, map, headerIndex, fileSupplier) {
  const items = [];
  const stats = { totalRows: 0, products: 0, notes: 0, totals: 0, sections: 0, blank: 0, headers: 0, skipped: 0 };
  const opt = { priceCol: map.price ?? null, nameCol: map.name ?? null, maxCol: sheet.maxCol };
  let sectionName = region.sectionName || "";

  // lấy các row trong [startRow, endRow] theo r-index
  for (const row of sheet.rows) {
    if (row.r < region.startRow || row.r > region.endRow) continue;
    if (row.r === headerIndex) { stats.headers += 1; continue; }
    stats.totalRows += 1;

    const cls = classifyRow(row, opt);

    if (cls === ROW_CLASS.SECTION) {
      stats.sections += 1;
      sectionName = row.joined.replace(/^[IVX]+[\.\)]\s*|^[A-Z][\.\)]\s*/i, "").trim();
      continue;
    }
    if (cls === ROW_CLASS.NOTE) { stats.notes += 1; stats.skipped += 1; continue; }
    if (cls === ROW_CLASS.TOTAL) { stats.totals += 1; stats.skipped += 1; continue; }
    if (cls === ROW_CLASS.BLANK) { stats.blank += 1; stats.skipped += 1; continue; }
    if (cls === ROW_CLASS.HEADER) { stats.headers += 1; stats.skipped += 1; continue; }
    if (cls !== ROW_CLASS.PRODUCT) { stats.skipped += 1; continue; }

    const item = rowToItem(row, map, sheet.name, sectionName, fileSupplier);
    if (item) { items.push(item); stats.products += 1; }
    else stats.skipped += 1;
  }

  return { items, stats };
}

export function extractItems(sheet, region, map, headerIndex, fileSupplier) {
  return extractItemsWithStats(sheet, region, map, headerIndex, fileSupplier).items;
}

export { parsePrice, rowToItem };
