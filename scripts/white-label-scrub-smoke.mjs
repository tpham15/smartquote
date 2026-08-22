#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const smartQuote = fs.readFileSync(path.join(root, 'src', 'SmartQuote.jsx'), 'utf8');
const excelBuilder = fs.readFileSync(path.join(root, 'api', 'excel_builder.py'), 'utf8');
const normalizer = fs.readFileSync(path.join(root, 'src', 'import-engine', 'normalizeWorkbook.js'), 'utf8');

// New workspaces must start from neutral pricing, not from any reference dealer's rules.
if (!/laborPercent\s*:\s*0\b/.test(smartQuote)) throw new Error('Neutral labor default missing');
if (!/label:\s*"Mặc định",\s*value:\s*1\b/.test(smartQuote)) throw new Error('Neutral default markup missing');
if (/costPrice\s*\*\s*1\.\d+\b/.test(smartQuote)) throw new Error('Hard-coded catalog markup detected');
if (/onSetFactor\?\.\(1\.\d+\)/.test(smartQuote)) throw new Error('Hard-coded line-factor shortcut detected');
if (!/previewFactors\.map\(\(factor\)/.test(smartQuote)) throw new Error('Catalog preview must use dealer-configured factors');
if (!/templateFactor = Number\(markups\?\.\[0\]\?\.value\)/.test(smartQuote)) throw new Error('Template totals must use dealer-configured markup');

// All bundled examples must be synthetic/generic.
if (!smartQuote.includes('Báo giá khách hàng mẫu.xlsx')) throw new Error('Generic old-quote example missing');
if (!smartQuote.includes('Báo giá căn hộ mẫu.xlsx')) throw new Error('Generic apartment-quote example missing');
if (!excelBuilder.includes('CÔNG TY DEMO') || !excelBuilder.includes('KHÁCH HÀNG MẪU')) throw new Error('Excel builder fixture must stay synthetic');
if (!excelBuilder.includes('"laborPercent": 0')) throw new Error('Excel builder fixture must use neutral labor');

// Filename supplier detection may special-case public product brands, but must not contain a private dealer branch.
const supplierBranches = [...normalizer.matchAll(/if \(\/([^/]+)\/\.test\(ascii\)\) return "([^"]+)";/g)].map((m) => m[2]);
const publicBrandAllowlist = new Set(['Lumi', 'Philips', 'Kaadas', 'Hexa']);
for (const supplier of supplierBranches) {
  if (!publicBrandAllowlist.has(supplier)) throw new Error(`Unexpected private supplier filename heuristic: ${supplier}`);
}

console.log('✓ White-label scrub smoke passed — neutral defaults and synthetic fixtures verified.');
