#!/usr/bin/env node
// Dependency-backed P1.2 file E2E: actual XLSX -> production BOM parser -> quote -> Final snapshot.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

let XLSX;
try {
  XLSX = await import('xlsx');
} catch (err) {
  console.error('✗ Pilot P1.2 File Commercial E2E BLOCKED_DEPENDENCY: package "xlsx" is not installed. Run npm ci first.');
  process.exit(3);
}
const { parseBomPreviewFile } = await import('../src/import-engine/bom/bomPreviewParser.js');
const { buildBomQuoteVariants, quoteVariantToRooms } = await import('../src/import-engine/bom/bomQuoteComposer.js');
const { assessQuoteCommercialSafety, buildQuoteProductMap, buildQuoteSnapshotRooms } = await import('../src/quote/quoteCommercialSafety.js');
const { buildFinalQuoteGate } = await import('../src/quote/quoteLifecycle.js');

const products = [
  { id:'p_markup', name:'Thiết bị A', sku:'A-100', unit:'Cái', costPrice:1_000_000, priceMode:'markup' },
  { id:'p_fixed', name:'Thiết bị B', sku:'B-200', unit:'Cái', costPrice:500_000, listPrice:800_000, priceMode:'fixed' },
];
const rows = [
  ['BẢNG KHỐI LƯỢNG THIẾT BỊ'],
  ['STT','TÊN THIẾT BỊ','MODEL','ĐƠN VỊ','SỐ LƯỢNG'],
  [1,'Thiết bị A','A-100','Cái',2],
  [2,'Thiết bị B','B-200','Cái',3],
  ['Tổng','','','',''],
];
const ws = XLSX.utils.aoa_to_sheet(rows); const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'BOM');
const tmp = path.join(os.tmpdir(), `sq-p12-file-e2e-${Date.now()}.xlsx`); XLSX.writeFile(wb, tmp);
const data = fs.readFileSync(tmp); const file = new File([data], 'p12-golden-bom.xlsx', { type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
const preview = await parseBomPreviewFile(file, products);
assert.equal(preview.totalLines, 2, `expected 2 BOM lines, got ${preview.totalLines}`);
const resolutionMap = {};
for (const line of preview.lines) {
  const target = products.find((p) => String(p.sku).toUpperCase() === String(line.model || '').toUpperCase());
  assert(target, `no catalog target for parsed model ${line.model}`); resolutionMap[line.id] = target.id;
}
const variants = buildBomQuoteVariants({ bomPreview: preview, products, resolutionMap, defaultMarkupFactor:1.2, laborPercent:10 });
const standard = variants.find((v) => v.id === 'standard');
assert.equal(standard.unmatchedCount, 0); assert.equal(standard.pricingNeedsReviewCount, 0); assert.equal(standard.completenessRequiredOpen, 0);
assert.equal(standard.deviceTotal, 4_800_000); assert.equal(standard.costTotal, 3_500_000); assert.equal(standard.grandTotal, 5_280_000);
const quoteRooms = quoteVariantToRooms(standard, (kind) => `${kind}-${Math.random().toString(36).slice(2,8)}`);
const catalog = Object.fromEntries(products.map((p) => [p.id,p])); const productMap = buildQuoteProductMap(catalog, quoteRooms);
const snap = buildQuoteSnapshotRooms(quoteRooms, productMap); const frozenMap = buildQuoteProductMap(catalog, snap);
const commercial = assessQuoteCommercialSafety({ rooms:snap, productById:frozenMap });
const gate = buildFinalQuoteGate({ commercialAssessment:commercial, customer:{name:'Golden File Customer'}, vatPercent:8, snapshotRooms:snap });
assert.equal(gate.ready, true, gate.blockers.map((x)=>x.id).join(','));
console.log('✓ Pilot P1.2 File Commercial E2E PASS');
console.log(`  XLSX -> BOM ${preview.totalLines} lines -> quote ${standard.deviceTotal} -> Final ready`);
