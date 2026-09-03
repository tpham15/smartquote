import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync('src/SmartQuote.jsx', 'utf8');

const tabMatch = app.match(/const PRIMARY_TABS = \[([\s\S]*?)\];/);
assert.ok(tabMatch, 'PRIMARY_TABS config missing');
const tabBlock = tabMatch[1];
for (const key of ['quote', 'data', 'assets', 'settings']) {
  assert.match(tabBlock, new RegExp(`key: "${key}"`), `primary tab ${key} missing`);
}
assert.equal((tabBlock.match(/key: "/g) || []).length, 12, 'PRIMARY_TABS should include 4 primary tabs + 8 sub views after Phase 11');

const requiredLegacyTargets = {
  catalog: '["data", "products"]',
  takeoff: '["data", "import"]',
  ai_reader: '["data", "import"]',
  ask: '["data", "ask"]',
  templates: '["assets", "room_packs"]',
  solution_families: '["assets", "solution_families"]',
  quote_template: '["assets", "quote_tmpl"]',
  upgrade: '["settings", "plan"]',
  settings: '["settings", "general"]',
};
for (const [legacy, target] of Object.entries(requiredLegacyTargets)) {
  assert.ok(app.includes(`${legacy}: ${target}`), `legacy tab ${legacy} is not mapped to ${target}`);
}

assert.match(app, /PRIMARY_TABS\.map\(\(item\) =>/, 'header nav must render from PRIMARY_TABS');
assert.match(app, /className="sub-nav"/, 'sub-nav wrapper missing');
assert.match(app, /tab === "data" && effectiveSubView === "products"/, 'Catalog route missing under data/products');
assert.match(app, /tab === "data" && effectiveSubView === "import"/, 'TakeoffReader route missing under data/import');
assert.match(app, /tab === "data" && effectiveSubView === "ask"/, 'AskSupplier route missing under data/ask');
assert.match(app, /tab === "assets" && effectiveSubView === "room_packs"/, 'Templates route missing under assets/room_packs');
assert.match(app, /tab === "assets" && effectiveSubView === "solution_families"/, 'SolutionFamilies route missing under assets/solution_families');
assert.match(app, /tab === "assets" && effectiveSubView === "quote_tmpl"/, 'QuoteTemplateSettings route missing under assets/quote_tmpl');
assert.match(app, /tab === "settings" && effectiveSubView === "general"/, 'Settings route missing under settings/general');
assert.match(app, /tab === "settings" && effectiveSubView === "plan" && <UpgradePage/, 'UpgradePage route missing under settings/plan');
assert.match(app, /const openUpgrade = \(\) => setTab\("settings", "plan"\)/, 'openUpgrade must route to settings/plan');

console.log('UX B1 nav smoke: PASS');
