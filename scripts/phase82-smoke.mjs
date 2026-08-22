import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PLAN_PRICE_VND as UI_PRICES } from '../src/billing/planLimits.js';
import { PLAN_PRICE_VND as STORE_PRICES } from '../src/supabase/billingStore.js';
import { getMonthlyLimit } from '../api/_lib/limits.js';

const phase82Sql = fs.readFileSync('supabase/phase8_2_operational_guardrails.sql', 'utf8');
const productApi = fs.readFileSync('api/product-enrich.js', 'utf8');
const externalUsage = fs.readFileSync('api/_lib/externalUsage.js', 'utf8');
const qaDoc = fs.readFileSync('docs/PRODUCTION_QA_2_USER_CHECKLIST.md', 'utf8');
const qaScript = fs.readFileSync('scripts/production-qa-check.mjs', 'utf8');

assert.deepEqual(UI_PRICES, STORE_PRICES, 'billingStore must import generated SQL plan prices');
assert.equal(getMonthlyLimit('starter', 'product_enrich'), 50, 'generated monthly limit sanity check failed');

assert.match(phase82Sql, /create table if not exists public\.external_api_usage/i, 'external_api_usage table missing');
assert.match(phase82Sql, /create table if not exists public\.external_api_budget_catalog/i, 'external_api_budget_catalog table missing');
assert.match(phase82Sql, /from public\.plan_catalog/i, 'billing price function must read plan_catalog');
assert.match(phase82Sql, /from public\.plan_limit_catalog/i, 'usage limit function must read plan_limit_catalog');
assert.doesNotMatch(phase82Sql, /when 'starter' then case[\s\S]*499000/i, 'Phase 8.2 SQL must not duplicate plan prices');
assert.doesNotMatch(phase82Sql, /when 'product_enrich' then/i, 'Phase 8.2 SQL must not hard-code product_enrich quota');

assert.match(productApi, /assertExternalBudget\(auth, \{ provider: 'serper'/, 'product-enrich must budget-check Serper before search');
assert.match(productApi, /recordExternalApiUsage\(auth, \{\s*provider: 'serper'/, 'product-enrich must record Serper usage');
assert.match(productApi, /externalUsage/, 'product-enrich response/log must include external usage');
assert.match(externalUsage, /external_api_budget_catalog/, 'externalUsage helper must read budget catalog');
assert.match(externalUsage, /external_api_usage/, 'externalUsage helper must write usage table');
assert.match(externalUsage, /SMARTQUOTE_SERPER_.*MONTHLY_BUDGET_USD|SMARTQUOTE_EXTERNAL_BUDGET_DISABLED/, 'external budget env override missing');

assert.match(qaDoc, /User A[\s\S]*User B/i, '2-user production QA doc must cover A/B isolation');
assert.match(qaDoc, /token A[\s\S]*dealer_id B/i, '2-user production QA doc must cover cross-dealer API denial');
assert.match(qaScript, /plan_catalog[\s\S]*plan_limit_catalog[\s\S]*external_api_budget_catalog/i, 'qa:production script must verify required tables');

console.log('✓ Phase 8.2 operational guardrails smoke passed');
