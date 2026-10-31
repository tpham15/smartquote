import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { INDUSTRY_PROFILES, getIndustryProfile } from '../src/config/industryProfiles.js';
import { buildDefaultQuoteTemplateConfig } from '../src/quoteTemplates.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const app = read('src/SmartQuote.jsx');
const authGate = read('src/supabase/SupabaseAuthGate.jsx');
const cloudState = read('src/supabase/cloudState.js');
const onboarding = read('src/ui/IndustryOnboarding.jsx');
const migration = read('supabase/phase15_industry_profiles.sql');
const quoteLifecycle = read('src/quote/quoteLifecycle.js');

for (const id of ['generic','lighting','cctv','smarthome','electrical','hvac']) {
  assert.ok(INDUSTRY_PROFILES[id], `missing industry profile ${id}`);
}
assert.equal(getIndustryProfile('unknown').id, 'generic', 'generic fallback must always exist');
assert.equal(getIndustryProfile('lighting').labels.product, 'Sản phẩm');
assert.equal(getIndustryProfile('cctv').labels.section, 'Hạng mục');
assert.ok(getIndustryProfile('lighting').productAttributes.some((x) => x.key === 'wattage'));
assert.ok(getIndustryProfile('lighting').productAttributes.some((x) => x.key === 'cct'));
assert.ok(getIndustryProfile('cctv').productAttributes.some((x) => x.key === 'resolution'));
assert.ok(getIndustryProfile('cctv').productAttributes.some((x) => x.key === 'poe'));
assert.equal(getIndustryProfile('generic').productAttributes.length, 0, 'generic must not depend on vertical attributes');
assert.equal(buildDefaultQuoteTemplateConfig().presetId, 'minimal_business', 'global quote-template fallback must be industry-neutral');

assert.match(onboarding, /Bạn đang kinh doanh trong lĩnh vực nào\?/);
assert.match(onboarding, /Doanh nghiệp của bạn thuộc mô hình nào\?/);
assert.match(authGate, /workspaceProfile && !workspaceProfile\.industry_profile/);
assert.match(authGate, /updateDealerWorkspaceProfile/);
assert.match(cloudState, /\.from\("dealers"\)[\s\S]*\.update\(payload\)/);
assert.doesNotMatch(cloudState, /\.from\("quotes"\)[\s\S]*industry_profile/);
assert.doesNotMatch(cloudState, /\.from\("catalog_items"\)[\s\S]*industry_profile/);

assert.match(migration, /industry_profile text/);
assert.match(migration, /business_type text/);
assert.match(migration, /where industry_profile is null/);
assert.match(migration, /grant update \(name, phone, address, industry_profile, business_type, industry_profile_version\)/);
assert.match(migration, /authenticated_plan_update_should_be_false/);

const qStart = app.indexOf('function QuoteBuilder(');
const qEnd = app.indexOf('function QuoteListPanel(', qStart);
assert.ok(qStart >= 0 && qEnd > qStart, 'QuoteBuilder block not found');
const quoteBlock = app.slice(qStart, qEnd);
for (const forbidden of ['Bộ Erfinden Villa', 'Phòng khách', 'Phòng ngủ', 'Smart Home Package', 'Gateway mặc định', 'Combo phòng']) {
  assert.ok(!quoteBlock.includes(forbidden), `generic quote workflow contains forbidden vertical wording: ${forbidden}`);
}
assert.match(quoteBlock, /\+ Thêm bộ sản phẩm/);
assert.match(quoteBlock, /\+ Thêm sản phẩm/);
assert.match(quoteBlock, /Hạng mục \/ Phân bổ/);
assert.match(quoteBlock, /industryProfile\.enableSolutionFamilies/);

assert.ok(!/industry_profile|industryProfile/.test(quoteLifecycle), 'Final/revision lifecycle must stay industry-independent');
assert.match(app, /visibleQuotePresets = QUOTE_TEMPLATE_PRESET_LIST\.filter/);
assert.match(app, /industryProfile\.productAttributes\.map/);
assert.match(app, /industryProfile\.defaultCategories/);

console.log('✓ Pilot P1.5 Industry-Neutral Core smoke PASS');
console.log('  - six workspace industry profiles + generic fallback');
console.log('  - first-time onboarding persists on dealer workspace');
console.log('  - quote workflow uses neutral product/section terminology');
console.log('  - Lighting/CCTV attributes and template filtering are profile-driven');
console.log('  - industry switching only updates workspace metadata');
console.log('  - Final quote lifecycle remains industry-independent');
console.log('  - migration preserves billing-column security');
