import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PLAN_LIMITS as CLIENT_PLAN_LIMITS, PLAN_PRICE_VND, PLAN_ORDER, PLAN_CAPABILITIES as CLIENT_CAPS } from '../src/billing/planLimits.js';
import { canAccessCapability } from '../src/billing/planCapabilities.js';
import { PLAN_LIMITS as API_PLAN_LIMITS, PLAN_CAPABILITIES as API_CAPS, getMonthlyLimit, hasPlanCapability } from '../api/_lib/limits.js';

const sourcePaths = ['supabase/phase8_1_plan_limits_source.sql', 'supabase/phase10_plan_capabilities.sql'];
const sql = sourcePaths.map((p) => fs.readFileSync(p, 'utf8')).join('\n\n');
const allPlans = ['free','trial','starter','pro','business','expired'];
const monthlyFeatures = ['quotes_per_month', 'ai_claude_request', 'web_scrape', 'product_enrich', 'pdf_extract', 'excel_export'];
const absoluteFeatures = ['seats', 'products'];
const capabilityKeys = ['ai_import','template_memory','correction_learning','branded_pdf','quote_variants_abc','bom_import','team_seats','price_intelligence','api_access','priority_support'];
function parsePlanCatalog(source){const rows=[...source.matchAll(/\('([^']+)',\s*'([^']+)',\s*(-?\d+),\s*(-?\d+),\s*(-?\d+)\)/g)].map(m=>({plan:m[1],label:m[2],monthly:+m[3],annual:+m[4],order:+m[5]})).filter(r=>allPlans.includes(r.plan));const map={};for(const r of rows)map[r.plan]=r;return map;}
function parseLimitCatalog(source){const rows=[...source.matchAll(/\('([^']+)',\s*'([^']+)',\s*'(monthly|absolute)',\s*(-?\d+)\)/g)].map(m=>({plan:m[1],feature:m[2],scope:m[3],value:+m[4]}));const map={};for(const r of rows){if(!allPlans.includes(r.plan))continue;map[r.plan] ||= {}; map[r.plan][r.feature]=r;}return map;}
function parseCapabilityCatalog(source){const rows=[...source.matchAll(/\('([^']+)',\s*'([^']+)',\s*(true|false)\)/gi)].map(m=>({plan:m[1],cap:m[2],enabled:m[3].toLowerCase()==='true'})).filter(r=>allPlans.includes(r.plan));const map={};for(const r of rows){map[r.plan] ||= {}; map[r.plan][r.cap]=r.enabled;}return map;}
function jsValue(v){return v < 0 ? Infinity : v;}
function parsePython(name){const py=fs.readFileSync('api/plan_limits_generated.py','utf8');const start=py.indexOf(`${name} = `);assert.ok(start>=0, `Python ${name} not found`);const sub=py.slice(start).split('\n\n')[0].replace(`${name} = `,'').replace(/True/g,'true').replace(/False/g,'false');return JSON.parse(sub);}
const sqlPlans=parsePlanCatalog(sql), sqlLimits=parseLimitCatalog(sql), sqlCaps=parseCapabilityCatalog(sql);
const pythonPlanLimits=parsePython('PLAN_LIMITS');
const pythonCaps=parsePython('PLAN_CAPABILITIES');
assert.deepEqual(PLAN_ORDER, ['free','starter','pro','business'], 'client PLAN_ORDER must expose sellable tiers only');
for (const plan of allPlans) {
  assert.ok(sqlPlans[plan], `${plan} missing in SQL plan catalog`);
  assert.equal(CLIENT_PLAN_LIMITS[plan]?.label, sqlPlans[plan].label, `${plan} label mismatch`);
  for (const feature of [...absoluteFeatures, ...monthlyFeatures]) {
    const row = sqlLimits[plan]?.[feature]; assert.ok(row, `${plan}.${feature} missing in SQL source`);
    assert.equal(CLIENT_PLAN_LIMITS[plan]?.[feature], jsValue(row.value), `${plan}.${feature} client mismatch`);
  }
  for (const cap of capabilityKeys) {
    assert.equal(CLIENT_CAPS[plan]?.[cap], sqlCaps[plan]?.[cap], `${plan}.${cap} client capability mismatch`);
    assert.equal(API_CAPS[plan]?.[cap], sqlCaps[plan]?.[cap], `${plan}.${cap} api capability mismatch`);
    assert.equal(pythonCaps[plan]?.[cap], sqlCaps[plan]?.[cap], `${plan}.${cap} python capability mismatch`);
    assert.equal(hasPlanCapability(plan, cap), sqlCaps[plan]?.[cap] === true, `${plan}.${cap} hasPlanCapability mismatch`);
  }
}
for (const plan of ['free','starter','pro','business']) {
  assert.equal(PLAN_PRICE_VND[plan]?.monthly, sqlPlans[plan].monthly, `${plan} monthly price mismatch`);
  assert.equal(PLAN_PRICE_VND[plan]?.annual, sqlPlans[plan].annual, `${plan} annual price mismatch`);
}
for (const plan of allPlans) {
  for (const feature of monthlyFeatures) {
    const sqlValue = sqlLimits[plan]?.[feature]?.value;
    assert.equal(API_PLAN_LIMITS[plan]?.[feature], jsValue(sqlValue), `${plan}.${feature} API JS mismatch`);
    assert.equal(getMonthlyLimit(plan, feature), jsValue(sqlValue), `${plan}.${feature} getMonthlyLimit mismatch`);
    assert.equal(pythonPlanLimits[plan]?.[feature], sqlValue, `${plan}.${feature} Python mismatch`);
  }
}
assert.equal(canAccessCapability({ dealer: { plan: 'free', subscription_status: 'active' } }, 'ai_import').ok, false, 'Free must not access AI import');
assert.equal(canAccessCapability({ dealer: { plan: 'starter', subscription_status: 'active' } }, 'bom_import').ok, false, 'Starter must not access BOM import');
assert.equal(canAccessCapability({ dealer: { plan: 'pro', subscription_status: 'active' } }, 'bom_import').ok, true, 'Pro must access BOM import');
assert.match(sql, /create table if not exists public\.plan_capability_catalog/i, 'capability SQL table missing');
assert.match(sql, /create or replace function public\.plan_has_capability/i, 'plan_has_capability helper missing');
console.log('Plan limits/capabilities consistency smoke passed: SQL source matches client JS, API JS, and Python.');
