import fs from 'node:fs';

const file = fs.readFileSync(new URL('../src/SmartQuote.jsx', import.meta.url), 'utf8');
const marker = 'const CSS = `';
const start = file.indexOf(marker);
if (start < 0) throw new Error('const CSS block not found');
const cssStart = start + marker.length;
const cssEnd = file.indexOf('`;', cssStart);
if (cssEnd < 0) throw new Error('const CSS closing delimiter not found');
const css = file.slice(cssStart, cssEnd);

function rootSpans(text) {
  const spans = [];
  const re = /:root(?:\[data-theme="dark"\])?\s*\{/g;
  let m;
  while ((m = re.exec(text))) {
    let i = re.lastIndex;
    let depth = 1;
    while (i < text.length && depth) {
      if (text[i] === '{') depth += 1;
      else if (text[i] === '}') depth -= 1;
      i += 1;
    }
    if (depth !== 0) throw new Error('Unbalanced :root block');
    spans.push([m.index, i]);
  }
  return spans;
}

const roots = rootSpans(css);
const inRoot = (idx) => roots.some(([a, b]) => idx >= a && idx < b);
const hexRe = /#[0-9A-Fa-f]{3,8}\b/g;
const disallowed = [];
let m;
while ((m = hexRe.exec(css))) {
  if (inRoot(m.index)) continue;
  const declStart = Math.max(css.lastIndexOf(';', m.index), css.lastIndexOf('{', m.index)) + 1;
  const declEndRaw = css.indexOf(';', m.index);
  const declEnd = declEndRaw < 0 ? css.length : declEndRaw;
  const decl = css.slice(declStart, declEnd).trim();
  const allowedPrimaryForeground = /^color\s*:\s*#fff(?:fff)?\s*!?important?$/i.test(decl) || /^color\s*:\s*#fff(?:fff)?$/i.test(decl);
  if (!allowedPrimaryForeground) disallowed.push({ hex: m[0], decl });
}
if (disallowed.length) {
  throw new Error(`Disallowed hard-coded CSS hex values remain: ${JSON.stringify(disallowed.slice(0, 12))}`);
}

if (/background(?:-color)?\s*:\s*rgba\(\s*(?:255\s*,\s*255\s*,\s*255|246\s*,\s*247\s*,\s*249)/i.test(css)) {
  throw new Error('Light hard-coded rgba surface remains in CSS');
}

for (const required of [
  'background:var(--card)',
  'background:var(--green-bg)',
  'background:var(--amber-bg)',
  'background:var(--red-bg)',
  'background:var(--primary-soft)',
  'color:var(--muted)',
  'color:var(--ink)',
]) {
  if (!css.includes(required)) throw new Error(`Expected tokenized CSS missing: ${required}`);
}

for (const legacy of [
  'var(--c-text,#1a2233)', 'var(--c-bg,#f7f8fb)', 'var(--c-ok,#1a9e6a)',
  'var(--c-warn,#c98a00)', 'var(--c-warn-line,#f0c000)', 'var(--c-warn-bg,#fff8e6)',
  'var(--c-primary-dark,#143AA6)', 'var(--c-primary-soft,#EEF4FF)'
]) {
  if (css.includes(legacy)) throw new Error(`Legacy literal fallback remains: ${legacy}`);
}

// This smoke test owns only the const CSS block. JSX inline-style migration is validated by Step 4.

let depth = 0;
for (const ch of css) {
  if (ch === '{') depth += 1;
  else if (ch === '}') depth -= 1;
  if (depth < 0) throw new Error('CSS braces close before they open');
}
if (depth !== 0) throw new Error(`CSS brace imbalance: ${depth}`);

console.log('✓ Dark Mode Step 3 CSS hard-code → token migration smoke passed');
