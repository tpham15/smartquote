import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PLAN_PRICE_VND as UI_PRICES, getPlanPriceVnd as uiPrice, formatVnd as uiVnd } from '../src/billing/planLimits.js';
import { PLAN_PRICE_VND as STORE_PRICES, getPlanPriceVnd as storePrice, formatVnd as storeVnd } from '../src/supabase/billingStore.js';

const sourceSql = readFileSync(new URL('../supabase/phase8_1_plan_limits_source.sql', import.meta.url), 'utf8');
function parsePrices(sql) {
  return Object.fromEntries([...sql.matchAll(/\('([^']+)',\s*'[^']+',\s*(\d+),\s*(\d+),\s*\d+\)/g)]
    .filter((m) => ['starter', 'pro', 'business'].includes(m[1]))
    .map((m) => [m[1], { monthly: Number(m[2]), annual: Number(m[3]) }]));
}
const expected = parsePrices(sourceSql);
assert.deepEqual(UI_PRICES, expected, 'UI prices must be generated from SQL source');
assert.deepEqual(STORE_PRICES, expected, 'billing store prices must use generated SQL source');
assert.deepEqual(UI_PRICES, STORE_PRICES, 'billing prices must match between UI and billing store');
assert.equal(uiPrice('pro', 'annual'), expected.pro.annual);
assert.equal(storePrice('business', 'monthly'), expected.business.monthly);
assert.equal(uiVnd(expected.pro.monthly), `${expected.pro.monthly.toLocaleString('vi-VN')}đ`);
assert.equal(storeVnd(expected.business.monthly), `${expected.business.monthly.toLocaleString('vi-VN')}đ`);

const sql = readFileSync(new URL('../supabase/phase6_billing_events.sql', import.meta.url), 'utf8');
assert.match(sql, /create table if not exists public\.billing_events/i);
assert.match(sql, /create_manual_billing_request/i);
assert.match(sql, /admin_activate_manual_billing_event/i);
assert.match(sql, /admin_activate_dealer_plan/i);
assert.match(sql, /from public\.plan_catalog/i, 'billing SQL must read prices from plan_catalog');
assert.doesNotMatch(sql, /when 'starter' then case[\s\S]*499000/i, 'billing SQL must not duplicate plan prices');
assert.match(sql, /grant execute on function public\.create_manual_billing_request/i);
assert.match(sql, /revoke all on function public\.admin_activate_manual_billing_event/i);
assert.doesNotMatch(sql, /grant execute on function public\.admin_activate_manual_billing_event/i);
assert.doesNotMatch(sql, /grant execute on function public\.admin_activate_dealer_plan/i);

console.log('✓ Billing/manual payment smoke passed');
