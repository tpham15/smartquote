import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = process.cwd();
const onboarding = fs.readFileSync(path.join(root, 'src/ui/IndustryOnboarding.jsx'), 'utf8');
const rootSql = fs.readFileSync(path.join(root, '01_RUN_ON_SUPABASE.sql'), 'utf8');

assert.match(onboarding, /onClick=\{\(\) => submit\(\)\}/, 'CTA must call submit() explicitly so React click event is not treated as businessTypeOverride');
assert.doesNotMatch(onboarding, /onClick=\{submit\}>\{busy \? "Đang lưu\.\.\." : "Vào SmartQuote →"\}/, 'stale direct onClick={submit} must be gone');

const orderedMarkers = [
  '-- 1. PILOT SECURITY FIX',
  '-- 2. P1.5 industry profiles',
  '-- 3. P1.5.2 CATALOG IMAGE OVERRIDES',
  '-- 4. P1.5.3 RELEASE HARDENING',
  '-- 5. FINAL VERIFICATION',
];
let last = -1;
for (const marker of orderedMarkers) {
  const idx = rootSql.indexOf(marker);
  assert.ok(idx > last, `master SQL missing/out-of-order marker: ${marker}`);
  last = idx;
}

assert.match(rootSql, /industry_column_was_present/, 'master SQL must preserve NULL onboarding tenants on re-run');
assert.match(rootSql, /catalog-product-images/, 'master SQL must include P1.5.2 Storage migration');
assert.match(rootSql, /revoke all on function public\.smartquote_increment_rate_limit[^;]+ from authenticated;/s, 'master SQL must harden rate-limit RPC');
assert.match(rootSql, /authenticated_industry_update_should_be_true/, 'master verification must cover industry privileges');
assert.match(rootSql, /catalog_image_bucket_should_be_true/, 'master verification must cover image Storage');
assert.match(rootSql, /service_role_consume_quota_should_be_true/, 'master verification must cover server-only quota RPC');

console.log('✓ Pilot P1.5.3.1 finalization smoke PASS');
console.log('  - onboarding CTA no longer receives React click event as business type');
console.log('  - one re-run-safe Supabase master SQL covers all four required migrations');
console.log('  - final verification covers billing, industry, image storage and server-only RPCs');
