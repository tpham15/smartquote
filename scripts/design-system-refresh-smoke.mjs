import fs from 'node:fs';

const jsx = fs.readFileSync('src/SmartQuote.jsx', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const fail = (msg) => { console.error(`Design system smoke failed: ${msg}`); process.exit(1); };
const must = (cond, msg) => { if (!cond) fail(msg); };

must(html.includes('Be+Vietnam+Pro'), 'index.html must load Be Vietnam Pro');
must(jsx.includes('--primary:#2947E0'), 'new primary token missing');
must(jsx.includes('--c-primary:var(--primary)'), 'legacy c-primary alias missing');
must(jsx.includes('className="app app-shell"'), 'app shell wrapper missing');
must(jsx.includes('className="rail"'), 'left sidebar rail missing');
must(jsx.includes('className="main shell-main"'), 'main shell missing');
must(jsx.includes('className="content smartquote-content"'), 'content wrapper missing');
must(jsx.includes('SidebarUsageMini'), 'sidebar usage mini component missing');
must(jsx.includes('grid-template-columns:236px minmax(0,1fr)'), 'desktop sidebar grid missing');
must(jsx.includes('grid-template-columns:64px minmax(0,1fr)'), 'responsive compact sidebar missing');
must(jsx.includes('font-variant-numeric:tabular-nums'), 'tabular numbers rule missing');
must(jsx.includes('className="s-total num"'), 'signature quote total missing');
must(jsx.includes('className="s-margin"'), 'gross margin chip missing');
must(jsx.includes('position:sticky;top:84px'), 'sticky quote summary missing');
must(jsx.includes('var(--amber-bg)'), 'amber warning token usage missing');
must(!jsx.includes('sessionStorage'), 'new sessionStorage usage should not exist');

pkg.scripts ||= {};
must(pkg.scripts['smoke:design-system'] === 'node scripts/design-system-refresh-smoke.mjs', 'package script smoke:design-system missing');
console.log('Design system refresh smoke: PASS');
