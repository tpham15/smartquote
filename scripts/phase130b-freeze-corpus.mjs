#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createFreezeLock, verifyFreezeLock } from '../benchmarks/vietnam-docbench/lib/freeze.mjs';

function arg(name, fallback = '') {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : fallback;
}
function has(name) { return process.argv.includes(`--${name}`); }

const explicitManifest = arg('manifest');
const manifestPath = path.resolve(explicitManifest || process.env.SQ_DOCBENCH_PRIVATE_MANIFEST || 'benchmarks/vietnam-docbench/private/manifest.json');
const lockPath = path.resolve(arg('lock', path.join(path.dirname(manifestPath), 'freeze-lock.json')));

if (!fs.existsSync(manifestPath)) {
  if (explicitManifest) {
    console.error(`✗ Manifest not found: ${manifestPath}`);
    process.exit(1);
  }
  console.log(`⚠ Phase 13.0B private corpus not installed: ${manifestPath}`);
  console.log('  Freeze verification skipped; public benchmark tests can still run.');
  process.exit(0);
}

if (has('create')) {
  if (!has('reviewer-confirmed')) {
    console.error('✗ Refusing to create freeze lock without --reviewer-confirmed.');
    process.exit(2);
  }
  const lock = createFreezeLock(manifestPath);
  fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n');
  console.log(`✓ Created DocBench freeze lock: ${lockPath}`);
  console.log(`  version=${lock.dataset.version} docs=${lock.counts.documents} products=${lock.counts.productRows} traps=${lock.counts.nonProductTraps}`);
  process.exit(0);
}

if (!fs.existsSync(lockPath)) {
  console.error(`✗ Freeze lock not found: ${lockPath}`);
  process.exit(1);
}
const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
const snapshot = verifyFreezeLock(manifestPath, lock);
console.log('✓ Phase 13.0B freeze verification PASS');
console.log(`  version=${snapshot.dataset.version} documents=${snapshot.counts.documents} productRows=${snapshot.counts.productRows} nonProductTraps=${snapshot.counts.nonProductTraps}`);
console.log(`  policy=${snapshot.dataset.benchmarkPolicy} manifest=${snapshot.dataset.manifestSha256.slice(0, 12)}…`);
