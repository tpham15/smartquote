import { readFileSync } from 'node:fs';

const src = readFileSync('src/SmartQuote.jsx', 'utf8');
const pkg = readFileSync('package.json', 'utf8');
const fail = (message) => {
  console.error(`UX B7.1 fix pack smoke: FAIL — ${message}`);
  process.exit(1);
};
const assertIncludes = (needle, label = needle) => {
  if (!src.includes(needle)) fail(`missing ${label}`);
};
const assertNotIncludes = (needle, label = needle) => {
  if (src.includes(needle)) fail(`still contains ${label}`);
};
const count = (needle) => (src.match(new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;

// B7.1.1: guard against the JSX regression found during review.
assertNotIncludes('/>\n        />', 'duplicate JSX self-close pattern');
assertIncludes('<UnifiedImportHub', 'UnifiedImportHub render exists');
if (src.includes('markups={markups}\n            markups={markups}')) fail('duplicate markups prop in Settings props');
if (count('<Field label="Hạng mục"') !== 1) fail('customer field Hạng mục should appear exactly once');

// B7.1.2: header keeps a clear plan/upgrade entry.
assertIncludes('className="cloud-upgrade"', 'header upgrade button');
assertIncludes('onClick={openUpgrade}>{billingStatus?.locked ? "Gia hạn" : "Xem gói"}', 'header upgrade copy');

// B7.1.3: Catalog now has one obvious import entry; rare tools are hidden one level down.
assertIncludes('<details className="cat-advanced-tools">', 'catalog advanced tools disclosure');
assertIncludes('⋯ Công cụ nâng cao', 'advanced tools summary');
assertIncludes('className="btn-import-catalog prominent"', 'single prominent import button');
assertIncludes('+ Thêm thủ công', 'manual add is secondary wording');
assertNotIncludes('<button className="btn-primary" onClick={() => setEditing({ name: "", sku: "", category: "", supplier: "", unit: "Cái", costPrice: 0 })}>\n          + Thêm', 'old primary add product button');

// B7.1.4: quote management is compact and not a full competing action area.
assertIncludes('quote-manage-card quote-manage-bar', 'compact quote manager bar');
assertIncludes('⋯ Quản lý', 'quote manager disclosure action');

// B7.1.5: import preview red-price rows visually disable the primary hero action too.
assertIncludes('const hasPriceUnconfirmed = priceColumnUncertainRows().length > 0 && !priceColumnConfirmed;', 'price-confirm guard in hero');
assertIncludes('? { label: "Cần xác nhận cột giá", onClick: () => {}, disabled: true }', 'disabled price-confirm hero action');
assertIncludes('disabled={defaultAction.disabled}', 'disabled hero button');
assertIncludes('Cần xác nhận cột giá', 'disabled save label');
assertNotIncludes('background: priceColumnUncertainRows().length > 0 && !priceColumnConfirmed ? "#94A3B8"', 'hard-coded disabled primary background');

// B7.1.6: package exposes this smoke test.
if (!pkg.includes('"smoke:ux-b7.1"')) fail('missing package script smoke:ux-b7.1');

console.log('UX B7.1 fix pack smoke: PASS');
