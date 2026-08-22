import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseCsvEnv, isOriginAllowed, resolveCorsOrigin, bodySizeBytes, redact } from '../api/_lib/security.js';
import { getPerMinuteLimit, minuteWindowStartIso, assertMemoryIpRateLimit } from '../api/_lib/rateLimit.js';

assert.deepEqual(parseCsvEnv('https://a.com, https://b.com ,'), ['https://a.com', 'https://b.com']);
process.env.SMARTQUOTE_ALLOWED_ORIGIN = 'https://app.smartquote.vn,https://admin.smartquote.vn';
assert.equal(isOriginAllowed('https://app.smartquote.vn'), true);
assert.equal(isOriginAllowed('https://evil.example'), false);
assert.equal(resolveCorsOrigin({ headers: { origin: 'https://admin.smartquote.vn' } }), 'https://admin.smartquote.vn');
assert.equal(resolveCorsOrigin({ headers: { origin: 'https://evil.example' } }), '');
process.env.SMARTQUOTE_ALLOWED_ORIGIN = '*';
assert.equal(resolveCorsOrigin({ headers: { origin: 'https://anything.example' } }), '*');

assert.equal(bodySizeBytes({ a: '123' }), Buffer.byteLength(JSON.stringify({ a: '123' })));
assert.equal(redact({ Authorization: 'Bearer secret-token', nested: { apiKey: 'abc' } }).Authorization, '[redacted]');
assert.equal(getPerMinuteLimit('trial', 'web_scrape'), 2);
assert.equal(getPerMinuteLimit('starter', 'excel_export'), 10);
assert.equal(getPerMinuteLimit('business', 'ai_claude_request'), 120);
assert.match(minuteWindowStartIso(new Date('2026-06-29T19:12:59+07:00')), /^2026-06-29T12:12:00\.000Z$/);

const req = { headers: { 'x-forwarded-for': '203.0.113.10' } };
assertMemoryIpRateLimit(req, { keyPrefix: 'smoke', limit: 2, windowMs: 60_000 });
assertMemoryIpRateLimit(req, { keyPrefix: 'smoke', limit: 2, windowMs: 60_000 });
assert.throws(() => assertMemoryIpRateLimit(req, { keyPrefix: 'smoke', limit: 2, windowMs: 60_000 }), /thao tác quá nhanh/);

const sql = readFileSync(new URL('../supabase/phase7_hardening.sql', import.meta.url), 'utf8');
assert.match(sql, /create table if not exists public\.api_rate_limits/i);
assert.match(sql, /smartquote_increment_rate_limit/i);
assert.match(sql, /create table if not exists public\.api_logs/i);
assert.match(sql, /admin_prune_api_logs/i);

const vercel = readFileSync(new URL('../vercel.json', import.meta.url), 'utf8');
assert.match(vercel, /frame-ancestors 'none'/);
assert.match(vercel, /Strict-Transport-Security/);
assert.match(vercel, /X-Content-Type-Options/);

console.log('✓ hardening smoke passed');
