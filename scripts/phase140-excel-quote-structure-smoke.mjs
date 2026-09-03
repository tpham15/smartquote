import assert from "node:assert/strict";
import { detectHeader } from "../src/import-engine/detectHeader.js";
import { mapColumns } from "../src/import-engine/mapColumns.js";
import { detectRegions } from "../src/import-engine/detectRegions.js";
import { extractItemsWithStats } from "../src/import-engine/extractItems.js";
import { validateItems } from "../src/import-engine/validateItems.js";
import { scoreConfidence } from "../src/import-engine/scoreConfidence.js";
import { classifyRow } from "../src/import-engine/classifyRows.js";
import { parseSafePrice, isLikelyNonProductRow } from "../src/import-engine/productSanitizer.js";
import { buildCatalogPreview } from "../src/import-engine/legacy/legacyCatalogImport.js";

function row(r, values) {
  const text = Array(12).fill("");
  for (const [c, v] of Object.entries(values)) text[Number(c)] = String(v ?? "");
  const cells = text.map((v, c) => v ? ({ c, v, ref: `${String.fromCharCode(65 + c)}${r + 1}` }) : null).filter(Boolean);
  return { r, text, cells, joined: text.filter(Boolean).join(" "), filled: cells.length };
}

// Mirrors a Vietnamese quotation sheet with blank rows omitted by normalizeWorkbook.
// Source row numbers deliberately do not match compact array indexes.
const rows = [
  row(0, { 0: "CÔNG TY MẪU", 1: "MST: 0400000000", 2: "Điện thoại: 0901 234 567" }),
  row(5, { 0: "Khách hàng: CÔNG TRÌNH MẪU", 5: "Số báo giá: BG-001" }),
  row(6, { 0: "Điện thoại: 0901.234.567", 5: "Ngày: 03/09/2026" }),
  row(8, { 0: "Địa điểm công trình: Hội An", 5: "Điện thoại: 0901.234.567" }),
  row(9, { 0: "Hạng mục: Giải pháp nhà thông minh" }),
  row(10, { 0: "BẢNG BÁO GIÁ TỔNG HỢP" }),
  row(12, { 0: "STT", 1: "Khu vực lắp đặt", 2: "Tên hàng hoá/ Mô tả", 3: "Thông số kỹ thuật/Tính năng cơ bản", 4: "Hình ảnh", 5: "Mã thiết bị", 6: "Xuất xứ", 7: "ĐVT", 8: "Số lượng", 9: "Đơn giá", 10: "Thành tiền", 11: "Ghi chú" }),
  row(13, { 0: "I./ Giải pháp chiếu sáng tự động thông minh" }),
  row(14, { 0: 1, 1: "Tầng 1", 2: "Công tắc cơ thông minh 1 nút", 3: "Zigbee 220V", 5: "LM-1G2W-C(G)", 6: "Lumi", 7: "Cái", 8: 10, 9: 1026000, 10: 10260000 }),
  row(15, { 0: 2, 1: "Tầng 2", 2: "Công tắc cơ thông minh 2 nút", 3: "Zigbee 220V", 5: "LM-2G2W-C(G)", 6: "Lumi", 7: "Cái", 8: 12, 9: 1080000, 10: 12960000 }),
  row(16, { 0: 3, 1: "Tầng 2", 2: "Cảm biến hiện diện BLE âm trần", 3: "220VAC/50Hz", 5: "LM-PCB", 6: "Lumi", 7: "Bộ", 8: 12, 9: 1593000, 10: 19116000 }),
  // Dữ liệu bẩn quan sát được từ báo giá cũ: section bị lưu vào Tên/Mã kèm giá.
  // Catalog import phải loại, không biến thành product master.
  row(17, { 0: 4, 1: "Âm thanh đa vùng", 2: "Sản phẩm III/ Giải pháp âm thanh đa vùng", 5: "III/ Giải pháp âm thanh đa vùng", 7: "Cái", 8: 1, 9: 14488000, 10: 14488000 }),
  row(18, { 0: 5, 1: "Wifi / mạng", 2: "Sản phẩm IV/ Hệ thống mạng nội bộ + Wifi", 5: "IV/ Hệ thống mạng nội bộ + Wifi", 7: "Cái", 8: 1, 9: 6855000, 10: 6855000 }),
  row(19, { 0: 6, 1: "Chiếu sáng", 2: "Cảm biến BH 36 tháng", 5: "BH 36 tháng", 6: "Lumi", 7: "Cái", 8: 1, 9: 1242000, 10: 1242000 }),
  row(20, { 0: "Tổng tiền hàng:", 10: 42336000 }),
  row(21, { 0: "Nhân công thi công lắp đặt và cài đặt lập trình", 10: 4233600 }),
  row(22, { 0: "Tổng giá trị hợp đồng", 10: 46569600 }),
  row(26, { 0: "QUY TRÌNH LÀM VIỆC" }),
  row(27, { 0: "STT", 2: "Tên quy trình", 9: "Thời gian", 10: "Tiến độ thanh toán" }),
  row(28, { 0: 1, 2: "Trình bày giải pháp và lắng nghe yêu cầu khách hàng", 9: "1 buổi" }),
];
const sheet = { name: "Sheet2", rows, maxCol: 11 };

const header = detectHeader(rows);
assert.equal(header.headerRow?.r, 12, "must detect the real product-table header, not document metadata");
assert.ok(header.headerIndex >= 0 && header.headerIndex !== header.headerRow.r, "fixture must exercise compact-index/source-row mismatch");

const dataRows = rows.slice(header.headerIndex + 1);
const { map, confidence } = mapColumns(header.headerRow, dataRows, sheet.maxCol);
assert.equal(map.name, 2, "explicit Tên hàng hoá header must stay locked as product name");
assert.equal(map.sku, 5);
assert.equal(map.quantity, 8);
assert.equal(map.price, 9);
assert.equal(map.lineTotal, 10);
assert.equal(map._quoteTable, true);
assert.equal(map._priceColUncertain, false, "explicit quote unit price must not force manual price-column confirmation");
assert.equal(map._priceArithmeticConfirmed, true, "SL × Đơn giá = Thành tiền should confirm price mapping");
assert.ok(!(map._tierPriceCols || []).includes(8), "quantity column must never be treated as a tier-price column");
assert.ok(confidence >= 0.9);

const regions = detectRegions(sheet, { priceCol: map.price, nameCol: map.name, minSourceRow: header.headerRow.r });
assert.ok(regions.length >= 1);
assert.ok(regions.every(r => r.startRow > header.headerRow.r), "regions must never cross above the actual header source row");

let extracted = [];
for (const region of regions) {
  extracted.push(...extractItemsWithStats(sheet, region, map, header.headerRow.r, "").items);
}
assert.equal(extracted.length, 3, "only the three product rows should survive; metadata/totals/labor/workflow must not become catalog products");
assert.deepEqual(extracted.map(x => x.sku), ["LM-1G2W-C(G)", "LM-2G2W-C(G)", "LM-PCB"]);
assert.deepEqual(extracted.map(x => x.name), ["Công tắc cơ thông minh 1 nút", "Công tắc cơ thông minh 2 nút", "Cảm biến hiện diện BLE âm trần"], "explicit product-name column must preserve commercial names");
assert.deepEqual(extracted.map(x => x.price), [1026000, 1080000, 1593000]);
assert.deepEqual(extracted.map(x => x.listPrice), [1026000, 1080000, 1593000], "old-quote Đơn giá must be preserved as fixed price, not markup base only");
assert.ok(extracted.every(x => x.priceMode === "fixed"));

const scored = scoreConfidence(validateItems(extracted), confidence);
assert.ok(scored.every(x => x.status !== "review" && x.status !== "rejected"), "well-grounded quote rows should be clean/new, not all need review");
assert.ok(scored.every(x => !(x.issues || []).some(i => i.code === "price_column_uncertain")));

for (const metadata of [
  "Khách hàng: CÔNG TRÌNH MẪU Số báo giá: BG-001",
  "Địa điểm công trình: Hội An Điện thoại: 0901.234.567",
  "Điện thoại: 0901.234.567",
]) {
  const r = row(1, { 0: metadata });
  assert.equal(classifyRow(r, { maxCol: 11 }), "note", `${metadata} must be metadata/note`);
  assert.equal(parseSafePrice(metadata), 0, `${metadata} must never produce a price`);
  assert.equal(isLikelyNonProductRow(metadata), true);
}


// Manual "Sửa mapping" phải tuân cùng safety contract với engine deterministic.
const manualRows = rows.filter(r => r.r > header.headerRow.r).map(r => r.text);
const manual = buildCatalogPreview(manualRows, { name: "2", sku: "5", supplier: "6", unit: "7", costPrice: "9", specs: "3" }, { quoteTable: true, sheetName: "Sheet2" });
assert.equal(manual.length, 3, "manual quote mapping must exclude metadata/sections/warranty pseudo rows/zero-price workflow rows");
assert.deepEqual(manual.map(x => x.name), ["Công tắc cơ thông minh 1 nút", "Công tắc cơ thông minh 2 nút", "Cảm biến hiện diện BLE âm trần"]);
assert.deepEqual(manual.map(x => x.sku), ["LM-1G2W-C(G)", "LM-2G2W-C(G)", "LM-PCB"]);

console.log("✓ Phase 14.0 Excel quote-structure smoke PASS");
console.log(`  header source row: ${header.headerRow.r + 1}; mapping confidence: ${confidence.toFixed(2)}`);
console.log(`  products: ${scored.length}; review/rejected: ${scored.filter(x => ["review","rejected"].includes(x.status)).length}`);
console.log("  metadata/phone rows: hard-skipped before price parsing");
