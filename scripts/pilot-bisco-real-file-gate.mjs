#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';

const filePath = path.resolve(process.argv[2] || process.env.SQ_BISCO_GOLDEN_XLSX || '');
if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
  console.error('✗ PILOT GATE BLOCKED: Bisco golden XLSX not found.');
  console.error('  Usage: npm run pilot:gate:bisco -- "/absolute/path/Form BG _Bisco Tech_V2_2025(1).xlsx"');
  console.error('  Or set SQ_BISCO_GOLDEN_XLSX.');
  process.exit(2);
}

try {
  await import('xlsx');
} catch {
  console.error('✗ PILOT GATE BLOCKED: npm dependency "xlsx" is not installed. Run npm ci first.');
  process.exit(3);
}

const [{ importFileForUI }, sanitizer, validator, identity, catalogMerge] = await Promise.all([
  import('../src/import-engine/uiAdapter.js'),
  import('../src/import-engine/productSanitizer.js'),
  import('../src/import-engine/businessValidator.js'),
  import('../src/import-engine/productIdentity.js'),
  import('../src/import-engine/catalogImportMerge.js'),
]);
const { sanitizeCatalogProducts, isUnsafeImportedProduct } = sanitizer;
const { applyCommercialValidation } = validator;
const { normalizeIdentitySku } = identity;
const { mergeCatalogImport } = catalogMerge;

const fileBytes = fs.readFileSync(filePath);
const fileHash = crypto.createHash('sha256').update(fileBytes).digest('hex');
const EXPECTED_BISCO_SHA256 = '9ab80ab5fe1bf92c6c3f9875fdcb13a46234b6eec082d0ddf55daa4f8f3f09ae';
assert.equal(fileHash, EXPECTED_BISCO_SHA256, `golden XLSX hash mismatch; expected ${EXPECTED_BISCO_SHA256}, got ${fileHash}`);
const file = new File([fileBytes], path.basename(filePath), { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

const expected = [
  { sheet:'VUCAN - 24V', sku:'29G020', name:'Cổng xoay tự động âm sàn V2 - VULCAN 24V', category:'Cổng âm sàn tự động', productType:'Cổng xoay tự động âm sàn', subtype:'Âm sàn', model:'VULCAN 24V', price:42900000, documentCategory:'Cổng Âm sàn tự động', rawAlias:'Vulcan - 24V (29G020)' },
  { sheet:'VUCAN - 230V', sku:'29G019', name:'Cổng xoay tự động âm sàn V2 - VULCAN 230V', category:'Cổng âm sàn tự động', productType:'Cổng xoay tự động âm sàn', subtype:'Âm sàn', model:'VULCAN 230V', price:34900000, documentCategory:'Cổng Âm sàn tự động', rawAlias:'Vulcan - 230V (29G019)' },
  { sheet:'TORQ 500D - 24V', sku:'30C109', name:'Mô tơ cổng trượt V2 - TORQ 500D', category:'Cổng trượt tự động', productType:'Mô tơ cổng trượt', subtype:'Trượt', model:'TORQ 500D', price:24900000, documentCategory:'Cổng trượt tự động', rawAlias:'TORQ 500D' },
  { sheet:'AYROS 1000D-24V', sku:'30C-074', name:'Mô tơ cổng trượt V2 - AYROS 1000D', category:'Cổng trượt tự động', productType:'Mô tơ cổng trượt', subtype:'Trượt', model:'AYROS 1000D', price:29900000, documentCategory:'Cổng trượt tự động', rawAlias:'AYROS 1000D (30C074)' },
  { sheet:'NYK - 24V', sku:'29H001', name:'Mô tơ cổng mở xoay tự động NYK 24V', category:'Cổng tay đòn tự động', productType:'Mô tơ cổng mở xoay tự động', subtype:'Tay đòn / mở xoay', model:'NYK 24V', price:29900000, documentCategory:'Cổng tay đòn tự động', rawAlias:'NYK - 24V' },
  { sheet:'STAR K3 -24V', sku:'29H003', name:'Mô tơ cổng mở xoay tự động STAR K3 24V', category:'Cổng tay đòn tự động', productType:'Mô tơ cổng mở xoay tự động', subtype:'Tay đòn / mở xoay', model:'STAR K3 24V', price:34900000, documentCategory:'Cổng tay đòn tự động', rawAlias:'STAR K3- 24V' },
  { sheet:'AYROS 650', sku:'30C-065', name:'Mô tơ cổng trượt AYROS 650', category:'Cổng trượt tự động', productType:'Mô tơ cổng trượt', subtype:'Trượt', model:'AYROS 650', price:25950000, documentCategory:'Cổng trượt tự động', rawAlias:'AYROS 650 (30C065)' },
  { sheet:'AYROS 650 V2', sku:'30C-065 V2', name:'Mô tơ cổng trượt AYROS 650', category:'Cổng trượt tự động', productType:'Mô tơ cổng trượt', subtype:'Trượt', model:'AYROS 650', price:27900000, documentCategory:'Cổng trượt tự động', rawAlias:'AYROS 650 (30C065V2)' },
  { sheet:'STARK600', sku:'29H006V2', name:'Mô tơ cổng mở xoay tự động STARK 600 V2', category:'Cổng tay đòn tự động', productType:'Mô tơ cổng mở xoay tự động', subtype:'Tay đòn / mở xoay', model:'STARK 600 V2', price:32900000, documentCategory:'Cổng tay đòn tự động', rawAlias:'29H006V2' },
];

const { result, preview, products: rawProducts } = await importFileForUI(file, { catalog: [] });
assert.equal(result.engine, 'v2', `expected v2 importer, got ${result.engine}`);
assert.equal(result.stats?.rejected || 0, 0, 'production importer rejected rows');

const sanitized = sanitizeCatalogProducts(rawProducts, {
  sourceFileName: file.name,
  importSourceKind: 'catalog',
  oldQuoteMode: true,
});
const validated = applyCommercialValidation(sanitized, { existingProducts: [] }).products;
const active = validated.filter((p) => {
  const st = String(p?._meta?.canonicalStatus || p?._meta?.status || p?.status || '').toLowerCase();
  return st !== 'skipped';
});
const unsafe = active.filter(isUnsafeImportedProduct);
assert.equal(unsafe.length, 0, `unsafe rows remain: ${unsafe.map(p=>p.name).join(' | ')}`);
assert.equal(active.length, expected.length, `expected exactly ${expected.length} sellable products, got ${active.length}`);

const bySku = new Map(active.map((p) => [normalizeIdentitySku(p.sku), p]));
assert.equal(bySku.size, expected.length, 'canonical SKU collision/duplicate detected');

for (const e of expected) {
  const p = bySku.get(normalizeIdentitySku(e.sku));
  assert.ok(p, `${e.sheet}: missing SKU ${e.sku}`);
  assert.equal(p.name, e.name, `${e.sku}: wrong canonical product name`);
  assert.equal(p.category, e.category, `${e.sku}: wrong source taxonomy/category`);
  assert.equal(p.productType, e.productType, `${e.sku}: wrong productType`);
  assert.equal(p.subtype, e.subtype, `${e.sku}: wrong subtype`);
  assert.equal(p.model, e.model, `${e.sku}: wrong commercial model`);
  assert.equal(Number(p.costPrice || 0), e.price, `${e.sku}: wrong unit price`);
  assert.equal(p.attributes?.identity?.family, 'Cổng tự động', `${e.sku}: family must remain broad only`);
  const sheet = p?.source?.sheet || p?._meta?.source?.sheet || '';
  const documentCategory = p?.source?.documentCategory || p?._meta?.source?.documentCategory || '';
  assert.equal(sheet, e.sheet, `${e.sku}: provenance sheet drift`);
  assert.equal(documentCategory, e.documentCategory, `${e.sku}: Quy Cách/documentCategory drift`);
}

const forbidden = /nhân công|vật tư phụ|tổng cộng/i;
assert.equal(active.filter(p => forbidden.test(String(p.name || ''))).length, 0, 'non-product quote rows leaked into catalog');

// Re-import/repair gate: construct the kind of coarse legacy rows created before P2.3.x,
// preserve source evidence, then prove every incoming row resolves to exactly one record.
let legacyCatalog = expected.map((e) => {
  const current = bySku.get(normalizeIdentitySku(e.sku));
  return {
    ...current,
    id: `legacy-${e.sku}`,
    name: `Cổng tự động ${e.rawAlias}`,
    sku: e.rawAlias,
    category: 'Cổng tự động',
    productType: '', subtype: '', model: '',
    attributes: {
      ...(current.attributes || {}),
      identity: {
        ...(current.attributes?.identity || {}),
        category: 'Cổng tự động', productType: '', subtype: '', model: '',
        canonicalName: `Cổng tự động ${e.rawAlias}`,
        sourceAlias: e.rawAlias,
      },
    },
  };
});

function mergeLikeCatalog(existing, incoming) {
  const merged = mergeCatalogImport(existing, incoming, { idFactory: (_p, i) => `gate-${i}` });
  assert.equal(merged.ambiguous, 0, `production merge path produced ${merged.ambiguous} ambiguous Bisco rows`);
  assert.equal(merged.added, 0, `production merge path created ${merged.added} duplicate Bisco rows`);
  assert.equal(merged.updated, incoming.length, `production merge path must update every Bisco row; updated=${merged.updated}`);
  return merged.products;
}

legacyCatalog = mergeLikeCatalog(legacyCatalog, active);
assert.equal(legacyCatalog.length, expected.length, 'first re-import created duplicates');
legacyCatalog = mergeLikeCatalog(legacyCatalog, active);
assert.equal(legacyCatalog.length, expected.length, 'second identical re-import created duplicates');
assert.equal(new Set(legacyCatalog.map(p => normalizeIdentitySku(p.sku))).size, expected.length, 're-import left duplicate canonical SKUs');
for (const e of expected) {
  const p = legacyCatalog.find(p => normalizeIdentitySku(p.sku) === normalizeIdentitySku(e.sku));
  assert.ok(p, `${e.sku}: repaired legacy product missing`);
  assert.equal(p.category, e.category, `${e.sku}: legacy taxonomy was not repaired`);
  assert.equal(p.productType, e.productType, `${e.sku}: legacy productType was not repaired`);
  assert.equal(p.name, e.name, `${e.sku}: legacy product name was not repaired`);
}

console.log('✓ PILOT REAL-FILE GATE PASS — Bisco XLSX');
console.log(`  file=${path.basename(filePath)} sha256=${fileHash}`);
console.log(`  production engine=${result.engine} previewLines=${preview?.lines?.length ?? 'n/a'} catalogProducts=${active.length}`);
console.log('  exact identity/taxonomy/model/SKU/price/provenance: 9/9');
console.log('  non-product leakage: 0');
console.log('  legacy re-import repair: 9 -> 9, second re-import: 9 -> 9, duplicates: 0');
