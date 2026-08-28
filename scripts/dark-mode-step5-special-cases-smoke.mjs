import fs from 'node:fs';

const file = fs.readFileSync(new URL('../src/SmartQuote.jsx', import.meta.url), 'utf8');
const marker = 'const CSS = `';
const start = file.indexOf(marker);
if (start < 0) throw new Error('const CSS block not found');
const cssStart = start + marker.length;
const cssEnd = file.indexOf('`;', cssStart);
if (cssEnd < 0) throw new Error('const CSS closing delimiter not found');
const css = file.slice(cssStart, cssEnd);

const required = [
  ':root[data-theme="dark"] .ci-overlay,',
  ':root[data-theme="dark"] .modal-backdrop,',
  ':root[data-theme="dark"] .pp-modal-bg,',
  ':root[data-theme="dark"] .sq-confirm-backdrop{background:rgba(0,0,0,.6);}',
  ':root[data-theme="dark"] .ci-preview-table th{background:var(--primary-d);color:#fff;}',
  ':root[data-theme="dark"] .ci-preview-table-clean th{background:var(--green-bg);color:var(--green);border-bottom-color:var(--line);}',
  ':root[data-theme="dark"] .line-table th,',
  ':root[data-theme="dark"] .bom-preview-table th{background:var(--green-bg);color:var(--green);}',
  'input,select,textarea{color:var(--ink);background-color:var(--card);}',
  'input::placeholder,textarea::placeholder{color:var(--faint);opacity:1;}',
  'select option{background:var(--card);color:var(--ink);}',
  'input[type="checkbox"],input[type="radio"]{accent-color:var(--primary);}',
  ':root[data-theme="dark"] input:-webkit-autofill,',
  '.ci-row-blocking td{background:var(--red-bg);}',
  '.ci-row-review td{background:var(--amber-bg);}',
  '.ci-summary-pills .ok,.ci-status.ok{background:var(--green-bg);color:var(--green);}',
  '.app-shell .brand-mark{width:28px;height:28px;border-radius:8px;background:linear-gradient(135deg,var(--primary),var(--primary-d));',
];
for (const token of required) {
  if (!css.includes(token)) throw new Error(`Step 5 required special-case rule missing: ${token}`);
}

// Shadow audit: rgba shadows belong only in the design-token definitions. UI components
// must consume --sh-1/--sh-2, primary-ring, or semantic tokens so dark mode can adapt.
const lines = css.split('\n');
const badShadows = [];
for (let i = 0; i < lines.length; i += 1) {
  const line = lines[i];
  if (!/box-shadow\s*:[^;]*rgba\(/i.test(line)) continue;
  if (/--sh-[12]\s*:/.test(line)) continue;
  badShadows.push({ line: i + 1, text: line.trim() });
}
if (badShadows.length) throw new Error(`Hard-coded rgba component shadows remain: ${JSON.stringify(badShadows.slice(0, 10))}`);

for (const expected of [
  'box-shadow:var(--sh-1)',
  'box-shadow:var(--sh-2)',
  'box-shadow:0 0 0 3px var(--primary-ring)',
]) {
  if (!css.includes(expected)) throw new Error(`Theme-aware shadow token not found: ${expected}`);
}

// Keep white labels on primary controls readable in dark mode by using --primary-d.
for (const expected of [
  ':root[data-theme="dark"] .btn-primary,',
  ':root[data-theme="dark"] .ci-primary-action.warn{background:var(--amber-bg);color:var(--amber);border:1px solid var(--amber-line);}',
  ':root[data-theme="dark"] .ci-primary-action.danger{background:var(--red-bg);color:var(--red);border:1px solid var(--line);}',
  ':root[data-theme="dark"] .usage-mini .up{background:var(--primary-d);color:#fff;}',
  ':root[data-theme="dark"] .avatar{background:var(--green-bg);color:var(--green);border:1px solid var(--line);}',
  ':root[data-theme="dark"] .sq-confirm-primary.danger{background:var(--red-bg);color:var(--red);border:1px solid var(--line);}',
]) {
  if (!css.includes(expected)) throw new Error(`Dark action contrast rule missing: ${expected}`);
}

function luminance(hex) {
  const h = hex.replace('#', '');
  const rgb = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((c) => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}
function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
const checks = [
  ['dark primary table header / white', '#4359D8', '#FFFFFF'],
  ['dark clean table header', '#34D399', '#0E2A20'],
  ['dark warning semantic pair', '#F0C674', '#2A2410'],
  ['dark error semantic pair', '#F87171', '#2C1618'],
  ['dark success semantic pair', '#34D399', '#0E2A20'],
];
for (const [label, fg, bg] of checks) {
  const ratio = contrast(fg, bg);
  if (ratio < 4.5) throw new Error(`${label} contrast ${ratio.toFixed(2)} < 4.5`);
}

let depth = 0;
for (const ch of css) {
  if (ch === '{') depth += 1;
  else if (ch === '}') depth -= 1;
  if (depth < 0) throw new Error('CSS braces close before they open');
}
if (depth !== 0) throw new Error(`CSS brace imbalance: ${depth}`);

console.log('✓ Dark Mode Step 5 special-case review smoke passed');
