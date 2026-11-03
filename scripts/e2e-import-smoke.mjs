#!/usr/bin/env node
// RC16 S4 — golden end-to-end import smoke.
//
// Runs the SAME path the app uses for "Nhập bảng giá" / "Báo giá cũ":
//   real .xlsx → importFileForUI (runImport → preview → importPreviewLinesToProducts)
//   → prepareCatalogImportProducts (sanitize → annotateCatalogMatches → applyCommercialValidation)
//   → user decisions with the app's own functions (price role, ambiguous match, approve row)
//   → finalizeCatalogImport (re-sanitize + isUnsafeImportedProduct) → commitCatalogImport (mergeCatalogImport)
// and compares the resulting catalog with tests/fixtures/e2e/golden.json.
//
//   npm run smoke:e2e-import              # compare (FAIL on any difference)
//   npm run golden:e2e-import:update      # rewrite golden.json — log every change in the release notes
//
// Infra problems (missing module, missing fixture) are FAIL, never SKIPPED.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

// fileURLToPath (not URL.pathname): folders with spaces/Vietnamese names work on macOS.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtureDir = path.join(root, 'tests', 'fixtures', 'e2e');
const goldenPath = path.join(fixtureDir, 'golden.json');
const UPDATE = process.argv.includes('--update');

// In-memory browser storage: learning/template memory use it. Reset before every
// case so cases stay independent and deterministic.
class MemoryStorage {
  constructor() { this.map = new Map(); }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v) { this.map.set(k, String(v)); }
  removeItem(k) { this.map.delete(k); }
  clear() { this.map.clear(); }
  key(i) { return [...this.map.keys()][i] ?? null; }
  get length() { return this.map.size; }
}
globalThis.localStorage = new MemoryStorage();
const resetStorage = () => globalThis.localStorage.clear();

const { importFileForUI, importManyForUI } = await import('../src/import-engine/uiAdapter.js');
const { readCatalogRowsForManualMapping, guessCatalogColumnsByName, parsePdfCatalogWithClaude } = await import('../src/import-engine/legacy/legacyCatalogImport.js');
const P = await import('../src/import-engine/catalogImportPipeline.js');
const { productToCatalogRpcItem, catalogRowToProduct } = await import('../src/supabase/catalogStore.js');
const { customerFacingParty } = await import('../src/import-engine/productIdentity.js');
const { snapshotQuoteProduct } = await import('../src/quote/quoteCommercialSafety.js');

/** Simulate saving the catalog to Supabase and loading it back (what the next session sees). */
const cloudRoundTrip = (products = []) => products.map((p) => {
  const item = productToCatalogRpcItem(p);
  return catalogRowToProduct({ ...item, raw_product: JSON.parse(JSON.stringify(item.raw_product)) });
});

const GOLDEN_FIELDS = ['sku', 'name', 'costPrice', 'listPrice', 'priceMode', 'supplier', '_meta.supplierSource', 'category'];
const pick = (obj, dotted) => dotted.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
const supplierSourceOf = (p) => p?._meta?.supplierSource ?? p?._meta?.source?.supplierSource ?? p?.source?.supplierSource ?? '';
const issueCodes = (p) => (p?._meta?.issues || []).map((it) => String(it?.code || it).toLowerCase());

function snapshotCatalog(products = []) {
  return products
    .map((p) => {
      const row = {};
      for (const f of GOLDEN_FIELDS) {
        const v = f === '_meta.supplierSource' ? supplierSourceOf(p) : pick(p, f);
        row[f] = v == null ? '' : v;
      }
      return row;
    })
    .sort((a, b) => `${a.sku}|${a.name}`.localeCompare(`${b.sku}|${b.name}`));
}

function loadFixture(name) {
  const filePath = path.join(fixtureDir, name);
  if (!fs.existsSync(filePath)) throw new Error(`fixture missing: ${path.relative(root, filePath)} — run node scripts/e2e-import-fixtures.mjs`);
  return new File([fs.readFileSync(filePath)], name, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

const CATALOG_DL12_NO_SUPPLIER = [{ id: 'cat-dl12', sku: 'DL-12W-30', name: 'Đèn downlight âm trần 12W 3000K', category: 'Chiếu sáng', supplier: '', unit: 'Cái', costPrice: 170000, listPrice: 0, priceMode: 'markup' }];
const CATALOG_DL12_RANG_DONG = [{ ...CATALOG_DL12_NO_SUPPLIER[0], supplier: 'Rạng Đông' }];

/**
 * One import as a dealer would do it. Returns everything a case wants to assert on.
 * decisions: { priceRole?: "cost"|"list", match?: (row, index) => {kind, targetId}|null, approve?: "none"|"warnings" }
 */
async function runAppImport({ file, catalog = [], importSourceKind = '', decisions = {}, source = 'engine', pdfCache = null }) {
  const fixture = loadFixture(file);
  let result = null; let preview = null; let products;
  if (source === 'manual_mapping') {
    // "Sửa mapping": raw rows → header guess → buildManualMappingPreview (same as ProductImporter.buildPreview).
    const { rows } = await readCatalogRowsForManualMapping(fixture);
    const headers = (rows[0] || []).map((h, idx) => ({ label: String(h ?? ''), idx }));
    const colMap = guessCatalogColumnsByName(headers);
    products = P.buildManualMappingPreview(rows.slice(1), colMap, { fileName: fixture.name, startRowIndex: 0 });
  } else if (source === 'pdf_cache') {
    // PDF path without AI: the real parsePdfCatalogWithClaude wrapper served from its cache
    // (rows cached by RC15, i.e. without supplier provenance labels).
    const pdf = new File([Buffer.from(`%PDF-1.4 ${file}`)], file.replace(/\.xlsx$/i, '.pdf'));
    products = await parsePdfCatalogWithClaude(pdf, { getCached: () => pdfCache, setCached: () => {}, getQuota: () => ({ pdfCount: 0 }), incQuota: () => {} });
    preview = products.importPreview;
  } else {
    ({ result, preview, products } = await importFileForUI(fixture, { catalog }));
  }
  const learned = P.applyImportLearning(products, { fileName: fixture.name });
  const ctx = { catalog, sourceFileName: fixture.name, importSourceKind };
  const split = P.splitCatalogPreviewProducts(P.prepareCatalogImportProducts(learned.products, ctx));
  let rows = split.active;
  const initial = rows;

  if (decisions.priceRole && rows.some((p) => P.hasImportIssue(p, 'price_column_uncertain'))) {
    rows = P.applyPriceRoleDecision(rows, decisions.priceRole, { catalog });
  }
  const rowsBeforeMatch = rows;
  const ambiguousBeforeDecision = rows.filter((p) => P.hasImportIssue(p, 'catalog_match_ambiguous')).map((p) => p.sku);
  if (typeof decisions.match === 'function') {
    rows.forEach((p, index) => {
      if (!P.hasImportIssue(p, 'catalog_match_ambiguous')) return;
      const choice = decisions.match(p, index);
      if (choice) rows = P.applyCatalogMatchDecision(rows, index, choice.kind, choice.targetId ?? null, { catalog });
    });
  }
  if (typeof decisions.edit === 'function') rows = rows.map((p) => decisions.edit(p) || p);
  if (decisions.approve === 'warnings') {
    rows.forEach((_p, index) => {
      const approved = P.approveImportRow(rows, index);
      if (!approved.refused) rows = approved.items;
    });
  }

  const willImport = P.countImportableProducts(rows);
  const reviewRows = rows.filter((p) => !P.countImportableProducts([p]));
  const finalized = P.finalizeCatalogImport(rows, ctx);
  const committed = P.commitCatalogImport(catalog, finalized.safe, { mode: 'merge', idFactory: (_p, i) => `new-${i}` });
  const learnedRows = P.learnFromImportedRows(finalized.safe, { fileName: fixture.name, acceptedAtMerge: true });
  // RC16: the supplier shown on each preview row must be exactly what the save leaves in the catalog.
  const supplierMismatches = [];
  for (const row of rows.filter((p) => P.countImportableProducts([p]))) {
    const shown = P.effectiveImportSupplier(row).value;
    const targetId = row._meta?.catalogMatch?.kind === 'update' ? row._meta.catalogMatch.targetId : null;
    const saved = targetId
      ? committed.products.find((p) => p.id === targetId)
      : committed.products.find((p) => p.sku === row.sku && p.name === row.name && !catalog.some((c) => c.id === p.id));
    if (saved && String(saved.supplier || '') !== shown) supplierMismatches.push(`${row.sku}: preview "${shown}" ≠ saved "${saved.supplier || ''}"`);
  }
  return { result, preview, products, learnedHits: learned.hits, learnedRows, initial, supplierMismatches, rowsBeforeMatch, ambiguousBeforeDecision, rows, reviewRows, willImport, finalized, committed, upstreamSkipped: split.skippedCount };
}

const byKey = (list, sku) => list.filter((p) => String(p.sku || '').toUpperCase() === sku.toUpperCase());
const looksLikeModelCode = (s = '') => /^[A-Z0-9]+(?:[-/.][A-Z0-9()]+){2,}$/i.test(String(s).trim());

const CASES = [
  {
    id: 'den_empty_list',
    title: 'bang_gia_den.xlsx · catalog trống · Đơn giá = Giá bán',
    run: () => runAppImport({ file: 'bang_gia_den.xlsx', decisions: { priceRole: 'list' } }),
    check: (r) => {
      assert.equal(r.committed.added, 5);
      for (const p of r.committed.products) {
        assert.equal(p.costPrice, 0, `${p.sku}: list role must leave costPrice empty`);
        assert.ok(p.listPrice > 0, `${p.sku}: listPrice`);
      }
    },
  },
  {
    id: 'den_empty_cost',
    title: 'S1-3 bang_gia_den.xlsx · catalog trống · Đơn giá = Giá nhập',
    run: () => runAppImport({ file: 'bang_gia_den.xlsx', decisions: { priceRole: 'cost' } }),
    check: (r) => {
      assert.equal(r.committed.added, 5);
      const dl = byKey(r.committed.products, 'DL-12W-30')[0];
      assert.equal(dl.supplier, 'den', 'S1-3 new product keeps the filename supplier');
      assert.equal(supplierSourceOf(dl), 'file_name', 'S1-3 new product must be labelled _meta.supplierSource="file_name"');
    },
  },
  {
    id: 'den_catalog_no_supplier',
    title: 'S1-2 bang_gia_den.xlsx · catalog có DL-12W-30 không NCC',
    run: () => runAppImport({ file: 'bang_gia_den.xlsx', catalog: CATALOG_DL12_NO_SUPPLIER, decisions: { priceRole: 'cost' } }),
    check: (r) => {
      assert.deepEqual(r.ambiguousBeforeDecision ?? [], []);
      assert.equal(r.committed.updated, 1, 'S1-2 DL-12W-30 must be an update');
      const dl = byKey(r.committed.products, 'DL-12W-30');
      assert.equal(dl.length, 1, 'S1-2 no duplicate DL-12W-30');
      assert.equal(dl[0].supplier || '', '', 'S1-2 empty supplier must stay empty, not "den"');
      assert.equal(P.effectiveImportSupplier(r.rows.find((p) => p.sku === 'DL-12W-30')).value, '', 'S1-2 preview shows no supplier');
    },
  },
  {
    id: 'den_catalog_rang_dong',
    title: 'S1-1 bang_gia_den.xlsx · catalog có DL-12W-30 NCC "Rạng Đông"',
    run: () => runAppImport({ file: 'bang_gia_den.xlsx', catalog: CATALOG_DL12_RANG_DONG, decisions: { priceRole: 'cost' } }),
    check: (r) => {
      const amb = r.rows.filter((p) => P.hasImportIssue(p, 'catalog_match_ambiguous'));
      assert.equal(amb.length, 0, `S1-1 filename supplier must not create an ambiguous match (${amb.map((p) => p.sku).join(',')})`);
      assert.equal(r.committed.updated, 1, 'S1-1 DL-12W-30 must be an update');
      const dl = byKey(r.committed.products, 'DL-12W-30');
      assert.equal(dl.length, 1, 'S1-1 no duplicate DL-12W-30');
      assert.equal(dl[0].supplier, 'Rạng Đông', 'S1-1 supplier must stay "Rạng Đông"');
      const row = r.rows.find((p) => p.sku === 'DL-12W-30');
      assert.deepEqual(P.effectiveImportSupplier(row), { value: 'Rạng Đông', weak: false, kept: true }, 'S1-1 preview shows the kept supplier, not "den"');
    },
  },
  {
    id: 'cot_ncc_rang_dong',
    title: 'S1-4 bang_gia_cot_ncc.xlsx (cột NCC "Duhal") · catalog "Rạng Đông"',
    run: () => runAppImport({
      file: 'bang_gia_cot_ncc.xlsx', catalog: CATALOG_DL12_RANG_DONG,
      decisions: { priceRole: 'cost', match: () => ({ kind: 'new' }) },
    }),
    check: (r) => {
      const amb = r.rowsBeforeMatch.filter((p) => P.hasImportIssue(p, 'catalog_match_ambiguous')).map((p) => p.sku);
      assert.deepEqual(amb, ['DL-12W-30'], 'S1-4 a real supplier column that conflicts must stay ambiguous');
      const dl = byKey(r.committed.products, 'DL-12W-30');
      assert.equal(dl.length, 2, 'S1-4 user chose "Thêm mới" → two DL-12W-30 identities');
      assert.deepEqual(dl.map((p) => p.supplier).sort(), ['Duhal', 'Rạng Đông']);
      assert.equal(supplierSourceOf(dl.find((p) => p.supplier === 'Duhal')), 'column');
    },
  },
  {
    id: 'rang_dong_reimport_cloud',
    title: 'S1-1b sau S1-1, lưu cloud rồi nhập lại bang_gia_den.xlsx: "Rạng Đông" vẫn là bằng chứng thật',
    run: async () => {
      const first = await runAppImport({ file: 'bang_gia_den.xlsx', catalog: CATALOG_DL12_RANG_DONG, decisions: { priceRole: 'cost' } });
      return runAppImport({ file: 'bang_gia_den.xlsx', catalog: cloudRoundTrip(first.committed.products), decisions: { priceRole: 'cost' } });
    },
    check: (r) => {
      assert.equal(r.committed.added, 0, 're-import adds nothing');
      assert.equal(r.committed.updated, 5);
      const dl = byKey(r.committed.products, 'DL-12W-30');
      assert.equal(dl.length, 1);
      assert.equal(dl[0].supplier, 'Rạng Đông');
      assert.notEqual(supplierSourceOf(dl[0]), 'file_name', 'kept real supplier must not be labelled weak');
    },
  },
  {
    id: 'den_cloud_then_cot_ncc',
    title: 'S1-3b NCC "den" (từ tên file) lưu cloud, sau đó nhập file có cột NCC "Duhal" → tự cập nhật',
    run: async () => {
      const first = await runAppImport({ file: 'bang_gia_den.xlsx', decisions: { priceRole: 'cost' } });
      const catalog = cloudRoundTrip(first.committed.products);
      const dl = byKey(catalog, 'DL-12W-30')[0];
      assert.equal(supplierSourceOf(dl), 'file_name', 'filename provenance must survive the cloud round-trip');
      return runAppImport({ file: 'bang_gia_cot_ncc.xlsx', catalog, decisions: { priceRole: 'cost' } });
    },
    check: (r) => {
      assert.deepEqual(r.ambiguousBeforeDecision, [], 'weak "den" must not conflict with a real supplier column');
      assert.equal(r.committed.updated, 2);
      const dl = byKey(r.committed.products, 'DL-12W-30');
      assert.equal(dl.length, 1);
      assert.equal(dl[0].supplier, 'Duhal', 'real supplier column replaces a filename guess');
      assert.equal(supplierSourceOf(dl[0]), 'column');
    },
  },
  {
    id: 'sua_mapping_rang_dong',
    title: 'S1 "Sửa mapping" bang_gia_den.xlsx · catalog "Rạng Đông" + 1 SKU không NCC',
    run: () => runAppImport({
      file: 'bang_gia_den.xlsx', source: 'manual_mapping', decisions: { priceRole: 'cost' },
      catalog: [...CATALOG_DL12_RANG_DONG, { id: 'cat-tr10', sku: 'TR-10W-24', name: 'Đèn ray nam châm 10W góc 24 độ', category: 'Chiếu sáng', supplier: '', unit: 'Cái', costPrice: 300000, priceMode: 'markup' }],
    }),
    check: (r) => {
      assert.deepEqual(r.ambiguousBeforeDecision, [], 'manual mapping: filename supplier must not create ambiguity');
      assert.equal(r.committed.updated, 2);
      assert.equal(byKey(r.committed.products, 'DL-12W-30')[0].supplier, 'Rạng Đông');
      assert.equal(byKey(r.committed.products, 'TR-10W-24')[0].supplier || '', '', 'manual mapping: empty supplier stays empty');
      const dl9 = byKey(r.committed.products, 'DL-9W-40')[0];
      assert.equal(dl9.supplier, 'den', 'manual mapping uses the same file-name guess as the engine ("den", not "bang_gia_den")');
      assert.equal(supplierSourceOf(dl9), 'file_name');
      for (const p of r.committed.products) {
        if (['DL-9W-40', 'DRV-DALI-40', 'LS-5050'].includes(p.sku)) {
          assert.equal(p.listPrice || 0, 0, `manual mapping: unmapped list price must stay empty (${p.sku}), not copy the cost`);
          assert.equal(p.priceMode, 'markup', `manual mapping: ${p.sku} priced by markup, not fixed at cost`);
        }
      }
    },
  },
  {
    id: 'pdf_cache_rang_dong',
    title: 'S1 PDF (bang_gia_den.pdf, NCC "PDF Catalog"/tên file) · catalog "Rạng Đông"',
    run: () => runAppImport({
      file: 'bang_gia_den.xlsx', source: 'pdf_cache', catalog: CATALOG_DL12_RANG_DONG,
      pdfCache: [
        { sku: 'DL-12W-30', name: 'Đèn downlight âm trần 12W 3000K', category: 'Đèn', unit: 'Cái', supplier: 'PDF Catalog', costPrice: 181000, priceMode: 'markup', _meta: { source: { page: 1, row: 1, rawText: 'DL-12W-30 Đèn downlight âm trần 12W 3000K 181.000' }, issues: [], canonicalStatus: 'auto_approved' } },
        { sku: 'DL-9W-40', name: 'Đèn downlight âm trần 9W 4000K', category: 'Đèn', unit: 'Cái', supplier: 'bang gia den', costPrice: 151000, priceMode: 'markup', _meta: { source: { page: 1, row: 2, rawText: 'DL-9W-40 Đèn downlight âm trần 9W 4000K 151.000' }, issues: [], canonicalStatus: 'auto_approved' } },
        { sku: 'TR-10W-24', name: 'Đèn ray nam châm 10W góc 24 độ', category: 'Đèn', unit: 'Cái', supplier: 'Duhal', costPrice: 321000, priceMode: 'markup', _meta: { source: { page: 1, row: 3, rawText: 'TR-10W-24 Duhal 321.000' }, issues: [], canonicalStatus: 'auto_approved' } },
      ],
    }),
    check: (r) => {
      assert.deepEqual(r.ambiguousBeforeDecision, [], 'PDF: "PDF Catalog" must not conflict with "Rạng Đông"');
      const dl = byKey(r.committed.products, 'DL-12W-30');
      assert.equal(dl.length, 1);
      assert.equal(dl[0].supplier, 'Rạng Đông');
      assert.equal(supplierSourceOf(byKey(r.committed.products, 'DL-9W-40')[0]), 'file_name');
      assert.equal(supplierSourceOf(byKey(r.committed.products, 'TR-10W-24')[0]), 'document', 'a supplier printed in the PDF stays strong');
    },
  },
  {
    id: 'hoc_tu_lan_sua',
    title: 'Học từ lần sửa: bảng giá không cột NCC, sửa tên lần 1 → lần 2 tự áp dụng',
    run: async () => {
      const first = await runAppImport({
        file: 'bang_gia_ten_ma.xlsx', decisions: { priceRole: 'cost', edit: (p) => (p.sku === 'DL-12W-30' ? { ...p, name: 'Đèn downlight âm trần 12W 3000K' } : null) },
      });
      const second = await runAppImport({ file: 'bang_gia_ten_ma.xlsx', catalog: [], decisions: { priceRole: 'cost' } });
      return { ...second, first };
    },
    check: (r) => {
      assert.ok(r.first.learnedRows >= 1, '"Đã học" must count stored rules for a file-name supplier');
      assert.ok(r.learnedHits >= 1, 'second import must apply the learned correction');
      assert.equal(byKey(r.committed.products, 'DL-12W-30')[0].name, 'Đèn downlight âm trần 12W 3000K');
    },
  },
  {
    id: 'nhieu_file',
    title: 'Nhập nhiều file: bang_gia_den.xlsx + bang_gia_cot_ncc.xlsx cùng lúc · catalog "Rạng Đông"',
    run: async () => {
      const catalog = CATALOG_DL12_RANG_DONG;
      const files = [loadFixture('bang_gia_den.xlsx'), loadFixture('bang_gia_cot_ncc.xlsx')];
      const { products } = await importManyForUI(files, { catalog });
      const learned = P.applyImportLearning(products, { fileName: '2 Excel files' });
      const ctx = { catalog, sourceFileName: '2 files' };
      const prepared = P.prepareCatalogImportProducts(learned.products, ctx);
      let rows = P.prepareMultiFileImport(prepared, ctx).active;
      rows = P.applyPriceRoleDecision(rows, 'cost', { catalog });
      const ambiguousBeforeDecision = rows.filter((p) => P.hasImportIssue(p, 'catalog_match_ambiguous')).map((p) => p.sku);
      rows.forEach((p, i) => { if (P.hasImportIssue(p, 'catalog_match_ambiguous')) rows = P.applyCatalogMatchDecision(rows, i, 'new', null, { catalog }); });
      // The two files quote slightly different prices for the same identity → the dealer reviews and approves.
      rows.forEach((_p, i) => { const a = P.approveImportRow(rows, i); if (!a.refused) rows = a.items; });
      const willImport = P.countImportableProducts(rows);
      const finalized = P.finalizeCatalogImport(rows, ctx);
      const committed = P.commitCatalogImport(catalog, finalized.safe, { idFactory: (_p, i) => `new-${i}` });
      return { rows, willImport, committed, ambiguousBeforeDecision, supplierMismatches: [] };
    },
    check: (r) => {
      // DL-12W-30: weak "den" row merges into the catalog item; the "Duhal" column row conflicts with "Rạng Đông" → user picks "new".
      assert.deepEqual(r.ambiguousBeforeDecision, ['DL-12W-30']);
      const dl = byKey(r.committed.products, 'DL-12W-30');
      assert.deepEqual(dl.map((p) => p.supplier).sort(), ['Duhal', 'Rạng Đông']);
      assert.equal(byKey(r.committed.products, 'TR-10W-24').length, 1, 'TR-10W-24 from both files is one identity (weak "den" vs column "Duhal")');
      const duhal = byKey(r.committed.products, 'DL-12W-30').find((p) => p.supplier === 'Duhal');
      assert.equal(duhal.costPrice, 175000, 'merged identity keeps the price that belongs to the Duhal row');
      assert.equal(byKey(r.committed.products, 'TR-10W-24')[0].costPrice, 310000);
    },
  },
  {
    id: 'sua_ncc_tay',
    title: 'Người dùng sửa NCC của dòng mới ở preview ("den" → "Rạng Đông"): NCC thật, in ra báo giá',
    run: () => runAppImport({
      file: 'bang_gia_den.xlsx',
      decisions: { priceRole: 'cost', edit: (p) => (p.sku === 'DL-9W-40' ? { ...p, supplier: 'Rạng Đông', _meta: { ...(p._meta || {}), userEdited: true } } : null) },
    }),
    check: (r) => {
      const edited = byKey(r.committed.products, 'DL-9W-40')[0];
      assert.equal(edited.supplier, 'Rạng Đông');
      assert.equal(supplierSourceOf(edited), 'user', 'a typed supplier is no longer a file-name guess');
      assert.equal(customerFacingParty(edited).supplier, 'Rạng Đông');
      const guessed = byKey(r.committed.products, 'DL-12W-30')[0];
      assert.equal(customerFacingParty(guessed).supplier, '', '"den" is not printed');
      // Editing a saved catalog product later (catalog page) also lifts the label.
      const cloud = cloudRoundTrip([guessed])[0];
      assert.equal(customerFacingParty({ ...cloud, supplier: 'Duhal' }).supplier, 'Duhal');
    },
  },
  {
    id: 'lech_cot',
    title: 'S2-1 bao_gia_cu_lech_cot.xlsx · Báo giá cũ',
    run: () => runAppImport({ file: 'bao_gia_cu_lech_cot.xlsx', importSourceKind: 'old_quote' }),
    check: (r) => {
      const lights = r.committed.products.filter((p) => /^LM-(D|ST|CS)/i.test(p.sku));
      const d9 = byKey(r.committed.products, 'LM-D9-90-110-W4-2')[0];
      assert.ok(d9, 'S2-1 LM-D9-90-110-W4-2 must be imported with its SKU');
      assert.match(d9.name, /^Đèn Downlight âm trần 9W - 110°/, 'S2-1 commercial name recovered from the specs column');
      for (const p of r.committed.products) {
        assert.ok(!looksLikeModelCode(p.name), `S2-1 product name must not be a model code: "${p.name}" (sku "${p.sku}")`);
        assert.ok(p.sku, `S2-1 every product has a SKU: "${p.name}"`);
        assert.ok(!/^on\/?off$/i.test(p.sku), `S2-1 feature text is not a SKU: "${p.sku}"`);
      }
      assert.equal(lights.length, 7, 'S2-1/UAT-21 repeated lights collapse to 7 light products');
      assert.equal(r.reviewRows.length, 0, 'S2-1 no review rows');
      assert.equal(r.committed.products.length, 10, 'S2-1 10 products after dedupe');
    },
  },
  {
    id: 'metadata',
    title: 'S3-1/S3-3 bao_gia_cu_metadata.xlsx · Báo giá cũ',
    run: () => runAppImport({ file: 'bao_gia_cu_metadata.xlsx', importSourceKind: 'old_quote' }),
    check: (r) => {
      assert.deepEqual(r.committed.products.map((p) => p.sku).sort(), ['LM-1G2W-C(G)', 'LM-2G2W-C(G)', 'LM-PCB'], 'S3-1 exactly 3 products');
      assert.ok(!r.committed.products.some((p) => /BH 36 tháng/i.test(p.name)), 'S3-1 warranty-only row is not a product');
      const skippedRows = r.preview?.skippedRows || [];
      const warrantySkip = skippedRows.find((s) => /BH 36 tháng/i.test(s.rawText || ''));
      assert.ok(warrantySkip, 'S3-3 warranty-only row must be listed in preview.skippedRows');
      assert.equal(warrantySkip.reason, 'Cột Mã chỉ có thông tin bảo hành, không có mã sản phẩm');
    },
  },
  {
    id: 'bao_hanh_bang_gia',
    title: 'S2-5 bang_gia_ma_bao_hanh.xlsx · bảng giá NCC, cột Mã "BH 12 tháng"',
    run: () => runAppImport({ file: 'bang_gia_ma_bao_hanh.xlsx' }),
    check: (r) => {
      const row = r.rows.find((p) => /pha LED 50W/i.test(p.name));
      assert.ok(row, 'S2-5 row kept in preview');
      assert.equal(row.sku || '', '', 'S2-5 warranty text is not a SKU');
      assert.ok(!/BH 12/i.test(row.name), 'S2-5 warranty text is not the name');
      assert.ok(issueCodes(row).includes('warranty_in_sku_column'), 'S2-5 row carries warranty_in_sku_column');
      assert.ok(r.reviewRows.includes(row), 'S2-5 row stays in "Cần kiểm tra" (not imported)');
      assert.deepEqual(r.committed.products.map((p) => p.sku), ['FL-100W']);
    },
  },
  {
    id: 'ma_ncc_dung_lai_x2',
    title: 'ma_ncc_dung_lai.xlsx · nhập 2 lần',
    run: async () => {
      const first = await runAppImport({ file: 'ma_ncc_dung_lai.xlsx' });
      const second = await runAppImport({ file: 'ma_ncc_dung_lai.xlsx', catalog: first.committed.products });
      return { ...second, first };
    },
    check: (r) => {
      assert.equal(r.first.committed.added, 4, 'first import adds 3 FU configs + R-TX4');
      assert.equal(byKey(r.first.committed.products, 'FU').length, 3);
      assert.equal(r.committed.added, 0, 're-import adds nothing');
      assert.equal(r.committed.products.length, 4, 're-import keeps 4 products');
      // Learning must not copy one FU configuration's corrections onto another (reused supplier code).
      const sig = (list) => byKey(list, 'FU').map((p) => `${p.name}|${p.category}`).sort();
      assert.deepEqual(sig(r.committed.products), sig(r.first.committed.products), 're-import keeps each FU configuration as it was');
    },
  },
];

// ---- run ----
const results = {};
const failures = [];
for (const c of CASES) {
  let r;
  resetStorage();
  try {
    r = await c.run();
  } catch (err) {
    failures.push(`${c.id}: infra error — ${err?.stack || err}`);
    console.log(`✗ ${c.title}\n    infra error: ${err?.message || err}`);
    continue;
  }
  const problems = [];
  const fail = (msg) => problems.push(msg);
  // "Thêm N" on the preview button must equal what the save actually adds + updates.
  const committedCount = r.committed.added + r.committed.updated;
  for (const m of r.supplierMismatches || []) fail(`preview supplier ≠ saved supplier — ${m}`);
  // RC16: a supplier guessed from a file name is never printed on a customer quote —
  // straight after saving, after the Supabase round-trip, and from a final-quote snapshot.
  for (const p of r.committed.products) {
    const variants = [['saved', p], ['cloud', cloudRoundTrip([p])[0]], ['final-quote snapshot', snapshotQuoteProduct(p)]];
    for (const [where, v] of variants) {
      const shown = customerFacingParty(v).supplier;
      const weak = supplierSourceOf(p) === 'file_name';
      if (weak && shown) fail(`customer quote (${where}) would print guessed supplier "${shown}" for ${p.sku}`);
      if (!weak && p.supplier && shown !== p.supplier) fail(`customer quote (${where}) hides real supplier "${p.supplier}" for ${p.sku}`);
    }
  }
  if (r.willImport !== committedCount) fail(`preview "Thêm ${r.willImport}" ≠ added ${r.committed.added} + updated ${r.committed.updated}`);
  try { c.check(r); } catch (err) { fail(err.message); }
  results[c.id] = snapshotCatalog(r.committed.products);
  if (problems.length) {
    failures.push(...problems.map((m) => `${c.id}: ${m}`));
    console.log(`✗ ${c.title}`);
    for (const m of problems) console.log(`    ${m}`);
  } else {
    console.log(`✓ ${c.title} (Thêm ${r.willImport} → +${r.committed.added} / ~${r.committed.updated})`);
  }
}

// ---- S1-5: every source key from extractItems survives into product.source ----
{
  for (const name of fs.readdirSync(fixtureDir).filter((f) => f.endsWith('.xlsx')).sort()) {
    const fixture = loadFixture(name);
    const { result, products } = await importFileForUI(fixture, { catalog: [] });
    const lost = [];
    (result.items || []).forEach((item) => {
      const product = products.find((p) => p._meta?.source?.row === (item.source?.row ?? item.source?.rowIndex) && p._meta?.source?.sheet === item.source?.sheet)
        || products.find((p) => p.sku && p.sku === item.sku);
      if (!product) return; // skipped/failed lines are not products
      for (const key of Object.keys(item.source || {})) {
        if (!(key in (product.source || {}))) lost.push(`product.source.${key}`);
        if (!(key in (product._meta?.source || {}))) lost.push(`_meta.source.${key}`);
      }
    });
    const uniq = [...new Set(lost)];
    if (uniq.length) {
      failures.push(`S1-5 ${name}: source keys lost at the preview boundary: ${uniq.join(', ')}`);
      console.log(`✗ S1-5 ${name}: lost ${uniq.join(', ')}`);
    } else {
      console.log(`✓ S1-5 ${name}: all item.source keys preserved`);
    }
  }
}

// ---- golden ----
if (UPDATE) {
  if (failures.length) {
    console.error(`\n✗ refusing to write golden: ${failures.length} assertion(s) fail. Fix the code; golden is not a way to make tests green.`);
    process.exit(1);
  }
  fs.writeFileSync(goldenPath, JSON.stringify({ fields: GOLDEN_FIELDS, cases: results }, null, 2) + '\n');
  console.log(`\nwrote ${path.relative(root, goldenPath)} — record the reason in the release notes.`);
  process.exit(0);
}

if (!fs.existsSync(goldenPath)) {
  failures.push(`golden missing: ${path.relative(root, goldenPath)}`);
} else {
  const golden = JSON.parse(fs.readFileSync(goldenPath, 'utf8'));
  for (const id of new Set([...Object.keys(golden.cases || {}), ...Object.keys(results)])) {
    const want = golden.cases?.[id];
    const got = results[id];
    if (!want) { failures.push(`golden: case ${id} missing from golden.json`); continue; }
    if (!got) { failures.push(`golden: case ${id} produced no result`); continue; }
    try {
      assert.deepEqual(got, want);
      console.log(`✓ golden ${id} (${got.length} products)`);
    } catch {
      const diffs = [];
      const n = Math.max(got.length, want.length);
      for (let i = 0; i < n; i++) {
        for (const f of GOLDEN_FIELDS) {
          if (JSON.stringify(got[i]?.[f]) !== JSON.stringify(want[i]?.[f])) diffs.push(`#${i} ${f}: got ${JSON.stringify(got[i]?.[f])} want ${JSON.stringify(want[i]?.[f])}`);
        }
      }
      failures.push(`golden ${id}: ${diffs.slice(0, 6).join(' · ')}${diffs.length > 6 ? ` … (+${diffs.length - 6})` : ''}`);
      console.log(`✗ golden ${id}\n    ${diffs.slice(0, 10).join('\n    ')}`);
    }
  }
}

if (failures.length) {
  console.error(`\n✗ e2e-import: ${failures.length} failure(s)`);
  process.exit(1);
}
console.log('\n✓ e2e-import: all cases match golden');
