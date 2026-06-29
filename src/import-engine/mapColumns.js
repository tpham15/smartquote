// ============================================================
// mapColumns — ánh xạ cột (deterministic)
// Dùng tên header + phân tích dữ liệu mẫu. KHÔNG cần AI.
// ============================================================

// Quy tắc khớp field theo tên cột. Thứ tự ưu tiên quan trọng.
const FIELD_RULES = [
  { key: "sku",      patterns: [/^mã\s*(sp|sản phẩm|hàng|vt|thiết bị)?$/i, /\bsku\b/i, /\bcode\b/i, /\bmodel\b/i, /part\s*no/i, /mã hàng/i] },
  { key: "name",     patterns: [/tên\s*(sản phẩm|hàng|thiết bị|vật tư)?/i, /sản phẩm/i, /hàng ho[áa]/i, /diễn giải/i, /^mô tả$/i, /^thiết bị$/i, /^vật tư$/i, /tên gọi/i] },
  { key: "specs",    patterns: [/thông số/i, /quy cách/i, /đặc điểm/i, /tính năng/i, /kỹ thuật/i, /mô tả (chi tiết|kỹ thuật|sản phẩm)/i, /phương thức/i, /màu sắc/i] },
  { key: "unit",     patterns: [/^đvt$/i, /đơn vị/i, /^dvt$/i, /^unit$/i] },
  { key: "category", patterns: [/nhóm/i, /loại\b/i, /danh mục/i, /chủng loại/i, /phân loại/i, /category/i] },
  { key: "supplier", patterns: [/nhà cung cấp/i, /^ncc$/i, /hãng/i, /xuất xứ/i, /thương hiệu/i, /brand/i, /nsx/i] },
  // Giá hiện hành / giá điều chỉnh: đây là giá công bố hiện tại, KHÔNG phải giá nhập.
  // Ví dụ header: "Điều chỉnh tăng 15/04/2026", "Giá mới áp dụng từ...".
  { key: "currentListPrice", patterns: [/điều\s*chỉnh\s*(tăng|giá)?/i, /dieu\s*chinh\s*(tang|gia)?/i, /giá\s*(mới|moi|điều\s*chỉnh|dieu\s*chinh)/i, /giá\s*áp\s*dụng/i, /gia\s*ap\s*dung/i, /áp\s*dụng\s*từ/i, /ap\s*dung\s*tu/i] },
  // Giá công bố/niêm yết: dùng làm giá bán hiển thị cho catalog, KHÔNG dùng để tính giá nhập.
  { key: "listPrice", patterns: [/giá\s*(bán\s*lẻ\s*)?(công\s*bố|cong\s*bo)/i, /giá\s*(niêm\s*yết|niem\s*yet)/i, /giá\s*bán\s*lẻ\s*công\s*bố/i, /giá\s*bán\s*lẻ$/i] },
  // Giá bán lẻ thấp nhất / giá MAP: lưu riêng để tham khảo, không hiển thị kiểu ×1.6/1.7 nữa.
  { key: "minRetailPrice", patterns: [/bán\s*lẻ\s*thấp\s*nhất/i, /ban\s*le\s*thap\s*nhat/i, /đại\s*l[ýi]\s*bán\s*lẻ\s*thấp\s*nhất/i] },
  // giá nhập/vốn: ưu tiên cột giá THẤP (nhập/npp/đại lý/vốn) hơn giá lẻ/bán
  { key: "price",    patterns: [/giá\s*(nhập|vốn|gốc|npp|đại lý|sỉ)/i, /giá\s*đại\s*l[íi]\b/i, /giá\s*bán\s*cho\s*đại\s*l[ýi]/i] },
  { key: "price2",   patterns: [/đơn giá/i, /^giá$/i, /price/i, /thành tiền/i] },
];

/** Phân tích dữ liệu cột để đoán kiểu (numeric/text/code) */
function profileColumn(rows, colIdx, sampleSize = 8) {
  let numeric = 0, code = 0, longText = 0, total = 0, sumLen = 0;
  for (const row of rows.slice(0, sampleSize)) {
    const t = (row.text[colIdx] || "").trim();
    if (!t) continue;
    total++;
    sumLen += t.length;
    if (/^[\d.,\s]+$/.test(t) && /\d/.test(t)) numeric++;
    else if (/^[A-Z0-9][A-Z0-9\-\/\.]{2,}$/i.test(t) && /[A-Z]/i.test(t) && /\d/.test(t)) code++;
    else if (t.length > 15) longText++;
  }
  return {
    numericRatio: total ? numeric / total : 0,
    codeRatio: total ? code / total : 0,
    longTextRatio: total ? longText / total : 0,
    avgLen: total ? sumLen / total : 0,
    total,
  };
}

const SPECISH_RE = /Chất liệu|Nguồn cấp|Nguồn điện|Dòng điện|Công suất|Nhiệt độ|Độ ẩm|Kích thước|Tích hợp|Loại thẻ|Tốc độ|Khoảng cách|Mã khóa|Màu sắc|Điện áp|Tần số|Thông số|Tính năng|Đặc điểm|Bảo hành|Xuất xứ|Phương thức|mở khóa|Vân tay|Mật mã|Chìa cơ|Thẻ từ|Bluetooth|Gateway|Wifi|App|Camera|Face|Applicative Door|Wooden doors?|Metal doors?|Glass Doors?|Qui cách|Quy cách/i;
const COLORISH_RE = /^(đen|trắng|xám|bạc|vàng|đồng|đỏ|xanh|tím|nâu|hồng|cam|gold|silver|black|white|gray|grey|red|blue|green|champagne)([\s\/\,\-]*(đen|trắng|xám|bạc|vàng|đồng|đỏ|xanh|tím|nâu|hồng|cam|gold|silver|black|white|gray|grey|red|blue|green|champagne))*$/i;
const DIMENSION_RE = /(?:^|\b)[LWH]?\s*\d{2,4}(?:[.,]\d+)?\s*[*x×]\s*[LWH]?\s*\d{2,4}(?:[.,]\d+)?(?:\s*[*x×]\s*[LWH]?\s*\d{2,4}(?:[.,]\d+)?)?/i;
const HIDDEN_SKU_HEADER_RE = /hình\s*ảnh|hinh\s*anh|^ảnh$|^anh$|image|photo|model\s*ẩn|ma\s*an/i;
const FEATURE_HEADER_RE = /tính\s*năng|tinh\s*nang|phương\s*thức|phuong\s*thuc|mở\s*khóa|mo\s*khoa|chức\s*năng|chuc\s*nang|đặc\s*điểm|dac\s*diem/i;
const NAME_SOURCE_HEADER_RE = /thông\s*số|thong\s*so|kỹ\s*thuật|ky\s*thuat|quy\s*cách|qui\s*cách|quy\s*cach|mô\s*tả|mo\s*ta|tính\s*năng|tinh\s*nang|đặc\s*điểm|dac\s*diem/i;
const TIER_PRICE_HEADER_RE = /(^|\b)(từ|tu)\s*\d+|trên\s*\d+|tren\s*\d+|\d+\s*[-–]\s*\d+\s*bộ|\d+\s*bo|số\s*lượng|so\s*luong|quantity\s*break|bulk|tier/i;
const EFFECTIVE_PRICE_DATE_RE = /(\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4})/;
// Header chắc chắn KHÔNG phải cột tên — không được suy luận chọn làm name.
// Ngăn bug chọn nhầm "Bảo hành"/"Số lượng"/"Xuất xứ" làm cột tên khi file thiếu cột tên thật.
const NON_NAME_HEADER_RE = /^(bảo\s*hành|bao\s*hanh|warranty|số\s*lượng|so\s*luong|^sl$|qty|đơn\s*giá|don\s*gia|giá|gia|price|thành\s*tiền|thanh\s*tien|đơn\s*vị|don\s*vi|đvt|dvt|unit|stt|^tt$|^no$|xuất\s*xứ|xuat\s*xu|hãng|hang|origin|ghi\s*chú|ghi\s*chu|note|hình\s*ảnh|hinh\s*anh|image|tình\s*trạng|tinh\s*trang|status|màu\s*sắc|mau\s*sac|color)/i;

function collectHeaderCols(headerRow, maxCol, re) {
  if (!headerRow) return [];
  const out = [];
  for (let c = 0; c <= maxCol; c++) {
    const label = String(headerRow.text[c] || "").trim();
    if (label && re.test(label)) out.push(c);
  }
  return out;
}


function looksLikeBadNameColumn(rows, colIdx, sampleSize = 12) {
  let total = 0, bad = 0, good = 0;
  for (const row of rows.slice(0, sampleSize)) {
    const t = (row.text[colIdx] || "").trim();
    if (!t) continue;
    total++;
    if (COLORISH_RE.test(t) || SPECISH_RE.test(t) || DIMENSION_RE.test(t) || t.length > 115 || /^[\d.,\s]+$/.test(t)) bad++;
    if (t.length >= 6 && t.length <= 85 && !COLORISH_RE.test(t) && !SPECISH_RE.test(t) && !DIMENSION_RE.test(t) && !/^[\d.,\s]+$/.test(t)) good++;
  }
  if (!total) return true;
  return bad / total >= 0.35 || good / total < 0.3;
}

function specishRatio(rows, colIdx, sampleSize = 12) {
  let total = 0, hit = 0;
  for (const row of rows.slice(0, sampleSize)) {
    const t = (row.text[colIdx] || "").trim();
    if (!t) continue;
    total++;
    if (SPECISH_RE.test(t) || t.length > 120) hit++;
  }
  return total ? hit / total : 0;
}

/**
 * Ánh xạ cột từ header + dữ liệu.
 * @param {import('./types').NormalizedRow} headerRow
 * @param {import('./types').NormalizedRow[]} dataRows
 * @param {number} maxCol
 * @returns {{map: import('./types').ColumnMap, confidence: number, byName: Object}}
 */
export function mapColumns(headerRow, dataRows, maxCol) {
  /** @type {import('./types').ColumnMap} */
  const map = {};
  const used = new Set();
  const priceCandidates = [];

  // ---- Bước 1: khớp theo tên header ----
  if (headerRow) {
    for (const rule of FIELD_RULES) {
      for (let c = 0; c <= maxCol; c++) {
        if (used.has(c)) continue;
        const label = (headerRow.text[c] || "").trim();
        if (!label) continue;
        if (rule.patterns.some((p) => p.test(label))) {
          if (rule.key === "price" || rule.key === "price2") {
            priceCandidates.push({ col: c, priority: rule.key === "price" ? 2 : 1, label });
          } else if (map[rule.key] == null) {
            map[rule.key] = c;
            used.add(c);
          }
          break;
        }
      }
    }
  }

  // Cột phụ không phải field chính nhưng chứa tín hiệu quan trọng.
  // Một số NCC nhét SKU vào ô "Hình ảnh" sau nhiều dấu xuống dòng, hoặc không có cột tên
  // mà chỉ có "Thông số kỹ thuật" + "Tính năng". Không đánh dấu used để vẫn giữ mapping chính.
  const hiddenSkuCols = collectHeaderCols(headerRow, maxCol, HIDDEN_SKU_HEADER_RE);
  const featureCols = collectHeaderCols(headerRow, maxCol, FEATURE_HEADER_RE);
  const nameSourceCols = collectHeaderCols(headerRow, maxCol, NAME_SOURCE_HEADER_RE);
  const tierPriceCols = collectHeaderCols(headerRow, maxCol, TIER_PRICE_HEADER_RE)
    .filter((c) => c !== map.currentListPrice && c !== map.listPrice && c !== map.price && c !== map.sku && c !== map.name);
  if (hiddenSkuCols.length) map._hiddenSkuCols = hiddenSkuCols;
  if (featureCols.length) map._featureCols = featureCols;
  if (nameSourceCols.length) map._nameSourceCols = nameSourceCols;
  if (tierPriceCols.length) map._tierPriceCols = tierPriceCols;
  if (map.currentListPrice != null && headerRow) {
    const label = String(headerRow.text[map.currentListPrice] || "");
    const m = label.match(EFFECTIVE_PRICE_DATE_RE);
    map._effectivePriceLabel = label.trim();
    if (m) map._effectivePriceDate = m[1];
  }

  // chọn cột giá: ưu tiên priority cao (giá nhập/npp), nếu nhiều cột giá bán → lấy cột giá nhỏ nhất giá trị
  if (priceCandidates.length) {
    for (const p of priceCandidates) {
      const label = String(p.label || "").toLowerCase();
      // Không lấy cột "chưa VAT chỉ để tính thưởng" làm giá nhập nếu có cột đại lý chuẩn.
      if (/chưa\s*bao\s*gồm\s*vat|chua\s*bao\s*gom\s*vat|tính\s*thưởng|tinh\s*thuong|doanh\s*số|doanh\s*so/.test(label)) p.priority -= 2.5;
      // Không lấy cột giá bán lẻ/công bố/niêm yết/điều chỉnh giá làm giá nhập.
      if (/bán\s*lẻ\s*thấp\s*nhất|ban\s*le\s*thap\s*nhat|công\s*bố|cong\s*bo|niêm\s*yết|niem\s*yet|điều\s*chỉnh|dieu\s*chinh|giá\s*mới|gia\s*moi|áp\s*dụng\s*từ|ap\s*dung\s*tu/.test(label)) p.priority -= 4;
      if (/giá\s*bán\s*cho\s*đại\s*l[ýi]/i.test(p.label || "")) p.priority += 1.5;
      if (/^giá\s*đại\s*l[ýi]\s*$/i.test(String(p.label || "").trim())) p.priority += 1.0;
    }
    priceCandidates.sort((a, b) => b.priority - a.priority);
    map.price = priceCandidates[0].col;
    used.add(map.price);
    // lưu các cột giá khác để ghi vào specs
    map._otherPriceCols = priceCandidates.slice(1).map((p) => p.col);
  }

  // ---- Bước 2: suy luận từ dữ liệu cho field còn thiếu ----
  // name: chỉ suy luận khi thật sự giống cột tên.
  // Nếu file chỉ có "Mã sản phẩm" + thông số/màu/giá, KHÔNG chọn màu hoặc specs làm tên.
  // Khi đó extractItems sẽ tự dựng tên thân thiện từ SKU + sheet/section/brand.
  if (map.name == null) {
    let bestCol = -1, bestScore = -Infinity;
    for (let c = 0; c <= maxCol; c++) {
      if (used.has(c)) continue;
      // Bỏ qua cột có header rõ ràng không phải tên (Bảo hành, Số lượng, Giá, Xuất xứ...).
      const headerLabel = headerRow ? String(headerRow.text[c] || "").trim() : "";
      if (headerLabel && NON_NAME_HEADER_RE.test(headerLabel)) continue;
      const prof = profileColumn(dataRows, c, 12);
      if (prof.total < 3 || prof.numericRatio > 0.35 || prof.codeRatio > 0.55) continue;
      const sr = specishRatio(dataRows, c, 12);
      if (sr > 0.25 || looksLikeBadNameColumn(dataRows, c, 12)) continue;
      const score = 80 - Math.abs(prof.avgLen - 28) + prof.longTextRatio * 5;
      if (score > bestScore) { bestScore = score; bestCol = c; }
    }
    if (bestCol >= 0 && bestScore > 20) {
      map.name = bestCol;
      used.add(bestCol);
    } else {
      map._deriveNameFromSku = map.sku != null;
      if ((map._featureCols || []).length || (map._nameSourceCols || []).length) {
        map._deriveNameFromFeature = true;
        map._nameWeak = true;
      }
    }
  }

  // sku: nếu chưa có, tìm cột có codeRatio cao
  if (map.sku == null) {
    let bestCol = -1, bestRatio = 0.3;
    for (let c = 0; c <= maxCol; c++) {
      if (used.has(c) || c === map.currentListPrice || c === map.listPrice || c === map.minRetailPrice || (map._tierPriceCols || []).includes(c)) continue;
      const prof = profileColumn(dataRows, c);
      if (prof.codeRatio > bestRatio) { bestRatio = prof.codeRatio; bestCol = c; }
    }
    if (bestCol >= 0) { map.sku = bestCol; used.add(bestCol); }
  }
  if (map.name == null && map.sku != null) map._deriveNameFromSku = true;

  // price: nếu chưa có, tìm cột numeric với giá trị lớn nhất
  if (map.price == null) {
    let bestCol = -1, bestAvg = 0;
    for (let c = 0; c <= maxCol; c++) {
      if (used.has(c) || c === map.currentListPrice || c === map.listPrice || c === map.minRetailPrice || (map._tierPriceCols || []).includes(c)) continue;
      const prof = profileColumn(dataRows, c);
      if (prof.numericRatio < 0.5) continue;
      // ước lượng giá trị trung bình
      let sum = 0, cnt = 0;
      for (const row of dataRows.slice(0, 8)) {
        const n = parseInt((row.text[c] || "").replace(/[^\d]/g, "")) || 0;
        if (n >= 100) { sum += n; cnt++; }
      }
      const avg = cnt ? sum / cnt : 0;
      if (avg > bestAvg) { bestAvg = avg; bestCol = c; }
    }
    if (bestCol >= 0) { map.price = bestCol; used.add(bestCol); }
  }

  // ---- Guardrail: nếu cột name thực chất là thông số dài, đổi sang cột tên ngắn hơn ----
  if (map.name != null) {
    const nameHeaderLabel = headerRow ? String(headerRow.text[map.name] || "").trim() : "";
    const nameProf = profileColumn(dataRows, map.name, 12);
    const nameSpecish = specishRatio(dataRows, map.name, 12);
    // Nếu cột đang chọn làm name có header rõ ràng KHÔNG phải tên (Bảo hành, Số lượng...),
    // bỏ ngay và chuyển sang dựng tên từ feature/SKU.
    if (nameHeaderLabel && NON_NAME_HEADER_RE.test(nameHeaderLabel) && !map._lockedName) {
      delete map.name;
      if ((map._featureCols || []).length || (map._nameSourceCols || []).length) {
        map._deriveNameFromFeature = true;
        map._nameWeak = true;
      } else if (map.sku != null) {
        map._deriveNameFromSku = true;
      }
    } else if ((nameSpecish >= 0.45 || nameProf.avgLen > 110) && !map._lockedName) {
      let altCol = -1;
      let altScore = -Infinity;
      for (let c = 0; c <= maxCol; c++) {
        if (c === map.name || c === map.price || c === map.listPrice || c === map.minRetailPrice || c === map.unit || c === map.sku || c === map.category || c === map.supplier) continue;
        const prof = profileColumn(dataRows, c, 12);
        if (prof.total < 3 || prof.numericRatio > 0.35 || prof.codeRatio > 0.6) continue;
        const sr = specishRatio(dataRows, c, 12);
        // Tên sản phẩm thường ngắn hơn thông số, nhưng vẫn có chữ.
        if (prof.avgLen < 4 || prof.avgLen > 95 || sr > 0.35) continue;
        const score = 100 - Math.abs(prof.avgLen - 28) - sr * 50 + prof.longTextRatio * 8;
        if (score > altScore) { altScore = score; altCol = c; }
      }
      if (altCol >= 0) {
        if (map.specs == null) map.specs = map.name;
        map.name = altCol;
        map._nameWasSpecColumn = true;
      } else if (map.sku != null) {
        if (map.specs == null) map.specs = map.name;
        delete map.name;
        map._deriveNameFromSku = true;
      }
    } else if (looksLikeBadNameColumn(dataRows, map.name, 12) && map.sku != null) {
      delete map.name;
      map._deriveNameFromSku = true;
    }
  }

  // ---- Tính confidence ----
  let conf = 0;
  if (map.name != null) conf += 0.4;
  else if (map._deriveNameFromFeature) conf += 0.24;
  else if (map._deriveNameFromSku) conf += 0.18;
  if (map.price != null) conf += 0.28;
  if (map.listPrice != null) conf += 0.07;
  if (map.currentListPrice != null) conf += 0.09;
  if (map.sku != null) conf += 0.2;
  if (map.unit != null) conf += 0.05;
  if (map.specs != null) conf += 0.05;

  return { map, confidence: Math.min(1, conf) };
}

export { profileColumn, FIELD_RULES };
