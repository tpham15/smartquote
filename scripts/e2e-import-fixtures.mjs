// RC16 S4 — generate the committed end-to-end import fixtures as real .xlsx files.
// The two old-quote fixtures are read from the existing phase14 smoke scripts so the
// e2e files can never drift from the row-level fixtures they mirror.
//
// Usage: node scripts/e2e-import-fixtures.mjs   (writes tests/fixtures/e2e/*.xlsx)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as XLSX from 'xlsx';

// fileURLToPath (not URL.pathname): folders with spaces/Vietnamese names work on macOS.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'tests', 'fixtures', 'e2e');
fs.mkdirSync(outDir, { recursive: true });

function writeSheet(fileName, sheetName, cellsByRow) {
  // cellsByRow: Array<{ r: number (0-based), values: { [col]: value } }>
  const ws = {};
  let maxR = 0;
  let maxC = 0;
  for (const { r, values } of cellsByRow) {
    for (const [cRaw, v] of Object.entries(values)) {
      if (v === '' || v == null) continue;
      const c = Number(cRaw);
      const ref = XLSX.utils.encode_cell({ r, c });
      ws[ref] = typeof v === 'number' ? { t: 'n', v } : { t: 's', v: String(v) };
      maxR = Math.max(maxR, r);
      maxC = Math.max(maxC, c);
    }
  }
  ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: maxR, c: maxC } });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  fs.writeFileSync(path.join(outDir, fileName), buf);
  return path.join(outDir, fileName);
}

function table(rows) {
  return rows.map((values, r) => ({ r, values: Object.fromEntries(values.map((v, c) => [c, v])) }));
}

/** Pull `row(...)` fixture data out of an existing smoke script. */
function rowsFromSmoke(scriptName) {
  const src = fs.readFileSync(path.join(root, 'scripts', scriptName), 'utf8');
  const start = src.indexOf('const rows = [');
  const end = src.indexOf('];', start);
  if (start < 0 || end < 0) throw new Error(`fixture rows not found in ${scriptName}`);
  const body = src.slice(start + 'const rows = ['.length, end);
  const collected = [];
  const row = (r, values) => { collected.push({ r, values }); return null; };
  // eslint-disable-next-line no-new-func
  new Function('row', `return [${body}];`)(row);
  return collected;
}

const written = [];

// 1) Supplier price list with ONE generic "Đơn giá" column (role must be chosen).
written.push(writeSheet('bang_gia_den.xlsx', 'Bang gia', table([
  ['STT', 'Mã SP', 'Tên sản phẩm', 'ĐVT', 'Đơn giá'],
  [1, 'DL-12W-30', 'Đèn downlight âm trần 12W 3000K', 'Cái', 180000],
  [2, 'DL-9W-40', 'Đèn downlight âm trần 9W 4000K', 'Cái', 150000],
  [3, 'TR-10W-24', 'Đèn ray nam châm 10W góc 24 độ', 'Cái', 320000],
  [4, 'DRV-DALI-40', 'Bộ nguồn driver DALI 40W', 'Cái', 650000],
  [5, 'LS-5050', 'Đèn LED dây 5050 12V cuộn 5m', 'Cuộn', 210000],
])));

// 1b) Same list but with an explicit supplier COLUMN (strong evidence, RC16 S1-4).
written.push(writeSheet('bang_gia_cot_ncc.xlsx', 'Bang gia', table([
  ['STT', 'Mã SP', 'Tên sản phẩm', 'Nhà cung cấp', 'ĐVT', 'Đơn giá'],
  [1, 'DL-12W-30', 'Đèn downlight âm trần 12W 3000K', 'Duhal', 'Cái', 175000],
  [2, 'TR-10W-24', 'Đèn ray nam châm 10W góc 24 độ', 'Duhal', 'Cái', 310000],
])));

// 2) Old quote with section schema drift (mirrors phase14 section-drift fixture).
written.push(writeSheet('bao_gia_cu_lech_cot.xlsx', 'BG TEST', rowsFromSmoke('phase140-section-schema-drift-smoke.mjs')));

// 3) Old quote with metadata/totals/labor/workflow rows (mirrors phase14 excel-quote fixture).
written.push(writeSheet('bao_gia_cu_metadata.xlsx', 'Sheet2', rowsFromSmoke('phase140-excel-quote-structure-smoke.mjs')));

// 4) Supplier legitimately reuses one code for 3 differently named configurations (Roger FU style).
written.push(writeSheet('ma_ncc_dung_lai.xlsx', 'Bang gia', table([
  ['STT', 'Mã hàng', 'Tên sản phẩm', 'ĐVT', 'Giá đại lý'],
  [1, 'FU', 'Bộ điều khiển cổng FU 1 kênh', 'Bộ', 1450000],
  [2, 'FU', 'Bộ điều khiển cổng FU 2 kênh', 'Bộ', 1690000],
  [3, 'FU', 'Bộ điều khiển cổng FU 4 kênh kèm remote', 'Bộ', 2150000],
  [4, 'R-TX4', 'Remote 4 nút tần số 433MHz', 'Cái', 290000],
])));

// 5) Supplier price list (not a quote table) whose code column only holds warranty text (RC16 S2-5).
written.push(writeSheet('bang_gia_ma_bao_hanh.xlsx', 'Bang gia', table([
  ['STT', 'Mã SP', 'Tên sản phẩm', 'ĐVT', 'Giá đại lý'],
  [1, 'BH 12 tháng', 'Đèn pha LED 50W ngoài trời', 'Cái', 520000],
  [2, 'FL-100W', 'Đèn pha LED 100W ngoài trời', 'Cái', 890000],
])));

// 6) Supplier list WITHOUT a supplier column whose name column only repeats the code
//    (dealer fixes the name once; learning must re-apply it next time — RC16 learning scope).
written.push(writeSheet('bang_gia_ten_ma.xlsx', 'Bang gia', table([
  ['STT', 'Mã SP', 'Tên sản phẩm', 'ĐVT', 'Đơn giá'],
  [1, 'DL-12W-30', 'DL-12W-30', 'Cái', 180000],
  [2, 'DL-9W-40', 'DL-9W-40', 'Cái', 150000],
])));

for (const file of written) console.log('wrote', path.relative(root, file));
