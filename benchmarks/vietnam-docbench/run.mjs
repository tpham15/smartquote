#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateManifest, validateGroundTruth, validatePredictions } from "./lib/schema.mjs";
import { alignProductRows } from "./lib/match.mjs";
import { scoreAlignment, aggregateMetricReports, criticalRowCorrect } from "./lib/metrics.mjs";
import { evaluateGates, DEFAULT_RELEASE_GATES } from "./lib/gates.mjs";
import { resolveDocBenchPolicy } from "./lib/policy.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) { const key = a.slice(2); const next = argv[i + 1]; if (next && !next.startsWith("--")) { out[key] = next; i++; } else out[key] = true; }
  }
  return out;
}
function readJson(p) { return JSON.parse(fs.readFileSync(p, "utf8")); }
function resolveFrom(base, p) { return path.isAbsolute(p) ? p : path.resolve(base, p); }
function pct(v) { return v == null ? "n/a" : `${(v * 100).toFixed(2)}%`; }

function sliceKey(doc) {
  return [doc.inputKind, doc.documentType, ...(doc.tags || []).map((x) => `tag:${x}`)];
}

function markdownReport(report) {
  const m = report.overall;
  const lines = [
    `# SmartQuote Vietnam DocBench — ${report.engine.id}`,
    "",
    `Generated: ${report.generatedAt}`,
    `Documents: ${report.documents.length}`,
    "",
    "## Overall",
    "",
    "| Metric | Result |",
    "|---|---:|",
    `| Product row precision | ${pct(m.rowDetection.precision)} |`,
    `| Product row recall | ${pct(m.rowDetection.recall)} |`,
    `| Product row F1 | ${pct(m.rowDetection.f1)} |`,
    `| False product rate | ${pct(m.rowDetection.falseProductRate)} |`,
    `| SKU exact | ${pct(m.fields.sku?.exact)} |`,
    `| Unit price exact | ${pct(m.fields.unitPrice?.exact)} |`,
    `| Unit price within rounding (±${m.fields.unitPrice?.roundingToleranceVnd ?? 0} VND) | ${pct(m.fields.unitPrice?.withinRoundingRate)} |`,
    `| Quantity exact | ${pct(m.fields.quantity?.exact)} |`,
    `| Unit exact | ${pct(m.fields.unit?.exact)} |`,
    `| Product name token F1 | ${pct(m.nameTokenF1)} |`,
    `| Trusted-row accuracy | ${pct(m.trustedRows.accuracy)} |`,
    `| Auto-approve precision | ${pct(m.autoApproval.precision)} |`,
    `| Auto-approve coverage | ${pct(m.autoApproval.coverage)} |`,
    `| Unsafe auto-approve rate | ${pct(m.autoApproval.unsafeRate)} |`,
    `| Grounding coverage | ${pct(m.grounding.coverage)} |`,
    "",
    "## Release gates",
    "",
    `Overall: **${report.gates.pass ? "PASS" : "FAIL"}**`,
    "",
    "| Gate | Actual | Target | Pass |",
    "|---|---:|---:|:---:|",
    ...report.gates.checks.map((g) => `| ${g.key} | ${pct(g.actual)} | ${g.direction} ${pct(g.target)} | ${g.pass ? "✅" : "❌"} |`),
    "",
    "## Per document",
    "",
    "| Document | Input | Type | Recall | SKU | Price | Auto precision |",
    "|---|---|---|---:|---:|---:|---:|",
    ...report.documents.map((d) => `| ${d.documentId} | ${d.inputKind} | ${d.documentType} | ${pct(d.metrics.rowDetection.recall)} | ${pct(d.metrics.fields.sku?.exact)} | ${pct(d.metrics.fields.unitPrice?.exact)} | ${pct(d.metrics.autoApproval.precision)} |`),
    "",
    "> This benchmark measures business extraction correctness, not generic OCR character error rate.",
    "",
  ];
  return lines.join("\n");
}

const args = parseArgs(process.argv);
if (!args.manifest || !args.predictions) {
  console.error("Usage: node benchmarks/vietnam-docbench/run.mjs --manifest <manifest.json> --predictions <predictions.json> [--out <dir>]");
  process.exit(2);
}
const manifestPath = path.resolve(args.manifest);
const manifestDir = path.dirname(manifestPath);
const manifest = validateManifest(readJson(manifestPath));
const benchmarkPolicy = resolveDocBenchPolicy(manifest.benchmarkPolicy);
const predictions = validatePredictions(readJson(path.resolve(args.predictions)));
const predMap = new Map(predictions.documents.map((d) => [d.documentId, d]));
const docs = [];
for (const doc of manifest.documents) {
  const gt = validateGroundTruth(readJson(resolveFrom(manifestDir, doc.groundTruth)), doc.id);
  const pred = predMap.get(doc.id) || { documentId: doc.id, rows: [] };
  const alignment = alignProductRows(gt.rows, pred.rows || [], benchmarkPolicy);
  const metrics = scoreAlignment(alignment, benchmarkPolicy);
  docs.push({
    documentId: doc.id, inputKind: doc.inputKind, documentType: doc.documentType,
    supplier: doc.supplier || "", industry: doc.industry || "", tags: doc.tags || [],
    runtimeMs: pred.runtimeMs ?? null, estimatedCostVnd: pred.estimatedCostVnd ?? null,
    metrics,
    errors: {
      missedRowIds: alignment.falseNegatives.map((r) => r.rowId),
      falsePositivePredictionIds: alignment.falsePositives.map((r) => r.predictionId || null),
      unsafeAutoApprovals: alignment.pairs
        .filter((p) => p.pred.status === "auto_approved" && !p.gt.acceptance?.ignore && !p.pred.acceptance?.ignore)
        .filter((p) => !criticalRowCorrect(p.gt, p.pred))
        .map((p) => p.pred.predictionId || null),
    },
  });
}
const overall = aggregateMetricReports(docs);
const gates = evaluateGates(overall, manifest.releaseGates || DEFAULT_RELEASE_GATES);
const slices = {};
for (const doc of docs) for (const key of sliceKey(doc)) {
  slices[key] ||= [];
  slices[key].push(doc);
}
const sliceReports = Object.fromEntries(Object.entries(slices).map(([k, v]) => [k, aggregateMetricReports(v)]));
const report = { schemaVersion: "sq-docbench-report-v1", benchmarkPolicy: benchmarkPolicy.id, generatedAt: new Date().toISOString(), engine: predictions.engine, dataset: { id: manifest.id || path.basename(manifestPath), version: manifest.version || "unversioned" }, releaseGates: manifest.releaseGates || DEFAULT_RELEASE_GATES, gates, overall, slices: sliceReports, documents: docs };
const outDir = path.resolve(args.out || path.join(here, "reports", predictions.engine.id));
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "report.json"), JSON.stringify(report, null, 2) + "\n");
fs.writeFileSync(path.join(outDir, "report.md"), markdownReport(report) + "\n");
console.log(`DocBench ${predictions.engine.id}: row recall ${pct(overall.rowDetection.recall)}, SKU ${pct(overall.fields.sku?.exact)}, price ${pct(overall.fields.unitPrice?.exact)}, auto precision ${pct(overall.autoApproval.precision)} -> gates ${gates.pass ? "PASS" : "FAIL"}`);
console.log(`Report: ${path.join(outDir, "report.md")}`);
if (args["fail-on-gates"] && !gates.pass) process.exit(1);
