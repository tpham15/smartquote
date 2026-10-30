import { readFileSync } from 'node:fs';

const src = readFileSync('src/SmartQuote.jsx', 'utf8');
const fail = (message) => {
  console.error(`UX B5 progressive disclosure smoke: FAIL — ${message}`);
  process.exit(1);
};
const assertIncludes = (needle, label = needle) => { if (!src.includes(needle)) fail(`missing ${label}`); };
const assertNotIncludes = (needle, label = needle) => { if (src.includes(needle)) fail(`still contains ${label}`); };

// B5.1: hệ số không còn là cột/nút nhanh trên bảng dòng mặc định.
assertNotIncludes('<th className="num hs-col">Hệ số</th>', 'inline factor column header');
assertNotIncludes('className="num hs-col"', 'inline factor cell');
assertIncludes('line-detail-factor', 'factor editor inside line edit modal');
assertIncludes('Hệ số riêng của dòng này', 'line-detail factor label');

// B5.2: cloud quote management moved behind a management panel.
assertNotIncludes('Kho báo giá cloud', 'old cloud quote title');
assertIncludes('Báo giá mới', 'compact quote management label');
assertIncludes('quoteManageOpen &&', 'quote management collapsed body');
assertIncludes('⋯ Quản lý', 'quote management overflow trigger');
assertIncludes('Tạo bản sao', 'copy quote still available in management panel');

// B5.3 / Pilot P1.1 hierarchy — Draft must Final first; only Final exposes primary Excel export.
assertIncludes('Chốt & khóa báo giá', 'Draft primary finalize action');
assertIncludes('disabled={exporting || !finalQuoteGate.ready} onClick={exportExcel}', 'Final-only primary Excel export');
assertIncludes('`Xuất báo giá · Rev ${quoteRevision}`', 'revision-aware primary export label');
assertIncludes('disabled={!finalQuoteGate.ready} onClick={exportPDF}>Xuất PDF</button>', 'Final-only secondary PDF button');
assertIncludes('Lưu nháp', 'Draft save action');
assertIncludes('Tạo Rev {quoteRevision + 1}', 'Final revision action');
assertNotIncludes('<button className="btn-pdf" onClick={exportPDF}>Xuất PDF</button>', 'PDF as primary action');
assertNotIncludes('Lưu thay đổi', 'verbose primary save label in top action row');

console.log('UX B5 progressive disclosure smoke: PASS');
