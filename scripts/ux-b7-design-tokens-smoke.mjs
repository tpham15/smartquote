import { readFileSync } from 'node:fs';

const src = readFileSync('src/SmartQuote.jsx', 'utf8');
const fail = (message) => {
  console.error(`UX B7 design tokens smoke: FAIL — ${message}`);
  process.exit(1);
};
const assertIncludes = (needle, label = needle) => {
  if (!src.includes(needle)) fail(`missing ${label}`);
};
const assertNotIncludes = (needle, label = needle) => {
  if (src.includes(needle)) fail(`still contains ${label}`);
};

// B7 has been superseded by the SaaS design-system token set, but the original rule remains:
// one token source, primary for main actions, secondary buttons as ghost/outline, and legacy aliases preserved.
const rootCount = (src.match(/:root\{/g) || []).length;
if (rootCount !== 1) fail(`expected exactly one :root token block, found ${rootCount}`);

assertIncludes('--f:"Be Vietnam Pro"', 'Vietnamese typography token');
assertIncludes('--fs-xs:11.5px;--fs-sm:13px;--fs-md:14px;--fs-lg:16px;--fs-xl:20px;--fs-2xl:26px;--fs-3xl:32px;', 'type-scale tokens');
assertIncludes('--sp-1:4px;--sp-2:8px;--sp-3:12px;--sp-4:16px;--sp-5:24px;--sp-6:32px;', 'spacing tokens');
assertIncludes('--r-sm:6px;--r-md:12px;--r-lg:14px;--r-btn:10px;--r-card:14px;--r-pill:999px;', 'radius tokens');
assertIncludes('--primary:#2947E0;', 'single SaaS primary action color');
assertIncludes('--amber:#B7791F;--amber-bg:#FDF6E7;--amber-line:#F2D999;', 'price-warning tokens');

// Legacy aliases keep older UI classes stable while pointing to the single design-system source.
assertIncludes('--c-primary:var(--primary);', 'legacy c-primary alias');
assertIncludes('--brand:var(--primary);', 'legacy brand alias');
assertIncludes('--bg:var(--canvas);', 'legacy background alias');
assertIncludes('--line:#E8EAED;', 'line token');
assertIncludes('--warn-bg:var(--amber-bg);', 'legacy warning alias');
assertIncludes('--radius:var(--r-md);--radius-lg:var(--r-card);', 'legacy radius alias');

// Core action buttons use the primary token; Excel remains secondary/ghost.
assertIncludes('.btn-primary{background:var(--c-primary);', 'primary button token');
assertIncludes('.btn-export-primary{width:100%;background:var(--c-primary);', 'quote export primary action token');
assertIncludes('.btn-export-primary:hover{background:var(--c-primary-dark);}', 'quote export hover token');
assertIncludes('.btn-excel{background:var(--surface);color:var(--c-text);border:1px solid var(--line2);', 'Excel secondary style');
assertNotIncludes('.btn-export-primary{width:100%;background:#DC2626', 'old red primary export');
assertNotIncludes('.btn-excel{background:#15803D', 'old green Excel primary');

// Typography cleanup: app/body use the design-system font, not the old system stack as the app font.
assertIncludes('html,body{margin:0;background:var(--canvas);color:var(--ink);font-family:var(--f);', 'body design-system font');
assertIncludes('.app{min-height:100vh;background:var(--canvas);color:var(--ink);font-family:var(--f);font-size:var(--fs-md);}', 'app design-system font');
assertIncludes('.card h2{margin:0 0 var(--sp-4);font-size:var(--fs-lg);font-weight:600;}', 'card heading token');
assertIncludes('.section-title{font-size:var(--fs-lg);font-weight:700;margin:0 0 var(--sp-4);}', 'section title token');

console.log('UX B7 design tokens smoke: PASS');
