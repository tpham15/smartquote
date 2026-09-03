import fs from 'node:fs';
import vm from 'node:vm';

function assert(cond, msg) { if (!cond) throw new Error(msg); }

const ui = fs.readFileSync(new URL('../src/SmartQuote.jsx', import.meta.url), 'utf8');
const store = fs.readFileSync(new URL('../src/supabase/billingStore.js', import.meta.url), 'utf8');
const sql = fs.readFileSync(new URL('../supabase/phase12_6_bank_transfer_checkout.sql', import.meta.url), 'utf8');
const env = fs.readFileSync(new URL('../.env.example', import.meta.url), 'utf8');

// Evaluate the real QR builder without loading Supabase dependencies.
const strippedStore = store
  .replace(/^import .*$/gm, '')
  .replace(/^export \{[^\n]+\};?$/gm, '')
  .replace(/\bexport\s+(?=(?:async\s+)?function|const|let|var)/g, '');
const sandbox = { URLSearchParams };
vm.runInNewContext(`${strippedStore}\nthis.__buildVietQrUrl = buildVietQrUrl;`, sandbox);
const buildVietQrUrl = sandbox.__buildVietQrUrl;
assert(typeof buildVietQrUrl === 'function', 'QR builder not exported');

const qr = buildVietQrUrl({
  bankId: '970422', accountNo: '123456789', amount: 899000,
  addInfo: 'SQABC12345PROTHANG', accountName: 'PHAM VAN A', template: 'compact2',
});
assert(qr.startsWith('https://img.vietqr.io/image/970422-123456789-compact2.png?'), 'unexpected VietQR quick-link path');
const parsed = new URL(qr);
assert(parsed.searchParams.get('amount') === '899000', 'QR amount missing');
assert(parsed.searchParams.get('addInfo') === 'SQABC12345PROTHANG', 'QR transfer content missing');
assert(parsed.searchParams.get('accountName') === 'PHAM VAN A', 'QR account owner missing');
assert(buildVietQrUrl({ bankId: '', accountNo: '123' }) === '', 'QR must fail closed without bank id');
assert(buildVietQrUrl({ bankId: '970422<script>', accountNo: '123456' }) === '', 'invalid bank id must fail closed');
assert(buildVietQrUrl({ bankId: '970422', accountNo: '12-34' }) === '', 'invalid account number must fail closed');
assert(buildVietQrUrl({ bankId: '970422', accountNo: '123456', template: 'evil' }).includes('-compact2.png'), 'QR template allowlist missing');

// UI checkout: amount/content must come from the created billing event.
for (const needle of [
  'VITE_SQ_PAYMENT_BANK_ID', 'VITE_SQ_PAYMENT_QR_TEMPLATE', 'buildVietQrUrl({',
  'amount: checkoutRequest.amount_vnd', 'addInfo: qrTransferContent',
  'Mở QR thanh toán', 'Tôi đã chuyển khoản', 'Sao chép', 'markManualBillingPaid',
  'SmartQuote chỉ ghi nhận thông báo của bạn ở bước này', 'qrIncludesTransferContent',
]) assert(ui.includes(needle), `UI checkout missing: ${needle}`);
assert(!/VITE_SQ_PAYMENT_ACCOUNT\s*\|\|\s*["'][0-9]{6,}/.test(ui), 'bank account must not be hard-coded in source');

// SQL security and state transition.
for (const re of [
  /create or replace function public\.mark_manual_billing_event_paid\s*\(/i,
  /auth\.uid\(\)/i,
  /public\.is_dealer_member\(target_dealer_id\)/i,
  /be\.dealer_id\s*=\s*target_dealer_id/i,
  /current_status\s*<>\s*'pending'/i,
  /set status\s*=\s*'paid'/i,
  /grant execute on function public\.mark_manual_billing_event_paid\(uuid, uuid\) to authenticated/i,
  /content\s*:=\s*'SQ'[\s\S]*upper\(normalized_plan\)[\s\S]*'THANG'/i,
]) assert(re.test(sql), `billing SQL requirement missing: ${re}`);
assert(!/content\s*:=\s*'SQ-'/i.test(sql), 'new transfer content should be VietQR-friendly alphanumeric');
assert(!/grant execute on function public\.admin_activate_manual_billing_event[^\n]*authenticated/i.test(sql), 'admin activation must not be exposed to browser users');

for (const needle of [
  'VITE_SQ_PAYMENT_BANK_ID=', 'VITE_SQ_PAYMENT_BANK=', 'VITE_SQ_PAYMENT_ACCOUNT=',
  'VITE_SQ_PAYMENT_OWNER=', 'VITE_SQ_PAYMENT_QR_TEMPLATE=compact2',
]) assert(env.includes(needle), `env example missing ${needle}`);

console.log('✓ Phase 12.6 bank-transfer checkout smoke passed');
console.log('  VietQR quick link, tenant-scoped paid declaration, env config, fallback and UI controls verified.');
