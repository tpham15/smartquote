import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { validateManifest, validateGroundTruth } from './schema.mjs';
import { resolveDocBenchPolicy } from './policy.mjs';

export const FREEZE_LOCK_SCHEMA = 'sq-docbench-freeze-lock-v1';

export function sha256Buffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

export function sha256File(filePath) {
  return sha256Buffer(fs.readFileSync(filePath));
}

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function policyFingerprint(policyId) {
  return sha256Buffer(Buffer.from(canonicalJson(resolveDocBenchPolicy(policyId)), 'utf8'));
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function relative(base, filePath) {
  return path.relative(base, filePath).split(path.sep).join('/');
}

function fileRecord(base, filePath, role) {
  const stat = fs.statSync(filePath);
  return {
    path: relative(base, filePath),
    role,
    bytes: stat.size,
    sha256: sha256File(filePath),
  };
}

export function assertCorpusReadyToFreeze(manifest) {
  if (!manifest.freeze || manifest.freeze.status !== 'frozen') {
    throw new Error('manifest.freeze.status must be "frozen" before creating a lock');
  }
  if (Number(manifest.freeze.reviewPasses) < 2 || manifest.freeze.secondPassSourceVerified !== true) {
    throw new Error('freeze requires reviewPasses>=2 and secondPassSourceVerified=true');
  }
  if (manifest.freeze.groundTruthLocked !== true) {
    throw new Error('freeze requires groundTruthLocked=true');
  }
  for (const doc of manifest.documents) {
    if (doc.labelStatus !== 'frozen_second_pass_verified') {
      throw new Error(`${doc.id}: labelStatus must be frozen_second_pass_verified`);
    }
  }
}

export function computeFreezeSnapshot(manifestPath) {
  const absoluteManifest = path.resolve(manifestPath);
  const base = path.dirname(absoluteManifest);
  const manifest = validateManifest(readJson(absoluteManifest));
  assertCorpusReadyToFreeze(manifest);

  let productRows = 0;
  let nonProductRows = 0;
  let sourceBytes = 0;
  const documents = [];
  const files = [fileRecord(base, absoluteManifest, 'manifest')];

  for (const doc of manifest.documents) {
    const sourcePath = path.resolve(base, doc.sourceFile);
    const gtPath = path.resolve(base, doc.groundTruth);
    if (!fs.existsSync(sourcePath)) throw new Error(`${doc.id}: missing source file ${sourcePath}`);
    if (!fs.existsSync(gtPath)) throw new Error(`${doc.id}: missing ground truth ${gtPath}`);
    const gt = validateGroundTruth(readJson(gtPath), doc.id);
    if (gt.review?.status !== 'frozen' || Number(gt.review?.passes) < 2 || gt.review?.sourceVerified !== true) {
      throw new Error(`${doc.id}: ground truth review metadata is not frozen/second-pass verified`);
    }
    const products = gt.rows.filter((row) => row.kind === 'product').length;
    const traps = gt.rows.filter((row) => row.kind === 'non_product').length;
    if (Number(doc.expectedProductRows) !== products) {
      throw new Error(`${doc.id}: expectedProductRows=${doc.expectedProductRows}, ground truth=${products}`);
    }
    const source = fileRecord(base, sourcePath, 'source');
    const groundTruth = fileRecord(base, gtPath, 'ground_truth');
    if (doc.sourceSha256 && doc.sourceSha256 !== source.sha256) {
      throw new Error(`${doc.id}: manifest sourceSha256 mismatch`);
    }
    if (doc.groundTruthSha256 && doc.groundTruthSha256 !== groundTruth.sha256) {
      throw new Error(`${doc.id}: manifest groundTruthSha256 mismatch`);
    }
    productRows += products;
    nonProductRows += traps;
    sourceBytes += source.bytes;
    files.push(source, groundTruth);
    documents.push({
      id: doc.id,
      inputKind: doc.inputKind,
      documentType: doc.documentType,
      productRows: products,
      nonProductTraps: traps,
      sourceSha256: source.sha256,
      groundTruthSha256: groundTruth.sha256,
    });
  }

  files.sort((a, b) => a.path.localeCompare(b.path));
  documents.sort((a, b) => a.id.localeCompare(b.id));

  return {
    manifest,
    snapshot: {
      dataset: {
        id: manifest.id,
        version: manifest.version,
        benchmarkPolicy: manifest.benchmarkPolicy,
        policySha256: policyFingerprint(manifest.benchmarkPolicy),
        manifestSha256: sha256File(absoluteManifest),
      },
      counts: {
        documents: manifest.documents.length,
        productRows,
        nonProductTraps: nonProductRows,
        sourceBytes,
      },
      documents,
      files,
    },
  };
}

export function createFreezeLock(manifestPath, { frozenAt = new Date().toISOString() } = {}) {
  const { manifest, snapshot } = computeFreezeSnapshot(manifestPath);
  return {
    schemaVersion: FREEZE_LOCK_SCHEMA,
    frozenAt,
    review: {
      passes: manifest.freeze.reviewPasses,
      secondPassSourceVerified: true,
      adjudicationBasis: manifest.freeze.adjudicationBasis || 'original_source',
      changePolicy: manifest.freeze.changePolicy || 'create_new_benchmark_version',
    },
    ...snapshot,
  };
}

function mismatch(label, expected, actual) {
  throw new Error(`${label} mismatch: frozen=${JSON.stringify(expected)} current=${JSON.stringify(actual)}`);
}

export function verifyFreezeLock(manifestPath, lock) {
  if (!lock || lock.schemaVersion !== FREEZE_LOCK_SCHEMA) {
    throw new Error(`freeze lock schema must be ${FREEZE_LOCK_SCHEMA}`);
  }
  const { snapshot } = computeFreezeSnapshot(manifestPath);
  for (const key of ['id', 'version', 'benchmarkPolicy', 'policySha256', 'manifestSha256']) {
    if (lock.dataset?.[key] !== snapshot.dataset[key]) mismatch(`dataset.${key}`, lock.dataset?.[key], snapshot.dataset[key]);
  }
  for (const key of ['documents', 'productRows', 'nonProductTraps', 'sourceBytes']) {
    if (lock.counts?.[key] !== snapshot.counts[key]) mismatch(`counts.${key}`, lock.counts?.[key], snapshot.counts[key]);
  }
  if (canonicalJson(lock.documents) !== canonicalJson(snapshot.documents)) mismatch('documents', lock.documents, snapshot.documents);
  if (canonicalJson(lock.files) !== canonicalJson(snapshot.files)) mismatch('files', lock.files, snapshot.files);
  return snapshot;
}
