#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { validateManifest, validateGroundTruth } from '../benchmarks/vietnam-docbench/lib/schema.mjs';
import { resolveDocBenchPolicy } from '../benchmarks/vietnam-docbench/lib/policy.mjs';
import { alignProductRows } from '../benchmarks/vietnam-docbench/lib/match.mjs';
import { scoreAlignment, aggregateMetricReports } from '../benchmarks/vietnam-docbench/lib/metrics.mjs';
import { evaluateGates } from '../benchmarks/vietnam-docbench/lib/gates.mjs';
import { verifyFreezeLock } from '../benchmarks/vietnam-docbench/lib/freeze.mjs';

function arg(name, fallback = '') {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : fallback;
}
function readJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }
function clone(v) { return JSON.parse(JSON.stringify(v)); }
function assertOne(label, value) {
  if (value != null && Math.abs(value - 1) > 1e-12) throw new Error(`${label} expected 1.0, got ${value}`);
}

const explicit = arg('manifest');
const manifestPath = path.resolve(explicit || process.env.SQ_DOCBENCH_PRIVATE_MANIFEST || 'benchmarks/vietnam-docbench/private/manifest.json');
if (!fs.existsSync(manifestPath)) {
  if (explicit) { console.error(`✗ Manifest not found: ${manifestPath}`); process.exit(1); }
  console.log(`⚠ Phase 13.0B private corpus not installed: ${manifestPath}`);
  console.log('  Frozen self-check skipped.');
  process.exit(0);
}
const base = path.dirname(manifestPath);
const lockPath = path.resolve(arg('lock', path.join(base, 'freeze-lock.json')));
if (!fs.existsSync(lockPath)) throw new Error(`freeze lock not found: ${lockPath}`);
verifyFreezeLock(manifestPath, readJson(lockPath));

const manifest = validateManifest(readJson(manifestPath));
const policy = resolveDocBenchPolicy(manifest.benchmarkPolicy);
const reports = [];
const predictionDocs = [];
for (const doc of manifest.documents) {
  const gt = validateGroundTruth(readJson(path.resolve(base, doc.groundTruth)), doc.id);
  const productRows = gt.rows.filter((row) => row.kind === 'product');
  const predictedRows = productRows.map((row, index) => ({
    predictionId: `${doc.id}-frozen-selfcheck-${index + 1}`,
    kind: 'product', status: 'auto_approved', confidence: 1,
    source: clone(row.source || {}), fields: clone(row.fields || {}),
  }));
  const alignment = alignProductRows(gt.rows, predictedRows, policy);
  const metrics = scoreAlignment(alignment, policy);
  reports.push({ metrics });
  predictionDocs.push({ documentId: doc.id, runtimeMs: 0, estimatedCostVnd: 0, rows: predictedRows });
  assertOne(`${doc.id}.rowPrecision`, metrics.rowDetection.precision);
  assertOne(`${doc.id}.rowRecall`, metrics.rowDetection.recall);
  for (const [field, stat] of Object.entries(metrics.fields)) if (stat.total > 0) assertOne(`${doc.id}.${field}`, stat.exact);
  assertOne(`${doc.id}.trustedRows`, metrics.trustedRows.accuracy);
  assertOne(`${doc.id}.autoApproval.precision`, metrics.autoApproval.precision);
  assertOne(`${doc.id}.autoApproval.coverage`, metrics.autoApproval.coverage);
  assertOne(`${doc.id}.grounding`, metrics.grounding.coverage);
  if (metrics.autoApproval.unsafe !== 0) throw new Error(`${doc.id}: frozen self-check has unsafe auto approvals`);
}
const overall = aggregateMetricReports(reports);
const gates = evaluateGates(overall, manifest.releaseGates);
assertOne('overall.rowPrecision', overall.rowDetection.precision);
assertOne('overall.rowRecall', overall.rowDetection.recall);
assertOne('overall.trustedRows', overall.trustedRows.accuracy);
assertOne('overall.autoApproval.precision', overall.autoApproval.precision);
assertOne('overall.autoApproval.coverage', overall.autoApproval.coverage);
assertOne('overall.grounding', overall.grounding.coverage);
if (!gates.pass) throw new Error('frozen self-check failed release gates');

const outPredictions = arg('out-predictions');
if (outPredictions) {
  const payload = {
    schemaVersion: 'sq-docbench-predictions-v1',
    engine: { id: 'frozen-ground-truth-selfcheck', version: manifest.version },
    documents: predictionDocs,
  };
  fs.writeFileSync(path.resolve(outPredictions), JSON.stringify(payload, null, 2) + '\n');
}
console.log('✓ Phase 13.0B frozen ground-truth self-check PASS');
console.log(`  documents=${manifest.documents.length} products=${overall.counts.groundTruthProducts} row/SKU/price/trusted/auto/grounding = 100% where applicable`);
