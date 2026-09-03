import assert from "node:assert/strict";
import fs from "node:fs";

const index = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("../src/SmartQuote.jsx", import.meta.url), "utf8");

const initMatch = index.match(/<script>([\s\S]*?sq_theme[\s\S]*?)<\/script>/);
assert.ok(initMatch, "early theme init script block missing");
assert.doesNotThrow(() => new Function(initMatch[1]), "early theme init script must be valid JavaScript");

assert.match(index, /localStorage\.getItem\(['\"]sq_theme['\"]\)/, "early init must read sq_theme");
assert.match(index, /matchMedia\(['\"]\(prefers-color-scheme: dark\)['\"]\)/, "early init must honor system dark mode");
assert.match(index, /document\.documentElement\.setAttribute\(['\"]data-theme['\"], theme\)/, "early init must set data-theme");
assert.ok(index.indexOf("sq_theme") < index.indexOf('src="/src/main.jsx"'), "theme init must run before the React bundle");
assert.match(index, /html\[data-theme="dark"\][^}]*background:\s*#0E1116/i, "dark boot background must prevent a white flash");

assert.match(app, /const \[theme, setTheme\] = useState\(/, "root theme state missing");
assert.match(app, /localStorage\.setItem\("sq_theme", theme\)/, "theme preference must persist");
assert.match(app, /setAttribute\("data-theme", theme\)/, "React theme effect must update html data-theme");
assert.match(app, /const toggleTheme = \(\) => setTheme/, "theme toggle handler missing");
assert.match(app, /className="theme-toggle"/, "sidebar theme toggle missing");
assert.match(app, /aria-label=\{theme === "dark" \? "Chuyển sáng" : "Chuyển tối"\}/, "theme toggle aria label missing");
assert.match(app, /className="rail-footer-actions"/, "sidebar footer action group missing");
assert.match(app, /className="rail-logout"/, "cloud logout must live beside the theme toggle");
assert.doesNotMatch(app, /className="btn ghost cloud-logout"/, "old topbar logout should not remain duplicated");
assert.match(app, /\.theme-toggle,\.rail-logout\{[^}]*background:transparent[^}]*color:var\(--ink-2\)/, "theme toggle must use design tokens");
assert.match(app, /@media\(max-width:1080px\)[\s\S]*\.rail-action-label\{display:none;\}/, "compact sidebar must hide action labels");
assert.match(app, /@media\(max-width:640px\)[\s\S]*\.rail-footer-actions\{margin:0 0 0 auto;flex-direction:row/, "mobile footer actions must remain reachable");

console.log("✓ Dark Mode Step 2 theme init/state/toggle smoke passed");
