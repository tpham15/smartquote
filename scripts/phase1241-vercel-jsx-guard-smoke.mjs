import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = path.join(root, 'src');
const jsxTagPattern = /(^|[=(>,:]\s*)<[A-Za-z][A-Za-z0-9.:-]*(?:\s|>|\/)/m;
const offenders = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.isFile() && entry.name.endsWith('.js')) {
      const source = fs.readFileSync(full, 'utf8');
      if (jsxTagPattern.test(source)) offenders.push(path.relative(root, full));
    }
  }
}

walk(srcDir);
assert.deepEqual(offenders, [], `JSX must use .jsx/.tsx extensions for Vite import analysis: ${offenders.join(', ')}`);
assert.ok(fs.existsSync(path.join(srcDir, 'ui', 'interaction.jsx')), 'interaction host must remain a .jsx module');

const app = fs.readFileSync(path.join(srcDir, 'SmartQuote.jsx'), 'utf8');
assert.match(app, /from\s+["']\.\/ui\/interaction\.jsx["']/, 'SmartQuote must import the JSX interaction module by its .jsx extension');

console.log('Phase 12.4.1 Vercel JSX build guard: PASS');
