import fs from 'node:fs';
import assert from 'node:assert/strict';

const source = fs.readFileSync(new URL('../src/SmartQuote.jsx', import.meta.url), 'utf8');
const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

assert.match(source, /className="crumb-primary"/, 'breadcrumb primary segment missing');
assert.match(source, /className="crumb-sep"[^>]*>\/<\/span>/, 'breadcrumb separator missing');
assert.match(source, /className="plan-banner-summary"/, 'plan banner summary wrapper missing');
assert.match(source, /className="plan-banner-status"/, 'plan status badge missing');
assert.match(source, /className="plan-banner-catalog"/, 'catalog quota spacing wrapper missing');
assert.match(source, /\.plan-banner-summary\{[^}]*gap:/, 'plan banner must use explicit gap');
assert.match(source, /\.topbar \.crumb\{[^}]*display:flex[^}]*gap:/, 'breadcrumb must use flex gap');
assert.match(source, /\.app-shell \.nav \.sub-nav button\{[^}]*width:100%[^}]*justify-content:flex-start[^}]*text-align:left/s, 'sub nav items must share one left axis');
assert.match(source, /\.um-row\{display:grid;grid-template-columns:minmax\(0,1fr\) auto/, 'usage rows must use stable label/value columns');
assert.match(source, /\.import-choice-grid\{[^}]*grid-auto-rows:1fr/, 'import cards must align to equal row height');
assert.match(source, /\.import-choice-card em\{[^}]*margin-top:auto/, 'import card CTA must align to card bottom');
assert.match(source, /Phase 12\.5\.6 — UI Spacing & Alignment Cleanup/, 'Phase 12.5.6 CSS marker missing');
assert.match(source, /planKey === \"business\"[\s\S]*?\? \"Xem gói\"/, 'Business sidebar CTA must not say upgrade to Pro');
assert.equal(pkg.scripts['smoke:phase12.5.6'], 'node scripts/phase1256-ui-spacing-alignment-smoke.mjs');

console.log('✓ Phase 12.5.6 UI spacing/alignment smoke passed');
