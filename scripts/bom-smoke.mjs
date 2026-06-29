import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as XLSX from 'xlsx';
import { parseBomPreviewFile, buildBomSmokeWorkbook } from '../src/import-engine/bom/bomPreviewParser.js';
import { buildBomQuoteVariants } from '../src/import-engine/bom/bomQuoteComposer.js';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

class NodeFile extends Blob {
  constructor(parts, name, options) { super(parts, options); this.name = name; }
}

const products = [
  { id: 'p1', name: 'Công tắc thông minh 4 nút Lumi', sku: 'LM-S4', category: 'Công tắc', supplier: 'Lumi', costPrice: 1000000, listPrice: 1600000 },
  { id: 'p2', name: 'Cảm biến hiện diện Lumi', sku: 'LM-HP', category: 'Cảm biến', supplier: 'Lumi', costPrice: 800000, listPrice: 1300000 },
  { id: 'p3', name: 'Đèn downlight Lumi 12W', sku: 'LM-D12-75', category: 'Đèn', supplier: 'Lumi', costPrice: 400000, listPrice: 650000 },
  { id: 'p4', name: 'Bộ điều khiển trung tâm Lumi Gateway', sku: 'LM-HC', category: 'Điều khiển', supplier: 'Lumi', costPrice: 2500000, listPrice: 3900000 },
];



function makeNodeFileFromWorkbook(workbook, name) {
  const tmpPath = path.join(os.tmpdir(), `${name.replace(/[^a-z0-9_-]/gi, '-')}-${Date.now()}-${Math.random().toString(36).slice(2)}.xlsx`);
  XLSX.writeFile(workbook, tmpPath);
  const data = fs.readFileSync(tmpPath);
  return new NodeFile([data], name, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}


function makeNodeFileFromPath(filePath, name = path.basename(filePath)) {
  const data = fs.readFileSync(filePath);
  return new NodeFile([data], name, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

function fixturePath(...parts) {
  return path.resolve(process.cwd(), 'tests', 'fixtures', 'bom', ...parts);
}

function buildHvacRealHeaderWorkbook() {
  const rows = [
    ['BẢNG KHỐI LƯỢNG ĐIỀU HÒA KHÔNG KHÍ'],
    ['STT', 'TÊN GỌI VÀ QUY CÁCH', 'ĐƠN VỊ', 'SỐ LƯỢNG'],
    [1, 'DÀN LẠNH CỤC BỘ CASSETTE ÂM TRẦN NỐI ỐNG GIÓ 5.0HP', 'CÁI', 1],
    [2, 'DÀN NÓNG MULTI VRV 10HP', 'CÁI', 1],
    ['Tổng', '', '', 2],
  ];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'HVAC');
  return wb;
}

function buildMatrixTakeoffWorkbook() {
  const rows = [
    ['BẢNG BÓC TÁCH ĐIỆN THÔNG MINH'],
    ['Tầng', 'Công tắc', '', 'Cảm biến'],
    ['', '1 nút', '2 nút', 'Hiện diện'],
    ['Tầng 1', 2, 1, 0],
    ['Tầng mái', 1, 0, 1],
    ['Tổng', 3, 1, 1],
  ];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Ma trận');
  return wb;
}

const wb = buildBomSmokeWorkbook();
const tmp = path.join(os.tmpdir(), `smartquote-bom-smoke-${Date.now()}.xlsx`);
XLSX.writeFile(wb, tmp);
const buf = fs.readFileSync(tmp);
const file = new NodeFile([buf], 'bom-smoke.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
const result = await parseBomPreviewFile(file, products);

assert(result.totalLines === 3, `Expected 3 BOM lines, got ${result.totalLines}`);
assert(result.ready >= 3, `Expected all lines ready, got ${result.ready}`);
assert(result.areas.some((a) => a.toLowerCase().includes('phòng khách') || a.toLowerCase().includes('hang muc')), 'Expected room/area detection');
assert(result.lines.some((l) => l.model === 'LM-S4' && l.qty === 2), 'Expected LM-S4 qty 2');
assert(result.lines.some((l) => l.model === 'LM-D12-75' && l.qty === 8), 'Expected LM-D12-75 qty 8');
assert(result.matched >= 2, `Expected at least 2 catalog suggestions, got ${result.matched}`);
assert(result.skipped >= 1, 'Expected subtotal/header skipped');
assert(Array.isArray(result.scopes) && result.scopes.length >= 2, 'Expected solution scope extraction');
assert(result.scopes.some((s) => /Công tắc|điều khiển/i.test(s.label)), 'Expected smart switch/control scope');
assert(result.scopes.some((s) => /Chiếu sáng|lighting/i.test(s.label)), 'Expected lighting scope');
assert(result.sheets.some((s) => s.discipline && s.discipline !== 'unknown'), 'Expected sheet discipline detection');
assert(Array.isArray(result.solutionPacks) && result.solutionPacks.length >= 2, 'Expected solution pack suggestions');
assert(result.solutionPacks.some((p) => /Công tắc|điều khiển/i.test(p.scopeLabel) && p.recommendations?.length), 'Expected smart switch pack recommendations');
assert(result.solutionPacks.some((p) => /Chiếu sáng|lighting/i.test(p.scopeLabel) && p.recommendations?.length), 'Expected lighting pack recommendations');
const switchPack = result.solutionPacks.find((p) => /Công tắc|điều khiển/i.test(p.scopeLabel));
const switchTemplate = switchPack?.recommendations?.[0]?.template;
assert(switchTemplate && switchTemplate.requiredCount >= 2, 'Expected smart switch pack template with required components');
assert(switchTemplate.requiredMatched >= 2, `Expected smart switch template required components matched, got ${switchTemplate?.requiredMatched || 0}`);

const variants = buildBomQuoteVariants({
  bomPreview: result,
  products,
  resolutionMap: {},
  ignoredMap: {},
  packSelections: {},
  grouping: 'scope',
  laborPercent: 10,
});
assert(Array.isArray(variants) && variants.length === 3, `Expected 3 quote variants, got ${variants.length}`);
assert(variants.some((v) => v.id === 'budget') && variants.some((v) => v.id === 'standard') && variants.some((v) => v.id === 'premium'), 'Expected budget/standard/premium variants');
const standard = variants.find((v) => v.id === 'standard');
assert(standard.ready, 'Expected standard quote variant ready');
assert(standard.itemCount >= 2, `Expected standard variant to include matched lines, got ${standard.itemCount}`);
assert(standard.grandTotal > standard.deviceTotal, 'Expected labor to be included in grand total');
assert(standard.rooms.length >= 1, 'Expected generated rooms for quote variant');
assert(standard.packTemplateLineCount >= 1, `Expected at least one pack template line, got ${standard.packTemplateLineCount || 0}`);
assert(standard.packTemplateSample?.some((x) => /trung tâm|gateway|controller/i.test(x)), 'Expected gateway/controller template sample');


// Regression 1: bảng khối lượng xây dựng VN thường dùng header "TÊN GỌI VÀ QUY CÁCH".
const hvacFile = makeNodeFileFromWorkbook(buildHvacRealHeaderWorkbook(), 'hvac-real-header.xlsx');
const hvacResult = await parseBomPreviewFile(hvacFile, products);
assert(hvacResult.totalLines === 2, `Expected 2 HVAC lines, got ${hvacResult.totalLines}`);
assert(hvacResult.lines.every((l) => !String(l.name).includes('|')), 'HVAC names must use the name column, not the whole joined row');
assert(hvacResult.lines.some((l) => /DÀN LẠNH|DAN LANH/i.test(l.name)), 'Expected HVAC dàn lạnh line');
assert(hvacResult.lines.some((l) => /Điều hòa|HVAC/i.test(l.category) || /Điều hòa|HVAC/i.test(l.solutionLabel)), 'Expected HVAC category/solution inference');
assert(hvacResult.sheets.some((s) => s.headerRow === 2), 'Expected header row 2 detected for HVAC workbook');

// Regression 2: file bóc tách dạng ma trận tầng × thiết bị không được biến "Tầng mái"/"Tổng" thành sản phẩm.
const matrixFile = makeNodeFileFromWorkbook(buildMatrixTakeoffWorkbook(), 'matrix-takeoff.xlsx');
const matrixResult = await parseBomPreviewFile(matrixFile, products);
assert(matrixResult.sheets.some((s) => s.layout === 'matrix'), 'Expected matrix layout route');
assert(matrixResult.totalLines === 4, `Expected 4 matrix BOM lines, got ${matrixResult.totalLines}`);
assert(!matrixResult.lines.some((l) => /^Tổng$/i.test(l.name) || /^Tong$/i.test(l.name)), 'Matrix total row must not become a product');
assert(!matrixResult.lines.some((l) => /^Tầng mái$/i.test(l.name)), 'Matrix floor/area name must not become a product');
assert(matrixResult.lines.some((l) => /Công tắc.*1 nút|Cong tac.*1 nut/i.test(l.name) && l.area === 'Tầng mái' && l.qty === 1), 'Expected Tầng mái Công tắc 1 nút qty 1');
assert(matrixResult.lines.some((l) => /Cảm biến.*Hiện diện|Cam bien.*Hien dien/i.test(l.name) && l.area === 'Tầng mái' && l.qty === 1), 'Expected Tầng mái Cảm biến hiện diện qty 1');



// Real fixture: workbook from architect/MEP takeoff sample.
// This is intentionally file-based so CI catches regressions that generated mini workbooks miss.
const architectFixture = fixturePath('architect-smarthome-lighting.xlsx');
if (fs.existsSync(architectFixture)) {
  const architectResult = await parseBomPreviewFile(makeNodeFileFromPath(architectFixture), products);
  assert(architectResult.totalLines >= 120, `Expected architect fixture to parse >=120 BOM lines, got ${architectResult.totalLines}`);
  assert(architectResult.ready >= 100, `Expected architect fixture to have >=100 ready lines, got ${architectResult.ready}`);
  assert(architectResult.sheets.some((s) => /ĐTM|DTM|điện thông minh|dien thong minh/i.test((s.sheetName || s.name)) && /smart|điện|dien/i.test(s.discipline || s.disciplineLabel || '')), 'Expected ĐTM sheet detected as smarthome/electrical discipline');
  assert(architectResult.sheets.some((s) => /Chiếu sáng|Chieu sang/i.test((s.sheetName || s.name)) && /lighting|chiếu sáng|chieu sang/i.test(s.discipline || s.disciplineLabel || '')), 'Expected Chiếu sáng sheet detected as lighting discipline');
  assert(architectResult.scopes.some((s) => /Công tắc|điều khiển|control/i.test(s.label)), 'Expected control/smart switch scope in architect fixture');
  assert(architectResult.scopes.some((s) => /Âm thanh|am thanh|audio/i.test(s.label)), 'Expected audio scope in architect fixture');
  assert(architectResult.scopes.some((s) => /Chiếu sáng|lighting/i.test(s.label)), 'Expected lighting scope in architect fixture');
  assert(!architectResult.lines.some((l) => /^Tầng\s+\d+$/i.test(String(l.name || '')) || /^PHẦN\s+/i.test(String(l.name || ''))), 'Area/section rows must not become product lines in architect fixture');
  assert(architectResult.lines.some((l) => /Bộ kết nối điều khiển chiếu sáng|Bo ket noi dieu khien chieu sang/i.test(l.name) && Number(l.qty) >= 1), 'Expected lighting controller item parsed from architect fixture');
  console.log(`✓ Real BOM fixture architect-smarthome-lighting → ${architectResult.totalLines} lines, ready ${architectResult.ready}, scopes ${architectResult.scopes.length}, skipped ${architectResult.skipped}, confidence ${architectResult.confidence}%`);
} else {
  console.warn('⚠ Real architect BOM fixture missing; skipped file-based BOM regression');
}

console.log(`✓ BOM smoke passed → ${result.totalLines} lines, ready ${result.ready}, matched ${result.matched}, scopes ${result.scopes.length}, packs ${result.solutionPacks?.length || 0}, templateLines ${standard.packTemplateLineCount || 0}, variants ${variants.length}, skipped ${result.skipped}, confidence ${result.confidence}%`);
