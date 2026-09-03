import fs from 'node:fs';
import vm from 'node:vm';

const src = fs.readFileSync(new URL('../src/SmartQuote.jsx', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function assert(cond, msg) { if (!cond) throw new Error(msg); }
function hexToRgb(hex){
  const h=hex.replace('#','');
  return [0,2,4].map(i=>parseInt(h.slice(i,i+2),16)/255);
}
function luminance(hex){
  const [r,g,b]=hexToRgb(hex).map(c=>c<=0.04045?c/12.92:((c+0.055)/1.055)**2.4);
  return 0.2126*r+0.7152*g+0.0722*b;
}
function contrast(a,b){
  const [x,y]=[luminance(a),luminance(b)].sort((m,n)=>n-m);
  return (x+0.05)/(y+0.05);
}
function token(name){
  const m=src.match(new RegExp(`:root\\[data-theme="dark"\\][\\s\\S]*?--${name}:([^;]+);`));
  assert(m, `missing dark token --${name}`);
  return m[1].trim();
}
function runBoot(saved, sysDark){
  const scriptMatch=html.match(/<script>\s*([\s\S]*?)<\/script>/);
  assert(scriptMatch, 'missing early theme init script');
  let applied=null;
  const sandbox={
    localStorage:{getItem:(k)=>k==='sq_theme'?saved:null},
    window:{matchMedia:()=>({matches:sysDark})},
    document:{documentElement:{setAttribute:(k,v)=>{if(k==='data-theme') applied=v;}}},
  };
  vm.runInNewContext(scriptMatch[1], sandbox);
  return applied;
}

// Reload / system preference behavior.
assert(runBoot('dark', false)==='dark', 'saved dark theme not restored');
assert(runBoot('light', true)==='light', 'saved light theme not restored');
assert(runBoot(null, true)==='dark', 'system dark preference not respected');
assert(runBoot(null, false)==='light', 'system light preference not respected');
assert(html.indexOf("localStorage.getItem('sq_theme')") < html.indexOf('/src/main.jsx'), 'theme init must run before React entry');
assert(html.includes('html[data-theme="dark"], html[data-theme="dark"] body { background: #0E1116;'), 'dark boot surface missing');

// Toggle + mobile access.
assert(src.includes('className="theme-toggle"'), 'theme toggle missing');
assert(src.includes('localStorage.setItem("sq_theme", theme)'), 'theme persistence hook missing');
assert(src.includes('@media(max-width:640px)'), 'mobile breakpoint missing');
assert(src.includes('.rail-footer-actions{margin:0 0 0 auto;flex-direction:row;gap:6px;}'), 'mobile theme action row missing');
assert(src.includes('.theme-toggle,.rail-logout{width:40px;height:40px;padding:0;justify-content:center;}'), 'compact mobile/tablet theme controls missing');

// Required screen inventory from spec.
for (const needle of ['label: "Báo giá"','label: "Danh mục"','label: "Nhập file"','label: "Mẫu & Gói"','label: "Cài đặt"']) {
  assert(src.includes(needle), `screen missing: ${needle}`);
}

// Core surfaces must be tokenized so dark mode cannot leave white panels.
for (const needle of [
  '.app-shell .rail{background:var(--rail)',
  '.app-shell>.main.shell-main{',
  'background:var(--canvas)',
  '.card{background:var(--card)',
  'input,select,textarea{color:var(--ink);background-color:var(--card);',
  ':root[data-theme="dark"] .ci-overlay,',
  ':root[data-theme="dark"] .line-table th,',
  ':root[data-theme="dark"] .bom-preview-table th',
]) assert(src.includes(needle), `required dark-aware surface missing: ${needle}`);

// No literal white UI backgrounds left inside CSS.
const cssMatch=src.match(/const CSS = `([\s\S]*?)`;\n/);
assert(cssMatch, 'CSS template not found');
const css=cssMatch[1];
assert(!/background(?:-color)?\s*:\s*(?:#fff(?:fff)?\b|white\b)/i.test(css), 'literal white CSS background remains');
assert(!/background(?:-color)?\s*:\s*rgba?\(\s*255\s*,\s*255\s*,\s*255/i.test(css), 'literal white rgba CSS background remains');

// Final AA contrast for all dark tokens used as actual text.
const dark={
  canvas:token('canvas'), card:token('card'), rail:token('rail'), surface2:token('surface2'),
  ink:token('ink'), ink2:token('ink-2'), muted:token('muted'), faint:token('faint'),
  primary:token('primary'), primaryD:token('primary-d'), primarySoft:token('primary-soft'),
  green:token('green'), greenBg:token('green-bg'), amber:token('amber'), amberBg:token('amber-bg'), red:token('red'), redBg:token('red-bg'),
};
const checks=[
  ['ink/card',dark.ink,dark.card], ['ink/canvas',dark.ink,dark.canvas], ['ink2/card',dark.ink2,dark.card],
  ['muted/card',dark.muted,dark.card], ['faint/card',dark.faint,dark.card], ['faint/surface2',dark.faint,dark.surface2],
  ['primary/card',dark.primary,dark.card], ['primary/surface2',dark.primary,dark.surface2], ['primary/primarySoft',dark.primary,dark.primarySoft],
  ['primary/rail',dark.primary,dark.rail], ['green/greenBg',dark.green,dark.greenBg], ['amber/amberBg',dark.amber,dark.amberBg], ['red/redBg',dark.red,dark.redBg],
  ['white/primaryD','#FFFFFF',dark.primaryD],
];
for (const [name,fg,bg] of checks){
  const ratio=contrast(fg,bg);
  assert(ratio>=4.5, `${name} contrast ${ratio.toFixed(2)} < 4.5`);
}

// primary-d may still be a fill, but text uses are explicitly promoted in dark mode.
for (const selector of [
  '.app-shell .nav button.active', '.app-shell .nav .sub-nav button.active', '.solution-card em',
  '.btn-solution-family', '.solution-family-pick em', '.excel-detect-summary b', '.plan-banner.trial .plan-banner-status'
]) {
  assert(css.includes(`:root[data-theme="dark"] ${selector}`), `AA text override missing for ${selector}`);
}

// Semantic preview rows and modal contrast.
assert(css.includes('background:rgba(0,0,0,.6)'), 'dark overlay opacity missing');
assert(css.includes('.import-warning-badge,.flag,.ci-status.warn{color:var(--amber);background:var(--amber-bg)'), 'warning semantic tokens missing');

console.log('✓ Dark Mode Step 6 QA smoke passed');
for (const [name,fg,bg] of checks) console.log(`  ${name}: ${contrast(fg,bg).toFixed(2)}:1`);
