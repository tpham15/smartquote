import fs from 'node:fs';
import assert from 'node:assert/strict';

const app = fs.readFileSync(new URL('../src/SmartQuote.jsx', import.meta.url), 'utf8');
const mapper = fs.readFileSync(new URL('../src/import-engine/legacy/legacyClaudeMapper.js', import.meta.url), 'utf8');
const onboarding = fs.readFileSync(new URL('../src/ui/IndustryOnboarding.jsx', import.meta.url), 'utf8');
const main = fs.readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8');
const boundary = fs.readFileSync(new URL('../src/ui/ErrorBoundary.jsx', import.meta.url), 'utf8');
const excelPy = fs.readFileSync(new URL('../api/excel_builder.py', import.meta.url), 'utf8');
const schema = fs.readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8');
const migration = fs.readFileSync(new URL('../supabase/phase15_3_pilot_release_hardening.sql', import.meta.url), 'utf8');
const env = fs.readFileSync(new URL('../.env.example', import.meta.url), 'utf8');

const serverOnlyRpcs = [
  'smartquote_increment_rate_limit\\(text, timestamptz, integer, integer\\)',
  'admin_prune_api_logs\\(integer\\)',
  'consume_usage_quota\\(uuid, uuid, text, integer, jsonb\\)',
];
for (const sig of serverOnlyRpcs) {
  assert.match(schema, new RegExp(`revoke all on function public\\.${sig} from anon;`, 'i'), `${sig}: anon revoke missing in fresh schema`);
  assert.match(schema, new RegExp(`revoke all on function public\\.${sig} from authenticated;`, 'i'), `${sig}: authenticated revoke missing in fresh schema`);
  assert.match(schema, new RegExp(`grant execute on function public\\.${sig} to service_role;`, 'i'), `${sig}: service_role grant missing in fresh schema`);
}
assert.match(migration, /authenticated_consume_quota_should_be_false/i, 'live migration privilege verification missing');
assert.match(migration, /service_role_consume_quota_should_be_true/i, 'service-role privilege verification missing');

// Generic/default quote export must not leak Smart Home language.
assert.doesNotMatch(excelPy, /TỔNG HỢP CÁC GIẢI PHÁP NHÀ THÔNG MINH|Giải pháp nhà thông minh/i, 'Python default Excel export still contains Smart Home wording');
const exportStart = app.indexOf('async function exportQuoteExcel({');
const exportEnd = app.indexOf('// ============================================================', exportStart + 20);
const exportBlock = app.slice(exportStart, exportEnd > exportStart ? exportEnd : app.length);
assert.doesNotMatch(exportBlock, /TỔNG HỢP CÁC GIẢI PHÁP NHÀ THÔNG MINH|Giải pháp nhà thông minh Lumi/i, 'JS default Excel fallback still contains Smart Home wording');
assert.match(exportBlock, /industryProfile/, 'generic Excel export must carry industry context');
assert.match(excelPy, /TỔNG HỢP HẠNG MỤC/, 'neutral Python summary title missing');

// KTS mapping must be industry-aware and not force Lumi/Smart Home in generic AI prompts.
const bomMapperStart = mapper.indexOf('export async function mapBomRowsWithClaude');
const takeoffMapperStart = mapper.indexOf('export async function mapTakeoffColumnsWithClaude');
const bomMapperBlock = mapper.slice(bomMapperStart, takeoffMapperStart);
const catalogMapperStart = mapper.indexOf('export async function autoMapCatalogColumnsWithClaude');
const takeoffMapperBlock = mapper.slice(takeoffMapperStart, catalogMapperStart);
assert.match(bomMapperBlock, /industryName/, 'BOM mapper industry context missing');
assert.doesNotMatch(bomMapperBlock, /LM-D9|LM-1G2W|DS-2CD|RG-AP2200/i, 'BOM mapper still hardcodes old Smart Home/CCTV SKUs');
assert.match(bomMapperBlock, /batch\.length \* 220/, 'BOM mapper output token budget is not batch-aware');
assert.match(takeoffMapperBlock, /industryName/, 'takeoff mapper industry context missing');
assert.doesNotMatch(takeoffMapperBlock, /LM-MDZ|LM-PCB|RG-AP2200|HIKVISION/i, 'takeoff mapper still forces legacy brands/SKUs');
assert.match(app, /if \(!isSmartHomeIndustry\)[\s\S]{0,260}rawGroup \|\| category/, 'non-Smart-Home takeoff grouping must remain neutral');

// Skip must persist null even if a business type had been selected just before it.
assert.match(onboarding, /submit\(null\)/, 'business-type Skip must submit an explicit null override');
assert.match(onboarding, /businessTypeOverride === undefined/, 'onboarding submit override guard missing');

// Crash containment and release env contract.
assert.match(main, /ErrorBoundary/, 'ErrorBoundary is not mounted at app root');
assert.match(boundary, /getDerivedStateFromError/, 'ErrorBoundary implementation missing');
assert.match(boundary, /Tải lại SmartQuote/, 'ErrorBoundary recovery action missing');
assert.match(env, /VITE_SUPABASE_URL=/, '.env.example missing Supabase frontend config');
assert.match(env, /SUPABASE_SERVICE_ROLE_KEY=/, '.env.example missing server key placeholder');
assert.match(env, /CORS is CLOSED to cross-origin requests by default/, '.env.example missing safe CORS contract');

// Changing industry must hide, not erase, stored Smart Home solution families.
assert.match(app, /Industry controls visibility, not ownership of stored solution-family data/, 'solution-family preservation guard missing');
assert.doesNotMatch(app, /const solutionFamilies = industryId === "smarthome" \? normalizeSolutionFamilies\(state\.solutionFamilies\) : \[\]/, 'industry switch can still erase stored solution families');

console.log('✓ Pilot P1.5.3 release hardening smoke PASS');
console.log('  - server-only RPCs locked to service_role');
console.log('  - default Excel/KTS workflow is industry-neutral');
console.log('  - AI batch token budget no longer truncates 30-row mappings at 1k tokens');
console.log('  - onboarding Skip persists null business type');
console.log('  - ErrorBoundary + .env.example restored');
console.log('  - industry switching preserves hidden solution-family data');
