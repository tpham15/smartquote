import fs from 'node:fs';

const app = fs.readFileSync('src/SmartQuote.jsx', 'utf8');
const api = fs.readFileSync('api/excel-template.py', 'utf8');

const requiredApp = [
  'function detectExcelQuoteTemplateMapping',
  'SmartQuote đã đoán mẫu này',
  'Tự nhận diện lại',
  'Chỉnh tay nếu SmartQuote đoán sai',
  'Click để sửa nhanh',
  'excelPickerTargets',
  'applyExcelPreviewPick',
  'fieldPrefixes',
  'clearUntilRow',
  'Dòng sản phẩm mẫu',
  'Xoá dữ liệu cũ tới dòng',
];
const requiredApi = [
  'def _set_field',
  'field_prefixes = mapping.get("fieldPrefixes")',
  'clear_until_row',
  '_clear_row_values',
];

const missingApp = requiredApp.filter((x) => !app.includes(x));
const missingApi = requiredApi.filter((x) => !api.includes(x));

if (missingApp.length || missingApi.length) {
  console.error('Phase 12.1 smoke failed');
  if (missingApp.length) console.error('Missing app markers:', missingApp);
  if (missingApi.length) console.error('Missing API markers:', missingApi);
  process.exit(1);
}

if (app.includes('PDF template') && !app.includes('Phase này không dùng PDF template')) {
  console.error('Unexpected PDF template wording leaked outside the Excel-only guard.');
  process.exit(1);
}

console.log('Phase 12.1 smart Excel mapper smoke: PASS');
