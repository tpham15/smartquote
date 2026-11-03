import assert from 'node:assert/strict';
import { matchCatalog } from '../src/import-engine/matchCatalog.js';
import { mapColumns } from '../src/import-engine/mapColumns.js';
import { rowToItem } from '../src/import-engine/extractItems.js';
import fs from 'node:fs';
import { technicalVariantsCompatible } from '../src/import-engine/productIdentity.js';

// ---------------------------------------------------------------------------
// P1.5.5 Identity Learning Safety
// ---------------------------------------------------------------------------

// 1) Fuzzy matching must not collapse technical variants.
{
  const catalog = [
    { id: 'p3k', name: 'Downlight 12W 3000K', sku: '', supplier: 'Brand A' },
    { id: 'p4k', name: 'Downlight 12W 4000K', sku: '', supplier: 'Brand A' },
  ];
  const [result] = matchCatalog([
    { name: 'Downlight 12W 3500K', sku: '', supplier: 'Brand A', source: { rawText: 'Downlight 12W 3500K' } },
  ], catalog, {});
  assert.equal(result.matchedProductId, null, '3500K must not fuzzy-match 3000K/4000K');
  assert.equal(result._matchType, 'none');
  assert.equal(technicalVariantsCompatible(catalog[0], catalog[1]), false, '3000K and 4000K must conflict');

  const cameras = [
    { id: 'c28', name: 'Camera IP 4MP Lens 2.8mm', supplier: 'Brand C' },
    { id: 'c36', name: 'Camera IP 4MP Lens 3.6mm', supplier: 'Brand C' },
  ];
  const [camera] = matchCatalog([
    { name: 'Camera IP 4MP Lens 4.0mm', supplier: 'Brand C', source: { rawText: 'Camera IP 4MP Lens 4.0mm' } },
  ], cameras, {});
  assert.equal(camera.matchedProductId, null, '4.0mm must not fuzzy-match 2.8mm/3.6mm');
}

// 2) Exact composite SKU must beat stale correction memory.
{
  const catalog = [
    { id: 'A', name: 'Motor Gate A', sku: 'SKU-A', supplier: 'Supplier A' },
    { id: 'B', name: 'Smart Lock B', sku: 'SKU-B', supplier: 'Supplier B' },
  ];
  const raw = 'same historical raw text';
  const rawKey = raw.toLowerCase().replace(/[^a-z0-9]/g, '');
  const [result] = matchCatalog([
    { name: 'Motor Gate A', sku: 'SKU-A', supplier: 'Supplier A', source: { rawText: raw } },
  ], catalog, { [rawKey]: 'B' });
  assert.equal(result.matchedProductId, 'A', 'exact SKU must win over stale correction');
  assert.equal(result._matchType, 'sku');
}

// 3) Correction must fail closed on supplier / SKU / variant conflict.
{
  const catalog = [
    { id: 'wrong', name: 'Downlight 12W 4000K', sku: 'DL-4000', supplier: 'Supplier B' },
  ];
  const raw = 'downlight import line';
  const rawKey = raw.toLowerCase().replace(/[^a-z0-9]/g, '');
  const [result] = matchCatalog([
    { name: 'Downlight 12W 3000K', sku: 'DL-3000', supplier: 'Supplier A', source: { rawText: raw } },
  ], catalog, { [rawKey]: 'wrong' });
  assert.equal(result.matchedProductId, null, 'unsafe correction must be ignored');
}

// 4) Header semantics: supplier, brand and origin are three different fields.
{
  const header = {
    r: 0,
    text: ['Tên sản phẩm', 'Mã SP', 'Nhà cung cấp', 'Hãng', 'Xuất xứ', 'ĐVT', 'Đơn giá'],
    joined: '', filled: 7, cells: [],
  };
  const data = {
    r: 1,
    text: ['Mô tơ cổng trượt TORQ 500D', 'TORQ 500D', 'Bisco Tech', 'Roger', 'Italia', 'bộ', '24900000'],
    joined: 'Mô tơ cổng trượt TORQ 500D TORQ 500D Bisco Tech Roger Italia bộ 24900000',
    filled: 7,
    cells: [0,1,2,3,4,5,6].map((c) => ({ c, v: '', ref: `A${c+1}` })),
  };
  const { map } = mapColumns(header, [data], 6);
  assert.equal(map.supplier, 2);
  assert.equal(map.brand, 3);
  assert.equal(map.origin, 4);

  const product = rowToItem(data, map, 'Sheet1', '', 'Bisco Tech');
  assert.ok(product);
  assert.equal(product.supplier, 'Bisco Tech');
  assert.equal(product.brand, 'Roger');
  assert.equal(product.origin, 'Italia');
  assert.equal(product.attributes?.origin, 'Italia');

  // Manual/legacy mapping path must follow the same semantic split.
  const legacySource = fs.readFileSync(new URL('../src/import-engine/legacy/legacyCatalogImport.js', import.meta.url), 'utf8');
  assert.match(legacySource, /m\.origin/);
  assert.match(legacySource, /m\.brand/);
  assert.doesNotMatch(legacySource, /nhà cung cấp\|ncc\|hãng\|supplier\|brand\|thương hiệu\|xuất xứ/);
}

// 5) Correction learning is tenant-local AND supplier/brand scoped.
{
  class MemoryStorage {
    constructor() { this.m = new Map(); }
    getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
    setItem(k, v) { this.m.set(k, String(v)); }
    removeItem(k) { this.m.delete(k); }
    key(i) { return [...this.m.keys()][i] ?? null; }
    get length() { return this.m.size; }
  }
  globalThis.localStorage = new MemoryStorage();
  const learning = await import(`../src/import-engine/correctionLearning.js?smoke=${Date.now()}`);
  learning.clearCorrectionLearning();

  const learned = {
    name: 'Motor Supplier A', sku: 'ABC-100', supplier: 'Supplier A', category: 'Motor',
    _meta: { source: { rawText: 'ABC-100 motor' } },
  };
  const saved = learning.saveProductLearning(learned, { userEdited: true, fileName: 'supplier-a.xlsx' });
  assert.equal(saved.ok, true);

  const sameSupplier = learning.applyCorrectionLearning([
    { name: 'ABC-100', sku: 'ABC-100', supplier: 'Supplier A', category: 'Chung', _meta: { source: { rawText: 'ABC-100 motor' } } },
  ]);
  assert.equal(sameSupplier.hits, 1, 'same supplier should reuse learned identity');
  assert.equal(sameSupplier.products[0].name, 'Motor Supplier A');

  const otherSupplier = learning.applyCorrectionLearning([
    { name: 'ABC-100', sku: 'ABC-100', supplier: 'Supplier B', category: 'Chung', _meta: { source: { rawText: 'ABC-100 motor' } } },
  ]);
  assert.equal(otherSupplier.hits, 0, 'learning must not bleed across suppliers');
  assert.equal(otherSupplier.products[0].name, 'ABC-100');

  const sameBrandOtherSupplier = learning.applyCorrectionLearning([
    { name: 'ABC-100', sku: 'ABC-100', supplier: 'Supplier B', brand: 'Shared Brand', category: 'Chung', _meta: { source: { rawText: 'ABC-100 motor' } } },
  ]);
  assert.equal(sameBrandOtherSupplier.hits, 0, 'same brand must not bypass supplier-scoped learning');

  const unknownSaved = learning.saveProductLearning({
    name: 'Unknown supplier motor', sku: 'UNKNOWN-1', category: 'Motor',
    _meta: { source: { rawText: 'UNKNOWN-1 motor' } },
  }, { userEdited: true, fileName: 'unknown.xlsx' });
  assert.equal(unknownSaved.skuKey, '', 'unknown-party SKU must not create reusable identity learning');
  assert.equal(unknownSaved.rawKey, '', 'unknown-party raw text must not create reusable identity learning');

  const unknownApplied = learning.applyCorrectionLearning([
    { name: 'UNKNOWN-1', sku: 'UNKNOWN-1', category: 'Chung', _meta: { source: { rawText: 'UNKNOWN-1 motor' } } },
  ]);
  assert.equal(unknownApplied.hits, 0, 'unknown-party learning must fail closed');
}

// 6) Export paths must preserve origin/brand/supplier semantics after import separation.
{
  const appSource = fs.readFileSync(new URL('../src/SmartQuote.jsx', import.meta.url), 'utf8');
  const excelBuilder = fs.readFileSync(new URL('../api/excel_builder.py', import.meta.url), 'utf8');
  const lossless = fs.readFileSync(new URL('../api/xlsx_lossless.py', import.meta.url), 'utf8');
  assert.match(appSource, /quotePartyValueForLabel/);
  // RC16 note: the default Excel export still prints origin first and falls back to
  // supplier, but through customerFacingParty() so a supplier guessed from an
  // import file name is never printed on the customer's quote.
  assert.match(appSource, /const party = customerFacingParty\(p\);/);
  assert.match(appSource, /party\.origin \|\| party\.supplier/);
  assert.match(excelBuilder, /p\.get\("origin"\).*p\.get\("supplier"/s);
  assert.match(lossless, /"origin": \["xuat xu", "origin", "country of origin"\]/);
  assert.match(lossless, /"brand": \["thuong hieu", "brand", "hang", "nsx", "nha san xuat"\]/);
  assert.doesNotMatch(lossless, /"supplier": \["xuat xu"/);
}

console.log('✓ Pilot P1.5.5 identity learning safety regression PASS');
