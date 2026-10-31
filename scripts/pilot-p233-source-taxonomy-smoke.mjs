import assert from "node:assert/strict";
import { rowToItem } from "../src/import-engine/extractItems.js";
import { sanitizeCatalogProduct } from "../src/import-engine/productSanitizer.js";
import { extractSheetDocumentContext } from "../src/import-engine/sheetContext.js";

const contextSamples = [
  ["Quy Cách: Cổng  Âm sàn tự động", "Cổng Âm sàn tự động"],
  ["Quy Cách: Cổng trượt tự động Ngày báo giá: 22/07/2025", "Cổng trượt tự động"],
  ["Quy Cách: Cổng tay đòn tự động", "Cổng tay đòn tự động"],
];
for (const [raw, expected] of contextSamples) {
  assert.equal(extractSheetDocumentContext([{ joined: raw }]).quoteSpecification, expected);
}

// Exact identity/taxonomy evidence from Form BG _Bisco Tech_V2_2025.xlsx.
const cases = [
  {
    sheet: "VUCAN - 24V", documentCategory: "Cổng Âm sàn tự động", section: "ĐỘNG CƠ CỔNG TỰ ĐỘNG ",
    rawSku: "Vulcan - 24V (29G020)", sku: "29G020",
    description: "Cổng xoay tự động âm sàn V2 - VULCAN 24V\nModel : 29G020\nThông số kỹ thuật:\nĐộng cơ điện 24V AC",
    category: "Cổng âm sàn tự động", productType: "Cổng xoay tự động âm sàn", subtype: "Âm sàn", model: "VULCAN 24V",
    name: "Cổng xoay tự động âm sàn V2 - VULCAN 24V",
  },
  {
    sheet: "VUCAN - 230V", documentCategory: "Cổng Âm sàn tự động", section: "ĐỘNG CƠ CỔNG TỰ ĐỘNG ",
    rawSku: "Vulcan - 230V (29G019)", sku: "29G019",
    description: "Cổng xoay tự động âm sàn V2 VULCAN 230V\nModel : 29G019\nThông số kỹ thuật\nNguồn điện vào 230V AC",
    category: "Cổng âm sàn tự động", productType: "Cổng xoay tự động âm sàn", subtype: "Âm sàn", model: "VULCAN 230V",
    name: "Cổng xoay tự động âm sàn V2 - VULCAN 230V",
  },
  {
    sheet: "TORQ 500D - 24V", documentCategory: "Cổng trượt tự động", section: "ĐỘNG CƠ CỔNG TRƯỢT TỰ ĐỘNG",
    rawSku: "TORQ 500D", sku: "30C109",
    description: "MÔ TƠ CỔNG TRƯỢT V2 - TORQ - 500D\nModel : 30C109\nThông số kỹ thuật\nĐộng cơ 24V AC",
    category: "Cổng trượt tự động", productType: "Mô tơ cổng trượt", subtype: "Trượt", model: "TORQ 500D",
    name: "Mô tơ cổng trượt V2 - TORQ 500D",
  },
  {
    sheet: "AYROS 1000D-24V", documentCategory: "Cổng trượt tự động", section: "ĐỘNG CƠ CỔNG TRƯỢT TỰ ĐỘNG",
    rawSku: "AYROS 1000D (30C074)", sku: "30C-074",
    description: "MÔ TƠ CỔNG TRƯỢT V2 - AYROS - 1000D\nModel : 30C-074\nThông số kỹ thuật\nĐộng cơ 24V AC",
    category: "Cổng trượt tự động", productType: "Mô tơ cổng trượt", subtype: "Trượt", model: "AYROS 1000D",
    name: "Mô tơ cổng trượt V2 - AYROS 1000D",
  },
  {
    sheet: "NYK - 24V", documentCategory: "Cổng tay đòn tự động", section: "ĐỘNG CƠ CỔNG TỰ ĐỘNG ",
    rawSku: "NYK - 24V", sku: "29H001",
    description: "Mô tơ cổng Mở xoay tự động NYK - 24V\nModel : 29H001\nThông số kỹ thuật:\nĐộng cơ điện 24V AC",
    category: "Cổng tay đòn tự động", productType: "Mô tơ cổng mở xoay tự động", subtype: "Tay đòn / mở xoay", model: "NYK 24V",
    name: "Mô tơ cổng mở xoay tự động NYK 24V",
  },
  {
    sheet: "STAR K3 -24V", documentCategory: "Cổng tay đòn tự động", section: "ĐỘNG CƠ CỔNG TỰ ĐỘNG ",
    rawSku: "STAR K3- 24V", sku: "29H003",
    description: "Mô tơ cổng Mở xoay tự động STAR K3 - 24V\nModel : 29H003\nThông số kỹ thuật:\nĐộng cơ điện 24V AC",
    category: "Cổng tay đòn tự động", productType: "Mô tơ cổng mở xoay tự động", subtype: "Tay đòn / mở xoay", model: "STAR K3 24V",
    name: "Mô tơ cổng mở xoay tự động STAR K3 24V",
  },
  {
    sheet: "AYROS 650", documentCategory: "Cổng trượt tự động", section: "ĐỘNG CƠ CỔNG TRƯỢT TỰ ĐỘNG",
    rawSku: "AYROS 650 (30C065)", sku: "30C-065",
    description: "MÔ TƠ CỔNG TRƯỢT AYROS 650\nModel : 30C-065\nThông số kỹ thuật\nĐộng cơ 24V AC",
    category: "Cổng trượt tự động", productType: "Mô tơ cổng trượt", subtype: "Trượt", model: "AYROS 650",
    name: "Mô tơ cổng trượt AYROS 650",
  },
  {
    sheet: "AYROS 650 V2", documentCategory: "Cổng trượt tự động", section: "ĐỘNG CƠ CỔNG TRƯỢT TỰ ĐỘNG",
    rawSku: "AYROS 650 (30C065V2)", sku: "30C-065 V2",
    description: "MÔ TƠ CỔNG TRƯỢT AYROS 650\nModel : 30C-065 V2\nThông số kỹ thuật\nĐộng cơ 24V AC",
    category: "Cổng trượt tự động", productType: "Mô tơ cổng trượt", subtype: "Trượt", model: "AYROS 650",
    name: "Mô tơ cổng trượt AYROS 650",
  },
  {
    sheet: "STARK600", documentCategory: "Cổng tay đòn tự động", section: "ĐỘNG CƠ CỔNG TỰ ĐỘNG ",
    rawSku: "29H006V2", sku: "29H006V2",
    description: "Mô tơ cổng Mở xoay tự động STARK 600 V2\nModel : 29H006V2\nThông số kỹ thuật:\nĐộng cơ điện 24V AC",
    category: "Cổng tay đòn tự động", productType: "Mô tơ cổng mở xoay tự động", subtype: "Tay đòn / mở xoay", model: "STARK 600 V2",
    name: "Mô tơ cổng mở xoay tự động STARK 600 V2",
  },
];

for (const c of cases) {
  const cells = ["1", c.description, c.rawSku, "Italia", "bộ", "1", "29900000", "29900000", ""];
  const row = { r: 17, text: cells, cells: cells.map((v, i) => ({ ref: `${String.fromCharCode(65 + i)}18`, v })), joined: cells.filter(Boolean).join(" | ") };
  const map = { specs: 1, sku: 2, origin: 3, unit: 4, quantity: 5, price: 6, lineTotal: 7, _quoteTable: true, _priceSourceLabel: "Đơn Giá", _nameSourceCols: [1], _deriveNameFromSku: true, _nameWeak: true };
  const extracted = rowToItem(row, map, c.sheet, c.section, "Bisco Tech", { quoteSpecification: c.documentCategory });
  assert.ok(extracted, `${c.sheet}: extraction returned null`);
  assert.equal(extracted.source.documentCategory, c.documentCategory, `${c.sheet}: Quy Cách must survive as provenance`);

  const p = sanitizeCatalogProduct(extracted, { oldQuoteMode: true, sourceFileName: "Form BG _Bisco Tech_V2_2025.xlsx" });
  assert.equal(p.attributes.identity.family, "Cổng tự động", `${c.sheet}: broad family only`);
  assert.equal(p.category, c.category, `${c.sheet}: source category must stay specific`);
  assert.equal(p.productType, c.productType, `${c.sheet}: product type must come from source product line`);
  assert.equal(p.subtype, c.subtype, `${c.sheet}: subtype`);
  assert.equal(p.model, c.model, `${c.sheet}: commercial model`);
  assert.equal(p.sku, c.sku, `${c.sheet}: canonical SKU`);
  assert.equal(p.name, c.name, `${c.sheet}: canonical name must preserve source terminology`);
  assert.equal(p.attributes.identity.semanticRule, "gate_source_taxonomy");
}

console.log("✓ P2.3.3 source taxonomy PASS");
console.log("  - Cổng tự động is family only, not the category forced onto every Bisco row");
console.log("  - Quy Cách survives as documentCategory provenance");
console.log("  - product type/name preserve source terminology: Cổng xoay... vs Mô tơ cổng trượt...");
console.log("  - all 9 Bisco products keep canonical Model/SKU separation");
