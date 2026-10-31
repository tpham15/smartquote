import assert from "node:assert/strict";
import { rowToItem } from "../src/import-engine/extractItems.js";
import { sanitizeCatalogProduct } from "../src/import-engine/productSanitizer.js";
import { deriveProductSemantics, canonicalizeLegacyProductForMatching } from "../src/import-engine/productSemantics.js";

const cases = [
  {
    sheet: "VUCAN - 24V", rawSku: "Vulcan - 24V (29G020)", sku: "29G020",
    description: "Cổng xoay tự động âm sàn V2 - VULCAN 24V\nModel : 29G020\nThông số kỹ thuật\nĐộng cơ điện 24V AC",
    subtype: "Âm sàn", model: "VULCAN 24V", name: "Động cơ cổng tự động âm sàn VULCAN 24V",
  },
  {
    sheet: "VUCAN - 230V", rawSku: "Vulcan - 230V (29G019)", sku: "29G019",
    description: "Cổng xoay tự động âm sàn V2 VULCAN 230V\nModel : 29G019\nThông số kỹ thuật\nNguồn điện vào 230V AC",
    subtype: "Âm sàn", model: "VULCAN 230V", name: "Động cơ cổng tự động âm sàn VULCAN 230V",
  },
  {
    sheet: "TORQ 500D - 24V", rawSku: "TORQ 500D", sku: "30C109",
    description: "MÔ TƠ CỔNG TRƯỢT V2 - TORQ - 500D\nModel : 30C109\nThông số kỹ thuật\nĐộng cơ 24V AC",
    subtype: "Cổng trượt", model: "TORQ 500D", name: "Động cơ cổng trượt tự động TORQ 500D",
  },
  {
    sheet: "AYROS 1000D-24V", rawSku: "AYROS 1000D (30C074)", sku: "30C-074",
    description: "MÔ TƠ CỔNG TRƯỢT V2 - AYROS - 1000D\nModel : 30C-074\nThông số kỹ thuật\nĐộng cơ 24V AC",
    subtype: "Cổng trượt", model: "AYROS 1000D", name: "Động cơ cổng trượt tự động AYROS 1000D",
  },
  {
    sheet: "NYK - 24V", rawSku: "NYK - 24V", sku: "29H001",
    description: "Mô tơ cổng Mở xoay tự động NYK - 24V\nModel : 29H001\nThông số kỹ thuật:\nĐộng cơ điện 24V AC",
    subtype: "Tay đòn / mở xoay", model: "NYK 24V", name: "Động cơ cổng mở xoay tay đòn NYK 24V",
  },
  {
    sheet: "STAR K3 -24V", rawSku: "STAR K3- 24V", sku: "29H003",
    description: "Mô tơ cổng Mở xoay tự động STAR K3 - 24V\nModel : 29H003\nThông số kỹ thuật:\nĐộng cơ điện 24V AC",
    subtype: "Tay đòn / mở xoay", model: "STAR K3 24V", name: "Động cơ cổng mở xoay tay đòn STAR K3 24V",
  },
  {
    sheet: "AYROS 650", rawSku: "AYROS 650 (30C065)", sku: "30C-065",
    description: "MÔ TƠ CỔNG TRƯỢT AYROS 650\nModel : 30C-065\nThông số kỹ thuật\nĐộng cơ 24V AC",
    subtype: "Cổng trượt", model: "AYROS 650", name: "Động cơ cổng trượt tự động AYROS 650",
  },
  {
    sheet: "AYROS 650 V2", rawSku: "AYROS 650 (30C065V2)", sku: "30C-065 V2",
    description: "MÔ TƠ CỔNG TRƯỢT AYROS 650\nModel : 30C-065 V2\nThông số kỹ thuật\nĐộng cơ 24V AC",
    subtype: "Cổng trượt", model: "AYROS 650", name: "Động cơ cổng trượt tự động AYROS 650",
  },
  {
    sheet: "STARK600", rawSku: "29H006V2", sku: "29H006V2",
    description: "Mô tơ cổng Mở xoay tự động STARK 600 V2\nModel : 29H006V2\nThông số kỹ thuật:\nĐộng cơ điện 24V AC",
    subtype: "Tay đòn / mở xoay", model: "STARK 600 V2", name: "Động cơ cổng mở xoay tay đòn STARK 600 V2",
  },
];

for (const c of cases) {
  const text = ["1", c.description, c.rawSku, "Bisco Tech", "bộ", "1", "24900000", "24900000", ""];
  const row = { r: 16, text, cells: text.map((v, i) => ({ ref: `${String.fromCharCode(65 + i)}17`, v })), joined: text.filter(Boolean).join(" | ") };
  const map = { specs: 1, sku: 2, supplier: 3, unit: 4, quantity: 5, price: 6, lineTotal: 7, _quoteTable: true, _priceSourceLabel: "Đơn Giá", _nameSourceCols: [1], _deriveNameFromSku: true, _nameWeak: true };
  const extracted = rowToItem(row, map, c.sheet, "ĐỘNG CƠ CỔNG TỰ ĐỘNG", "");
  assert.ok(extracted, `${c.sheet}: extraction returned null`);
  const p = sanitizeCatalogProduct(extracted, { oldQuoteMode: true, sourceFileName: "Bisco quotation.xlsx" });
  assert.equal(p.category, "Cổng tự động", `${c.sheet}: broad category`);
  assert.equal(p.productType, "Động cơ cổng tự động", `${c.sheet}: actual product type`);
  assert.equal(p.subtype, c.subtype, `${c.sheet}: subtype`);
  assert.equal(p.model, c.model, `${c.sheet}: commercial model`);
  assert.equal(p.sku, c.sku, `${c.sheet}: canonical SKU`);
  assert.equal(p.name, c.name, `${c.sheet}: canonical sellable product name`);
  assert.equal(p.attributes.identity.category, "Cổng tự động");
  assert.equal(p.attributes.identity.productType, "Động cơ cổng tự động");
  assert.equal(p.attributes.identity.model, c.model);
  assert.equal(p.attributes.identity.sku, c.sku);
  assert.ok(p.attributes.identity.sourceName, `${c.sheet}: source name preserved`);
  assert.equal(p.attributes.identity.semanticRule, "gate_motor");
}


const legacySaved = canonicalizeLegacyProductForMatching({
  name: "Cổng tự động Vulcan-24V (29G020)",
  sku: "Vulcan-24V (29G020)",
  category: "Cổng tự động",
  supplier: "Bisco Tech",
  specs: "Cổng xoay tự động âm sàn V2 - VULCAN 24V\nModel : 29G020\nĐộng cơ điện 24V AC",
});
assert.equal(legacySaved.sku, "29G020", "legacy saved alias SKU should be repaired from explicit Model evidence");
assert.equal(legacySaved.name, "Động cơ cổng tự động âm sàn VULCAN 24V");
assert.equal(legacySaved.attributes.identity.sourceAlias, "Vulcan-24V (29G020)");

// Category alone must NOT be rewritten into a motor. This prevents a whole
// automatic-gate assembly or accessory from being mislabeled as a motor.
const wholeGate = deriveProductSemantics({
  name: "Bộ cổng tự động hoàn chỉnh 4m",
  category: "Cổng tự động",
  sku: "GATE-KIT-4M",
  specs: "Bộ cổng hoàn chỉnh gồm khung và phụ kiện",
});
assert.equal(wholeGate.evidence.rule, "none");
assert.equal(wholeGate.canonicalName, "Bộ cổng tự động hoàn chỉnh 4m");

console.log("✓ P2.3.2 product semantics PASS");
console.log("  - Category != Product Type != Subtype != Model != SKU != Canonical Name");
console.log("  - 9 Bisco gate motor identities canonicalized without per-row patches");
console.log("  - broad gate category alone never forces a motor identity");
