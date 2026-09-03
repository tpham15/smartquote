#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { validateManifest, validateGroundTruth } from '../benchmarks/vietnam-docbench/lib/schema.mjs';

function arg(name, fallback='') {
  const i=process.argv.indexOf(`--${name}`);
  return i>=0 && process.argv[i+1] ? process.argv[i+1] : fallback;
}
function readJson(p){ return JSON.parse(fs.readFileSync(p,'utf8')); }
function sha256(p){ return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'); }
function fail(msg){ console.error(`✗ ${msg}`); process.exitCode=1; }

const defaultManifest=path.resolve('benchmarks/vietnam-docbench/private/manifest.json');
const manifestPath=path.resolve(arg('manifest', process.env.SQ_DOCBENCH_PRIVATE_MANIFEST || defaultManifest));
if (!fs.existsSync(manifestPath)) {
  console.log(`⚠ Phase 13.0A private corpus not installed: ${manifestPath}`);
  console.log('  Copy the private corpus into benchmarks/vietnam-docbench/private/ or pass --manifest <path>.');
  process.exit(0);
}
const base=path.dirname(manifestPath);
const manifest=validateManifest(readJson(manifestPath));
let productRows=0, nonProductRows=0, sourceBytes=0;
const byKind={};
const byType={};
for (const doc of manifest.documents) {
  const gtPath=path.resolve(base,doc.groundTruth);
  if (!fs.existsSync(gtPath)) { fail(`${doc.id}: missing ground truth ${gtPath}`); continue; }
  const gt=validateGroundTruth(readJson(gtPath),doc.id);
  const products=gt.rows.filter(r=>r.kind==='product');
  const traps=gt.rows.filter(r=>r.kind==='non_product');
  productRows+=products.length; nonProductRows+=traps.length;
  byKind[doc.inputKind]=(byKind[doc.inputKind]||0)+1;
  byType[doc.documentType]=(byType[doc.documentType]||0)+1;
  if (doc.expectedProductRows != null && Number(doc.expectedProductRows)!==products.length) {
    fail(`${doc.id}: expectedProductRows=${doc.expectedProductRows}, GT=${products.length}`);
  }
  const src=doc.sourceFile ? path.resolve(base,doc.sourceFile) : null;
  if (src) {
    if (!fs.existsSync(src)) fail(`${doc.id}: missing source ${src}`);
    else {
      sourceBytes+=fs.statSync(src).size;
      if (doc.sourceSha256 && sha256(src)!==doc.sourceSha256) fail(`${doc.id}: source SHA-256 mismatch`);
    }
  }
  for (const row of products) {
    const f=row.fields||{};
    const q=Number(f.quantity), p=Number(f.unitPrice), t=Number(f.lineTotal);
    if (f.quantity != null && f.unitPrice != null && f.lineTotal != null && [q,p,t].every(Number.isFinite)) {
      if (Math.abs(q*p-t)>1) fail(`${doc.id}.${row.rowId}: quantity × unitPrice != lineTotal (${q}×${p} != ${t})`);
    }
    const critical=row.acceptance?.criticalFields||[];
    if (!critical.length) fail(`${doc.id}.${row.rowId}: no criticalFields`);
  }
}
if (!process.exitCode) {
  console.log(`✓ Phase 13.0A private corpus audit PASS`);
  console.log(`  documents=${manifest.documents.length} productRows=${productRows} nonProductTraps=${nonProductRows} sourceMB=${(sourceBytes/1048576).toFixed(2)}`);
  console.log(`  inputKinds=${JSON.stringify(byKind)} documentTypes=${JSON.stringify(byType)}`);
}
