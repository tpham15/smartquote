import fs from 'node:fs';

const jsx = fs.readFileSync('src/SmartQuote.jsx', 'utf8');
const api = fs.readFileSync('api/excel-template.py', 'utf8');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));

function assert(cond, msg) {
  if (!cond) {
    console.error(`Phase 12 smoke FAIL: ${msg}`);
    process.exit(1);
  }
}

assert(jsx.includes('DEFAULT_EXCEL_QUOTE_TEMPLATE_MAPPING'), 'missing default Excel template mapping');
assert(jsx.includes('normalizeExcelQuoteTemplates'), 'missing Excel template normalizer');
assert(jsx.includes('Mẫu Excel báo giá của đại lý'), 'missing Excel template UI section');
assert(jsx.includes('Phase 12 chỉ nhận file .xlsx'), 'missing xlsx-only upload guard');
assert(jsx.includes('exportQuoteExcelWithTemplate'), 'missing template export function');
assert(jsx.includes('/api/excel-template'), 'missing template export API call');
assert(jsx.includes('Mẫu Excel dùng khi xuất'), 'missing quote screen template selector');
assert(jsx.includes('Nút “Xuất Excel” sẽ điền dữ liệu báo giá hiện tại trực tiếp vào mẫu này.'), 'missing unified template-fill export guidance');
assert(!jsx.includes('Upload mẫu PDF'), 'must not introduce PDF template upload');
assert(api.includes('load_workbook'), 'API must use openpyxl load_workbook to preserve xlsx template');
assert(api.includes('Phase 12 chỉ hỗ trợ mẫu Excel .xlsx'), 'API missing xlsx-only guard');
assert(api.includes('record_usage(auth, "excel_export"'), 'API must record excel_export usage');
assert(pkg.scripts['smoke:phase12'] === 'node scripts/phase12-excel-template-smoke.mjs', 'missing smoke script in package.json');

const importEngineFiles = fs.readdirSync('src/import-engine', { recursive: true }).filter(String);
assert(importEngineFiles.length > 0, 'import-engine folder not found');
console.log('Phase 12 Excel template smoke: PASS');
