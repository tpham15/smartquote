#!/usr/bin/env node
// RC16 (P2.3.14) — S1 supplier/brand provenance end-to-end, S2/S3 old-quote
// schema-drift + warranty rows, S2 clear-model variant dedupe.
// S1 cases run the app path: real xlsx bytes → importFileForUI (runImport →
// preview → importPreviewLinesToProducts) → catalogImportPipeline → mergeCatalogImport.
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { importFileForUI } from '../src/import-engine/uiAdapter.js';
import { rowToItem } from '../src/import-engine/extractItems.js';
import { dedupeCatalogIdentities } from '../src/import-engine/productSanitizer.js';
import { technicalVariantsCompatible, isWeakBrandEvidence, normalizeIdentityBrand, hasIdentityPartyEvidence } from '../src/import-engine/productIdentity.js';
import * as P from '../src/import-engine/catalogImportPipeline.js';

const supplierSourceOf = (p) => p?._meta?.supplierSource ?? p?._meta?.source?.supplierSource ?? p?.source?.supplierSource ?? '';
const codes = (p) => (p?._meta?.issues || p?.issues || []).map((it) => String(it?.code || it).toLowerCase());

function xlsxFile(name, rows, sheetName = 'Sheet1') {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), sheetName);
  return new File([XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })], name);
}

async function appImport(file, { catalog = [], priceRole = 'cost', importSourceKind = '', match } = {}) {
  const { result, preview, products } = await importFileForUI(file, { catalog });
  const ctx = { catalog, sourceFileName: file.name, importSourceKind };
  let rows = P.splitCatalogPreviewProducts(P.prepareCatalogImportProducts(products, ctx)).active;
  if (rows.some((p) => P.hasImportIssue(p, 'price_column_uncertain'))) rows = P.applyPriceRoleDecision(rows, priceRole, { catalog });
  const ambiguous = rows.filter((p) => P.hasImportIssue(p, 'catalog_match_ambiguous')).map((p) => p.sku);
  if (match) rows.forEach((p, i) => { if (P.hasImportIssue(p, 'catalog_match_ambiguous')) rows = P.applyCatalogMatchDecision(rows, i, match.kind, match.targetId, { catalog }); });
  const willImport = P.countImportableProducts(rows);
  const { safe } = P.finalizeCatalogImport(rows, ctx);
  const committed = P.commitCatalogImport(catalog, safe, { idFactory: (_p, i) => `n${i}` });
  assert.equal(willImport, committed.added + committed.updated, `${file.name}: preview "Thêm ${willImport}" must equal saved rows`);
  return { result, preview, products, rows, ambiguous, committed };
}

const priceList = (rows, withSupplier = false) => [
  withSupplier ? ['STT', 'Mã SP', 'Tên sản phẩm', 'Nhà cung cấp', 'ĐVT', 'Đơn giá'] : ['STT', 'Mã SP', 'Tên sản phẩm', 'ĐVT', 'Đơn giá'],
  ...rows,
];
const DL = { id: 'c1', sku: 'DL-12W-30', name: 'Đèn downlight âm trần 12W 3000K', category: 'Chiếu sáng', unit: 'Cái', costPrice: 170000, priceMode: 'markup' };

// ---------- S1 ----------
{
  // S1-1: real supplier in catalog, f2_250.xlsx with same SKU + name.
  const file = xlsxFile('f2_250.xlsx', priceList([[1, 'DL-12W-30', 'Đèn downlight âm trần 12W 3000K', 'Cái', 180000]]));
  const r = await appImport(file, { catalog: [{ ...DL, supplier: 'Rạng Đông' }] });
  assert.deepEqual(r.ambiguous, [], 'S1-1 no ambiguity from a filename supplier');
  assert.equal(r.committed.updated, 1, 'S1-1 update');
  assert.equal(r.committed.products.length, 1);
  assert.equal(r.committed.products[0].supplier, 'Rạng Đông', 'S1-1 supplier kept');
  assert.equal(r.committed.products[0].costPrice, 180000, 'S1-1 price updated');
}
{
  // S1-2: catalog product without supplier stays without supplier.
  const file = xlsxFile('bang_gia_den.xlsx', priceList([[1, 'DL-12W-30', 'Đèn downlight âm trần 12W 3000K', 'Cái', 180000]]));
  const r = await appImport(file, { catalog: [{ ...DL, supplier: '' }] });
  assert.equal(r.committed.updated, 1, 'S1-2 update');
  assert.equal(r.committed.products[0].supplier || '', '', 'S1-2 supplier stays empty');
}
{
  // S1-3: empty catalog → new product keeps filename supplier, labelled weak.
  const file = xlsxFile('bang_gia_den.xlsx', priceList([[1, 'DL-12W-30', 'Đèn downlight âm trần 12W 3000K', 'Cái', 180000]]));
  const r = await appImport(file);
  const p = r.committed.products[0];
  assert.equal(p.supplier, 'den');
  assert.equal(supplierSourceOf(p), 'file_name', 'S1-3 _meta.supplierSource');
  assert.equal(p.attributes?.provenance?.supplierSource, 'file_name', 'S1-3 provenance persisted in attributes');
}
{
  // S1-4: an explicit supplier column that conflicts is still ambiguous (RC15 F3-2).
  const file = xlsxFile('bang_gia_duhal.xlsx', priceList([[1, 'DL-12W-30', 'Đèn downlight âm trần 12W 3000K', 'Duhal', 'Cái', 175000]], true));
  const r = await appImport(file, { catalog: [{ ...DL, supplier: 'Rạng Đông' }] });
  assert.deepEqual(r.ambiguous, ['DL-12W-30'], 'S1-4 strong conflicting supplier stays ambiguous');
  assert.equal(r.committed.added + r.committed.updated, 0, 'S1-4 ambiguous row is not saved without a decision');
}
{
  // S1-5: every key of item.source survives into product.source and _meta.source.
  const file = xlsxFile('f2_250.xlsx', priceList([[1, 'DL-12W-30', 'Đèn downlight âm trần 12W 3000K', 'Cái', 180000], [2, 'TR-10W-24', 'Đèn ray 10W', 'Cái', 320000]]));
  const { result, products } = await importFileForUI(file, { catalog: [] });
  assert.ok(result.items.length >= 2);
  for (const item of result.items) {
    const p = products.find((x) => x.sku === item.sku);
    assert.ok(p, `S1-5 product for ${item.sku}`);
    for (const key of Object.keys(item.source || {})) {
      assert.ok(key in p.source, `S1-5 product.source.${key} kept`);
      assert.ok(key in p._meta.source, `S1-5 _meta.source.${key} kept`);
    }
    assert.equal(p.source.supplierSource, 'file_name');
  }
}
{
  // Brand inferred only from the file name is weak evidence.
  const weak = { brand: 'Lumi', source: { brandSource: 'file_name' } };
  assert.equal(isWeakBrandEvidence(weak), true);
  assert.equal(normalizeIdentityBrand(weak), '');
  assert.equal(hasIdentityPartyEvidence({ ...weak, supplier: 'lumi', _meta: { supplierSource: 'file_name' } }), false);
  assert.equal(normalizeIdentityBrand({ brand: 'Lumi', source: { brandSource: 'column' } }), 'lumi');
  const file = xlsxFile('bang_gia_lumi.xlsx', priceList([[1, 'LM-S1N', 'Công tắc 1 nút', 'Cái', 900000]]));
  const { result } = await importFileForUI(file, { catalog: [] });
  // (the engine item keeps only the label; brand itself is not carried past matchCatalog, as in RC15)
  assert.equal(result.items[0].source.brandSource, 'file_name', 'brand guessed from "lumi" in the file name is labelled file_name');
}

// ---------- S2 ----------
{
  // S2-2: same clear model SKU, 3000K vs 4000K → not merged.
  const a = { sku: 'LM-ST12-75-55-CRBTC-O1', name: 'Đèn spotlight 12W', specs: '12W 3000K' };
  const b = { sku: 'LM-ST12-75-55-CRBTC-O1', name: 'Đèn spotlight 12W', specs: '12W 4000K' };
  assert.equal(technicalVariantsCompatible(a, b), false, 'S2-2 3000K vs 4000K conflict');
  assert.equal(dedupeCatalogIdentities([a, b]).products.length, 2, 'S2-2 not merged');
  // Missing token on one side is compatible for an exact clear model code.
  const c = { sku: 'LM-ST12-75-55-CRBTC-O1', name: 'Đèn spotlight 12W', specs: '12W' };
  assert.equal(technicalVariantsCompatible(b, c), true, 'S2 12w|4000k vs 12w compatible');
  assert.equal(dedupeCatalogIdentities([b, c]).products.length, 1, 'S2 merged');
  // Other dimensions keep conflicting.
  assert.equal(technicalVariantsCompatible({ sku: 'DS-2CD1023G0E', name: 'Camera', specs: '2.8mm' }, { sku: 'DS-2CD1023G0E', name: 'Camera', specs: '3.6mm' }), false, '2.8mm vs 3.6mm');
  assert.equal(technicalVariantsCompatible({ sku: 'LM-ST12-75', name: 'Đèn', specs: '12W' }, { sku: 'LM-ST12-75', name: 'Đèn', specs: '9W' }), false, '12W vs 9W');
  assert.equal(technicalVariantsCompatible({ sku: 'LM-SW01-GLASS', name: 'Công tắc 2 nút' }, { sku: 'LM-SW01-GLASS', name: 'Công tắc 3 nút' }), false, '2 nút vs 3 nút');
  // Short/generic SKU keeps the strict rule.
  assert.equal(technicalVariantsCompatible({ sku: 'FU', name: 'Bộ FU', specs: '12W' }, { sku: 'FU', name: 'Bộ FU', specs: '12W 4000K' }), false, 'short SKU strict');
}
{
  // S2-2 through runImport: same clear SKU written twice with different CCT stays two products.
  const file = xlsxFile('bang_gia_spot.xlsx', priceList([
    [1, 'LM-ST12-75-55-CrBTC-O1', 'Đèn spotlight âm trần 12W 3000K', 'Cái', 702000],
    [2, 'LM-ST12-75-55-CrBTC-O1', 'Đèn spotlight âm trần 12W 4000K', 'Cái', 702000],
  ]));
  const { products } = await importFileForUI(file, { catalog: [] });
  assert.equal(products.length, 2, 'S2-2 runImport keeps both CCT variants');
}
{
  // S2-3: no SKU, same name, one side has 4000K → strict rule, not merged.
  const a = { sku: '', name: 'Đèn panel âm trần', specs: '4000K' };
  const b = { sku: '', name: 'Đèn panel âm trần', specs: '' };
  assert.equal(technicalVariantsCompatible(a, b), false);
  assert.equal(dedupeCatalogIdentities([a, b]).products.length, 2, 'S2-3 not merged');
}
{
  // S2-4: prose in the Mã column (not warranty) keeps RC5 behaviour.
  const item = rowToItem(
    { r: 4, text: ['3', 'Chặn cửa bán nguyệt', '45000'], joined: '3 Chặn cửa bán nguyệt 45000', filled: 3, cells: [] },
    { sku: 1, price: 2, _deriveNameFromSku: true, _priceColUncertain: false },
    'PHỤ KIỆN', '', 'Supplier', {},
  );
  assert.ok(item);
  assert.equal(item.name, 'Chặn cửa bán nguyệt');
  assert.equal(item.sku, '');
  assert.ok(!codes(item).includes('warranty_in_sku_column'));
}
{
  // S2-5: supplier price list (not a quote table) with warranty text in Mã → no SKU, not name, review with reason.
  const item = rowToItem(
    { r: 2, text: ['1', 'BH 12 tháng', 'Đèn pha LED 50W ngoài trời', 'Cái', '520000'], joined: '1 BH 12 tháng Đèn pha LED 50W ngoài trời Cái 520000', filled: 5, cells: [] },
    { sku: 1, name: 2, unit: 3, price: 4, _priceColUncertain: false },
    'Bang gia', '', 'Supplier', {},
  );
  assert.ok(item, 'S2-5 row kept for review');
  assert.equal(item.sku, '');
  assert.equal(item.name, 'Đèn pha LED 50W ngoài trời');
  assert.ok(codes(item).includes('warranty_in_sku_column'), 'S2-5 reason attached');
  assert.equal(item.issues.find((it) => it.code === 'warranty_in_sku_column').level, 'warning');
}

// ---------- S3 ----------
const QUOTE_HEADER = ['Khu vực lắp đặt', '', 'Tên hàng hoá/ Mô tả', 'Thông số kỹ thuật/Tính năng cơ bản', 'Hình ảnh', 'Mã thiết bị', 'Xuất xứ', 'ĐVT', 'Số lượng', 'Đơn giá', 'Thành tiền'];
{
  // S3-2: quote table, Mã "BH 24 tháng", Thông số has the commercial name, Tên has the model → recovered, not dropped.
  const file = xlsxFile('bao_gia_cu_bh24.xlsx', [
    ['Khách hàng: KHÁCH MẪU', '', '', '', 'Số báo giá: BG-002'],
    QUOTE_HEADER,
    ['VII/ Giải pháp chiếu sáng'],
    ['Phòng khách', '', 'LM-D9-90-110-W4-2', 'Đèn Downlight âm trần 9W - 110° Tính năng On/Off Nhiệt độ màu: 4000K', '', 'BH 24 tháng', 'Lumi', 'Cái', 2, 216000, 432000],
    ['Phòng ngủ', '', 'LM-CS10-36W4-1', 'Đèn spotlight vuông ốp nổi 10W - 36° Tính năng On/Off', '', 'BH 24 tháng', 'Lumi', 'Cái', 1, 1134000, 1134000],
  ], 'BG');
  const r = await appImport(file, { importSourceKind: 'old_quote' });
  const skus = r.committed.products.map((p) => p.sku).sort();
  assert.deepEqual(skus, ['LM-CS10-36W4-1', 'LM-D9-90-110-W4-2'], 'S3-2 both lights recovered');
  const d9 = r.committed.products.find((p) => p.sku === 'LM-D9-90-110-W4-2');
  assert.match(d9.name, /^Đèn Downlight âm trần 9W - 110°/);
  assert.ok(!(r.preview.skippedRows || []).length, 'S3-2 nothing skipped');
}
{
  // S3-1/S3-3: warranty-only row (no real code anywhere) is skipped WITH a reason in the preview.
  const file = xlsxFile('bao_gia_cu_bh.xlsx', [
    ['Khách hàng: KHÁCH MẪU', '', '', '', 'Số báo giá: BG-003'],
    QUOTE_HEADER,
    ['Tầng 1', '', 'Công tắc cơ thông minh 1 nút', 'Mặt kính', '', 'LM-1G2W-C(G)', 'Lumi', 'Cái', 2, 1026000, 2052000],
    ['Tầng 1', '', 'Cảm biến BH 36 tháng', 'Cảm biến chuyển động', '', 'BH 36 tháng', 'Lumi', 'Cái', 1, 1242000, 1242000],
  ], 'BG');
  const r = await appImport(file, { importSourceKind: 'old_quote' });
  assert.deepEqual(r.committed.products.map((p) => p.sku), ['LM-1G2W-C(G)'], 'S3-1 warranty-only row is not a product');
  const skipped = r.preview.skippedRows || [];
  assert.equal(skipped.length, 1, 'S3-3 one skipped row with reason');
  assert.equal(skipped[0].reason, 'Cột Mã chỉ có thông tin bảo hành, không có mã sản phẩm');
  assert.match(skipped[0].rawText, /Cảm biến BH 36 tháng/);
  assert.ok((r.preview.warnings || []).some((w) => /bảo hành/.test(w)), 'S3-3 reason also in preview warnings');
}

// ---------- RC16 review follow-ups ----------
{
  // Dedupe must stay ~linear: RC16 first cut was O(n²) (6,000 rows ≈ 12.7 s).
  const n = 6000;
  const rows = Array.from({ length: n }, (_, i) => ({ sku: `LM-ST${i}-75-55`, name: `Đèn spotlight ${i} 12W`, specs: '12W 4000K', costPrice: 1000 + i, supplier: 'den', _meta: { supplierSource: 'file_name' } }));
  const t0 = Date.now();
  const out = dedupeCatalogIdentities(rows);
  const ms = Date.now() - t0;
  assert.equal(out.products.length, n);
  assert.ok(ms < 2000, `dedupe of ${n} rows took ${ms} ms (budget 2000 ms)`);
  // The index must still find the variant-compatible duplicate.
  const withDup = [...rows.slice(0, 50), { ...rows[10], specs: '12W' }];
  assert.equal(dedupeCatalogIdentities(withDup).products.length, 50, 'index-based lookup still merges 12w vs 12w|4000k');
}
{
  // Explicit "Báo giá cũ" mode: the file name is the customer/project, never the NCC.
  const r = P.prepareCatalogImportProducts([
    { sku: 'LM-D9-90', name: 'Đèn downlight 9W', costPrice: 216000, listPrice: 216000, supplier: 'BG Villa Anh Tuan', _meta: { supplierSource: 'file_name', issues: [] } },
    { sku: 'LM-HC', name: 'Bộ điều khiển trung tâm', costPrice: 2970000, listPrice: 2970000, supplier: 'Lumi', _meta: { supplierSource: 'column', issues: [] } },
  ], { sourceFileName: 'BG_Villa_Anh_Tuan_2025.xlsx', importSourceKind: 'old_quote' });
  assert.equal(r.find((p) => p.sku === 'LM-D9-90').supplier, '', 'old quote: file-name supplier dropped');
  assert.equal(r.find((p) => p.sku === 'LM-HC').supplier, 'Lumi', 'old quote: supplier column kept');
}

{
  // Customer-facing quote outputs must use customerFacingParty (no file-name guesses).
  const fs = await import('node:fs');
  const app = fs.readFileSync(new URL('../src/SmartQuote.jsx', import.meta.url), 'utf8');
  assert.ok(!app.includes('p.origin || p.attributes?.origin || p.supplier'), 'default Excel export must not fall back to raw supplier');
  assert.ok(!/const supplier = product\.supplier \|\| "";/.test(app), 'printed quote column must not read raw supplier');
  assert.ok((app.match(/\.\.\.customerFacingParty\(p\)/g) || []).length >= 3, 'export rows, sections and server Excel payload use customerFacingParty');
  assert.ok(app.includes('const { origin, brand, supplier } = customerFacingParty(product);'), 'quotePartyValueForLabel uses customerFacingParty');
  const { customerFacingParty } = await import('../src/import-engine/productIdentity.js');
  assert.deepEqual(customerFacingParty({ supplier: 'den', _meta: { supplierSource: 'file_name' } }), { supplier: '', brand: '', origin: '' });
  assert.equal(customerFacingParty({ supplier: 'Rạng Đông' }).supplier, 'Rạng Đông', 'legacy/manual supplier still printed');
  assert.equal(customerFacingParty({ supplier: 'Duhal', attributes: { provenance: { supplierSource: 'file_name', supplierValue: 'den' } } }).supplier, 'Duhal', 'edited after a guess → printed');
  assert.equal(customerFacingParty({ supplier: 'den', attributes: { provenance: { supplierSource: 'file_name', supplierValue: 'den' } } }).supplier, '', 'still the guess → hidden');
  assert.equal(customerFacingParty({ supplier: 'den', origin: 'Việt Nam', _meta: { supplierSource: 'file_name' } }).origin, 'Việt Nam');
}

console.log('✓ P2.3.14 RC16 provenance + old-quote smoke PASS');
console.log('  - S1: filename supplier/brand stay weak from runImport to merge; kept/empty suppliers are not overwritten');
console.log('  - S1-5: item.source keys survive the preview boundary');
console.log('  - S2: old-quote schema drift recovered from original cells; clear-model variant dedupe by dimension');
console.log('  - S2-5/S3: warranty text in Mã → review (price list) or skipped with reason (quote)');
