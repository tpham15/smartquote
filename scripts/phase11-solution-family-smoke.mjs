import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const smartQuotePath = path.join(root, 'src', 'SmartQuote.jsx');
const pkgPath = path.join(root, 'package.json');
const src = fs.readFileSync(smartQuotePath, 'utf8');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

const mustContain = [
  'Phase 11 — Solution Family / Brand Option Engine',
  'SOLUTION_CATEGORY_KEYS',
  'buildSeedSolutionFamilies',
  'normalizeSolutionFamilies',
  'resolveSolutionFamily',
  'makeSolutionFamilyRoom',
  '{ key: "solution_families", label: "Bộ giải pháp" }',
  '<SolutionFamilies products={products} solutionFamilies={solutionFamilies} setSolutionFamilies={setSolutionFamilies} />',
  'solutionFamilies={solutionFamilies}',
  '⚡ Tạo từ bộ giải pháp',
  'SolutionFamilyApplyModal',
  'Bộ Lumi Villa',
  'Bộ Erfinden Villa',
  'Bộ Schneider Villa',
  'Phương án Tiết kiệm',
  'Phương án Cao cấp',
  'solution-table',
];

for (const token of mustContain) {
  if (!src.includes(token)) throw new Error(`Missing Phase 11 token: ${token}`);
}

if (!pkg.scripts?.['smoke:phase11']) throw new Error('Missing npm script smoke:phase11');
if (/sessionStorage\.setItem|sessionStorage\.getItem/.test(src)) throw new Error('Phase 11 must not add sessionStorage usage');

const importEngineFiles = fs.readdirSync(path.join(root, 'src', 'import-engine'), { recursive: true });
if (!importEngineFiles.length) throw new Error('import-engine folder missing');

console.log('Phase 11 solution family smoke: PASS');
