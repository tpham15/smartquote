import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PLAN_LIMITS, getMonthlyLimit, monthStartIso } from '../api/_lib/limits.js';
import { normalizeUnits } from '../api/_lib/usage.js';

const sourceSql = readFileSync(new URL('../supabase/phase8_1_plan_limits_source.sql', import.meta.url), 'utf8');
function parseLimit(plan, feature) {
  const re = new RegExp(`\\('${plan}',\\s*'${feature}',\\s*'monthly',\\s*(-?\\d+)\\)`);
  const match = sourceSql.match(re);
  assert.ok(match, `Missing ${plan}.${feature} in SQL source`);
  const value = Number(match[1]);
  return value < 0 ? Infinity : value;
}

assert.equal(getMonthlyLimit('trial', 'web_scrape'), parseLimit('trial', 'web_scrape'));
assert.equal(getMonthlyLimit('starter', 'pdf_extract'), parseLimit('starter', 'pdf_extract'));
assert.equal(getMonthlyLimit('pro', 'ai_claude_request'), parseLimit('pro', 'ai_claude_request'));
assert.equal(getMonthlyLimit('business', 'web_scrape'), parseLimit('business', 'web_scrape'));
assert.equal(getMonthlyLimit('unknown', 'web_scrape'), PLAN_LIMITS.trial.web_scrape);

assert.equal(normalizeUnits(0), 1);
assert.equal(normalizeUnits(1.2), 2);
assert.equal(normalizeUnits(999999), 10000);
assert.match(monthStartIso(new Date('2026-06-29T19:00:00+07:00')), /^2026-06-01T00:00:00\.000Z$/);

console.log('✓ api auth/quota smoke passed');
