#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { validateManifest, validatePredictions } from "../benchmarks/vietnam-docbench/lib/schema.mjs";
import { analyzePredictions } from "../benchmarks/vietnam-docbench/error-analysis.mjs";
import { buildRouteDecision } from "../benchmarks/vietnam-docbench/route-decision.mjs";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sq-phase131c-"));
const gt = {
  schemaVersion: "sq-docbench-ground-truth-v1", documentId: "scan1",
  rows: [
    { rowId: "p1", kind: "product", source: { page: 1, row: 1 }, fields: { name: "Công tắc Luto", sku: "LM-S1", unitPrice: 100000 }, acceptance: { criticalFields: ["sku", "unitPrice"] } },
    { rowId: "p2", kind: "product", source: { page: 1, row: 2 }, fields: { name: "Cảm biến hiện diện", sku: "LM-PCB", unitPrice: 200000 }, acceptance: { criticalFields: ["sku", "unitPrice"] } },
    { rowId: "n1", kind: "non_product", source: { page: 1, row: 3 }, fields: { name: "Tổng cộng" } },
  ],
};
fs.writeFileSync(path.join(tmp, "gt.json"), JSON.stringify(gt));
const manifestPath = path.join(tmp, "manifest.json");
const manifest = {
  schemaVersion: "sq-docbench-manifest-v1", benchmarkPolicy: "sq-docbench-policy-v1", id: "phase131c-smoke", version: "1.0.0",
  releaseGates: { rowRecall: 0.5, rowPrecision: 0.5, skuExact: 0.5, unitPriceExact: 0.5, autoApprovePrecision: 0.999, maxUnsafeAutoApproveRate: 0.001, groundingCoverage: 0.5 },
  documents: [{ id: "scan1", inputKind: "scan_pdf", documentType: "supplier_price_list", groundTruth: "gt.json" }],
};
fs.writeFileSync(manifestPath, JSON.stringify(manifest));
const predictions = {
  schemaVersion: "sq-docbench-predictions-v1", engine: { id: "fake-paddle", version: "1.6" },
  documents: [{ documentId: "scan1", rows: [
    { predictionId: "r1", kind: "product", status: "needs_review", source: { page: 1, row: 1 }, fields: { name: "Công tắc Luto", sku: "LM-S1", unitPrice: 100000 } },
    { predictionId: "r2", kind: "product", status: "needs_review", source: { page: 1, row: 2 }, fields: { name: "Cảm biến hiện diện", sku: "LM-PCX", unitPrice: 201000 } },
    { predictionId: "r3", kind: "product", status: "needs_review", source: { page: 1, row: 3 }, fields: { name: "Tổng cộng", sku: "", unitPrice: null } },
  ] }],
};
const analysis = analyzePredictions({ manifest: validateManifest(manifest), manifestPath, predictions: validatePredictions(predictions) });
assert.equal(analysis.summary.missedProducts, 0);
assert.equal(analysis.summary.falseProducts, 1);
assert.equal(analysis.summary.likelyTrapFalseProducts, 1);
assert.equal(analysis.summary.criticalMatchedRowFailures, 1);
assert.equal(analysis.summary.errorTypeCounts.sku_mismatch, 1);
assert.equal(analysis.summary.errorTypeCounts.unitPrice_mismatch, 1);

const goodReviewMetrics = {
  rowDetection: { recall: 0.99, precision: 0.999 }, fields: { sku: { exact: 1 }, unitPrice: { exact: 1 } },
  autoApproval: { total: 0, precision: null, unsafeRate: null }, grounding: { coverage: 1 },
};
const executed = buildRouteDecision({
  executionStatus: { status: "EXECUTED", engine: predictions.engine, dataset: { id: manifest.id, version: manifest.version } },
  report: { engine: predictions.engine, dataset: { id: manifest.id, version: manifest.version }, releaseGates: manifest.releaseGates, gates: { pass: false }, slices: { scan_pdf: goodReviewMetrics } },
  errorAnalysis: analysis,
});
assert.equal(executed.decision, "SCAN_REVIEW_CANARY_ELIGIBLE");
assert.equal(executed.productionPromotionAllowed, false);
assert.equal(executed.slices.scan_pdf.reviewOnlyExtraction.pass, true);
assert.equal(executed.slices.scan_pdf.fullProduction.pass, false);

const blocked = buildRouteDecision({ executionStatus: { status: "BLOCKED_RUNTIME", blocker: "runtime missing", engine: predictions.engine, dataset: { id: manifest.id, version: manifest.version } } });
assert.equal(blocked.decision, "BLOCKED_RUNTIME");
assert.equal(blocked.productionPromotionAllowed, false);

console.log("Phase 13.1C error analysis + route decision smoke: PASS");
