import assert from "node:assert/strict";
import { rowToItem } from "../src/import-engine/extractItems.js";
import { mapColumns } from "../src/import-engine/mapColumns.js";

function realProfilerQuoteRow({ description, sku, supplier = "Italia", price = 24_900_000 }) {
  const text = ["1", description, sku, supplier, "bộ", "1", String(price), String(price), ""];
  return {
    row: {
      r: 18,
      text,
      cells: text.map((v, i) => ({ ref: `${String.fromCharCode(65 + i)}19`, v })),
      joined: text.filter(Boolean).join(" | "),
    },
    // Mirrors the REAL Bisco profiler path after the long "Thông số sản phẩm"
    // column is moved out of `name` and treated as specs/name-source.
    map: {
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
    },
  };
}

const cases = [
  {
    sheet: "VUCAN - 24V",
    section: "ĐỘNG CƠ CỔNG TỰ ĐỘNG",
    sku: "Vulcan - 24V (29G020)",
    description: "Cổng xoay tự động âm sàn V2 - VULCAN 24V\nModel : 29G020\nThông số kỹ thuật\nĐộng cơ điện 24V AC\nKhi mất điện mở bằng tay (Có chìa khóa mở kèm).",
    expectedName: "Cổng xoay tự động âm sàn V2 - VULCAN 24V",
  },
  {
    sheet: "VUCAN - 230V",
    section: "ĐỘNG CƠ CỔNG TỰ ĐỘNG",
    sku: "Vulcan - 230V (29G019)",
    description: "Cổng xoay tự động âm sàn V2 VULCAN 230V\nModel : 29G019\nThông số kỹ thuật\nNguồn điện vào 230V AC\nKhi mất điện mở bằng tay (Có chìa khóa mở kèm).",
    expectedName: "Cổng xoay tự động âm sàn V2 VULCAN 230V",
  },
  {
    sheet: "TORQ 500D - 24V",
    section: "ĐỘNG CƠ CỔNG TRƯỢT TỰ ĐỘNG",
    sku: "TORQ 500D",
    description: "MÔ TƠ CỔNG TRƯỢT V2 - TORQ - 500D\nModel : 30C109\nThông số kỹ thuật\nĐộng cơ 24V AC\nKhi mất điện mở bằng tay (Có chìa khóa mở kèm).",
    expectedName: "MÔ TƠ CỔNG TRƯỢT V2 - TORQ - 500D",
  },
  {
    sheet: "AYROS 1000D-24V",
    section: "ĐỘNG CƠ CỔNG TRƯỢT TỰ ĐỘNG",
    sku: "AYROS 1000D (30C074)",
    description: "MÔ TƠ CỔNG TRƯỢT V2 - AYROS - 1000D\nModel : 30C-074\nThông số kỹ thuật\nĐộng cơ 24V AC\nKhi mất điện mở bằng tay (Có chìa khóa mở kèm).",
    expectedName: "MÔ TƠ CỔNG TRƯỢT V2 - AYROS - 1000D",
  },
  {
    sheet: "NYK - 24V",
    section: "ĐỘNG CƠ CỔNG TỰ ĐỘNG",
    sku: "NYK - 24V",
    description: "Mô tơ cổng Mở xoay tự động NYK - 24V\nModel : 29H001\nThông số kỹ thuật:\nĐộng cơ điện 24V AC\nKhi mất điện mở bằng tay (Có chìa khóa mở kèm).",
    expectedName: "Mô tơ cổng Mở xoay tự động NYK - 24V",
  },
  {
    sheet: "STAR K3 -24V",
    section: "ĐỘNG CƠ CỔNG TỰ ĐỘNG",
    sku: "STAR K3- 24V",
    description: "Mô tơ cổng Mở xoay tự động STAR K3 - 24V\nModel : 29H003\nThông số kỹ thuật:\nĐộng cơ điện 24V AC\nKhi mất điện mở bằng tay (Có chìa khóa mở kèm).",
    expectedName: "Mô tơ cổng Mở xoay tự động STAR K3 - 24V",
  },
  {
    sheet: "AYROS 650",
    section: "ĐỘNG CƠ CỔNG TRƯỢT TỰ ĐỘNG",
    sku: "AYROS 650 (30C065)",
    description: "MÔ TƠ CỔNG TRƯỢT AYROS 650\nModel : 30C-065\nThông số kỹ thuật\nĐộng cơ 24V AC\nKhi mất điện mở bằng tay (Có chìa khóa mở kèm).",
    expectedName: "MÔ TƠ CỔNG TRƯỢT AYROS 650",
  },
  {
    sheet: "AYROS 650 V2",
    section: "ĐỘNG CƠ CỔNG TRƯỢT TỰ ĐỘNG",
    sku: "AYROS 650 (30C065V2)",
    description: "MÔ TƠ CỔNG TRƯỢT AYROS 650\nModel : 30C-065 V2\nThông số kỹ thuật\nĐộng cơ 24V AC\nKhi mất điện mở bằng tay (Có chìa khóa mở kèm).",
    expectedName: "MÔ TƠ CỔNG TRƯỢT AYROS 650",
  },
  {
    sheet: "STARK600",
    section: "ĐỘNG CƠ CỔNG TỰ ĐỘNG",
    sku: "29H006V2",
    description: "Mô tơ cổng Mở xoay tự động STARK 600 V2\nModel : 29H006V2\nThông số kỹ thuật:\nĐộng cơ điện 24V AC\nKhi mất điện mở bằng tay (Có chìa khóa mở kèm).",
    expectedName: "Mô tơ cổng Mở xoay tự động STARK 600 V2",
  },
];


// Prove the real Bisco header/data profile takes the path that previously broke:
// "Thông số sản phẩm" is moved to specs/name-source, while name becomes derived.
const realHeader = { text: ["Stt", "Thông số sản phẩm", "Mã SP", "Xuất xứ", "ĐVT", "Số lượng", "Đơn Giá", "Thành Tiền", "Ghi chú"] };
const profileRows = cases.slice(2, 5).map((c, i) => ({
  text: [String(i + 1), c.description, c.sku, "Italia", "bộ", "1", String(24_900_000 + i * 5_000_000), String(24_900_000 + i * 5_000_000), ""],
}));
const profiled = mapColumns(realHeader, profileRows, 8).map;
assert.equal(profiled.name, undefined, "real Bisco long description column should be moved out of direct name mapping");
assert.equal(profiled.specs, 1, "real Bisco description column should remain available as specs");
assert.deepEqual(profiled._nameSourceCols, [1], "real Bisco description column must remain a name source");
assert.equal(profiled._quoteTable, true, "real Bisco table must be recognized as quotation schema");
assert.equal(profiled._deriveNameFromSku, true, "regression must exercise the actual derived-name path");

for (const testCase of cases) {
  const { row, map } = realProfilerQuoteRow(testCase);
  const item = rowToItem(row, map, testCase.sheet, testCase.section, "");
  assert.ok(item, `${testCase.sheet}: item missing`);
  assert.equal(item.name, testCase.expectedName, `${testCase.sheet}: commercial identity was overwritten`);
  assert.equal(item.category, "Cổng tự động", `${testCase.sheet}: broad catalog category may remain Cổng tự động`);
  assert.ok(!/^Cổng tự động\s+/i.test(item.name), `${testCase.sheet}: category must not replace product name`);
  assert.ok(!/^Khóa thông minh\s+/i.test(item.name), `${testCase.sheet}: smart-lock regression`);
  assert.ok(/Model|Thông số/i.test(item.specs || ""), `${testCase.sheet}: technical details must remain specs`);
}

console.log("✓ Pilot P1.5.3.2 Bisco product-identity regression PASS");
console.log("  - real profiler shape no longer converts every product name to 'Cổng tự động + SKU'");
console.log("  - first descriptive line from 'Thông số sản phẩm' is the commercial product name");
console.log("  - 'Cổng tự động' remains only the broad catalog category");
