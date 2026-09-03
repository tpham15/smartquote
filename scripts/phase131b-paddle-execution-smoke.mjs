#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sq-phase131b-"));
const source = path.join(tmp, "source.pdf");
fs.writeFileSync(source, "fixture");
const gt = {
  schemaVersion: "sq-docbench-ground-truth-v1",
  documentId: "doc1",
  rows: [
    { rowId: "r1", kind: "product", source: { page: 1, bbox: [0,0,1,1] }, fields: { name: "Test product", sku: "SKU-1", unit: "Cái", unitPrice: 123000 }, acceptance: { criticalFields: ["sku", "unitPrice"] } },
    { rowId: "n1", kind: "non_product", source: { page: 1 }, fields: { name: "Tổng cộng" } },
  ],
};
fs.writeFileSync(path.join(tmp, "gt.json"), JSON.stringify(gt));
const manifest = {
  schemaVersion: "sq-docbench-manifest-v1",
  benchmarkPolicy: "sq-docbench-policy-v1",
  id: "phase131b-smoke",
  version: "1.0.0",
  releaseGates: { rowRecall: 0.9, rowPrecision: 0.9, skuExact: 0.9, unitPriceExact: 0.9, autoApprovePrecision: 0, maxUnsafeAutoApproveRate: 1, groundingCoverage: 0.9 },
  documents: [{ id: "doc1", inputKind: "scan_pdf", documentType: "supplier_price_list", sourceFile: "source.pdf", groundTruth: "gt.json" }],
};
const manifestPath = path.join(tmp, "manifest.json");
fs.writeFileSync(manifestPath, JSON.stringify(manifest));

const blockedAdapter = path.join(tmp, "blocked.mjs");
fs.writeFileSync(blockedAdapter, `export const engine={id:'blocked',version:'1'}; export async function runtimeProbe(){return {ready:false,python:'3.13',pipelineVersion:'v1.6',backend:'native'}}; export async function runDocument(){throw new Error('must not run')}`);
const blockedOut = path.join(tmp, "blocked-out");
let r = spawnSync(process.execPath, [path.join(root, "benchmarks/vietnam-docbench/paddleocr-vl-benchmark.mjs"), "--manifest", manifestPath, "--adapter", blockedAdapter, "--out-dir", blockedOut], { encoding: "utf8" });
assert.equal(r.status, 0, r.stderr);
const blockedStatus = JSON.parse(fs.readFileSync(path.join(blockedOut, "execution-status.json"), "utf8"));
assert.equal(blockedStatus.status, "BLOCKED_RUNTIME");
assert.equal(fs.existsSync(path.join(blockedOut, "predictions.json")), false);
assert.doesNotMatch(JSON.stringify(blockedStatus), /groundTruth|expectedProductRows|reviewEvidence/);

const readyAdapter = path.join(tmp, "ready.mjs");
fs.writeFileSync(readyAdapter, `
export const engine={id:'fake-paddle',version:'1.6',config:{benchmarkOnly:true}};
export function supports(){return true}
export async function runtimeProbe(){return {ready:true,python:'3.13',paddleocr:'3.x',paddlex:'3.x',paddle:'3.2.1',pipelineVersion:'v1.6',backend:'native'}}
export async function runDocument({document,sourcePath,benchmark}){
 if ('groundTruth' in document || 'expectedProductRows' in document) throw new Error('label leakage');
 return {runtimeMs:7,estimatedCostVnd:0,rows:[{predictionId:'p1',kind:'product',status:'needs_review',source:{page:1,bbox:[0,0,1,1]},fields:{name:'Test product',sku:'SKU-1',unit:'Cái',unitPrice:123000}}]};
}`);
const readyOut = path.join(tmp, "ready-out");
r = spawnSync(process.execPath, [path.join(root, "benchmarks/vietnam-docbench/paddleocr-vl-benchmark.mjs"), "--manifest", manifestPath, "--adapter", readyAdapter, "--out-dir", readyOut], { encoding: "utf8" });
assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
const readyStatus = JSON.parse(fs.readFileSync(path.join(readyOut, "execution-status.json"), "utf8"));
assert.equal(readyStatus.status, "EXECUTED");
assert.ok(fs.existsSync(path.join(readyOut, "predictions.json")));
assert.ok(fs.existsSync(path.join(readyOut, "score", "report.json")));
assert.ok(fs.existsSync(path.join(readyOut, "promotion-decision.json")));
const report = JSON.parse(fs.readFileSync(path.join(readyOut, "score", "report.json"), "utf8"));
assert.equal(report.overall.rowDetection.recall, 1);
assert.equal(report.overall.fields.sku.exact, 1);
assert.equal(report.overall.fields.unitPrice.exact, 1);
assert.equal(report.overall.grounding.coverage, 1);
const promotion = JSON.parse(fs.readFileSync(path.join(readyOut, "promotion-decision.json"), "utf8"));
assert.equal(promotion.productionPromotionAllowed, false);

console.log("Phase 13.1B Paddle execution smoke: PASS");
