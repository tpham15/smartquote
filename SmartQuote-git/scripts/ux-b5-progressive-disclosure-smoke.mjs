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
assertIncludes('Quản lý báo giá', 'quote management label');
assertIncludes('quoteManageOpen &&', 'quote management collapsed body');
assertIncludes('⋯ Quản lý', 'quote management overflow trigger');
assertIncludes('Lưu bản sao', 'copy quote still available in management panel');

// B5.3 / Pilot export hierarchy — Excel quote export is primary; PDF/Save are secondary.
assertIncludes('<button className="btn-export-primary" disabled={exporting} onClick={exportExcel}>', 'primary quote export button');
assertIncludes('{exporting ? "Đang tạo…" : "Xuất báo giá"}', 'primary quote export label');
assertIncludes('<button className="btn-ghost" onClick={exportPDF}>Xuất PDF</button>', 'secondary PDF button');
assertIncludes('onClick={() => saveCurrentQuote()}', 'secondary save action');
assertNotIncludes('<button className="btn-pdf" onClick={exportPDF}>Xuất PDF</button>', 'PDF as primary action');
assertNotIncludes('Lưu thay đổi', 'verbose primary save label in top action row');

console.log('UX B5 progressive disclosure smoke: PASS');
