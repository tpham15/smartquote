#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { verifyFreezeLock } from '../benchmarks/vietnam-docbench/lib/freeze.mjs';
import { validateManifest } from '../benchmarks/vietnam-docbench/lib/schema.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function arg(name, fallback='') { const i=process.argv.indexOf(`--${name}`); return i>=0 && process.argv[i+1] && !process.argv[i+1].startsWith('--') ? process.argv[i+1] : fallback; }
const required = process.argv.includes('--require-private');
const reference = JSON.parse(fs.readFileSync(path.join(root, 'benchmarks/pilot-golden/extraction-seed.json'), 'utf8')).dataset;
const manifestPath = path.resolve(arg('manifest', process.env.SQ_DOCBENCH_PRIVATE_MANIFEST || path.join(root, 'benchmarks/vietnam-docbench/private/manifest.json')));
const lockPath = path.resolve(arg('lock', path.join(path.dirname(manifestPath), 'freeze-lock.json')));
const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');

if (!fs.existsSync(manifestPath)) {
  if (required) {
    console.error(`✗ P1.2 private golden corpus required but not installed: ${manifestPath}`);
    process.exit(2);
  }
  console.log(`⚠ P1.2 private golden corpus not installed: ${manifestPath}`);
  console.log('  Public regression remains valid; run npm run golden:pilot:private before a paid-pilot release.');
  process.exit(0);
}
if (!fs.existsSync(lockPath)) throw new Error(`P1.2 private golden freeze lock missing: ${lockPath}`);
assert.equal(sha(manifestPath), reference.manifestSha256, 'private manifest is not the frozen Vietnam DocBench v0.1 identity');
const manifest = validateManifest(JSON.parse(fs.readFileSync(manifestPath, 'utf8')));
assert.equal(manifest.id, reference.id);
assert.equal(manifest.version, reference.version);
assert.equal(manifest.benchmarkPolicy, reference.benchmarkPolicy);
const snapshot = verifyFreezeLock(manifestPath, JSON.parse(fs.readFileSync(lockPath, 'utf8')));
assert.equal(snapshot.counts.documents, reference.documents);
assert.equal(snapshot.counts.productRows, reference.productRows);
assert.equal(snapshot.counts.nonProductTraps, reference.nonProductTraps);
const byKind = {}, byType = {};
for (const doc of manifest.documents) { byKind[doc.inputKind]=(byKind[doc.inputKind]||0)+1; byType[doc.documentType]=(byType[doc.documentType]||0)+1; }
assert.deepEqual(byKind, reference.inputKinds);
assert.deepEqual(byType, reference.documentTypes);
console.log('✓ Pilot P1.2 Private Golden gate PASS');
console.log(`  ${snapshot.counts.documents} docs / ${snapshot.counts.productRows} products / ${snapshot.counts.nonProductTraps} traps`);
console.log(`  manifest=${reference.manifestSha256.slice(0,12)}… policy=${reference.benchmarkPolicy}`);
