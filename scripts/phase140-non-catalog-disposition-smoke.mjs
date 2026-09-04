import assert from "node:assert/strict";
import fs from "node:fs";
import { detectHeader } from "../src/import-engine/detectHeader.js";
import { mapColumns } from "../src/import-engine/mapColumns.js";
import { detectRegions, isQuoteContextSubtotalRow } from "../src/import-engine/detectRegions.js";
import { extractItemsWithStats } from "../src/import-engine/extractItems.js";
import { validateItems } from "../src/import-engine/validateItems.js";
import { scoreConfidence } from "../src/import-engine/scoreConfidence.js";
import { dedupeCatalogIdentities, sanitizeCatalogProduct } from "../src/import-engine/productSanitizer.js";
import { engineResultToImportPreviewResult, importPreviewLinesToProducts } from "../src/import-engine/previewResult.js";

function row(r, values) {
  const text = Array(11).fill("");
  for (const [c, v] of Object.entries(values)) text[Number(c)] = String(v ?? "").replace(/\s+/g, " ").trim();
  const cells = text.map((v, c) => v ? ({ c, v, ref: `${String.fromCharCode(65 + c)}${r + 1}` }) : null).filter(Boolean);
  return { r, text, cells, joined: text.filter(Boolean).join(" "), filled: cells.length };
}

// Synthetic quotation shaped like the hard cases seen in pilot files:
// - generic ancillary material with qty + unit price but no catalog identity
// - floor subtotal rows with line total only
// - repeated lighting SKU across floors that must dedupe, not be counted as skipped
const rows = [
  row(12, { 0: "Khu vực lắp đặt", 2: "Tên hàng hoá/ Mô tả", 3: "Thông số kỹ thuật/Tính năng cơ bản", 5: "Mã thiết bị", 6: "Xuất xứ", 7: "ĐVT", 8: "Số lượng", 9: "Đơn giá", 10: "Thành tiền" }),
  row(13, { 0: "I/ Giải pháp camera", 10: 2500000 }),
  row(14, { 0: "Phòng khách", 2: "Camera ngoài trời", 3: "Camera 4MP", 5: "CAM-4MP", 6: "Hãng A", 7: "Bộ", 8: 1, 9: 2000000, 10: 2000000 }),
  row(15, { 0: "Vật tư phụ (đầu mạng, dây nhảy, băng keo...)", 7: "Gói", 8: 1, 9: 500000, 10: 500000 }),
  row(16, { 0: "II/ Giải pháp đèn", 10: 4000000 }),
  row(17, { 0: "Tầng 1", 10: 2000000 }),
  row(18, { 0: "1", 2: "LIGHT-01", 3: "Đèn Spotlight âm trần 12W", 5: "LIGHT-01", 6: "Hãng B", 7: "Cái", 8: 2, 9: 1000000, 10: 2000000 }),
  row(19, { 0: "Tầng 2", 10: 2000000 }),
  row(20, { 0: "1", 2: "LIGHT-01", 3: "Đèn Spotlight âm trần 12W", 5: "LIGHT-01", 6: "Hãng B", 7: "Cái", 8: 2, 9: 1000000, 10: 2000000 }),
];

const sheet = { name: "BG PILOT", rows, maxCol: 10 };
const { headerRow, headerIndex } = detectHeader(rows);
assert.equal(headerRow?.r, 12);
const { map, confidence } = mapColumns(headerRow, rows.slice(headerIndex + 1), sheet.maxCol);
assert.equal(map._quoteTable, true);

const preMap = {
  priceCol: map.price,
  nameCol: map.name,
  skuCol: map.sku,
  quantityCol: map.quantity,
  lineTotalCol: map.lineTotal,
  quoteTable: true,
  minSourceRow: headerRow.r,
};
const contextSubtotals = rows.filter((r) => r.r > headerRow.r && isQuoteContextSubtotalRow(r, preMap));
assert.deepEqual(contextSubtotals.map((r) => r.text[0]), ["Tầng 1", "Tầng 2"]);

const regions = detectRegions(sheet, preMap);
assert.ok(!regions.some((r) => r.startRow === 17 || r.startRow === 19), "floor subtotal must not become preview product regions");

let items = [];
for (const region of regions) items.push(...extractItemsWithStats(sheet, region, map, headerRow.r, "").items);
const scored = scoreConfidence(validateItems(items), confidence);
const deduped = dedupeCatalogIdentities(scored);

const generic = deduped.products.find((p) => /vật tư phụ|vat tu phu/i.test(p.source?.rawText || ""));
assert.ok(generic, "generic ancillary row should remain auditable inside engine output");
assert.equal(generic.status, "skipped", "generic ancillary row must be dispositioned as skipped, never review/error");
assert.equal(deduped.deduped, 1, "repeated lighting occurrence must be merged, not skipped");


// UI hardening: even if a stale/manual mapping has already copied a context label
// into both product name and SKU, sanitizer must still disposition it as skipped.
const mappedFloorSubtotal = sanitizeCatalogProduct({
  name: "Tầng 1",
  sku: "Tầng 1",
  costPrice: 50139000,
  unit: "",
  specs: "",
  _meta: { source: { rawText: "Tầng 1 50.139.000", fileName: "3-1-25 BG VILLA BÙI VIỆN.xlsx" } },
}, { oldQuoteMode: true, sourceFileName: "3-1-25 BG VILLA BÙI VIỆN.xlsx" });
assert.equal(mappedFloorSubtotal?._meta?.canonicalStatus, "skipped", "mis-mapped floor subtotal must be skipped even when copied into SKU");

const mappedGenericMaterial = sanitizeCatalogProduct({
  name: "Vật tư phụ: dây điện, đá cắt, ống gen, ruột gà",
  sku: "VT-PHU",
  costPrice: 2500000,
  unit: "Gói",
  specs: "",
  _meta: { source: { rawText: "Vật tư phụ: dây điện, đá cắt, ống gen, ruột gà 2.500.000", fileName: "3-1-25 BG VILLA BÙI VIỆN.xlsx" } },
}, { oldQuoteMode: true, sourceFileName: "3-1-25 BG VILLA BÙI VIỆN.xlsx" });
assert.equal(mappedGenericMaterial?._meta?.canonicalStatus, "skipped", "generic ancillary row must be skipped before pseudo-SKU evidence can rescue it");

const result = {
  items: deduped.products,
  templateId: "synthetic",
  templateKnown: false,
  domain: "lighting",
  engine: "v2",
  warnings: [],
  stats: {
    total: deduped.products.length,
    sourceRows: rows.length - 1,
    skipped: contextSubtotals.length,
    noteRows: 0,
    matched: 0,
    new: deduped.products.filter((p) => p.status === "new").length,
    review: 0,
    rejected: 0,
    aiUsed: 0,
  },
};
const preview = engineResultToImportPreviewResult(result, "BG_PILOT.xlsx");
const products = importPreviewLinesToProducts(preview);

assert.equal(products.length, 2, "only real catalog identities should reach UI products");
assert.deepEqual(products.map((p) => p.sku).sort(), ["CAM-4MP", "LIGHT-01"]);
assert.equal(preview.summary.skipped, 3, "2 floor subtotals + 1 generic ancillary row must be reported as skipped");
assert.equal(preview.summary.needReview, 0);
assert.equal(preview.summary.failed, 0);

const jsx = fs.readFileSync(new URL("../src/SmartQuote.jsx", import.meta.url), "utf8");
assert.ok(jsx.includes("splitCatalogPreviewProducts"), "UI must partition skipped rows away from preview products");
assert.ok(jsx.includes("Không thuộc catalog"), "processing details must expose auto-skipped non-catalog rows");
assert.ok(jsx.includes("tự bỏ qua"), "customer copy must describe automatic non-catalog disposition");

console.log("✓ Phase 14.0 non-catalog disposition smoke PASS");
console.log(`  catalog: ${products.length} clean · skipped: ${preview.summary.skipped} · review: 0 · failed: 0`);
