import assert from "node:assert/strict";
import { rowToItem } from "../src/import-engine/extractItems.js";
import { inferCategory } from "../src/import-engine/categoryInference.js";

function quoteRow({ name, sku, price = 10_000_000 }) {
  const text = ["1", name, sku, "Supplier", "bộ", "1", String(price), String(price), ""];
  return {
    row: {
      r: 17,
      text,
      cells: text.map((v, i) => ({ ref: `${String.fromCharCode(65 + i)}18`, v })),
      joined: text.filter(Boolean).join(" | "),
    },
    map: {
      name: 1,
      sku: 2,
      supplier: 3,
      unit: 4,
      quantity: 5,
      price: 6,
      lineTotal: 7,
      _quoteTable: true,
      _priceSourceLabel: "Đơn Giá",
      _lockedName: false,
    },
  };
}

const cases = [
  {
    sheet: "GATE SLIDING",
    section: "ĐỘNG CƠ CỔNG TRƯỢT TỰ ĐỘNG",
    name: "MÔ TƠ CỔNG TRƯỢT V2 - MOTOR - 500D\nModel : GATE-500D\nThông số kỹ thuật\nKhi mất điện mở bằng tay (Có chìa khóa mở kèm).",
    sku: "GATE-500D",
    expectedName: "MÔ TƠ CỔNG TRƯỢT V2 - MOTOR - 500D",
    expectedCategory: "Cổng trượt tự động",
  },
  {
    sheet: "GATE SWING",
    section: "ĐỘNG CƠ CỔNG TỰ ĐỘNG",
    name: "Mô tơ cổng Mở xoay tự động ARM - 24V\nModel : ARM-24V\nThông số kỹ thuật\nKhi mất điện mở bằng tay (Có chìa khóa mở kèm).",
    sku: "ARM-24V",
    expectedName: "Mô tơ cổng Mở xoay tự động ARM - 24V",
    expectedCategory: "Cổng mở xoay tự động",
  },
  {
    sheet: "UNDERGROUND GATE",
    section: "ĐỘNG CƠ CỔNG TỰ ĐỘNG",
    name: "Cổng xoay tự động âm sàn V2 - UG 24V\nModel : UG-24V\nThông số kỹ thuật\n02 chìa khóa mở khẩn khi mất điện",
    sku: "UG-24V",
    expectedName: "Cổng xoay tự động âm sàn V2 - UG 24V",
    expectedCategory: "Cổng âm sàn tự động",
  },
];

for (const testCase of cases) {
  const { row, map } = quoteRow(testCase);
  const item = rowToItem(row, map, testCase.sheet, testCase.section, "");
  assert.ok(item, `${testCase.sheet}: item missing`);
  assert.equal(item.category, testCase.expectedCategory, `${testCase.sheet}: source-specific category regression`);
  assert.equal(item.name, testCase.expectedName, `${testCase.sheet}: quote commercial name must be preserved`);
  assert.ok(!/khóa thông minh/i.test(item.name), `${testCase.sheet}: must not become smart lock`);
  assert.equal(item.costPrice, 10_000_000, `${testCase.sheet}: price changed`);
  assert.equal(item.listPrice, 10_000_000, `${testCase.sheet}: quote fixed price changed`);
  assert.match(item.specs, /Model/i, `${testCase.sheet}: technical detail must move to specs`);
}

assert.equal(
  inferCategory({
    name: "Khóa thông minh DDL702",
    sku: "DDL702",
    specs: "Vân tay, mật mã, thẻ từ",
  }),
  "Khóa thông minh",
  "real smart-lock evidence must still classify as smart lock",
);

assert.notEqual(
  inferCategory({
    name: "Bộ cơ khí",
    specs: "Khi mất điện mở bằng tay, có chìa khóa mở kèm",
  }),
  "Khóa thông minh",
  "physical-key prose alone must never imply smart lock",
);

console.log("✓ Pilot P1.5.1 gate-motor identity regression PASS");
console.log("  - 'chìa khóa mở kèm' no longer turns gate motors into smart locks");
console.log("  - source-specific gate category is preserved; broad Cổng tự động remains family semantics");
console.log("  - quote-table first line is preserved as the commercial product name");
console.log("  - SKU/prices remain unchanged");
console.log("  - genuine smart-lock evidence still classifies correctly");
