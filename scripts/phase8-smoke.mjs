import fs from 'node:fs';
import assert from 'node:assert/strict';
import { PLAN_LIMITS, FEATURE_LABELS, canUseFeature } from '../src/billing/planLimits.js';

for (const plan of ['trial', 'starter', 'pro', 'business', 'expired']) {
  assert.ok(Object.prototype.hasOwnProperty.call(PLAN_LIMITS[plan], 'product_enrich'), `${plan} missing product_enrich limit`);
}
assert.equal(FEATURE_LABELS.product_enrich, 'lượt tìm sản phẩm web/tháng');
assert.equal(canUseFeature({ dealer: { plan: 'trial', subscription_status: 'trialing' }, usage: { product_enrich: PLAN_LIMITS.trial.product_enrich - 1 } }, 'product_enrich', 1).ok, true);
assert.equal(canUseFeature({ dealer: { plan: 'trial', subscription_status: 'trialing' }, usage: { product_enrich: PLAN_LIMITS.trial.product_enrich } }, 'product_enrich', 1).ok, false);

const api = fs.readFileSync('api/product-enrich.js', 'utf8');
assert.match(api, /eventType: 'product_enrich'/);
assert.match(api, /redirect: 'manual'/);
assert.match(api, /validatePublicUrl\(nextUrl\)/);
assert.match(api, /google\.serper\.dev\/search/);
assert.match(api, /assertExternalBudget/);
assert.match(api, /recordExternalApiUsage/);
assert.ok(api.includes('application\\/ld\\+json') || api.includes('application/ld+json'));

const app = fs.readFileSync('src/SmartQuote.jsx', 'utf8');
assert.match(app, /function ProductEnrichmentModal/);
assert.match(app, /\/api\/product-enrich/);
assert.match(app, /guardFeature\(cloud, "product_enrich"/);
assert.match(app, /Tìm sản phẩm từ web/);

const sql = fs.readFileSync('supabase/phase8_product_enrichment.sql', 'utf8');
assert.match(sql, /from public\.plan_limit_catalog/i, 'product_enrich quota must come from plan_limit_catalog');
assert.doesNotMatch(sql, /when 'product_enrich' then/i, 'product_enrich quota must not be hard-coded in Phase 8 SQL');

console.log('✅ Phase 8 product enrichment smoke PASS');
