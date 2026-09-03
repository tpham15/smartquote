import fs from 'node:fs';
import assert from 'node:assert/strict';
import { normalizeBilling } from '../src/billing/planLimits.js';

function read(path) { return fs.readFileSync(path, 'utf8'); }

const now = new Date('2026-07-10T00:00:00Z');
const expiredPro = normalizeBilling({
  plan: 'pro',
  subscription_status: 'active',
  current_period_end: '2026-07-01T00:00:00Z',
}, { now });
assert.equal(expiredPro.locked, true, 'paid plan must lock when current_period_end is past even if status=active');
assert.equal(expiredPro.effectivePlan, 'expired');

const planLimits = read('src/billing/planLimits.js');
const apiLimits = read('api/_lib/limits.js');
const pyAuth = read('api/auth_guard.py');
assert(!planLimits.includes("&& !['active', 'trialing'].includes(subscriptionStatus)"), 'client paid expiry should not depend on active status');
assert(!apiLimits.includes("&& !['active', 'trialing'].includes(status)"), 'api paid expiry should not depend on active status');
assert(!pyAuth.includes('and status not in ("active", "trialing")'), 'python paid expiry should not depend on active status');

const web = read('api/web-products.js');
const img = read('api/img.js');
assert(web.includes("redirect: 'manual'"), 'web scraper must use manual redirects');
assert(img.includes("redirect: 'manual'"), 'image proxy must use manual redirects');
assert(!web.includes("redirect: 'follow'"), 'web scraper must not auto-follow redirects');
assert(web.includes('validatePublicUrl(nextUrl)'), 'web redirects must be revalidated');
assert(img.includes('validatePublicImageUrl(nextUrl)'), 'image redirects must be revalidated');

const usage = read('api/_lib/usage.js');
const sql = read('supabase/phase7_1_must_fix.sql');
assert(usage.includes("rpc('consume_usage_quota'"), 'JS usage must consume quota through atomic RPC');
assert(pyAuth.includes('/rest/v1/rpc/consume_usage_quota'), 'Python usage must consume quota through atomic RPC');
assert(sql.includes('pg_advisory_xact_lock'), 'quota RPC must use advisory xact lock');

const claude = read('api/claude.js');
assert(claude.includes('sanitizeClaudeRequest'), 'Claude proxy must sanitize payload');
assert(claude.includes('SMARTQUOTE_ALLOWED_CLAUDE_MODELS'), 'Claude proxy must whitelist models');
assert(claude.includes('SMARTQUOTE_MAX_CLAUDE_OUTPUT_TOKENS'), 'Claude proxy must clamp output tokens');

const smart = read('src/SmartQuote.jsx');
assert(smart.includes('assertSmartQuoteUploadFile'), 'SmartQuote should guard uploads before parsing');
assert(smart.includes('mode: "merge"'), 'catalog autosave should use merge mode to reduce cross-tab deletes');
assert(smart.includes('deleteCloudCatalogItems'), 'explicit deletes should delete cloud items directly');

console.log('✓ Phase 7.1 production must-fix smoke passed');
