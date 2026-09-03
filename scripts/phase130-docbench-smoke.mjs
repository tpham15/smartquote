import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { smartQuotePreviewToPredictionDocument } from "../benchmarks/vietnam-docbench/adapters/smartquote-preview.mjs";
import { validateManifest, validateGroundTruth, validatePredictions } from "../benchmarks/vietnam-docbench/lib/schema.mjs";

const root = process.cwd();
const fixture = path.join(root, "benchmarks/vietnam-docbench/fixtures/smoke");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sq-docbench-"));
const read = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const must = (cond, msg) => { if (!cond) throw new Error(msg); };

validateManifest(read(path.join(fixture, "manifest.json")));
validateGroundTruth(read(path.join(fixture, "gt-supplier.json")), "supplier-xlsx-clean");
validatePredictions(read(path.join(fixture, "predictions-perfect.json")));

const run = (pred, out, extra = []) => spawnSync(process.execPath, [
  path.join(root, "benchmarks/vietnam-docbench/run.mjs"),
  "--manifest", path.join(fixture, "manifest.json"),
  "--predictions", path.join(fixture, pred),
  "--out", path.join(tmp, out), ...extra,
], { encoding: "utf8" });

const perfect = run("predictions-perfect.json", "perfect", ["--fail-on-gates"]);
must(perfect.status === 0, `perfect fixture should pass gates: ${perfect.stderr || perfect.stdout}`);
const pReport = read(path.join(tmp, "perfect/report.json"));
must(pReport.gates.pass === true, "perfect gates must pass");
must(pReport.overall.rowDetection.recall === 1, "perfect recall must be 1");
must(pReport.overall.fields.sku.exact === 1, "perfect SKU exact must be 1");
must(pReport.overall.fields.unitPrice.exact === 1, "perfect price exact must be 1");
must(pReport.overall.autoApproval.precision === 1, "perfect auto precision must be 1");
must(pReport.slices.scan_pdf && pReport.slices["tag:blur"], "slice reports must exist");

const risky = run("predictions-risky.json", "risky", ["--fail-on-gates"]);
must(risky.status === 1, "risky fixture must fail gates");
const rReport = read(path.join(tmp, "risky/report.json"));
must(rReport.gates.pass === false, "risky gates must fail");
must((rReport.overall.rowDetection.falseProductRate ?? 0) > 0, "risky false-product rate must be detected");
must((rReport.overall.autoApproval.unsafe ?? 0) > 0, "unsafe auto approval must be detected");
must((rReport.overall.fields.unitPrice.exact ?? 1) < 1, "wrong price must reduce price exact metric");

const previewDoc = smartQuotePreviewToPredictionDocument({ lines: [{
  lineId: "l1", status: "auto_approved", confidence: 0.98,
  source: { sheet: "S", row: 3 },
  raw: { productName: "Tên", sku: "A", price: 100 },
  parsed: { productName: "Tên", sku: "A", unit: "Cái", costPrice: 100 },
}] }, "adapter-doc");
must(previewDoc.rows[0].fields.unitPrice === 100, "SmartQuote adapter must map cost price");
must(previewDoc.rows[0].source.row === 3, "SmartQuote adapter must preserve grounding row");

console.log("Phase 13.0 Vietnam DocBench smoke: PASS");
console.log(`Temporary reports: ${tmp}`);
