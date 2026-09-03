import assert from 'node:assert/strict';
import { canFitProductCount, canUseFeature, normalizeBilling, PLAN_LIMITS } from '../src/billing/planLimits.js';

const future = new Date(Date.now() + 7 * 86400000).toISOString();
const past = new Date(Date.now() - 86400000).toISOString();

const trial = normalizeBilling({
  dealer: { plan: 'trial', subscription_status: 'trialing', trial_ends_at: future },
  usage: { web_scrape: 2, pdf_extract: 3, excel_export: 0 },
});
assert.equal(trial.locked, false, 'active trial should not lock');
assert.equal(trial.limits.products, PLAN_LIMITS.trial.products, 'trial product limit must follow generated source');
const trialWebLimit = PLAN_LIMITS.trial.web_scrape;
assert.equal(canUseFeature({ dealer: { plan: 'trial', subscription_status: 'trialing', trial_ends_at: future }, usage: { web_scrape: trialWebLimit - 1 } }, 'web_scrape', 1).ok, true);
assert.equal(canUseFeature({ dealer: { plan: 'trial', subscription_status: 'trialing', trial_ends_at: future }, usage: { web_scrape: trialWebLimit } }, 'web_scrape', 1).ok, false);
const starterProductLimit = PLAN_LIMITS.starter.products;
assert.equal(canFitProductCount({ dealer: { plan: 'starter', subscription_status: 'active' }, usage: {} }, starterProductLimit).ok, true);
assert.equal(canFitProductCount({ dealer: { plan: 'starter', subscription_status: 'active' }, usage: {} }, starterProductLimit + 1).ok, false);

const expired = normalizeBilling({ dealer: { plan: 'trial', subscription_status: 'trialing', trial_ends_at: past }, usage: {} });
assert.equal(expired.locked, true, 'expired trial should lock');
assert.equal(expired.effectivePlan, 'expired');
assert.equal(canUseFeature({ dealer: { plan: 'trial', subscription_status: 'trialing', trial_ends_at: past }, usage: {} }, 'pdf_extract', 1).ok, false);

assert.equal(PLAN_LIMITS.pro.quotes_per_month, Infinity, 'pro should have unlimited quotes');
console.log('✓ plan gate smoke passed');
