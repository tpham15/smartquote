import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { smartQuotePreviewToPredictionDocument } from "../benchmarks/vietnam-docbench/adapters/smartquote-preview.mjs";
import { DOCBENCH_POLICY_V1 } from "../benchmarks/vietnam-docbench/lib/policy.mjs";

const root = process.cwd();
const fixture = path.join(root, "benchmarks/vietnam-docbench/fixtures/smoke");
const manifest = JSON.parse(fs.readFileSync(path.join(fixture, "manifest.json"), "utf8"));
assert.equal(manifest.benchmarkPolicy, DOCBENCH_POLICY_V1.id);
assert.equal(DOCBENCH_POLICY_V1.match.threshold, 0.38);
assert.equal(DOCBENCH_POLICY_V1.match.skuExactWeight, 0.56);

const previewDoc = smartQuotePreviewToPredictionDocument({ lines: [
  { lineId: "p1", kind: "catalog_product", rowType: "item", status: "need_review", raw: { productName: "SP", sku: "A", price: 100 } },
  { lineId: "n1", kind: "catalog_product", rowType: "header", status: "skipped", raw: { productName: "TỔNG HỢP" } },
  { lineId: "n2", kind: "service", rowType: "item", status: "need_review", raw: { productName: "Nhân công" } },
] }, "adapter-kind-smoke");
assert.deepEqual(previewDoc.rows.map((r) => r.kind), ["product", "non_product", "non_product"]);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sq-docbench-1301-"));
const run = spawnSync(process.execPath, [
  path.join(root, "benchmarks/vietnam-docbench/run.mjs"),
  "--manifest", path.join(fixture, "manifest.json"),
  "--predictions", path.join(fixture, "predictions-perfect.json"),
  "--out", tmp,
], { encoding: "utf8" });
assert.equal(run.status, 0, run.stderr || run.stdout);
const report = JSON.parse(fs.readFileSync(path.join(tmp, "report.json"), "utf8"));
assert.equal(report.benchmarkPolicy, DOCBENCH_POLICY_V1.id);
assert.equal(report.overall.fields.unitPrice.exact, 1);
assert.equal(report.overall.fields.unitPrice.withinRoundingRate, 1);
assert.equal(report.overall.fields.unitPrice.roundingToleranceVnd, 1000);

const envExample = fs.readFileSync(path.join(root, ".env.example"), "utf8");
assert.doesNotMatch(envExample, /^SMARTQUOTE_ALLOWED_ORIGIN=\*$/m);
assert.match(envExample, /CORS is CLOSED to cross-origin requests by default/);

const securityJs = fs.readFileSync(path.join(root, "api/_lib/security.js"), "utf8");
assert.doesNotMatch(securityJs, /SMARTQUOTE_ALLOWED_ORIGINS\s*\|\|\s*['"]\*['"]/);
const securityPy = fs.readFileSync(path.join(root, "api/auth_guard.py"), "utf8");
assert.doesNotMatch(securityPy, /SMARTQUOTE_ALLOWED_ORIGINS.*or "\*"/);

console.log("Phase 13.0.1 DocBench FixPack smoke: PASS");
