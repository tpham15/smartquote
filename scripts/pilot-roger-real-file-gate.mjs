#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { extractPagesFromPdf } from '../api/_lib/pdfTextGeometry.js';
import { dedupeCatalogIdentities } from '../src/import-engine/productSanitizer.js';
import { applyCommercialValidation } from '../src/import-engine/businessValidator.js';

const root = process.cwd();
const filePath = path.resolve(process.argv[2] || process.env.SQ_ROGER_GOLDEN_PDF || '');
if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
  console.error('✗ PILOT GATE BLOCKED: Roger golden PDF not found.');
  console.error('  Usage: npm run pilot:gate:roger -- "/absolute/path/Roger_BG - RF - Giá đại lý Cấp 1 - 2026.pdf"');
  console.error('  Or set SQ_ROGER_GOLDEN_PDF.');
  process.exit(2);
}

const golden = JSON.parse(fs.readFileSync(path.join(root, 'PILOT_GOLDEN_ROGER_SOURCE_AUDIT.json'), 'utf8'));
const bytes = fs.readFileSync(filePath);
const hash = crypto.createHash('sha256').update(bytes).digest('hex');
assert.equal(hash, golden.sha256, `golden Roger PDF hash mismatch; expected ${golden.sha256}, got ${hash}`);

// Use the exact production server PDF geometry extractor.
const extracted = await extractPagesFromPdf(bytes);
assert.equal(extracted.pageCount, 2, `expected 2 pages, got ${extracted.pageCount}`);
assert.ok(extracted.textChars > 5000, `selectable text unexpectedly low: ${extracted.textChars}`);

// Load the exact production deterministic catalog source in Node. Only the Vite
// '?url' worker import is replaced; deterministic parsing/dedupe logic is unchanged.
const pipelinePath = path.join(root, 'src/import-engine/pdf/pdfCatalogPipeline.js');
const pipelineSource = fs.readFileSync(pipelinePath, 'utf8');
const workerImport = /import\s+pdfJsWorkerUrl\s+from\s+["']pdfjs-dist\/legacy\/build\/pdf\.worker\.mjs\?url["'];?/;
assert.ok(workerImport.test(pipelineSource), 'production pipeline worker import shape changed; update gate loader explicitly');
const tempPath = path.join(root, 'src/import-engine/pdf', `.pilot-roger-pipeline-${process.pid}-${Date.now()}.mjs`);
fs.writeFileSync(tempPath, pipelineSource.replace(workerImport, 'const pdfJsWorkerUrl = "";'));
let pipeline;
try {
  pipeline = await import(`${pathToFileURL(tempPath).href}?v=${Date.now()}`);
} finally {
  try { fs.unlinkSync(tempPath); } catch {}
}

const column = pipeline.extractColumnAwareProductsFromPdfPages(extracted.pages, 'Roger');
const normalized = pipeline.normalizePdfItems(column.items, 'Roger', 'pdf-a-column-v2');
const deterministic = pipeline.dedupeProducts(normalized, { supplierGuess: 'Roger', fileName: path.basename(filePath) });
const uiDedupe = dedupeCatalogIdentities(deterministic);
const products = uiDedupe.products;

if (column.items.length !== golden.expectedProductRows) {
  const summary = column.items.map((p) => ({
    stt: Number(p?.attributes?.pdfSourceStt || p?._meta?.productEvidence?.sourceStt || 0),
    sku: p?.sku || '',
    name: p?.name || '',
  }));
  console.error('Roger gate row-count diagnostics:', JSON.stringify(summary, null, 2));
}
assert.equal(column.items.length, golden.expectedProductRows, `column parser must recover ${golden.expectedProductRows} rows, got ${column.items.length}`);
assert.equal(products.length, golden.expectedProductRows, `catalog identity stage must preserve ${golden.expectedProductRows} rows, got ${products.length}`);

const sttOf = (p) => Number(p?.attributes?.pdfSourceStt || p?._meta?.productEvidence?.sourceStt || 0);
const byStt = new Map();
for (const p of products) {
  const stt = sttOf(p);
  assert.ok(stt >= 1 && stt <= golden.expectedProductRows, `missing/invalid source STT for ${p?.sku || p?.name}`);
  assert.ok(!byStt.has(stt), `duplicate source STT ${stt}`);
  byStt.set(stt, p);
}
for (let n = 1; n <= golden.expectedProductRows; n++) assert.ok(byStt.has(n), `missing source STT ${n}`);

function checkProduct(p, e, label) {
  assert.ok(p, `${label}: product missing`);
  assert.equal(p.sku, e.sku, `${label}: wrong SKU`);
  assert.equal(p.name, e.name, `${label}: wrong product name`);
  if ('costPrice' in e) assert.equal(Number(p.costPrice || 0), e.costPrice, `${label}: wrong dealer/level-1 price`);
  if ('listPrice' in e) assert.equal(Number(p.listPrice || 0), e.listPrice, `${label}: wrong retail price`);
}

for (const e of golden.criticalRows) checkProduct(byStt.get(e.stt), e, `STT ${e.stt}`);
for (const [rawStt, e] of Object.entries(golden.multiConfigurationRows)) {
  const stt = Number(rawStt);
  const p = byStt.get(stt);
  checkProduct(p, e, `STT ${stt}`);
  assert.equal(Number(p.costPrice || 0), 0, `STT ${stt}: multi-configuration row must not silently select dealer price`);
  assert.equal(Number(p.listPrice || 0), 0, `STT ${stt}: multi-configuration row must not silently select retail price`);
  const options = p?.attributes?.pdfPriceOptions || [];
  assert.deepEqual(options.map(x => ({ label:String(x.label), listPrice:Number(x.listPrice), costPrice:Number(x.costPrice) })), e.priceOptions, `STT ${stt}: price options drift`);
  assert.ok((p?._meta?.issues || []).some(x => (x?.code || x) === 'pdf_configuration_price_options'), `STT ${stt}: missing configuration-price review gate`);
}

// Every ordinary row must have dealer and retail prices with the correct economic direction.
for (let stt = 3; stt <= golden.expectedProductRows; stt++) {
  const p = byStt.get(stt);
  assert.ok(Number(p.costPrice || 0) >= 1000, `STT ${stt}: missing dealer/level-1 price`);
  assert.ok(Number(p.listPrice || 0) >= 1000, `STT ${stt}: missing retail price`);
  assert.ok(Number(p.listPrice) >= Number(p.costPrice), `STT ${stt}: retail price below dealer price`);
  const nameKey = String(p.name || '').toLowerCase().replace(/[^a-z0-9à-ỹ]/gi, '');
  const skuKey = String(p.sku || '').toLowerCase().replace(/[^a-z0-9à-ỹ]/gi, '');
  assert.notEqual(nameKey, skuKey, `STT ${stt}: product name collapsed to SKU (${p.sku})`);
}

for (const group of golden.reusedSupplierCodes || []) {
  const matches = products.filter(p => String(p.sku || '').toUpperCase() === String(group.sku).toUpperCase());
  assert.equal(matches.length, group.expectedRows, `supplier SKU ${group.sku}: expected ${group.expectedRows} distinct products, got ${matches.length}`);
  assert.equal(new Set(matches.map(p => p.name)).size, group.expectedRows, `supplier SKU ${group.sku}: distinct names were collapsed`);
}

// RC12 browser/business validation contract: supplier-code reuse for visibly
// distinct products is REVIEW/WARNING, never a blocking duplicate-SKU error.
const businessValidated = applyCommercialValidation(products).products;
const blockingDuplicateSku = businessValidated.filter((p) => (p?._meta?.issues || []).some((it) =>
  String(it?.code || '') === 'pilot_business_duplicate_sku_in_import' && String(it?.level || '').toLowerCase() === 'error'
));
assert.equal(blockingDuplicateSku.length, 0, `Roger supplier-code reuse must not create blocking duplicate-SKU errors; got ${blockingDuplicateSku.length}`);
for (const group of golden.reusedSupplierCodes || []) {
  const matches = businessValidated.filter(p => String(p.sku || '').toUpperCase() === String(group.sku).toUpperCase());
  assert.equal(matches.length, group.expectedRows, `business validation changed ${group.sku} row count`);
  assert.ok(matches.every(p => p?._meta?.canonicalStatus !== 'failed'), `${group.sku}: business validation must preserve rows as review/non-failed`);
}

const forbidden = /(chính sách đặc biệt|giá khóa lục bằng khóa chìa|đã cọc đế|gửi ngay mạch khác|số lượng tối thiểu 10 bộ)/i;
assert.equal(products.filter(p => forbidden.test(String(p.name || ''))).length, 0, 'supplier notes leaked into catalog as products');

console.log('✓ PILOT REAL-FILE GATE PASS — Roger PDF');
console.log(`  file=${path.basename(filePath)} sha256=${hash}`);
console.log(`  production geometry: pages=${extracted.pageCount} textChars=${extracted.textChars}`);
console.log(`  STT coverage: 88/88, UI identity stage: ${products.length}/88`);
console.log('  Mã SP != Tên sản phẩm: enforced for ordinary rows');
console.log('  Giá cấp 1 -> costPrice; Giá bán lẻ -> listPrice: enforced');
console.log('  FU supplier-code reuse: 8 distinct products preserved; business validation = REVIEW/WARNING, not ERROR');
console.log('  STT 1/2: 201/304 price options preserved; no silent price selection');
