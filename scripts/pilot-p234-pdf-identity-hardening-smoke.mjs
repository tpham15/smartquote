import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { mergePdfRowParts, inferTableRegions, inferColumnModel, fieldForRole } from '../src/import-engine/pdf/pdfColumnModel.js';
import { classifyPdfStructuralRow } from '../src/import-engine/pdf/pdfEvidence.js';
import { applyProductSemantics } from '../src/import-engine/productSemantics.js';

function row(y, parts, pageWidth = 560) {
  const minX = Math.min(...parts.map(p => p.x));
  const maxX = Math.max(...parts.map(p => p.x + p.width));
  return { y, text: parts.map(p => p.str).join(' '), parts, bbox:{x:minX,y,width:maxX-minX,height:6}, pageWidth };
}
function cell(x, width, str) { return { x, width, height:6, str }; }

// Regression 1: the default merge gap must merge words inside one visual cell.
const splitDescription = row(100, [
  cell(167.2,12.1,'Cổng'), cell(180.6,5.5,'tự'), cell(187.5,12.2,'động'),
  cell(201.0,7.5,'tay'), cell(209.8,8.1,'đòn'), cell(219.2,14,'Roger'), cell(234.6,11.6,'Italia'),
]);
const merged = mergePdfRowParts(splitDescription);
assert.equal(merged.length, 1, `description words must stay one cell, got ${merged.map(x=>x.text).join(' | ')}`);
assert.equal(merged[0].text, 'Cổng tự động tay đòn Roger Italia');

// Regression 2: 1400kg / year 2022 must not become money columns; multi-row
// retail/dealer headers must bind correctly.
const page = { page:1, pageWidth:560, pageHeight:800, rows:[
  row(740,[cell(64,20,'Stt'),cell(118,35,'Mã SP'),cell(167,140,'Thông tin sản phẩm'),cell(329,24,'Đơn vị'),cell(368,45,'Ghi chú')]),
  row(730,[cell(368,28,'Giá bán lẻ'),cell(401,28,'Giá cấp 1')]),
  row(710,[cell(64,8,'9'),cell(118,45,'SMARTY7'),cell(167,140,'Cổng tự động tay đòn Roger Italia Smarty 7 - 36V - 1400kg'),cell(329,20,'Bộ'),cell(368,28,'84,300,000'),cell(401,28,'44,500,000')]),
  row(690,[cell(64,8,'13'),cell(118,35,'R30'),cell(167,140,'Cổng tự động trượt Roger Italia KIT R30 - 230V - 1200kg'),cell(329,20,'Bộ'),cell(368,28,'35,500,000'),cell(401,28,'19,900,000')]),
  row(670,[cell(64,8,'17'),cell(118,35,'T80'),cell(167,140,'Tay điều khiển Roger Italia 2 nút - T80/2 (MÀU ROGER 2022)'),cell(329,30,'Chiếc'),cell(368,28,'2,300,000'),cell(401,28,'800,000')]),
]};
const regions = inferTableRegions([page]);
assert.equal(regions.length,1);
const model = inferColumnModel(regions[0]);
assert(model.columns.some(c=>c.role==='name'));
assert(model.columns.some(c=>c.role==='listPrice'));
assert(model.columns.some(c=>c.role==='unitPrice'));
assert.equal(fieldForRole(page.rows[2],model,'name').text,'Cổng tự động tay đòn Roger Italia Smarty 7 - 36V - 1400kg');
assert.equal(fieldForRole(page.rows[2],model,'listPrice').text,'84,300,000');
assert.equal(fieldForRole(page.rows[2],model,'unitPrice').text,'44,500,000');
assert.equal(fieldForRole(page.rows[4],model,'name').text,'Tay điều khiển Roger Italia 2 nút - T80/2 (MÀU ROGER 2022)');

// Regression 2b: a free-text note immediately to the right of dealer price
// must not contaminate either commercial price cell.
const notePriceRow = row(650,[
  cell(64,8,'40'), cell(118,35,'LT300/R'), cell(167,130,'Cơ cấu mở cổng 125 độ - LT300/R'),
  cell(329,30,'Chiếc'), cell(368,28,'5,000,000'), cell(401,28,'1,700,000'),
  cell(431,18,'Giá'), cell(451,25,'thu hồi'), cell(478,30,'550k'),
]);
assert.equal(fieldForRole(notePriceRow,model,'listPrice').text,'5,000,000');
assert.equal(fieldForRole(notePriceRow,model,'unitPrice').text,'1,700,000');

// Regression 3: product wording "qua điện thoại" is not contact metadata.
assert.equal(classifyPdfStructuralRow('Thiết bị mở cổng qua điện thoại - Znex').catalogEligible, true);
assert.equal(classifyPdfStructuralRow('Điện thoại: 0905 123 456').catalogEligible, false);

// Load the exact production pipeline source while neutralizing only Vite's ?url import.
const root=process.cwd();
const pipelinePath=path.join(root,'src/import-engine/pdf/pdfCatalogPipeline.js');
const source=fs.readFileSync(pipelinePath,'utf8');
const workerImport=/import\s+pdfJsWorkerUrl\s+from\s+["']pdfjs-dist\/legacy\/build\/pdf\.worker\.mjs\?url["'];?/;
assert(workerImport.test(source));
const temp=path.join(root,'src/import-engine/pdf',`.pilot-p234-${process.pid}-${Date.now()}.mjs`);
fs.writeFileSync(temp,source.replace(workerImport,'const pdfJsWorkerUrl = "";'));
let pipeline;
try { pipeline=await import(`${pathToFileURL(temp).href}?v=${Date.now()}`); }
finally { try{fs.unlinkSync(temp);}catch{} }

// Regression 4: supplier SKU reuse must preserve distinct visible identities.
const baseMeta={_meta:{source:{type:'pdf',page:1,bbox:{x:1,y:1,width:10,height:5}},engine:'pdf-a-column-v2',canonicalStatus:'auto_approved',status:'new',issues:[]}};
const fu=pipeline.dedupeProducts([
  {...baseMeta,name:'Đế Inox FU103/R - 304 (Đế & Nắp)',sku:'FU',supplier:'Roger',costPrice:2500000},
  {...baseMeta,name:'Đế thép FU100 (Đế & Nắp)',sku:'FU',supplier:'Roger',costPrice:2000000},
]);
assert.equal(fu.length,2,'same supplier SKU with different sellable names must not collapse');
assert(fu.every(x=>(x._meta?.issues||[]).some(i=>(i?.code||i)==='supplier_sku_reused_for_distinct_products')));

// Regression 5: when an explicit STT column is present, a continuation/note
// row with no STT must never become a product.
const indexedPage={page:1,pageWidth:560,pageHeight:800,rows:[
  row(740,[cell(64,20,'Stt'),cell(118,35,'Mã SP'),cell(167,140,'Thông tin sản phẩm'),cell(329,24,'Đơn vị'),cell(368,28,'Giá bán lẻ'),cell(401,28,'Giá cấp 1')]),
  row(720,[cell(64,8,'1'),cell(118,35,'A100'),cell(167,120,'Sản phẩm A'),cell(329,20,'Bộ'),cell(368,28,'5,000,000'),cell(401,28,'3,000,000')]),
  row(700,[cell(64,8,'2'),cell(118,35,'B200'),cell(167,120,'Sản phẩm B'),cell(329,20,'Bộ'),cell(368,28,'6,000,000'),cell(401,28,'4,000,000')]),
  row(680,[cell(64,8,'3'),cell(118,35,'C300'),cell(167,120,'Sản phẩm C'),cell(329,20,'Bộ'),cell(368,28,'7,000,000'),cell(401,28,'5,000,000')]),
  row(660,[cell(118,35,'NOTE'),cell(167,120,'Giá thu hồi ngõng'),cell(401,28,'550k')]),
]};
const indexedProducts=pipeline.extractColumnAwareProductsFromPdfPages([indexedPage],'Test');
assert.equal(indexedProducts.items.length,3,`non-indexed continuation row leaked as product: ${indexedProducts.items.map(x=>x.name).join(' | ')}`);

// Regression 6: source commercial name must beat a previously synthesized
// display name. AYROS 650 V2 has V2 in Model/SKU/sheet, but the source
// commercial line deliberately names the product "MÔ TƠ CỔNG TRƯỢT AYROS 650".
const ayros650v2 = applyProductSemantics({
  name: 'Mô tơ cổng trượt V2 - AYROS 650',
  sku: '30C-065 V2',
  specs: 'Model : 30C-065 V2\nThông số kỹ thuật\nNguồn điện vào 230V AC',
  category: 'Cổng trượt tự động',
  source: { sheet: 'AYROS 650 V2', documentCategory: 'Cổng trượt tự động', rawSku: 'AYROS 650 (30C065V2)' },
}, {
  sourceCommercialName: 'MÔ TƠ CỔNG TRƯỢT AYROS 650',
  category: 'Cổng trượt tự động',
  sheetName: 'AYROS 650 V2',
  documentCategory: 'Cổng trượt tự động',
  rawSku: 'AYROS 650 (30C065V2)',
});
assert.equal(ayros650v2.name, 'Mô tơ cổng trượt AYROS 650', 'model/sheet V2 must not leak into source product name');
assert.equal(ayros650v2.sku, '30C-065 V2');
assert.equal(ayros650v2.model, 'AYROS 650');
assert.equal(ayros650v2.attributes?.identity?.sourceName, 'MÔ TƠ CỔNG TRƯỢT AYROS 650');

// Integration guard: sanitizer must derive and pass sourceCommercialName.
const sanitizerSource = fs.readFileSync(path.join(root,'src/import-engine/productSanitizer.js'),'utf8');
assert(sanitizerSource.includes('const sourceCommercialName = extractCommercialNameFromSpecs(p.specs);'));
assert(/applyProductSemantics\(p,\s*\{\s*sourceCommercialName,/.test(sanitizerSource));

console.log('✓ P2.3.4 PDF identity/table hardening smoke PASS');
console.log('  - description words stay in one visual cell');
console.log('  - 1400kg / 2022 are not price columns');
console.log('  - multi-row retail vs dealer headers stay distinct');
console.log('  - adjacent note prices cannot contaminate dealer/retail columns');
console.log('  - product phrase “qua điện thoại” is not contact metadata');
console.log('  - repeated supplier SKU preserves distinct products');
console.log('  - explicit STT tables reject non-indexed continuation rows');
console.log('  - source commercial name outranks model/sheet version leakage');
