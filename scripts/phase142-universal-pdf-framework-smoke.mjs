import assert from 'node:assert/strict';
import { normalizePdfDocumentIR, assembleProductsFromPdfDocumentIR, summarizePdfDocumentIR, makePdfTemplateFingerprint, mergeRecoveredPdfRow } from '../src/import-engine/pdf/pdfDocumentFramework.js';
import { expandPdfSellableVariants } from '../src/import-engine/pdf/pdfVariants.js';
import { assessPdfVisionTrust } from '../src/import-engine/pdf/pdfEvidence.js';

const f = (text, confidence = 98, bbox = [10,10,100,40]) => ({ text, confidence, bbox });
const price = (label, role, value, confidence = 99, variantKey = '', bbox = [700,10,850,40]) => ({ label, role, variantKey, text: String(value), value, confidence, bbox });
const variant = (sku, label, variantKey, value, confidence = 99) => ({ sku, label, variantKey, priceRole: 'variant_price', price: value, confidence, bbox: [300,10,900,40] });

// Archetype 1: Lumi Lighting — one physical row, three sellable SKU variants.
const lighting = normalizePdfDocumentIR({
  page: 1, pageType: 'catalog_table', ignoredRegions: [], tables: [{
    tableId: 'lighting', title: 'DÒNG SẢN PHẨM SPOTLIGHT CHỈNH HƯỚNG 2025', rowModel: 'product_family_variants',
    headers: [
      { label: 'Thiết bị', role: 'product_name', priceRole: 'unknown', variantKey: '', bbox: [0,0,300,50] },
      { label: 'Mã sản phẩm', role: 'sku', priceRole: 'unknown', variantKey: '', bbox: [300,0,500,50] },
      { label: 'Đơn giá On/off', role: 'variant_price', priceRole: 'variant_price', variantKey: 'on_off', bbox: [650,0,750,50] },
      { label: 'Đơn giá Smart dimmable', role: 'variant_price', priceRole: 'variant_price', variantKey: 'smart_dimmable', bbox: [750,0,875,50] },
      { label: 'Đơn giá Smart Tunable', role: 'variant_price', priceRole: 'variant_price', variantKey: 'smart_tunable', bbox: [875,0,1000,50] },
    ],
    sections: [{ title: 'Spotlight chỉnh hướng 2025', sharedSpecs: 'Driver: On Off / Smart dimmable / Smart Tunable white', bbox: [0,50,1000,300], rows: [{
      kind: 'product', visibleRowLabel: '1', sourceRow: 1, rowIndex: 1, bbox: [10,80,990,260],
      name: f('Đèn Spotlight âm trần 7W chỉnh hướng, 24D'), sku: f('LM-ST7-55-O'), unit: f('Cái'), specs: f('Công suất: 7W'),
      prices: [price('On/off','variant_price',648000,99,'on_off'), price('Smart dimmable','variant_price',810000,99,'smart_dimmable'), price('Smart Tunable','variant_price',1080000,99,'smart_tunable')],
      variants: [variant('LM-ST7-55-O','On/off','on_off',648000), variant('LM-ST7-55-D','Smart dimmable','smart_dimmable',810000), variant('LM-ST7-55-T','Smart Tunable','smart_tunable',1080000)],
    }] }],
  }],
});
const lightingAssembled = assembleProductsFromPdfDocumentIR(lighting, { supplierGuess: 'Lumi' });
assert.equal(lightingAssembled.products.length, 1);
assert.equal(lightingAssembled.products[0].variants.length, 3);
const lightingExpanded = expandPdfSellableVariants(lightingAssembled.products.map((p) => ({
  ...p,
  _meta: { source: { page: p.sourcePage, row: p.sourceRow }, variants: p.variants, tableSemantics: p.tableSemantics, variantBinding: { visibleSkuCount: p.visibleSkuCount, visiblePriceCount: p.visiblePriceCount } },
})));
assert.equal(lightingExpanded.products.length, 3);
assert.deepEqual(lightingExpanded.products.map((p) => [p.sku, p.costPrice]), [
  ['LM-ST7-55-O', 648000], ['LM-ST7-55-D', 810000], ['LM-ST7-55-T', 1080000],
]);

// Archetype 2: Lumi Smarthome — no STT, section header + merged/shared specs.
const smarthome = normalizePdfDocumentIR({
  page: 1, pageType: 'catalog_table', ignoredRegions: ['company stamp'], tables: [{
    tableId: 'smarthome', title: '', rowModel: 'single_sku',
    headers: [
      { label: 'THIẾT BỊ', role: 'product_name', priceRole: 'unknown', variantKey: '', bbox: [0,0,350,50] },
      { label: 'MÃ SẢN PHẨM', role: 'sku', priceRole: 'unknown', variantKey: '', bbox: [350,0,550,50] },
      { label: 'MÔ TẢ', role: 'specs', priceRole: 'unknown', variantKey: '', bbox: [550,0,800,50] },
      { label: 'ĐƠN GIÁ', role: 'commercial_price', priceRole: 'commercial_price', variantKey: '', bbox: [800,0,1000,50] },
    ],
    sections: [{
      title: 'CÔNG TẮC CẦU THANG LUTO', sharedSpecs: 'Màu sắc: Trắng/đen; Kiểu dáng: Vuông/Chữ nhật; Viền: Nhôm/Anode vàng/champagne; Nguồn cấp: 220VAC/50Hz', bbox: [0,100,1000,700],
      rows: [
        { kind: 'section_header', visibleRowLabel: '', sourceRow: 0, rowIndex: 1, bbox: [0,100,1000,160], name: f(''), sku: f(''), unit: f(''), specs: f(''), prices: [], variants: [] },
        { kind: 'product', visibleRowLabel: '', sourceRow: 0, rowIndex: 2, bbox: [10,170,990,260], name: f('Công tắc cầu thang Luto kính phẳng, viền bo champagne'), sku: f('LM-S2P/S-Fy/CC'), unit: f('Cái'), specs: f(''), prices: [price('Đơn giá','commercial_price',2673000)], variants: [] },
        { kind: 'product', visibleRowLabel: '', sourceRow: 0, rowIndex: 3, bbox: [10,270,990,360], name: f('Công tắc cầu thang Luto kính phẳng, viền bo vàng'), sku: f('LM-S2P/S-Fy/CG'), unit: f('Cái'), specs: f(''), prices: [price('Đơn giá','commercial_price',2862000)], variants: [] },
      ],
    }],
  }],
});
const smartAssembled = assembleProductsFromPdfDocumentIR(smarthome, { supplierGuess: 'Lumi' });
assert.equal(smartAssembled.products.length, 2);
assert.equal(smartAssembled.products[0].sourceRow, 1); // stable layout ordinal, no fake visible STT
assert.equal(smartAssembled.products[1].sourceRow, 2);
assert.equal(smartAssembled.products[0].category, 'CÔNG TẮC CẦU THANG LUTO');
assert.match(smartAssembled.products[0].specs, /220VAC\/50Hz/);
assert.equal(smartAssembled.products[0].costPrice, 2673000);
assert.equal(smartAssembled.products[1].costPrice, 2862000);
assert.equal(smartAssembled.stats.inheritedSpecRows, 2);

// Convert a strong layout row to the normalized-ish shape expected by trust.
const rawStrong = smartAssembled.products[0];
const strongForTrust = {
  name: rawStrong.name, sku: rawStrong.sku, costPrice: rawStrong.costPrice, category: rawStrong.category,
  variants: rawStrong.variants,
  _meta: {
    source: { type: 'pdf', page: rawStrong.sourcePage, row: rawStrong.sourceRow, bbox: rawStrong.sourceBBox, layoutGrounded: true },
    fieldEvidence: rawStrong.fieldEvidence,
    productEvidence: rawStrong.evidence,
    engine: 'pdf-v7-layout-ir',
  },
};
assert.equal(assessPdfVisionTrust(strongForTrust, 'pdf-v7-layout-ir').trusted, true, 'no-STT layout row should be trusted when grounded + strong fields');

// Low SKU confidence should be recoverable/reviewable, not silently clean.
const lowConfidence = JSON.parse(JSON.stringify(smarthome));
lowConfidence.tables[0].sections[0].rows[1].sku.confidence = 44;
const low = assembleProductsFromPdfDocumentIR(lowConfidence, { supplierGuess: 'Lumi' }).products[0];
assert.equal(low._layoutNeedsRecovery, true);
const repaired = mergeRecoveredPdfRow(low, {
  name: f(low.name, 99), sku: f('LM-S2P/S-Fy/CC', 99), unit: f('Cái', 95), specs: f('', 0),
  prices: [price('Đơn giá','commercial_price',2673000,99)], variants: [],
});
assert.equal(repaired._layoutNeedsRecovery, false);
assert.equal(repaired.sku, 'LM-S2P/S-Fy/CC');
assert.ok(repaired.fieldEvidence.sku.confidence >= 0.99);

// Footer/signature rows never become products.
const footer = JSON.parse(JSON.stringify(smarthome));
footer.tables[0].sections[0].rows.push({ kind: 'footer', visibleRowLabel: '', sourceRow: 0, rowIndex: 4, bbox: [0,800,1000,950], name: f('Bảng giá có hiệu lực kể từ ngày 01 tháng 06 năm 2026'), sku: f(''), unit: f(''), specs: f(''), prices: [], variants: [] });
assert.equal(assembleProductsFromPdfDocumentIR(footer, { supplierGuess: 'Lumi' }).products.length, 2);

const summary = summarizePdfDocumentIR([lighting, smarthome]);
assert.equal(summary.pages, 2);
assert.equal(summary.rows, 3);
assert.ok(summary.roles.includes('product_name'));
assert.ok(summary.mergedSpecSections >= 1);
assert.match(makePdfTemplateFingerprint(summary), /^pdf_tpl_/);

console.log('✓ Phase 14.2 Universal PDF Document Framework smoke PASS');
console.log('  - Lighting: 1 source row -> 3 correctly bound sellable variants');
console.log('  - Smarthome: no STT required; layout ordinal + merged shared specs reconstructed');
console.log('  - field confidence can trigger targeted row recovery');
console.log('  - footer/section rows are excluded before catalog assembly');
