import fs from 'node:fs';

const gate = fs.readFileSync(new URL('../src/supabase/SupabaseAuthGate.jsx', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function assert(cond, msg) { if (!cond) throw new Error(msg); }
function must(text, needle, label) { assert(text.includes(needle), `Missing ${label}: ${needle}`); }

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
}
function luminance(hex) {
  const [r, g, b] = hexToRgb(hex).map((c) => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// Auth behavior must still be present.
for (const needle of [
  'signInDealer({ email, password })',
  'signUpDealer({ email, password, dealerName, fullName })',
  'requestPasswordReset(cleanedEmail, passwordResetRedirectUrl())',
  'updateCurrentUserPassword(password)',
  'PASSWORD_RECOVERY',
  'mode === "register"',
  'mode === "forgot"',
  'mode === "update_password"',
]) must(gate, needle, 'auth behavior');

// Product-facing copy should no longer expose infrastructure / prototype language.
must(gate, 'Đăng nhập SmartQuote', 'login title');
must(gate, 'Quản lý báo giá, sản phẩm và workspace của bạn.', 'login description');
must(gate, 'Tạo workspace SmartQuote', 'register title');
must(gate, 'Chưa có tài khoản? Tạo workspace', 'register link');
assert(!gate.includes('SmartQuote Cloud";'), 'legacy SmartQuote Cloud auth title remains');
assert(!gate.includes('sẽ đồng bộ lên Supabase'), 'Supabase implementation detail remains in auth copy');
assert(!gate.includes('📦'), 'prototype package emoji remains');
assert(!gate.includes('Tạo đại lý mới'), 'legacy create dealer wording remains');

// Brand identity must match the app shell.
must(gate, 'className="sq-auth-brand-mark"', 'SmartQuote brand mark');
must(gate, 'M4 13l5 5L20 6', 'SmartQuote check path');
must(gate, 'Smart<span>Quote</span>', 'SmartQuote wordmark');

// Auth surfaces must use the same light/dark token family as the main app.
for (const needle of [
  ':root{',
  '--ink:#16181D',
  '--canvas:#F6F7F9',
  '--card:#FFFFFF',
  '--primary:#2947E0',
  ':root[data-theme="dark"]{',
  '--canvas:#0E1116',
  '--card:#171A21',
  '--ink:#E6E8EC',
  '--primary:#6A83F5',
  '.sq-auth-card{',
  'background:var(--card)',
  '.sq-auth-card input{',
  'background:var(--surface2);color:var(--ink)',
  '.sq-auth-card input::placeholder{color:var(--faint)',
  'border-color:var(--brand);background:var(--card);box-shadow:0 0 0 3px var(--primary-ring)',
  '.sq-auth-card button[type="submit"]{',
  'background:var(--primary-d);color:#fff',
  '.sq-auth-link{',
  'color:var(--brand)',
  '@media(max-width:640px)',
]) must(gate, needle, 'auth design system');

// Old green auth theme / hard-coded white panel must not remain.
for (const legacy of ['#148457', '#12664a', '#10b981', 'background:white', '#ecfdf5']) {
  assert(!gate.toLowerCase().includes(legacy.toLowerCase()), `Legacy auth color remains: ${legacy}`);
}


// Key auth text/background pairs meet WCAG AA for normal text in both themes.
for (const [label, fg, bg] of [
  ['light muted/card', '#6B7280', '#FFFFFF'],
  ['light primary/card', '#2947E0', '#FFFFFF'],
  ['light white/primary-d', '#FFFFFF', '#1E37B8'],
  ['light notice ink-2/amber-bg', '#3A3F49', '#FDF6E7'],
  ['dark muted/card', '#8A90A0', '#171A21'],
  ['dark primary/card', '#6A83F5', '#171A21'],
  ['dark white/primary-d', '#FFFFFF', '#4359D8'],
  ['dark notice ink-2/amber-bg', '#B4B9C4', '#2A2410'],
]) {
  const ratio = contrast(fg, bg);
  assert(ratio >= 4.5, `${label} contrast ${ratio.toFixed(2)} < 4.5`);
}
must(gate, '.sq-auth-notice{background:var(--amber-bg);color:var(--ink-2);', 'AA warning notice text');

// Theme is still initialized before React so auth does not flash the wrong scheme.
assert(html.indexOf("localStorage.getItem('sq_theme')") >= 0, 'theme boot lookup missing');
assert(html.indexOf("localStorage.getItem('sq_theme')") < html.indexOf('/src/main.jsx'), 'theme boot must run before React');

console.log('✓ Phase 12.6.1 Auth UI Unification smoke passed');
