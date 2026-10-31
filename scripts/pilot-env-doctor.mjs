#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

let failed = false;
const ok = (s) => console.log(`✓ ${s}`);
const fail = (s) => { failed = true; console.error(`✗ ${s}`); };

const major = Number(process.versions.node.split('.')[0]);
major >= 20 ? ok(`Node ${process.version}`) : fail(`Node >=20 required, found ${process.version}`);

for (const dep of ['xlsx','vite','pdfjs-dist/legacy/build/pdf.mjs']) {
  try { await import(dep); ok(`npm dependency ${dep}`); }
  catch { fail(`npm dependency ${dep} missing/broken — run npm ci`); }
}

const py = spawnSync('python3', ['-c', 'import openpyxl; print(openpyxl.__version__)'], { encoding:'utf8' });
if (py.status === 0) ok(`Python openpyxl ${String(py.stdout).trim()}`);
else fail('Python openpyxl missing — create/activate venv then pip install openpyxl');

const bisco = process.argv[2] || process.env.SQ_BISCO_GOLDEN_XLSX || '';
const roger = process.argv[3] || process.env.SQ_ROGER_GOLDEN_PDF || '';
if (bisco && fs.existsSync(path.resolve(bisco))) ok(`Bisco golden file: ${path.resolve(bisco)}`);
else fail('Bisco golden XLSX path missing — pass it as argument or set SQ_BISCO_GOLDEN_XLSX');
if (roger && fs.existsSync(path.resolve(roger))) ok(`Roger golden file: ${path.resolve(roger)}`);
else fail('Roger golden PDF path missing — pass it as second file argument or set SQ_ROGER_GOLDEN_PDF');

if (failed) process.exit(2);
console.log('✓ Pilot environment doctor PASS');
