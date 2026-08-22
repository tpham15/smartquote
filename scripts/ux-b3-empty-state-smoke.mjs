import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync('src/SmartQuote.jsx', 'utf8');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));

assert.match(app, /function NewUserEmptyState\(/, 'NewUserEmptyState component missing');
assert.match(app, /tab === "quote" && products\.length === 0[\s\S]*?<NewUserEmptyState[\s\S]*?context="quote"/, 'Quote empty state must replace QuoteBuilder when products is empty');
assert.match(app, /tab === "quote" && products\.length > 0[\s\S]*?<QuoteBuilder/, 'QuoteBuilder must still render after products exist');
assert.ok(app.includes('Bắt đầu trong 2 bước'), 'Quote empty-state title missing');
assert.ok(app.includes('Nhập bảng giá của bạn'), 'Step 1 copy missing');
assert.ok(app.includes('Tạo báo giá đầu tiên'), 'Step 2 copy missing');
assert.match(app, /onImport=\{\(\) => setTab\("data", "import"\)\}/, 'Quote empty state CTA must route to data/import');
assert.match(app, /products\.length === 0 && \([\s\S]*?<NewUserEmptyState context="catalog" onImport=\{openCatalogImport\}/, 'Catalog products view must render catalog empty state');
assert.ok(app.includes('Chưa có sản phẩm nào'), 'Catalog empty-state title missing');
assert.ok(app.includes('catalog-empty-secondary-actions'), 'Catalog secondary actions should stay below primary import CTA');
assert.match(app, /\.new-user-empty/, 'New user empty-state CSS missing');
assert.equal(pkg.scripts['smoke:ux-b3'], 'node scripts/ux-b3-empty-state-smoke.mjs', 'package script smoke:ux-b3 missing');

console.log('UX B3 empty state smoke: PASS');
