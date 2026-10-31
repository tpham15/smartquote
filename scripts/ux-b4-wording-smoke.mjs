import { readFileSync } from 'node:fs';

const src = readFileSync('src/SmartQuote.jsx', 'utf8');
const fail = (message) => {
  console.error(`UX B4 wording smoke: FAIL — ${message}`);
  process.exit(1);
};
const assertIncludes = (needle, label = needle) => {
  if (!src.includes(needle)) fail(`missing ${label}`);
};
const assertNotIncludes = (needle, label = needle) => {
  if (src.includes(needle)) fail(`still contains ${label}`);
};

assertIncludes('+ Thêm hạng mục', 'primary add-section label');
assertNotIncludes('+ Thêm phòng', 'old room-specific add label');
assertIncludes('name: `${industryProfile.labels.section} 1`', 'default first neutral section label');
assertIncludes('const name = `${industryProfile.labels.section} ${idx}`;', 'new added section label pattern');
assertIncludes('Hạng mục / Phân bổ', 'neutral section allocation column label');
assertNotIncludes('Phòng / Phân bổ', 'old room-specific allocation label');

assertIncludes('Mở Zalo với Nhà cung cấp', 'full supplier wording on Zalo action');
assertIncludes('Chưa có nhà cung cấp', 'empty supplier wording');
assertIncludes('Tên nhà cung cấp', 'supplier field label');
assertIncludes('Nhà cung cấp/Brand (tuỳ chọn)', 'web import supplier placeholder');
assertNotIncludes('Mở Zalo với NCC', 'old NCC Zalo action');
assertNotIncludes('Chưa có NCC', 'old empty NCC wording');
assertNotIncludes('Tên NCC', 'old NCC field label');
assertNotIncludes('NCC/Brand', 'old short supplier placeholder');
assertNotIncludes('Gợi ý NCC', 'old short supplier suggestion');

console.log('UX B4 wording smoke: PASS');
