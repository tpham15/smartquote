#!/usr/bin/env node
// SmartQuote RC16.1 (P2.3.14.1) — Pilot Lock smoke.
//  1. PDF template memory is isolated per workspace (and the pre-RC16.1 global key is not shared).
//  2. No dealer data is written to browser storage outside the tenant namespace.
//  3. The RC16.1 SQL block is identical in the phase file, schema.sql and 01_RUN_ON_SUPABASE.sql,
//     and finalize_quote uses the same totals formula as src/quoteMath.js.
//  4. xlsx (SheetJS) is ≥ 0.20.3 — CVE-2023-30533 / CVE-2024-22363 fixed.
//  5. Smoke scripts resolve their own folder in a way that survives spaces in the path.
// The database behaviour itself is covered by scripts/pilot-p23141-rc161-db-acceptance.sql.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

class MemoryStorage {
  constructor() { this.map = new Map(); }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v) { this.map.set(k, String(v)); }
  removeItem(k) { this.map.delete(k); }
  clear() { this.map.clear(); }
  key(i) { return [...this.map.keys()][i] ?? null; }
  get length() { return this.map.size; }
}
globalThis.localStorage = new MemoryStorage();

// ---------- 1. PDF template memory isolation ----------
{
  const { setTenantStorageScope } = await import('../src/storage/tenantStorage.js');
  const { rememberPdfTemplate, getPdfTemplateHint } = await import('../src/import-engine/pdf/pdfTemplateMemory.js');
  const { PDF_DOCUMENT_IR_SCHEMA_VERSION } = await import('../src/import-engine/pdf/pdfDocumentFramework.js');
  const ir = {
    schemaVersion: PDF_DOCUMENT_IR_SCHEMA_VERSION,
    page: 1,
    tables: [{ rowModel: 'one_row_per_sku', headers: [{ role: 'sku' }, { role: 'name' }, { role: 'unit_price' }], sections: [{ title: 'Đèn', rows: [{ kind: 'product' }] }] }],
  };
  const doc = { supplierGuess: 'Rang Dong', fileName: 'Bang gia Rang Dong.pdf' };

  setTenantStorageScope('dealer-A');
  assert.ok(rememberPdfTemplate({ ...doc, pageIrs: [ir] }), 'workspace A remembers a PDF layout');
  assert.match(getPdfTemplateHint(doc), /Template memory/, 'workspace A reads its own hint');

  setTenantStorageScope('dealer-B');
  assert.equal(getPdfTemplateHint(doc), '', 'workspace B must NOT see workspace A\'s PDF hint (same browser)');

  setTenantStorageScope('dealer-A');
  assert.match(getPdfTemplateHint(doc), /Template memory/, 'switching back to A still finds A\'s hint');
  const keys = [...globalThis.localStorage.map.keys()];
  assert.ok(keys.includes('sq_dealer_dealer-A_pdf_template_memory_v1'), `stored in A's namespace (keys: ${keys.join(', ')})`);
  assert.ok(!keys.includes('smartquote_pdf_template_memory_v1'), 'no global key written');

  // A hint left in the pre-RC16.1 GLOBAL key by another workspace is neither shown nor kept.
  globalThis.localStorage.setItem('smartquote_pdf_template_memory_v1', JSON.stringify({ 'rang dong': [{ fingerprint: 'x', roles: ['leak'], rowModels: [], updatedAt: 1 }] }));
  setTenantStorageScope('dealer-C');
  assert.equal(getPdfTemplateHint(doc), '', 'signed-in workspace C ignores the legacy global hint');
  assert.equal(globalThis.localStorage.getItem('smartquote_pdf_template_memory_v1'), null, 'legacy global key removed');

  // Local single-user mode (no workspace): the legacy hint is migrated once into the local key.
  globalThis.localStorage.setItem('smartquote_pdf_template_memory_v1', JSON.stringify({ 'rang dong': [{ fingerprint: 'y', roles: ['sku'], rowModels: ['one_row_per_sku'], updatedAt: 1 }] }));
  setTenantStorageScope('');
  assert.match(getPdfTemplateHint(doc), /roles=sku/, 'local mode keeps its own legacy hint');
  assert.equal(globalThis.localStorage.getItem('smartquote_pdf_template_memory_v1'), null);
  assert.ok(globalThis.localStorage.getItem('sq_pdf_template_memory_v1'));
}

// ---------- 2. No dealer data outside the tenant namespace ----------
{
  const offenders = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!/\.(js|jsx|mjs)$/.test(entry.name)) continue;
      const rel = path.relative(root, full).split(path.sep).join('/');
      if (rel === 'src/storage/tenantStorage.js') continue;
      const lines = fs.readFileSync(full, 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (!/\b(localStorage|sessionStorage|indexedDB)\b/.test(line)) return;
        if (/^\s*(\/\/|\*)/.test(line)) return; // comments
        // Pure availability guards (no read/write) are fine.
        if (/typeof (localStorage|sessionStorage) === ["']undefined["']/.test(line) && !/\.(getItem|setItem|removeItem|clear)\(/.test(line)) return;
        // Allowed: SmartQuote.jsx local/cloud state helpers (cloud keys are sq_dealer_<id>_*),
        // the UI theme, and the one-time legacy cleanup in pdfTemplateMemory.js.
        if (rel === 'src/SmartQuote.jsx' && /legacyStorageKey|dealerScopedStorageKey|typeof localStorage === "undefined"|"sq_theme"|tenantStorage/.test(line)) return;
        if (rel === 'src/import-engine/pdf/pdfTemplateMemory.js' && /typeof localStorage === 'undefined' \? null : localStorage/.test(line)) return;
        offenders.push(`${rel}:${i + 1}: ${line.trim().slice(0, 120)}`);
      });
    }
  };
  walk(path.join(root, 'src'));
  assert.deepEqual(offenders, [], `direct browser storage outside tenantStorage:\n${offenders.join('\n')}`);
}

// ---------- 3. SQL block consistency + formula parity ----------
{
  const block = read('supabase/phase23_14_1_rc161_pilot_lock.sql').trim();
  assert.ok(read('supabase/schema.sql').includes(block), 'schema.sql contains the RC16.1 block verbatim');
  assert.ok(read('01_RUN_ON_SUPABASE.sql').includes(block), '01_RUN_ON_SUPABASE.sql contains the RC16.1 block verbatim');
  const quoteMath = read('src/quoteMath.js');
  assert.match(quoteMath, /const laborTotal = Math\.round\(\(goods \* laborRate\) \/ 100\);/);
  assert.match(quoteMath, /const vatTotal = Math\.round\(\(preTaxTotal \* vatRate\) \/ 100\);/);
  assert.match(block, /server_labor := round\(server_device \* labor_pct \/ 100\);/);
  assert.match(block, /server_vat := round\(server_pretax \* vat_pct \/ 100\);/);
  assert.match(block, /perform set_config\('smartquote\.allow_finalize','off',true\);/, 'finalize closes its own bypass window');
  for (const table of ['quotes', 'catalog_items', 'dealer_app_state', 'customers', 'imports', 'import_rows', 'quote_learning_observations', 'usage_events', 'billing_events']) {
    assert.match(block, new RegExp(`\\('${table}',`), `role guard declared for ${table}`);
  }
}

// ---------- 4. xlsx version ----------
{
  const require = createRequire(import.meta.url);
  // 0.20.x does not export ./package.json; read it next to the resolved entry point.
  const xlsxPkg = JSON.parse(fs.readFileSync(path.join(path.dirname(require.resolve('xlsx')), 'package.json'), 'utf8'));
  const XLSX = await import('xlsx');
  assert.equal(XLSX.version, xlsxPkg.version, 'runtime XLSX.version matches the installed package');
  const [major, minor, patch] = String(xlsxPkg.version).split('.').map(Number);
  const atLeast = (a, b, c) => major > a || (major === a && (minor > b || (minor === b && patch >= c)));
  assert.ok(atLeast(0, 20, 3), `xlsx ${xlsxPkg.version} is vulnerable (CVE-2023-30533 fixed in 0.19.3, CVE-2024-22363 fixed in 0.20.2); RC16.1 requires ≥ 0.20.3`);
  const declared = JSON.parse(read('package.json')).dependencies.xlsx;
  assert.match(declared, /cdn\.sheetjs\.com\/xlsx-0\.20\.3\/xlsx-0\.20\.3\.tgz/, `package.json must pin the official SheetJS 0.20.3 tarball (found ${declared})`);
  const lock = JSON.parse(read('package-lock.json'));
  const locked = lock.packages?.['node_modules/xlsx'];
  assert.equal(locked?.version, '0.20.3', 'package-lock pins xlsx 0.20.3');
  // Official SheetJS tarball SHA-512 (independently published by several projects and osv-scanner#3073).
  assert.equal(locked?.integrity, 'sha512-oLDq3jw7AcLqKWH2AhCpVTZl8mf6X2YReP+Neh0SJUzV/BdZYjth94tG5toiMB1PPrYtxOCfaoUCkvtuH+3AJA==', 'package-lock pins the official 0.20.3 tarball hash');
  assert.equal(locked?.resolved, 'https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz');
  for (const orphan of ['adler-32', 'cfb', 'codepage', 'crc-32', 'frac', 'ssf', 'wmf', 'word']) {
    assert.ok(!lock.packages?.[`node_modules/${orphan}`], `${orphan} (only used by xlsx 0.18.5) removed from the lock`);
  }
}

// ---------- 5. Script paths survive spaces ----------
{
  const bad = fs.readdirSync(path.join(root, 'scripts'))
    .filter((f) => /\.(mjs|js)$/.test(f) && f !== path.basename(fileURLToPath(import.meta.url)))
    .filter((f) => /\)\.pathname\b/.test(fs.readFileSync(path.join(root, 'scripts', f), 'utf8').replace(/\/\/.*$/gm, '')));
  assert.deepEqual(bad, [], `use fileURLToPath(import.meta.url) instead of new URL(import.meta.url).pathname: ${bad.join(', ')}`);
}

console.log('✓ P2.3.14.1 RC16.1 pilot-lock smoke PASS');
console.log('  - PDF template memory isolated per workspace; legacy global key never shared');
console.log('  - no dealer data in browser storage outside the tenant namespace');
console.log('  - RC16.1 SQL identical in phase file / schema.sql / 01_RUN; totals formula = quoteMath.js');
console.log('  - xlsx ≥ 0.20.3 pinned from cdn.sheetjs.com with integrity');
console.log('  - scripts resolve paths with fileURLToPath (spaces OK)');
