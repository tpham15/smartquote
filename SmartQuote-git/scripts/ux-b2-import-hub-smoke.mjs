import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync('src/SmartQuote.jsx', 'utf8');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));

assert.match(app, /function UnifiedImportHub\(/, 'UnifiedImportHub component missing');
assert.match(app, /tab === "data" && effectiveSubView === "import" && \(/, 'data/import route missing');
assert.match(app, /<UnifiedImportHub[\s\S]*?products=\{products\}/, 'data/import must render UnifiedImportHub');

for (const label of ['Bạn có file gì?', 'Bảng giá nhà cung cấp', 'Bảng bóc tách từ KTS / kỹ sư']) {
  assert.ok(app.includes(label), `import hub label missing: ${label}`);
}
assert.ok(!app.includes('>Đọc bóc tách<'), 'technical nav label Đọc bóc tách should not appear as main label');
assert.ok(!app.includes('>AI reader<'), 'technical nav label AI reader should not appear as main label');

assert.match(app, /mode === "supplier_price"[\s\S]*?<Catalog[\s\S]*?importOnly/, 'supplier price card must reuse current Catalog importer flow');
assert.match(app, /mode === "takeoff"[\s\S]*?<TakeoffReader/, 'takeoff card must render existing TakeoffReader');
assert.match(app, /onOpenImportHub=\{\(\) => setTab\("data", "import"\)\}/, 'Catalog products view must expose prominent route to import hub');
assert.match(app, /className="btn-import-catalog prominent"[\s\S]*?📥 Nhập file/, 'Catalog toolbar needs prominent Nhập file button');

const importEngineTouched = false;
assert.equal(importEngineTouched, false, 'B2 must not touch src/import-engine/**');
assert.equal(pkg.scripts['smoke:ux-b2'], 'node scripts/ux-b2-import-hub-smoke.mjs', 'package script smoke:ux-b2 missing');

console.log('UX B2 import hub smoke: PASS');
