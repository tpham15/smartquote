#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { extractPagesFromPdf } from '../api/_lib/pdfTextGeometry.js';
import { importFileForUI } from '../src/import-engine/uiAdapter.js';
import {
  sanitizeCatalogProducts,
  isUnsafeImportedProduct,
  dedupeCatalogIdentities,
} from '../src/import-engine/productSanitizer.js';
import { applyCommercialValidation } from '../src/import-engine/businessValidator.js';
import { expandPdfSellableVariants } from '../src/import-engine/pdf/pdfVariants.js';
import { productIdentityKey } from '../src/import-engine/productIdentity.js';

const root = process.cwd();
const inputDir = path.resolve(process.argv[2] || process.env.SQ_SUPPLIER_PRICE_DIR || '');
const supported = new Set(['.pdf', '.xlsx', '.xls']);
const maxSamples = Math.max(5, Math.min(200, Number(process.env.SQ_DIAG_MAX_SAMPLES || 60) || 60));

if (!inputDir || !fs.existsSync(inputDir) || !fs.statSync(inputDir).isDirectory()) {
  console.error('✗ SUPPLIER DIAGNOSTIC V3 BLOCKED: folder not found.');
  console.error('  Usage: node scripts/pilot-supplier-diagnostic-v3.mjs "/absolute/path/to/bang-gia"');
  process.exit(2);
}

const entries = fs.readdirSync(inputDir, { withFileTypes: true })
  .filter((e) => e.isFile()) // intentionally top-level only; nested folders are excluded
  .filter((e) => supported.has(path.extname(e.name).toLowerCase()))
  .filter((e) => !e.name.startsWith('~$'))
  .map((e) => path.join(inputDir, e.name))
  .sort((a, b) => path.basename(a).localeCompare(path.basename(b), 'vi'));

if (!entries.length) {
  console.error('✗ SUPPLIER DIAGNOSTIC V3 BLOCKED: no top-level PDF/XLS/XLSX files found.');
  process.exit(2);
}

const normalizeKey = (v) => String(v ?? '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/đ/g, 'd').replace(/Đ/g, 'D')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const text = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const money = (p) => Math.max(Number(p?.costPrice || p?.price || 0), Number(p?.listPrice || p?.publicPrice || 0));
const forbiddenRe = /(tổng\s*cộng|thành\s*tiền|chính\s*sách|thanh\s*toán|điều\s*khoản|ghi\s*chú|hotline|website|bảo\s*hành\s*áp\s*dụng|nhân\s*công|vật\s*tư\s*phụ)/i;

function sourceOf(product = {}) {
  return product?._meta?.source || product?.source || {};
}
function loc(source = {}) {
  const parts = [];
  if (source.fileName) parts.push(path.basename(source.fileName));
  if (source.sheet) parts.push(`sheet=${source.sheet}`);
  if (source.page) parts.push(`page=${source.page}`);
  if (source.row) parts.push(`row=${source.row}`);
  if (source.rowIndex) parts.push(`row=${source.rowIndex}`);
  return parts.join(' · ') || 'unknown source';
}
function parsedSnapshot(p = {}) {
  return {
    name: text(p.name),
    sku: text(p.sku),
    category: text(p.category),
    productType: text(p.productType || p?.attributes?.productType),
    model: text(p.model || p?.attributes?.commercialModel || p?.attributes?.model),
    supplier: text(p.supplier || p.brand),
    unit: text(p.unit),
    costPrice: Number(p.costPrice || p.price || 0) || 0,
    listPrice: Number(p.listPrice || p.publicPrice || 0) || 0,
  };
}
function addIssue(out, code, severity, message, product = null, extra = {}) {
  const source = product ? sourceOf(product) : (extra.source || {});
  out.push({
    code,
    severity,
    message,
    location: loc(source),
    source,
    rawText: text(extra.rawText || source.rawText || ''),
    parsed: product ? parsedSnapshot(product) : (extra.parsed || null),
    issueCodes: product ? (product?._meta?.issues || product?.issues || []).map((x) => x?.code || String(x)).filter(Boolean) : [],
    ...extra,
  });
}
function issueCodeSet(product = {}) {
  return new Set((product?._meta?.issues || product?.issues || []).map((x) => String(x?.code || x || '')).filter(Boolean));
}
function groupBy(arr, keyFn) {
  const map = new Map();
  for (const x of arr) {
    const key = keyFn(x);
    if (!key) continue;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(x);
  }
  return map;
}
function lineProduct(line = {}) {
  return {
    name: line?.parsed?.productName || line?.raw?.productName || '',
    sku: line?.parsed?.sku || line?.raw?.sku || '',
    category: line?.parsed?.category || '',
    supplier: line?.parsed?.supplier || '',
    unit: line?.parsed?.unit || '',
    costPrice: Number(line?.parsed?.costPrice ?? line?.parsed?.unitPrice ?? 0) || 0,
    listPrice: Number(line?.parsed?.listPrice ?? line?.parsed?.publicPrice ?? 0) || 0,
    specs: line?.parsed?.specs || '',
    _meta: { source: line?.source || {}, issues: line?.issues || [], canonicalStatus: line?.status },
  };
}

function collectProductDiagnostics(products = [], previewLines = []) {
  const issues = [];
  const total = products.length;

  for (const p of products) {
    const name = normalizeKey(p?.name);
    const sku = normalizeKey(p?.sku);
    const source = sourceOf(p);
    const codes = issueCodeSet(p);

    if (isUnsafeImportedProduct(p)) {
      const engineIssues = p?._meta?.issues || p?.issues || [];
      const hasHardEngineError = engineIssues.some((x) => String(x?.level || '').toLowerCase() === 'error');
      addIssue(
        issues,
        hasHardEngineError ? 'UNSAFE_PRODUCT' : 'NEEDS_REVIEW',
        hasHardEngineError ? 'ERROR' : 'WARN',
        hasHardEngineError ? 'Product has a hard sanitizer/validation error.' : 'Product is intentionally held for human review; no hard corruption proven.',
        p
      );
    }
    if (name && sku && name === sku) addIssue(issues, 'NAME_EQUALS_SKU', 'ERROR', 'Product name collapsed to SKU/code.', p);
    if (/^sản phẩm\s+/i.test(text(p?.name))) addIssue(issues, 'GENERIC_PRODUCT_NAME', 'ERROR', 'Fallback generic product name was generated instead of source commercial name.', p);
    if (!text(p?.name)) addIssue(issues, 'MISSING_NAME', 'ERROR', 'Product name is empty.', p);
    if (!text(p?.sku)) addIssue(issues, 'MISSING_SKU', 'WARN', 'Product has no SKU/model code.', p);
    if (!(money(p) > 0)) addIssue(issues, 'MISSING_PRICE', 'WARN', 'No usable cost/list price was resolved.', p);
    if (forbiddenRe.test(text(p?.name))) addIssue(issues, 'NON_PRODUCT_LEAKAGE', 'ERROR', 'A non-product/summary/service row appears to have entered the catalog.', p);
    if (codes.has('identity_collision_review')) addIssue(issues, 'IDENTITY_COLLISION', 'WARN', 'Same coarse identity has conflicting visible evidence; SmartQuote preserved both rows for review.', p);
    if (codes.has('duplicate_identity_price_conflict')) addIssue(issues, 'DUPLICATE_PRICE_CONFLICT', 'WARN', 'Same canonical identity has conflicting prices; SmartQuote preserved source occurrences and requires review.', p);
    for (const code of codes) {
      if (/^(missing_|pdf_|price_|identity_|duplicate_)/.test(code) && !['identity_collision_review', 'duplicate_identity_price_conflict'].includes(code)) {
        const it = (p?._meta?.issues || p?.issues || []).find((x) => String(x?.code || x) === code);
        addIssue(issues, `ENGINE_${code.toUpperCase()}`, String(it?.level || 'WARN').toUpperCase() === 'ERROR' ? 'ERROR' : 'WARN', it?.message || `Engine issue: ${code}`, p);
      }
    }
    if (!source.rawText && !source.sheet && !source.page) {
      addIssue(issues, 'MISSING_PROVENANCE', 'WARN', 'Product has weak/missing source provenance.', p);
    }
  }

  // Preview lines preserve rows that never became products.
  for (const line of previewLines || []) {
    const status = String(line?.status || '');
    if (status === 'need_review' || status === 'failed') {
      const p = lineProduct(line);
      addIssue(
        issues,
        status === 'failed' ? 'ENGINE_LINE_FAILED' : 'ENGINE_LINE_REVIEW',
        status === 'failed' ? 'ERROR' : 'WARN',
        status === 'failed' ? 'Canonical import line failed before catalog conversion.' : 'Canonical import line requires human review.',
        p,
        { lineId: line?.lineId, confidence: line?.confidence, raw: line?.raw, parsedLine: line?.parsed }
      );
    }
  }

  // Exact duplicate identity after parser output.
  const exactGroups = groupBy(products, (p) => productIdentityKey(p));
  for (const [key, rows] of exactGroups) {
    if (rows.length <= 1) continue;
    for (const p of rows) addIssue(issues, 'EXACT_DUPLICATE_IDENTITY', 'ERROR', `Exact identity occurs ${rows.length} times: ${key}`, p, { groupSize: rows.length });
  }

  // Reused supplier code: diagnostic only. This may be valid (e.g. Roger FU), so never fail solely on this.
  const skuGroups = groupBy(products, (p) => {
    const s = normalizeKey(p?.sku);
    const sup = normalizeKey(p?.supplier || p?.brand);
    return s ? `${sup}|${s}` : '';
  });
  for (const [key, rows] of skuGroups) {
    const names = [...new Set(rows.map((p) => normalizeKey(p?.name)).filter(Boolean))];
    if (rows.length > 1 && names.length > 1) {
      for (const p of rows) addIssue(issues, 'SUPPLIER_CODE_REUSED', 'INFO', `Supplier code is reused across ${rows.length} distinct rows; do not merge by bare SKU alone.`, p, { groupKey: key, groupSize: rows.length, distinctNames: names.length });
    }
  }

  return { issues, total };
}

function summarizeIssues(issues = []) {
  const byCode = new Map();
  const bySeverity = { ERROR: 0, WARN: 0, INFO: 0 };
  for (const i of issues) {
    byCode.set(i.code, (byCode.get(i.code) || 0) + 1);
    bySeverity[i.severity] = (bySeverity[i.severity] || 0) + 1;
  }
  return {
    bySeverity,
    byCode: [...byCode.entries()].sort((a, b) => b[1] - a[1]).map(([code, count]) => ({ code, count })),
  };
}

let pdfPipelinePromise = null;
async function loadPdfPipeline() {
  if (pdfPipelinePromise) return pdfPipelinePromise;
  pdfPipelinePromise = (async () => {
    const pipelinePath = path.join(root, 'src/import-engine/pdf/pdfCatalogPipeline.js');
    const source = fs.readFileSync(pipelinePath, 'utf8');
    const workerImport = /import\s+pdfJsWorkerUrl\s+from\s+["']pdfjs-dist\/legacy\/build\/pdf\.worker\.mjs\?url["'];?/;
    if (!workerImport.test(source)) throw new Error('PDF production worker import shape changed; diagnostic loader must be updated.');
    const tempPath = path.join(root, 'src/import-engine/pdf', `.pilot-supplier-diag-v3-${process.pid}-${Date.now()}.mjs`);
    fs.writeFileSync(tempPath, source.replace(workerImport, 'const pdfJsWorkerUrl = "";'));
    try {
      return await import(`${pathToFileURL(tempPath).href}?v=${Date.now()}`);
    } finally {
      try { fs.unlinkSync(tempPath); } catch {}
    }
  })();
  return pdfPipelinePromise;
}

function knownGolden(filePath, hash) {
  const base = path.basename(filePath).toLowerCase();
  if (hash === '2d8de09b5014ebc634a425da4137b1fcf747f1909ba6925ed0b05e01084fb0c8' || base.includes('roger')) return 'pilot-roger-real-file-gate.mjs';
  if (hash === '9ab80ab5fe1bf92c6c3f9875fdcb13a46234b6eec082d0ddf55daa4f8f3f09ae' || (base.includes('bisco') && base.includes('form'))) return 'pilot-bisco-real-file-gate.mjs';
  return null;
}
function runGolden(filePath, hash) {
  const scriptName = knownGolden(filePath, hash);
  if (!scriptName) return null;
  const script = path.join(root, 'scripts', scriptName);
  if (!fs.existsSync(script)) return { script: scriptName, passed: false, exitCode: 2, stderr: 'Golden gate script missing.' };
  const out = spawnSync(process.execPath, [script, filePath], { cwd: root, encoding: 'utf8' });
  return { script: scriptName, passed: out.status === 0, exitCode: out.status, stdout: text(out.stdout), stderr: text(out.stderr) };
}

function statusFor({ golden, issues, scanLike, productCount }) {
  // Exact golden evidence is authoritative. Generic heuristics remain visible but cannot overturn a PASS.
  if (golden) return golden.passed ? 'PASS' : 'FAIL';
  if (scanLike) return 'REVIEW';
  if (!productCount) return 'FAIL';

  const counts = summarizeIssues(issues);
  const errorCount = counts.bySeverity.ERROR || 0;
  const hardCodes = new Set(['NAME_EQUALS_SKU', 'GENERIC_PRODUCT_NAME', 'NON_PRODUCT_LEAKAGE', 'EXACT_DUPLICATE_IDENTITY', 'ENGINE_LINE_FAILED']);
  const hasHard = issues.some((i) => i.severity === 'ERROR' && hardCodes.has(i.code));
  const unsafeCount = issues.filter((i) => i.code === 'UNSAFE_PRODUCT').length;
  const genericCount = issues.filter((i) => i.code === 'GENERIC_PRODUCT_NAME').length;
  const nameSkuCount = issues.filter((i) => i.code === 'NAME_EQUALS_SKU').length;

  if (hasHard || unsafeCount / productCount > 0.25 || genericCount / productCount > 0.25 || nameSkuCount / productCount > 0.25 || errorCount / productCount > 0.4) return 'FAIL';
  return 'REVIEW'; // unknown supplier files never auto-PASS without a reviewed golden baseline
}

function findSttDiagnostics(products = []) {
  const issues = [];
  const sttRows = products.map((p) => ({
    p,
    stt: Number(p?.attributes?.pdfSourceStt || p?._meta?.productEvidence?.sourceStt || 0),
  })).filter((x) => Number.isInteger(x.stt) && x.stt > 0);
  if (sttRows.length < 5) return issues;
  const by = groupBy(sttRows, (x) => String(x.stt));
  for (const [stt, rows] of by) {
    if (rows.length > 1) for (const x of rows) addIssue(issues, 'SOURCE_STT_DUPLICATE', 'ERROR', `PDF source STT ${stt} appears ${rows.length} times.`, x.p, { sourceStt: Number(stt), groupSize: rows.length });
  }
  const unique = [...new Set(sttRows.map((x) => x.stt))].sort((a, b) => a - b);
  const min = unique[0], max = unique.at(-1);
  if (min === 1 && max <= 5000) {
    const missing = [];
    const set = new Set(unique);
    for (let n = 1; n <= max; n++) if (!set.has(n)) missing.push(n);
    if (missing.length && missing.length <= Math.max(20, Math.ceil(max * 0.2))) {
      issues.push({ code: 'SOURCE_STT_GAP', severity: 'WARN', message: `PDF source STT gaps: ${missing.slice(0, 30).join(', ')}${missing.length > 30 ? '…' : ''}`, location: 'document', rawText: '', parsed: null, missingStt: missing });
    }
  }
  return issues;
}

async function inspectSpreadsheet(filePath) {
  const bytes = fs.readFileSync(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const mime = ext === '.xls' ? 'application/vnd.ms-excel' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const file = new File([bytes], path.basename(filePath), { type: mime });
  const { result, preview, products: rawProducts } = await importFileForUI(file, { catalog: [] });
  const sanitized = sanitizeCatalogProducts(rawProducts, { sourceFileName: file.name, importSourceKind: 'catalog', oldQuoteMode: true });
  const validated = applyCommercialValidation(sanitized, { existingProducts: [] }).products;
  const active = validated.filter((p) => !['skipped', 'failed'].includes(String(p?._meta?.canonicalStatus || p?._meta?.status || p?.status || '').toLowerCase()));
  const deduped = dedupeCatalogIdentities(active);
  const diag = collectProductDiagnostics(deduped.products, preview?.lines || []);

  if (Number(deduped.conflicts || 0) > 0 && !diag.issues.some((i) => i.code === 'IDENTITY_COLLISION')) {
    diag.issues.push({ code: 'DEDUPE_CONFLICT_COUNT', severity: 'WARN', message: `Canonical dedupe preserved ${deduped.conflicts} conflicting identity pair(s) for review.`, location: 'document', rawText: '', parsed: null, count: deduped.conflicts });
  }
  if (Number(result?.stats?.rejected || preview?.summary?.failed || 0) > 0) {
    diag.issues.push({ code: 'REJECTED_ROWS', severity: 'ERROR', message: `${Number(result?.stats?.rejected || preview?.summary?.failed || 0)} row(s) were rejected/failed by the engine.`, location: 'document', rawText: '', parsed: null });
  }

  const hash = sha256(bytes);
  const golden = runGolden(filePath, hash);
  const summary = summarizeIssues(diag.issues);
  return {
    file: path.basename(filePath), filePath, type: 'spreadsheet', hash,
    engine: result?.engine || preview?.engine || '',
    sourceRows: Number(result?.stats?.sourceRows || preview?.summary?.totalRows || 0),
    previewLines: Number(preview?.lines?.length || 0),
    productCount: deduped.products.length,
    dedupedCount: Number(deduped.deduped || 0),
    identityConflicts: Number(deduped.conflicts || 0),
    scanLike: false,
    golden,
    issues: diag.issues,
    issueSummary: summary,
    status: statusFor({ golden, issues: diag.issues, scanLike: false, productCount: deduped.products.length }),
  };
}

async function inspectPdf(filePath) {
  const bytes = fs.readFileSync(filePath);
  const hash = sha256(bytes);
  const extracted = await extractPagesFromPdf(bytes);
  const scanLike = !extracted.pages?.length || extracted.textChars < Math.max(120, (extracted.pageCount || 1) * 80);
  const supplierGuess = path.basename(filePath).replace(/\.pdf$/i, '').replace(/[_\-]/g, ' ').slice(0, 80);
  let products = [];
  let columnModels = 0;
  const issues = [];

  if (scanLike) {
    issues.push({ code: 'SCAN_OR_IMAGE_PDF', severity: 'WARN', message: 'PDF has little/no selectable text; deterministic text parser cannot verify the catalog. Route to OCR/vision + human review.', location: 'document', rawText: '', parsed: null });
  } else {
    const pipeline = await loadPdfPipeline();
    const column = pipeline.extractColumnAwareProductsFromPdfPages(extracted.pages, supplierGuess);
    columnModels = column.models?.length || 0;
    const columnItems = pipeline.normalizePdfItems(column.items, supplierGuess, 'diagnostic-v3-column');
    const heuristicItems = pipeline.normalizePdfItems(
      pipeline.heuristicExtractProductsFromPdfPages(extracted.pages, supplierGuess, { excludeRows: column.handledRows }),
      supplierGuess,
      'diagnostic-v3-heuristic',
    );
    const deterministic = pipeline.dedupeProducts([...columnItems, ...heuristicItems], { fileName: path.basename(filePath), supplierGuess });
    const finalized = pipeline.finalizePdfTrust(deterministic, { expectedRows: 0, failedPages: 0, engine: 'diagnostic-v3-deterministic' }).items;
    const expanded = expandPdfSellableVariants(finalized);
    const deduped = dedupeCatalogIdentities(expanded.products);
    products = deduped.products;
    const diag = collectProductDiagnostics(products, []);
    issues.push(...diag.issues, ...findSttDiagnostics(products));
    if (deduped.conflicts > 0 && !issues.some((i) => i.code === 'IDENTITY_COLLISION')) {
      issues.push({ code: 'DEDUPE_CONFLICT_COUNT', severity: 'WARN', message: `Canonical dedupe preserved ${deduped.conflicts} conflicting identity pair(s) for review.`, location: 'document', rawText: '', parsed: null, count: deduped.conflicts });
    }
  }

  const golden = runGolden(filePath, hash);
  const summary = summarizeIssues(issues);
  return {
    file: path.basename(filePath), filePath, type: 'pdf', hash,
    pageCount: Number(extracted.pageCount || 0), textChars: Number(extracted.textChars || 0), columnModels,
    productCount: products.length, scanLike, golden,
    issues, issueSummary: summary,
    status: statusFor({ golden, issues, scanLike, productCount: products.length }),
  };
}

function mdEsc(v) { return String(v ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' '); }
function csvEsc(v) { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }
function stamp() { return new Date().toISOString().replace(/[:.]/g, '-'); }
function safeFileName(v) { return normalizeKey(v).replace(/\s+/g, '-').slice(0, 90) || 'file'; }

console.log(`\nSupplier Diagnostic Gate v3: ${inputDir}`);
console.log(`Top-level supplier files: ${entries.length} (all subfolders ignored)\n`);

const results = [];
for (const filePath of entries) {
  const name = path.basename(filePath);
  process.stdout.write(`→ ${name} ... `);
  try {
    const ext = path.extname(filePath).toLowerCase();
    const r = ext === '.pdf' ? await inspectPdf(filePath) : await inspectSpreadsheet(filePath);
    results.push(r);
    const errs = r.issueSummary?.bySeverity?.ERROR || 0;
    const warns = r.issueSummary?.bySeverity?.WARN || 0;
    console.log(`${r.status} (products=${r.productCount}, errors=${errs}, warnings=${warns}${r.golden ? `, golden=${r.golden.passed ? 'PASS' : 'FAIL'}` : ''})`);
  } catch (err) {
    const r = {
      file: name, filePath, type: path.extname(filePath).slice(1), status: 'FAIL', productCount: 0,
      golden: null,
      issues: [{ code: 'EXCEPTION', severity: 'ERROR', message: err?.message || String(err), location: 'document', rawText: '', parsed: null, stack: err?.stack || '' }],
    };
    r.issueSummary = summarizeIssues(r.issues);
    results.push(r);
    console.log(`FAIL (${err?.message || err})`);
  }
}

const counts = { PASS: 0, REVIEW: 0, FAIL: 0 };
for (const r of results) counts[r.status] = (counts[r.status] || 0) + 1;
const reportRoot = path.join(root, 'pilot-reports', `supplier-diagnostic-v3-${stamp()}`);
const detailsDir = path.join(reportRoot, 'details');
fs.mkdirSync(detailsDir, { recursive: true });

// Per-file details.
for (const r of results) {
  const base = safeFileName(r.file);
  fs.writeFileSync(path.join(detailsDir, `${base}.json`), JSON.stringify(r, null, 2));
  const lines = [
    `# ${r.status} — ${r.file}`, '',
    `- Products: ${r.productCount}`,
    `- Golden: ${r.golden ? (r.golden.passed ? `PASS (${r.golden.script})` : `FAIL (${r.golden.script})`) : 'none — unverified supplier file'}`,
    ...(r.type === 'pdf' ? [`- PDF: pages=${r.pageCount || 0}, textChars=${r.textChars || 0}, columnModels=${r.columnModels || 0}, scanLike=${!!r.scanLike}`] : [`- Spreadsheet: engine=${r.engine || '-'}, sourceRows=${r.sourceRows || 0}, previewLines=${r.previewLines || 0}`]),
    '', '## Root-cause clusters', '',
    ...(r.issueSummary?.byCode?.length ? r.issueSummary.byCode.map((x) => `- **${x.code}**: ${x.count}`) : ['- No generic diagnostic issue.']),
    '', '## Row-level diagnostics', '',
  ];
  const shown = r.issues.slice(0, maxSamples);
  for (const [idx, i] of shown.entries()) {
    lines.push(`### ${idx + 1}. ${i.severity} — ${i.code}`);
    lines.push(`- ${i.message}`);
    lines.push(`- Source: ${i.location || 'unknown'}`);
    if (i.rawText) lines.push(`- Raw: \`${mdEsc(i.rawText).slice(0, 800)}\``);
    if (i.parsed) lines.push(`- Parsed: \`${mdEsc(JSON.stringify(i.parsed)).slice(0, 1000)}\``);
    if (i.issueCodes?.length) lines.push(`- Engine issue codes: ${i.issueCodes.join(', ')}`);
    lines.push('');
  }
  if (r.issues.length > shown.length) lines.push(`_Showing ${shown.length}/${r.issues.length} diagnostics. Full data is in the JSON/CSV report._`, '');
  fs.writeFileSync(path.join(detailsDir, `${base}.md`), lines.join('\n'));
}

// One flat CSV for sorting/filtering.
const csvRows = [['status','file','severity','code','location','message','name','sku','category','supplier','costPrice','listPrice','rawText']];
for (const r of results) for (const i of r.issues) csvRows.push([
  r.status, r.file, i.severity, i.code, i.location || '', i.message || '',
  i.parsed?.name || '', i.parsed?.sku || '', i.parsed?.category || '', i.parsed?.supplier || '',
  i.parsed?.costPrice ?? '', i.parsed?.listPrice ?? '', i.rawText || '',
]);
fs.writeFileSync(path.join(reportRoot, 'ALL_ISSUES.csv'), csvRows.map((row) => row.map(csvEsc).join(',')).join('\n'));

const summaryMd = [
  '# SmartQuote Supplier Diagnostic Gate v3', '',
  `- Folder: \`${inputDir}\``,
  `- Generated: ${new Date().toISOString()}`,
  '- Scope: top-level `.pdf/.xls/.xlsx` only; all subfolders are excluded.',
  '- Policy: a known golden PASS is authoritative; unknown supplier files never auto-PASS.',
  `- Result: **PASS=${counts.PASS} · REVIEW=${counts.REVIEW} · FAIL=${counts.FAIL}**`, '',
  '| Status | File | Products | Errors | Warnings | Golden | Main root causes |',
  '|---|---|---:|---:|---:|---|---|',
  ...results.map((r) => {
    const err = r.issueSummary?.bySeverity?.ERROR || 0;
    const warn = r.issueSummary?.bySeverity?.WARN || 0;
    const clusters = (r.issueSummary?.byCode || []).slice(0, 5).map((x) => `${x.code}=${x.count}`).join('; ');
    const golden = r.golden ? (r.golden.passed ? 'PASS' : 'FAIL') : '—';
    return `| ${r.status} | ${mdEsc(r.file)} | ${r.productCount || 0} | ${err} | ${warn} | ${golden} | ${mdEsc(clusters)} |`;
  }),
  '', '## What to send back for parser hardening', '',
  'Send `SUMMARY.md` plus `ALL_ISSUES.csv`. For a specific failing supplier, also send its file from `details/`.',
  '', '## Release interpretation', '',
  '- **PASS** = exact golden gate passed. Generic warnings remain visible but do not override verified evidence.',
  '- **REVIEW** = no proven corruption blocker, but this supplier file has no reviewed golden baseline or is image/scan based.',
  '- **FAIL** = deterministic evidence of identity/data corruption or a golden gate failure.',
].join('\n');
fs.writeFileSync(path.join(reportRoot, 'SUMMARY.md'), summaryMd);
fs.writeFileSync(path.join(reportRoot, 'SUMMARY.json'), JSON.stringify({ generatedAt: new Date().toISOString(), inputDir, counts, results }, null, 2));

console.log('\n=== DIAGNOSTIC V2 SUMMARY ===');
for (const r of results) {
  const top = (r.issueSummary?.byCode || []).slice(0, 4).map((x) => `${x.code}=${x.count}`).join(', ') || 'none';
  console.log(`${r.status.padEnd(6)} ${r.file} | products=${r.productCount || 0} | ${top}${r.golden ? ` | golden=${r.golden.passed ? 'PASS' : 'FAIL'}` : ''}`);
}
console.log(`\nTOTAL: PASS=${counts.PASS} REVIEW=${counts.REVIEW} FAIL=${counts.FAIL}`);
console.log(`\nReports:\n  ${path.join(reportRoot, 'SUMMARY.md')}\n  ${path.join(reportRoot, 'ALL_ISSUES.csv')}\n  ${detailsDir}`);

// Diagnostics are intentionally release-blocking until every unverified supplier has been reviewed/frozen.
if (counts.FAIL > 0) process.exitCode = 2;
else if (counts.REVIEW > 0) process.exitCode = 1;
else process.exitCode = 0;
