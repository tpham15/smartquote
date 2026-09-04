import assert from "node:assert/strict";
import {
  analyzeSellableVariantFamily,
  expandPdfSellableVariants,
  normalizePdfTableSemantics,
} from "../src/import-engine/pdf/pdfVariants.js";
import { productsToImportPreviewResult } from "../src/import-engine/previewResult.js";

const lumiSemantics = {
  rowModel: "product_family_variants",
  priceColumns: [
    { label: "Đơn giá (On/off)", role: "variant_price", variantKey: "on_off" },
    { label: "Đơn giá (Smart dimmable)", role: "variant_price", variantKey: "smart_dimmable" },
    { label: "Đơn giá (Smart Tunable)", role: "variant_price", variantKey: "smart_tunable" },
  ],
};

const lumiRow1 = {
  id: "imp_lumi_1",
  name: "Đèn Spotlight âm trần 7W chỉnh hướng, 24D",
  sku: "LM-ST7-55-O",
  category: "DÒNG SẢN PHẨM SPOTLIGHT CHỈNH HƯỚNG 2025",
  supplier: "Lumi",
  unit: "Cái",
  costPrice: 648000,
  listPrice: 0,
  minRetailPrice: 0,
  specs: "Công suất: 7W; Lỗ khoét: 55mm",
  variants: [
    { sku: "LM-ST7-55-O", label: "On/off", variantKey: "on_off", priceRole: "variant_price", price: 648000 },
    { sku: "LM-ST7-55-D", label: "Smart dimmable", variantKey: "smart_dimmable", priceRole: "variant_price", price: 810000 },
    { sku: "LM-ST7-55-T", label: "Smart Tunable", variantKey: "smart_tunable", priceRole: "variant_price", price: 1080000 },
  ],
  _meta: {
    tableSemantics: lumiSemantics,
    variantBinding: { visibleSkuCount: 3, visiblePriceCount: 3 },
    source: { type: "pdf", page: 1, row: 1, rawText: "row 1" },
    engine: "pdf-v6-native-structured",
    canonicalStatus: "auto_approved",
    status: "new",
    confidence: 0.95,
    issues: [],
  },
};

const analysis = analyzeSellableVariantFamily(lumiRow1);
assert.equal(analysis.expandable, true);
assert.equal(analysis.variants.length, 3);

const expanded = expandPdfSellableVariants([lumiRow1]);
assert.equal(expanded.stats.sourceRows, 1);
assert.equal(expanded.stats.variantFamilies, 1);
assert.equal(expanded.stats.sellableSkus, 3);
assert.equal(expanded.products.length, 3);
assert.deepEqual(
  expanded.products.map((p) => [p.sku, p.costPrice]),
  [
    ["LM-ST7-55-O", 648000],
    ["LM-ST7-55-D", 810000],
    ["LM-ST7-55-T", 1080000],
  ],
);
assert.match(expanded.products[0].name, /On\/off/i);
assert.match(expanded.products[1].name, /Smart dimmable/i);
assert.match(expanded.products[2].name, /Smart Tunable/i);
assert.ok(expanded.products.every((p) => p.listPrice === 0));
assert.ok(expanded.products.every((p) => p._meta?.family?.variantCount === 3));


// A row that visibly contains 3 SKUs but only 1 bound variant must NOT be expanded.
const incomplete = {
  ...lumiRow1,
  id: "incomplete_1",
  variants: [lumiRow1.variants[0]],
  _meta: { ...lumiRow1._meta, variantBinding: { visibleSkuCount: 3, visiblePriceCount: 3 } },
};
const incompleteAnalysis = analyzeSellableVariantFamily(incomplete);
assert.equal(incompleteAnalysis.expandable, false);
assert.equal(incompleteAnalysis.signals.bindingComplete, false);

// Commercial tiers belong to ONE SKU and must never be exploded into products.
const commercialTierRow = {
  ...lumiRow1,
  id: "commercial_1",
  sku: "ABC-100",
  name: "Thiết bị ABC-100",
  variants: [
    { sku: "ABC-100", label: "Giá đại lý", variantKey: "dealer", priceRole: "commercial_price", price: 500000 },
    { sku: "ABC-100", label: "Giá công bố", variantKey: "public", priceRole: "commercial_price", price: 650000 },
  ],
  _meta: {
    ...lumiRow1._meta,
    tableSemantics: {
      rowModel: "single_sku",
      priceColumns: [
        { label: "Giá đại lý", role: "commercial_price", variantKey: "" },
        { label: "Giá công bố", role: "commercial_price", variantKey: "" },
      ],
    },
  },
};
const commercialExpanded = expandPdfSellableVariants([commercialTierRow]);
assert.equal(commercialExpanded.products.length, 1);
assert.equal(commercialExpanded.stats.variantFamilies, 0);

// Preview must expose three independent sellable SKU lines, all clean.
const preview = productsToImportPreviewResult({
  products: expanded.products,
  fileName: "Bang gia Lighting.pdf",
  engine: "pdf-v6-native-structured",
});
assert.equal(preview.lines.length, 3);
assert.equal(new Set(preview.lines.map((l) => l.parsed.sku)).size, 3);
assert.equal(preview.summary.needReview, 0);

const sem = normalizePdfTableSemantics(lumiSemantics);
assert.equal(sem.rowModel, "product_family_variants");
assert.equal(sem.priceColumns.filter((c) => c.role === "variant_price").length, 3);

console.log("✓ Phase 14.1A semantic variant binding smoke PASS");
console.log("  Lumi row 1: 1 source row -> 3 sellable SKUs");
console.log("  LM-ST7-55-O -> 648000");
console.log("  LM-ST7-55-D -> 810000");
console.log("  LM-ST7-55-T -> 1080000");
console.log("  incomplete 3-SKU binding is NOT auto-expanded");
console.log("  commercial price tiers for one SKU are NOT expanded");
