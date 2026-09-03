import assert from "node:assert/strict";
import { detectHeader } from "../src/import-engine/detectHeader.js";
import { mapColumns } from "../src/import-engine/mapColumns.js";
import { detectRegions } from "../src/import-engine/detectRegions.js";
import { extractItemsWithStats } from "../src/import-engine/extractItems.js";
import { validateItems } from "../src/import-engine/validateItems.js";
import { scoreConfidence } from "../src/import-engine/scoreConfidence.js";
import { dedupeCatalogIdentities, sanitizeCatalogProducts, isLikelyOldQuoteSectionRow } from "../src/import-engine/productSanitizer.js";
import { buildCatalogPreview } from "../src/import-engine/legacy/legacyCatalogImport.js";

function row(r, values) {
  const text = Array(11).fill("");
  for (const [c, v] of Object.entries(values)) text[Number(c)] = String(v ?? "").replace(/\s+/g, " ").trim();
  const cells = text.map((v, c) => v ? ({ c, v, ref: `${String.fromCharCode(65 + c)}${r + 1}` }) : null).filter(Boolean);
  return { r, text, cells, joined: text.filter(Boolean).join(" "), filled: cells.length };
}

const rows = [
  row(5, { 0: "Khách hàng: KHÁCH MẪU", 4: "Số báo giá: BG-001" }),
  row(8, { 0: "Địa điểm công trình: Đà Nẵng", 4: "Điện thoại: 0901.234.567" }),
  row(12, { 0: "Khu vực lắp đặt", 2: "Tên hàng hoá/ Mô tả", 3: "Thông số kỹ thuật/Tính năng cơ bản", 4: "Hình ảnh", 5: "Mã thiết bị", 6: "Xuất xứ", 7: "ĐVT", 8: "Số lượng", 9: "Đơn giá", 10: "Thành tiền" }),
  row(13, { 0: "I. Giải pháp chiếu sáng tự động thông minh", 10: 67122000 }),
  row(14, { 0: "1./ Công tắc điện thông minh Lumi", 10: 64152000 }),
  row(15, { 0: "Tầng 1", 2: "Công tắc điện thông minh 1 nút", 3: "Mặt kính cường lực", 5: "LM-S1N/S", 6: "Lumi", 7: "Chiếc", 8: 33, 9: 1944000, 10: 64152000 }),
  row(16, { 0: "2./ Bộ điều khiển trung tâm Lumi", 10: 2970000 }),
  row(17, { 0: "Tầng 1", 2: "Bộ điều khiển trung tâm", 3: "Điện áp hoạt động 100 – 240V", 5: "LM-HC", 6: "Lumi", 7: "Bộ", 8: 1, 9: 2970000, 10: 2970000 }),
  // Numeric-looking text inside specs must never override the explicitly mapped unit-price cell.
  row(24, { 0: "Phòng khách", 2: "Bộ phát wifi chuyên dụng ốp trần", 3: "WiFi 6, tốc độ tối đa 1.267Gbps, MU-MIMO", 5: "RG-AP 2200F", 6: "RUIJIE", 7: "Cái", 8: 1, 9: 1440000, 10: 1440000 }),
  row(38, { 0: "VII/ Giải pháp chiếu sáng đèn Lumi lighting", 10: 39528000 }),
  // Section drift: Tên hàng hoá chứa SKU, Mã thiết bị lại chứa warranty.
  row(39, { 0: "Phòng giặt", 2: "LM-D9-90-110-W4-2", 3: "Đèn Downlight âm trần 9W - 110° Tính năng On/Off Nhiệt độ màu: 4000K CRI >90", 5: "BH 36 tháng", 6: "Lumi", 7: "Cái", 8: 5, 9: 216000, 10: 1080000 }),
  row(40, { 0: "Phòng bếp", 2: "LM-ST12-75-55-40CrBTC-O1", 3: "Đèn Spotlight âm trần 12W - 55°, chỉnh hướng Tính năng On/Off Nhiệt độ màu: 4000K", 5: "BH 36 tháng", 6: "Lumi", 7: "Cái", 8: 4, 9: 702000, 10: 2808000 }),
  row(41, { 0: "Phòng khách", 2: "LM-ST7-55-24-CrBTC-T1", 3: "Đèn Spotlight âm trần 7W - 24°, chỉnh hướng Tính năng Smart Tunable White Nhiệt độ màu", 5: "BH 36 tháng", 6: "Lumi", 7: "Cái", 8: 1, 9: 1080000, 10: 1080000 }),
  row(42, { 0: "Phòng khách", 2: "LM-ST12-75-55-CrBTC-T1", 3: "Đèn Spotlight âm trần 12W - 55°, chỉnh hướng Tính năng Smart Tunable White Nhiệt độ màu", 5: "BH 36 tháng", 6: "Lumi", 7: "Cái", 8: 6, 9: 1242000, 10: 7452000 }),
  row(43, { 0: "Ban công", 2: "LM-CS10-36W4-1", 3: "Đèn spotlight vuông ốp nổi 10W - 36° Tính năng On/Off Nhiệt độ màu: 4000K", 5: "BH 36 tháng", 6: "Lumi", 7: "Cái", 8: 1, 9: 1134000, 10: 1134000 }),
  row(44, { 0: "Phòng ăn", 2: "LM-ST7-55-24-CrBLC-T1", 3: "Đèn Spotlight âm trần 7W - 24°, chỉnh hướng, không viền Tính năng Smart Tunable White", 5: "BH 36 tháng", 6: "Lumi", 7: "Cái", 8: 2, 9: 1080000, 10: 2160000 }),
  row(45, { 0: "Phòng ăn", 2: "LM-ST12-75-55-CrBTC-T1", 3: "Đèn Spotlight âm trần 12W - 55°, chỉnh hướng Tính năng Smart Tunable White", 5: "BH 36 tháng", 6: "Lumi", 7: "Cái", 8: 5, 9: 1242000, 10: 6210000 }),
  row(46, { 0: "WC", 2: "LM-ST12-75-55-40CrBTC-O1", 3: "Đèn Spotlight âm trần 12W - 55°, chỉnh hướng Tính năng On/Off", 5: "BH 36 tháng", 6: "Lumi", 7: "Cái", 8: 12, 9: 702000, 10: 8424000 }),
  row(47, { 0: "Phòng ngủ 1", 2: "LM-ST7-55-24-40CrBTC-O1", 3: "Đèn Spotlight âm trần 7W - 24°, chỉnh hướng Tính năng On/Off", 5: "BH 36 tháng", 6: "Lumi", 7: "Cái", 8: 1, 9: 648000, 10: 648000 }),
  row(48, { 0: "Phòng ngủ 2", 2: "LM-ST12-75-55-CrBTC-T1", 3: "Đèn Spotlight âm trần 12W - 55°, chỉnh hướng Tính năng Smart Tunable White", 5: "BH 36 tháng", 6: "Lumi", 7: "Cái", 8: 6, 9: 1242000, 10: 7452000 }),
  row(49, { 0: "Phòng ngủ 2", 2: "LM-ST7-55-24-CrBLC-T1", 3: "Đèn Spotlight âm trần 7W - 24°, chỉnh hướng, không viền Tính năng Smart Tunable White", 5: "BH 36 tháng", 6: "Lumi", 7: "Cái", 8: 1, 9: 1080000, 10: 1080000 }),
  row(50, { 0: "TỔNG HỢP CÁC GIẢI PHÁP" }),
  row(57, { 0: "Tổng giá trị tiền hàng (tạm tính):", 10: 219429000 }),
];

const sheet = { name: "BG TEST", rows, maxCol: 10 };
const { headerRow, headerIndex } = detectHeader(rows);
assert.equal(headerRow?.r, 12);
const { map, confidence } = mapColumns(headerRow, rows.slice(headerIndex + 1), sheet.maxCol);
assert.equal(map.name, 2);
assert.equal(map.sku, 5);
assert.equal(map.quantity, 8);
assert.equal(map.price, 9);
assert.equal(map.lineTotal, 10);
assert.equal(map._quoteTable, true);
assert.equal(map._priceArithmeticConfirmed, true);

assert.equal(isLikelyOldQuoteSectionRow("1./ Công tắc điện thông minh Lumi"), true);
assert.equal(isLikelyOldQuoteSectionRow("2./ Bộ điều khiển trung tâm Lumi"), true);

const regions = detectRegions(sheet, {
  priceCol: map.price,
  nameCol: map.name,
  skuCol: map.sku,
  quantityCol: map.quantity,
  lineTotalCol: map.lineTotal,
  quoteTable: !!map._quoteTable,
  minSourceRow: headerRow.r,
});
assert.ok(!regions.some((r) => r.startRow === 14 || r.startRow === 16), "aggregate subheaders must never open a product region");

let extracted = [];
for (const region of regions) extracted.push(...extractItemsWithStats(sheet, region, map, headerRow.r, "").items);
assert.equal(extracted.length, 14, "3 normal products + 11 lighting occurrences must be recovered");
assert.equal(extracted.find((p) => p.sku === "RG-AP 2200F")?.costPrice, 1440000, "numeric-looking specs must not contaminate mapped unit price");
assert.ok(!extracted.some((p) => /^\d+\.\//.test(p.name)), "numbered group headers must not become products");

const lighting = extracted.filter((p) => /^LM-(?:D|ST|CS)/i.test(p.sku));
assert.equal(lighting.length, 11);
assert.ok(lighting.every((p) => (p.issues || []).some((x) => x.code === "section_schema_drift_recovered")));
assert.equal(lighting.find((p) => p.sku === "LM-D9-90-110-W4-2")?.name, "Đèn Downlight âm trần 9W - 110°");
assert.equal(lighting.find((p) => p.sku === "LM-ST12-75-55-40CrBTC-O1")?.name, "Đèn Spotlight âm trần 12W - 55°, chỉnh hướng");

const scored = scoreConfidence(validateItems(extracted), confidence);
const deduped = dedupeCatalogIdentities(scored);
assert.equal(deduped.deduped, 4, "four repeated lighting occurrences must collapse by SKU");
assert.equal(deduped.products.length, 10, "3 normal + 7 unique lighting identities");
const sanitized = sanitizeCatalogProducts(deduped.products, { oldQuoteMode: true, importSourceKind: "old_quote", sourceFileName: "BG_TEST.xlsx" });
assert.equal(sanitized.filter((p) => p._meta?.status === "review").length, 0, "recovered lighting rows must stay clean despite warranty text in specs");

// Manual “Sửa mapping” must use the same recovery + dedupe contract.
const manual = buildCatalogPreview(rows.filter((r) => r.r > headerRow.r).map((r) => r.text), {
  name: "2", sku: "5", supplier: "6", unit: "7", costPrice: "9", specs: "3",
}, { quoteTable: true, sheetName: "BG TEST" });
assert.equal(manual.length, 10);
assert.equal(manual.find((p) => p.sku === "RG-AP 2200F")?.costPrice, 1440000, "manual mapping must prefer mapped price cell over numeric-looking specs");
assert.ok(manual.some((p) => p.sku === "LM-D9-90-110-W4-2" && p.name === "Đèn Downlight âm trần 9W - 110°"));
assert.ok(!manual.some((p) => /^\d+\.\//.test(p.name)));

// Dedupe must never silently choose between conflicting prices for the same identity.
const conflicting = dedupeCatalogIdentities([
  { name: "Thiết bị mẫu", sku: "MODEL-X", costPrice: 1000000, confidence: 0.95, status: "new", issues: [] },
  { name: "Thiết bị mẫu", sku: "MODEL-X", costPrice: 1200000, confidence: 0.95, status: "new", issues: [] },
]);
assert.equal(conflicting.products.length, 1);
assert.equal(conflicting.conflicts, 1);
assert.equal(conflicting.products[0].status, "review");
assert.ok((conflicting.products[0].issues || []).some((x) => x.code === "duplicate_identity_price_conflict"));

console.log("✓ Phase 14.0 section-schema-drift smoke PASS");
console.log(`  occurrences: ${extracted.length} → unique: ${deduped.products.length} (${deduped.deduped} deduped)`);
console.log("  aggregate headers: 0 product; lighting schema drift: recovered; review: 0");
