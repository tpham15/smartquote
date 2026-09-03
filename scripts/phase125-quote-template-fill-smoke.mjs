import fs from 'node:fs';

const src = fs.readFileSync('src/SmartQuote.jsx', 'utf8');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));

function assert(cond, msg) {
  if (!cond) {
    console.error(`Phase 12.5 quote→template smoke FAIL: ${msg}`);
    process.exit(1);
  }
}

const exportStart = src.indexOf('// Phase 12.5 — một đường xuất Excel duy nhất.');
const exportEnd = src.indexOf('const exportPDF =', exportStart);
const exportBlock = src.slice(exportStart, exportEnd);

assert(exportStart >= 0, 'unified Phase 12.5 export handler missing');
assert(exportBlock.includes('if (activeExcelTemplate)'), 'Excel export must prefer the selected/default template');
assert(exportBlock.includes('await exportQuoteExcelWithTemplate({'), 'template path must fill current quote into lossless template');
assert(exportBlock.includes('await exportQuoteExcel({ company, customer, rooms, productById, lineSalePrice, calc });'), 'generic export must remain only as no-template fallback');
assert(exportBlock.indexOf('exportQuoteExcelWithTemplate') < exportBlock.indexOf('exportQuoteExcel({ company'), 'lossless template path must be evaluated before generic fallback');
assert(!src.includes('const exportExcelTemplate = async'), 'duplicate template export handler must be removed');
assert(!src.includes('>Xuất theo mẫu Excel</button>'), 'duplicate template export button must be removed');
assert(src.includes('Mẫu Excel dùng khi xuất'), 'quote screen template selector missing');
assert(src.includes('Nút “Xuất báo giá” mặc định tạo file Excel và điền dữ liệu hiện tại trực tiếp vào mẫu này.'), 'quote→template explanation missing');
assert(src.includes('defaultExcelQuoteTemplateId'), 'dealer default Excel template id missing');
assert(src.includes('Đặt làm mẫu mặc định'), 'settings action to choose default Excel template missing');
assert(src.includes('Không có template => mới dùng workbook generic của SmartQuote.'), 'no-template-only fallback contract missing');
assert(pkg.scripts['smoke:phase12.5'] === 'node scripts/phase125-quote-template-fill-smoke.mjs && python3 scripts/phase125-quote-template-fill-smoke.py', 'phase12.5 smoke script missing');

console.log('Phase 12.5 unified quote→template UI smoke: PASS');
