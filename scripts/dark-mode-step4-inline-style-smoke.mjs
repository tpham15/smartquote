import fs from 'node:fs';

const file = fs.readFileSync(new URL('../src/SmartQuote.jsx', import.meta.url), 'utf8');
const cssMarker = 'const CSS = `';
const cssAt = file.indexOf(cssMarker);
if (cssAt < 0) throw new Error('const CSS block not found');
const jsx = file.slice(0, cssAt);

// Inline JSX style objects in this codebase use style={{ ... }}. Keep this scan scoped
// to JSX so printable/export HTML strings and Excel/PDF colors are not treated as UI.
const styleRe = /style\s*=\s*\{\{([\s\S]*?)\}\}/g;
const styleObjects = [];
let m;
while ((m = styleRe.exec(jsx))) styleObjects.push(m[1]);
if (styleObjects.length < 100) {
  throw new Error(`Unexpectedly low inline-style count (${styleObjects.length}); scanner may be broken`);
}

const literalColorRe = /#[0-9A-Fa-f]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/g;
const offenders = [];
for (const objectText of styleObjects) {
  const colors = objectText.match(literalColorRe);
  if (colors) offenders.push({ colors, style: objectText.trim().replace(/\s+/g, ' ').slice(0, 260) });
}
if (offenders.length) {
  throw new Error(`Hard-coded color literals remain in JSX inline styles: ${JSON.stringify(offenders.slice(0, 12))}`);
}

for (const expected of [
  'style={{ fontSize: 11, color: "var(--muted)" }}',
  'color: "var(--faint)"',
  'background: "var(--surface2)"',
  'background: "var(--card)"',
]) {
  if (!jsx.includes(expected)) throw new Error(`Expected Step 4 tokenized inline style missing: ${expected}`);
}

// Scope guard: brand defaults and printable/export document colors are intentional,
// are not app-theme UI, and must remain unchanged by Step 4.
for (const preserved of [
  'cfg.brand?.primaryColor || "#1A7A4A"',
  'cfg.brand?.accentColor || "#D1FAE5"',
  'const primary = template.brand?.primaryColor || "#1A7A4A";',
  'const accent = template.brand?.accentColor || "#D1FAE5";',
  'body{font-family:${esc(font)},Arial,sans-serif;color:#1a1a1a;',
]) {
  if (!jsx.includes(preserved)) throw new Error(`Step 4 scope guard failed; non-UI/export color changed: ${preserved}`);
}

console.log(`✓ Dark Mode Step 4 inline JSX style migration smoke passed (${styleObjects.length} inline style objects scanned)`);
