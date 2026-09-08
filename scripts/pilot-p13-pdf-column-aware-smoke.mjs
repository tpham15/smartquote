import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  inferTableRegions,
  inferColumnModel,
  assignCellsToColumnModel,
  fieldForRole,
  parsePdfColumnMoney,
} from '../src/import-engine/pdf/pdfColumnModel.js';
import { assessPdfVisionTrust } from '../src/import-engine/pdf/pdfEvidence.js';
import { sanitizeCatalogProduct } from '../src/import-engine/productSanitizer.js';

function row(y, cells, width = 600) {
  const parts = cells.map(([x, w, str]) => ({ x, width: w, height: 10, str }));
  const minX = Math.min(...parts.map((p) => p.x));
  const maxX = Math.max(...parts.map((p) => p.x + p.width));
  return { y, text: parts.map((p) => p.str).join(' '), parts, bbox: { x: minX, y, width: maxX - minX, height: 10 }, pageWidth: width };
}
function money(field) {
  const digits = String(field?.text || '').replace(/[^\d]/g, '');
  return digits ? Number(digits) : 0;
}

// 0) Vietnamese commercial price shorthand is normalized inside the price column itself.
assert.equal(parsePdfColumnMoney('850k'), 850000);
assert.equal(parsePdfColumnMoney('1,2 triệu'), 1200000);
assert.equal(parsePdfColumnMoney('2tr4'), 2400000);
assert.equal(parsePdfColumnMoney('2tr45'), 2450000);

// 1) Header table without STT must activate column path and bind unitPrice vs total correctly.
const quotePage = { page: 1, pageWidth: 620, pageHeight: 800, rows: [
  row(720, [[50,150,'Tên sản phẩm'],[245,80,'Mã'],[350,35,'SL'],[405,75,'Đơn giá'],[520,80,'Thành tiền']]),
  row(700, [[50,150,'Camera IP'],[245,80,'CAM-01'],[370,15,'2'],[410,70,'1.200.000'],[520,80,'2.400.000']]),
  row(680, [[50,150,'Đầu ghi NVR'],[245,80,'NVR-08'],[370,15,'1'],[410,70,'3.000.000'],[520,80,'3.000.000']]),
  row(660, [[50,150,'Switch PoE'],[245,80,'SW-08P'],[370,15,'1'],[410,70,'2.000.000'],[520,80,'2.000.000']]),
] };
const regions1 = inferTableRegions([quotePage]);
assert.equal(regions1.length, 1, 'table without STT should activate');
const model1 = inferColumnModel(regions1[0]);
assert(model1, 'column model required');
assert.equal(model1.ambiguousPrice, false);
assert(model1.columns.some((c) => c.role === 'unitPrice'));
assert(model1.columns.some((c) => c.role === 'total'));
assert(model1.columns.some((c) => c.role === 'qty'));
const priceField1 = fieldForRole(quotePage.rows[1], model1, 'unitPrice');
const totalField1 = fieldForRole(quotePage.rows[1], model1, 'total');
assert.equal(money(priceField1), 1200000, 'must bind unit price by column');
assert.equal(money(totalField1), 2400000, 'must keep line total separate');
assert(priceField1.bbox && priceField1.bbox.x >= 400 && priceField1.bbox.width < 100, 'price bbox should target price cell, not row');

// 2) Header-independent catalog: name / SKU / one right-aligned price inferred from content.
const catalogPage = { page: 2, pageWidth: 620, pageHeight: 800, rows: [
  row(720, [[45,190,'Công tắc Luto'],[285,80,'LM-S1'],[490,80,'1.250.000']]),
  row(700, [[45,190,'Cảm biến cửa'],[285,80,'LM-DS1'],[505,65,'850.000']]), // right edge remains aligned
  row(680, [[45,190,'Bộ điều khiển trung tâm'],[285,80,'LM-HC1'],[490,80,'2.400.000']]),
] };
const regions2 = inferTableRegions([catalogPage]);
assert.equal(regions2.length, 1);
const model2 = inferColumnModel(regions2[0]);
assert(model2.columns.some((c) => c.role === 'name'));
assert(model2.columns.some((c) => c.role === 'sku'));
assert(model2.columns.some((c) => c.role === 'unitPrice'));
assert.equal(model2.ambiguousPrice, false);
assert.equal(money(fieldForRole(catalogPage.rows[1], model2, 'unitPrice')), 850000);

// 3) Two unlabeled commercial price columns with no quantity are ambiguous: do not guess dealer/list.
const ambiguousPage = { page: 3, pageWidth: 720, pageHeight: 800, rows: [
  row(720, [[40,190,'Công tắc Luto'],[280,80,'LM-S1'],[455,80,'900.000'],[585,85,'1.250.000']], 720),
  row(700, [[40,190,'Cảm biến cửa'],[280,80,'LM-DS1'],[455,80,'600.000'],[600,70,'850.000']], 720),
  row(680, [[40,190,'Bộ điều khiển'],[280,80,'LM-HC1'],[455,80,'1.700.000'],[585,85,'2.400.000']], 720),
] };
const model3 = inferColumnModel(inferTableRegions([ambiguousPage])[0]);
assert.equal(model3.ambiguousPrice, true);
assert.equal(model3.columns.filter((c) => c.role === 'unknownPrice').length, 2);
assert.equal(model3.columns.filter((c) => c.role === 'unitPrice').length, 0, 'ambiguous price columns must not be guessed');

// 4) Multiple table regions on the same page can have different layouts.
const multiPage = { page: 4, pageWidth: 720, pageHeight: 900, rows: [
  row(840, [[30,170,'Tên sản phẩm'],[250,90,'Mã'],[560,90,'Đơn giá']], 720),
  row(820, [[30,170,'Camera A'],[250,90,'CAM-A1'],[560,90,'1.000.000']], 720),
  row(800, [[30,170,'Camera B'],[250,90,'CAM-B1'],[560,90,'1.200.000']], 720),
  row(780, [[30,170,'Camera C'],[250,90,'CAM-C1'],[560,90,'1.300.000']], 720),
  row(750, [[30,300,'PHỤ KIỆN']], 720), // separator: closes first region
  row(720, [[40,160,'Tên'],[240,80,'Mã'],[390,45,'ĐVT'],[500,80,'Giá bán lẻ']], 720),
  row(700, [[40,160,'Nguồn 12V'],[240,80,'PS-12V'],[390,45,'Cái'],[500,80,'450.000']], 720),
  row(680, [[40,160,'Nguồn 24V'],[240,80,'PS-24V'],[390,45,'Cái'],[500,80,'650.000']], 720),
  row(660, [[40,160,'Relay'],[240,80,'RL-01'],[390,45,'Cái'],[500,80,'350.000']], 720),
] };
const regions4 = inferTableRegions([multiPage]);
assert.equal(regions4.length, 2, 'same page must support multiple table regions');
const models4 = regions4.map(inferColumnModel);
assert(models4[0].columns.some((c) => c.role === 'unitPrice'));
assert(models4[1].columns.some((c) => c.role === 'listPrice'));
assert.notDeepEqual(models4[0].columns.map((c) => Math.round(c.center)), models4[1].columns.map((c) => Math.round(c.center)), 'regions must not share one document-wide layout');

// 5) Trust requires field confidence for column-v2, exactly like layout IR.
const strongColumn = {
  name: 'Camera IP 4MP', sku: 'CAM-4MP-01', costPrice: 1200000, category: 'Camera',
  _meta: {
    engine: 'pdf-a-column-v2',
    source: { type: 'pdf', page: 1, row: 2, bbox: { x: 20, y: 700, width: 580, height: 10 }, layoutGrounded: true },
    fieldEvidence: {
      name: { confidence: 0.9, bbox: { x: 50, y: 700, width: 150, height: 10 } },
      sku: { confidence: 0.9, bbox: { x: 245, y: 700, width: 80, height: 10 } },
      price: { confidence: 0.9, bbox: { x: 410, y: 700, width: 70, height: 10 } },
    },
    productEvidence: { hasGrounding: true, layoutGrounded: true, hasPrice: true, hasSku: true },
  },
};
assert.equal(assessPdfVisionTrust(strongColumn, 'pdf-a-column-v2').trusted, true);
const weakPrice = structuredClone(strongColumn);
weakPrice._meta.fieldEvidence.price.confidence = 0.4;
assert.equal(assessPdfVisionTrust(weakPrice, 'pdf-a-column-v2').trusted, false, 'weak price cell must stay review-only');

// 6) Sanitizer must not resurrect a guessed price from ambiguous raw row text.
const ambiguousSanitized = sanitizeCatalogProduct({
  name: 'Công tắc Luto', sku: 'LM-S1', costPrice: 0, listPrice: 0, rawText: 'Công tắc Luto LM-S1 900.000 1.250.000',
  _meta: {
    engine: 'pdf-a-column-v2',
    source: { type: 'pdf', page: 3, row: 1, priceRole: 'unknown', rawText: 'Công tắc Luto LM-S1 900.000 1.250.000' },
    productEvidence: { priceColumnUncertain: true },
    issues: [{ code: 'price_column_uncertain', level: 'warning', message: 'ambiguous', field: 'price' }],
  },
}, { defaultSupplier: 'Lumi' });
assert.equal(ambiguousSanitized.costPrice, 0, 'sanitizer must not recover first raw number as cost');
assert.equal(ambiguousSanitized.listPrice, 0, 'sanitizer must not infer list price from ambiguous row');
assert(ambiguousSanitized._meta.issues.some((x) => x.code === 'price_column_uncertain'));

// 7) Execute the actual production extraction + normalization functions offline.
// The temporary module only stubs network/browser-only imports; all PDF column,
// sanitizer, evidence and merge logic is the real production source.
let testablePipelineSource = fs.readFileSync('src/import-engine/pdf/pdfCatalogPipeline.js', 'utf8');
testablePipelineSource = testablePipelineSource
  .replace(/import \{ callClaudeText[^\n]+\n/, `const callClaudeText=async()=>({}); const callClaudeStructured=async()=>({}); const PDF_CATALOG_OUTPUT_SCHEMA={}; const extractCatalogPdfWithClaude=async()=>[];\n`)
  .replace(/import \{ smartQuoteFetch \} from '\.\.\/\.\.\/supabase\/apiFetch\.js';\n/, `const smartQuoteFetch=async()=>{throw new Error('offline P1.3 smoke')};\n`)
  .replace(/import pdfJsWorkerUrl from "pdfjs-dist\/legacy\/build\/pdf\.worker\.mjs\?url";\n/, `const pdfJsWorkerUrl='';\n`);
const tempPipelinePath = `src/import-engine/pdf/.pilot-p13-testable-${process.pid}.mjs`;
fs.writeFileSync(tempPipelinePath, testablePipelineSource);
try {
  const pipelineModule = await import(pathToFileURL(path.resolve(tempPipelinePath)).href + `?p13=${Date.now()}`);
  const rawQuote = pipelineModule.extractColumnAwareProductsFromPdfPages([quotePage], 'Pilot Supplier');
  assert.equal(rawQuote.items.length, 3);
  assert.equal(rawQuote.items[0].costPrice, 1200000, 'production extraction must use unitPrice, not total');
  assert.equal(rawQuote.items[0].quoteLineTotal, 2400000);
  assert(rawQuote.items[0].fieldEvidence.price.bbox.x >= 400);
  const normalizedQuote = pipelineModule.normalizePdfItems(rawQuote.items, 'Pilot Supplier', 'pdf-a-column-v2');
  assert.equal(normalizedQuote[0].costPrice, 1200000, 'normalizer must preserve column-authoritative price');

  const rawAmbiguous = pipelineModule.extractColumnAwareProductsFromPdfPages([ambiguousPage], 'Pilot Supplier');
  assert.equal(rawAmbiguous.items.length, 3);
  assert(rawAmbiguous.items.every((x) => x.costPrice === 0));
  const normalizedAmbiguous = pipelineModule.normalizePdfItems(rawAmbiguous.items, 'Pilot Supplier', 'pdf-a-column-v2');
  assert(normalizedAmbiguous.every((x) => x.costPrice === 0), 'sanitizer/normalizer must not resurrect ambiguous raw prices');
  assert(normalizedAmbiguous.every((x) => x._meta.canonicalStatus === 'need_review'));
  assert(normalizedAmbiguous.every((x) => x._meta.issues.some((it) => it.code === 'price_column_uncertain')));
} finally {
  try { fs.unlinkSync(tempPipelinePath); } catch {}
}

// 8) Static integration guards: authoritative price-by-column + uncertainty + field grounding wired into production path/UI.
const pipeline = fs.readFileSync('src/import-engine/pdf/pdfCatalogPipeline.js', 'utf8');
const app = fs.readFileSync('src/SmartQuote.jsx', 'utf8');
assert.match(pipeline, /extractColumnAwareProductsFromPdfPages/);
assert.match(pipeline, /columnAuthoritative/);
assert.match(pipeline, /price_column_uncertain/);
assert.match(pipeline, /fieldBboxes/);
assert.match(pipeline, /pdf-a-column-v2/);
assert.match(pipeline, /excludeRows: columnPass\.handledRows/);
assert.match(app, /fieldEvidence\?\.price\?\.bbox/);
assert.match(app, /source\?\.fieldBboxes\?\.unitPrice/);

console.log('✓ Pilot P1.3 PDF Column-Aware smoke PASS');
console.log('  - no-STT header tables activate');
console.log('  - header-independent x clustering infers name/SKU/price');
console.log('  - unit price is separated from line total');
console.log('  - ambiguous multi-price tables fail safe (no guessed commercial price)');
console.log('  - multiple regions per page keep independent layouts');
console.log('  - per-field price bbox is wired to grounding viewer');
