import assert from "node:assert/strict";
import { rowToItem } from "../src/import-engine/extractItems.js";
import { extractExplicitIdentityCode, resolveCanonicalQuoteIdentity, sanitizeCatalogProduct, extractSkuFromText } from "../src/import-engine/productSanitizer.js";
import { normalizeIdentitySku } from "../src/import-engine/productIdentity.js";

const cases = [
  {
    sheet: "VUCAN - 24V",
    rawSku: "Vulcan - 24V (29G020)",
    description: "Cổng xoay tự động âm sàn V2 - VULCAN 24V\nModel : 29G020\nThông số kỹ thuật\nĐộng cơ điện 24V AC",
    expectedSku: "29G020",
    expectedName: "Cổng xoay tự động âm sàn V2 - VULCAN 24V",
  },
  {
    sheet: "VUCAN - 230V",
    rawSku: "Vulcan - 230V (29G019)",
    description: "Cổng xoay tự động âm sàn V2 VULCAN 230V\nModel : 29G019\nThông số kỹ thuật\nNguồn điện vào 230V AC",
    expectedSku: "29G019",
    expectedName: "Cổng xoay tự động âm sàn V2 VULCAN 230V",
  },
  {
    sheet: "TORQ 500D - 24V",
    rawSku: "TORQ 500D",
    description: "MÔ TƠ CỔNG TRƯỢT V2 - TORQ - 500D\nModel : 30C109\nThông số kỹ thuật\nĐộng cơ 24V AC",
    expectedSku: "30C109",
    expectedName: "MÔ TƠ CỔNG TRƯỢT V2 - TORQ - 500D",
  },
  {
    sheet: "AYROS 1000D-24V",
    rawSku: "AYROS 1000D (30C074)",
    description: "MÔ TƠ CỔNG TRƯỢT V2 - AYROS - 1000D\nModel : 30C-074\nThông số kỹ thuật\nĐộng cơ 24V AC",
    expectedSku: "30C-074",
    expectedName: "MÔ TƠ CỔNG TRƯỢT V2 - AYROS - 1000D",
  },
  {
    sheet: "NYK - 24V",
    rawSku: "NYK - 24V",
    description: "Mô tơ cổng Mở xoay tự động NYK - 24V\nModel : 29H001\nThông số kỹ thuật:\nĐộng cơ điện 24V AC",
    expectedSku: "29H001",
    expectedName: "Mô tơ cổng Mở xoay tự động NYK - 24V",
  },
  {
    sheet: "STAR K3 -24V",
    rawSku: "STAR K3- 24V",
    description: "Mô tơ cổng Mở xoay tự động STAR K3 - 24V\nModel : 29H003\nThông số kỹ thuật:\nĐộng cơ điện 24V AC",
    expectedSku: "29H003",
    expectedName: "Mô tơ cổng Mở xoay tự động STAR K3 - 24V",
  },  {
    sheet: "AYROS 650",
    rawSku: "AYROS 650 (30C065)",
    description: "MÔ TƠ CỔNG TRƯỢT AYROS 650\nModel : 30C-065\nThông số kỹ thuật\nĐộng cơ 24V AC",
    expectedSku: "30C-065",
    expectedName: "MÔ TƠ CỔNG TRƯỢT AYROS 650",
  },
  {
    sheet: "AYROS 650 V2",
    rawSku: "AYROS 650 (30C065V2)",
    description: "MÔ TƠ CỔNG TRƯỢT AYROS 650\nModel : 30C-065 V2\nThông số kỹ thuật\nĐộng cơ 24V AC",
    expectedSku: "30C-065 V2",
    expectedName: "MÔ TƠ CỔNG TRƯỢT AYROS 650",
  },
  {
    sheet: "STARK600",
    rawSku: "29H006V2",
    description: "Mô tơ cổng Mở xoay tự động STARK 600 V2\nModel : 29H006V2\nThông số kỹ thuật:\nĐộng cơ điện 24V AC",
    expectedSku: "29H006V2",
    expectedName: "Mô tơ cổng Mở xoay tự động STARK 600 V2",
  },
];

assert.equal(extractExplicitIdentityCode("foo Model : 29G020 Thông số kỹ thuật"), "29G020");
assert.equal(extractSkuFromText("Model 29G020"), "29G020");
assert.equal(extractSkuFromText("Nguồn điện 230V AC · động cơ 24V"), "", "voltage must never become SKU");
assert.equal(extractExplicitIdentityCode("Model : 30C-074 V2 | Nguồn 24V"), "30C-074 V2");
assert.equal(normalizeIdentitySku("30C-074"), normalizeIdentitySku("30C074"));

for (const c of cases) {
  const text = ["1", c.description, c.rawSku, "Bisco Tech", "bộ", "1", "24900000", "24900000", ""];
  const row = {
    r: 16,
    text,
    cells: text.map((v, i) => ({ ref: `${String.fromCharCode(65 + i)}17`, v })),
    joined: text.filter(Boolean).join(" | "),
  };
  const map = {
    specs: 1,
    sku: 2,
    supplier: 3,
    unit: 4,
    quantity: 5,
    price: 6,
    lineTotal: 7,
    _quoteTable: true,
    _priceSourceLabel: "Đơn Giá",
    _nameSourceCols: [1],
    _deriveNameFromSku: true,
    _nameWeak: true,
  };
  const item = rowToItem(row, map, c.sheet, "ĐỘNG CƠ CỔNG TỰ ĐỘNG", "");
  assert.ok(item, `${c.sheet}: rowToItem returned null`);
  assert.equal(item.name, c.expectedName, `${c.sheet}: commercial name must come from description`);
  assert.equal(item.sku, c.expectedSku, `${c.sheet}: canonical SKU must come from explicit Model label`);
  assert.equal(item.source.rawSku, c.rawSku, `${c.sheet}: raw mapped SKU must be preserved as provenance`);
  assert.equal(item.source.canonicalSkuEvidence, "explicit_model_label");
}

const screenshotShape = sanitizeCatalogProduct({
  name: "Cổng tự động Vulcan-24V (29G020)",
  sku: "Vulcan-24V (29G020)",
  category: "Cổng tự động",
  supplier: "Bisco Tech",
  unit: "bộ",
  costPrice: 42900000,
  specs: "Cổng xoay tự động âm sàn V2 - VULCAN 24V Model : 29G020 Thông số kỹ thuật Động cơ điện 24V AC",
  _meta: { source: { rawText: "Form BG Bisco Tech VUCAN - 24V dòng 17" } },
}, { oldQuoteMode: true });
assert.equal(screenshotShape.sku, "29G020", "sanitizer must fix the exact bad preview shape shown in the screenshot");
assert.equal(screenshotShape.name, "Cổng xoay tự động âm sàn V2 - VULCAN 24V", "semantic canonicalization must preserve the source sellable product terminology");

const resolved = resolveCanonicalQuoteIdentity({
  rawSku: "Vulcan - 24V (29G020)",
  specs: "Cổng xoay tự động âm sàn V2 - VULCAN 24V Model : 29G020 Thông số kỹ thuật",
});
assert.equal(resolved.sku, "29G020");
assert.equal(resolved.evidence, "explicit_model_label");
assert.equal(resolved.changed, true);

console.log("✓ P2.3.1 product identity canonicalization PASS");
console.log("  - explicit Model/SKU/Code wins over mixed quotation alias");
console.log("  - commercial product name stays separate from canonical SKU");
console.log("  - raw mapped SKU is preserved as provenance, not used as identity");
