#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createFreezeLock, verifyFreezeLock, policyFingerprint } from '../benchmarks/vietnam-docbench/lib/freeze.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sq-docbench-freeze-'));
try {
  fs.mkdirSync(path.join(tmp, 'files'), { recursive: true });
  fs.mkdirSync(path.join(tmp, 'ground-truth'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'files', 'sample.txt'), 'supplier row\n');
  const gtPath = path.join(tmp, 'ground-truth', 'sample.json');
  fs.writeFileSync(gtPath, JSON.stringify({
    schemaVersion: 'sq-docbench-ground-truth-v1',
    documentId: 'sample',
    review: { status: 'frozen', passes: 2, sourceVerified: true },
    rows: [
      { rowId: 'p1', kind: 'product', source: { row: 1 }, fields: { name: 'A', sku: 'A1', unitPrice: 1000 }, acceptance: { criticalFields: ['sku', 'unitPrice'] } },
      { rowId: 'n1', kind: 'non_product', source: { row: 2 } },
    ],
  }, null, 2) + '\n');
  const manifestPath = path.join(tmp, 'manifest.json');
  const crypto = await import('node:crypto');
  const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
  const sourcePath = path.join(tmp, 'files', 'sample.txt');
  const manifest = {
    schemaVersion: 'sq-docbench-manifest-v1', benchmarkPolicy: 'sq-docbench-policy-v1', id: 'freeze-smoke', version: '0.0.1',
    freeze: { status: 'frozen', reviewPasses: 2, secondPassSourceVerified: true, groundTruthLocked: true },
    documents: [{ id: 'sample', inputKind: 'other', documentType: 'other', sourceFile: 'files/sample.txt', groundTruth: 'ground-truth/sample.json', expectedProductRows: 1, sourceSha256: sha(sourcePath), groundTruthSha256: sha(gtPath), labelStatus: 'frozen_second_pass_verified' }],
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  const lock = createFreezeLock(manifestPath, { frozenAt: '2026-09-03T00:00:00.000Z' });
  const verified = verifyFreezeLock(manifestPath, lock);
  assert.equal(verified.counts.productRows, 1);
  assert.equal(lock.dataset.policySha256, policyFingerprint('sq-docbench-policy-v1'));

  const originalGt = fs.readFileSync(gtPath, 'utf8');
  const mutated = JSON.parse(originalGt);
  mutated.rows[0].fields.unitPrice = 1001;
  fs.writeFileSync(gtPath, JSON.stringify(mutated, null, 2) + '\n');
  assert.throws(() => verifyFreezeLock(manifestPath, lock), /groundTruthSha256 mismatch|files mismatch/);
  fs.writeFileSync(gtPath, originalGt);

  fs.appendFileSync(sourcePath, 'mutation\n');
  assert.throws(() => verifyFreezeLock(manifestPath, lock), /sourceSha256 mismatch|files mismatch/);

  console.log('✓ Phase 13.0B freeze smoke PASS (lock verifies and detects GT/source mutation)');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
