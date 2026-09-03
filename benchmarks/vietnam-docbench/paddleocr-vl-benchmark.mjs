#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { pathToFileURL, fileURLToPath } from "node:url";
import { validateManifest } from "./lib/schema.mjs";
import { canonicalJson } from "./lib/freeze.mjs";
import { validateEngineAdapterModule } from "./engines/protocol.mjs";

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2); const next = argv[i + 1];
    if (next && !next.startsWith("--")) { out[key] = next; i++; }
    else out[key] = true;
  }
  return out;
}
function readJson(p) { return JSON.parse(fs.readFileSync(p, "utf8")); }
function writeJson(p, value) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(value, null, 2) + "\n"); }
function sha256File(p) { return crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex"); }
function sha256Text(s) { return crypto.createHash("sha256").update(String(s)).digest("hex"); }
function safeEnvSnapshot() {
  return {
    pipelineVersion: process.env.SQ_PADDLEOCR_VL_PIPELINE_VERSION || "v1.6",
    backend: process.env.SQ_PADDLEOCR_VL_BACKEND || "native",
    device: process.env.SQ_PADDLEOCR_VL_DEVICE || "cpu",
    pythonConfigured: Boolean(process.env.SQ_PADDLEOCR_PYTHON),
    rawDirConfigured: Boolean(process.env.SQ_PADDLEOCR_RAW_DIR),
    serverConfigured: Boolean(process.env.SQ_PADDLEOCR_VL_SERVER_URL),
    apiKeyConfigured: Boolean(process.env.SQ_PADDLEOCR_VL_API_KEY),
  };
}
function publicDocument(doc) {
  return {
    id: doc.id,
    inputKind: doc.inputKind,
    documentType: doc.documentType,
    sourceSha256: doc.sourceSha256 || null,
  };
}
function runNode(script, args, { cwd = process.cwd() } = {}) {
  const result = spawnSync(process.execPath, [script, ...args], { cwd, encoding: "utf8", env: process.env });
  return { code: result.status ?? 1, stdout: result.stdout || "", stderr: result.stderr || "" };
}
function runtimeSummary(probe) {
  if (!probe) return null;
  return {
    schemaVersion: probe.schemaVersion || null,
    python: probe.python || null,
    platform: probe.platform || null,
    paddleocr: probe.paddleocr || null,
    paddlex: probe.paddlex || null,
    paddle: probe.paddle || null,
    pipelineVersion: probe.pipelineVersion || null,
    backend: probe.backend || null,
    device: probe.device || null,
    classImportReady: Boolean(probe.classImportReady),
    classImportError: probe.classImportError || null,
    serverConfigured: Boolean(probe.serverConfigured),
    apiKeyConfigured: Boolean(probe.apiKeyConfigured),
    ready: Boolean(probe.ready),
  };
}
function markdownStatus(status) {
  const lines = [
    "# Phase 13.1B — PaddleOCR-VL execution status",
    "",
    `Status: **${status.status}**`,
    `Engine: **${status.engine?.id || "unknown"}**`,
    `Dataset: **${status.dataset?.id || "unknown"}@${status.dataset?.version || "unknown"}**`,
    `Execution config SHA-256: \`${status.executionConfigSha256}\``,
    "",
    "## Runtime",
    "",
    `- Python: ${status.runtime?.python || "n/a"}`,
    `- Platform: ${status.runtime?.platform || "n/a"}`,
    `- paddleocr: ${status.runtime?.paddleocr || "not installed"}`,
    `- paddlex: ${status.runtime?.paddlex || "not installed"}`,
    `- paddle: ${status.runtime?.paddle || "not installed"}`,
    `- Pipeline: ${status.runtime?.pipelineVersion || status.config?.pipelineVersion || "n/a"}`,
    `- Backend: ${status.runtime?.backend || status.config?.backend || "n/a"}`,
    "",
  ];
  if (status.status !== "EXECUTED") {
    lines.push("## Blocker", "", status.blocker || "Runtime is not ready.", "", "> No predictions or accuracy metrics were fabricated.", "");
  } else {
    lines.push(
      "## Outputs", "",
      `- Predictions: \`${status.outputs.predictions}\``,
      `- Score report: \`${status.outputs.reportJson}\``,
      `- Promotion decision: \`${status.outputs.promotionJson}\``,
      ""
    );
  }
  return lines.join("\n");
}
export function buildExecutionConfig({ manifest, manifestPath, adapterPath, adapter, probe }) {
  return {
    schemaVersion: "sq-docbench-paddle-execution-config-v1",
    benchmarkPolicy: manifest.benchmarkPolicy,
    dataset: { id: manifest.id, version: manifest.version },
    manifestSha256: sha256File(manifestPath),
    engine: adapter.engine,
    config: safeEnvSnapshot(),
    runtime: runtimeSummary(probe),
    documents: manifest.documents.map(publicDocument),
    adapterSha256: sha256File(adapterPath),
  };
}

const args = parseArgs(process.argv);
if (!args.manifest || !args.adapter || !args["out-dir"]) {
  console.error("Usage: node .../paddleocr-vl-benchmark.mjs --manifest <private manifest> --adapter <paddle adapter> --out-dir <private report dir> [--fail-if-blocked]");
  process.exit(2);
}
const manifestPath = path.resolve(args.manifest);
const adapterPath = path.resolve(args.adapter);
const outDir = path.resolve(args["out-dir"]);
fs.mkdirSync(outDir, { recursive: true });
const manifest = validateManifest(readJson(manifestPath));
const adapter = validateEngineAdapterModule(await import(pathToFileURL(adapterPath).href));
if (typeof adapter.runtimeProbe !== "function") throw new Error("Phase 13.1B requires adapter.runtimeProbe()");
let probe = null;
let probeError = null;
try { probe = await adapter.runtimeProbe(); } catch (error) { probeError = String(error?.message || error); }
const executionConfig = buildExecutionConfig({ manifest, manifestPath, adapterPath, adapter, probe });
const executionConfigSha256 = sha256Text(canonicalJson(executionConfig));
writeJson(path.join(outDir, "execution-config.json"), executionConfig);

if (probeError || !probe?.ready) {
  const status = {
    schemaVersion: "sq-docbench-paddle-execution-status-v1",
    status: "BLOCKED_RUNTIME",
    generatedAt: new Date().toISOString(),
    engine: adapter.engine,
    dataset: { id: manifest.id, version: manifest.version },
    executionConfigSha256,
    config: executionConfig.config,
    runtime: runtimeSummary(probe),
    blocker: probeError || "PaddleOCR runtime is not installed/ready in this environment.",
    outputs: null,
  };
  writeJson(path.join(outDir, "execution-status.json"), status);
  fs.writeFileSync(path.join(outDir, "EXECUTION_STATUS.md"), markdownStatus(status) + "\n");
  console.log(`BLOCKED_RUNTIME ${adapter.engine.id}: ${status.blocker}`);
  if (args["fail-if-blocked"]) process.exit(3);
  process.exit(0);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const adapterRunner = path.join(here, "engines", "run-adapter.mjs");
const scorer = path.join(here, "run.mjs");
const predictionsPath = path.join(outDir, "predictions.json");
const scoreDir = path.join(outDir, "score");
const runResult = runNode(adapterRunner, ["--manifest", manifestPath, "--adapter", adapterPath, "--out", predictionsPath]);
fs.writeFileSync(path.join(outDir, "adapter.stdout.txt"), runResult.stdout);
fs.writeFileSync(path.join(outDir, "adapter.stderr.txt"), runResult.stderr);
if (runResult.code !== 0 || !fs.existsSync(predictionsPath)) {
  const status = {
    schemaVersion: "sq-docbench-paddle-execution-status-v1",
    status: "FAILED_INFERENCE",
    generatedAt: new Date().toISOString(),
    engine: adapter.engine,
    dataset: { id: manifest.id, version: manifest.version },
    executionConfigSha256,
    config: executionConfig.config,
    runtime: runtimeSummary(probe),
    blocker: `Adapter execution failed with exit code ${runResult.code}. See adapter.stderr.txt.`,
    outputs: null,
  };
  writeJson(path.join(outDir, "execution-status.json"), status);
  fs.writeFileSync(path.join(outDir, "EXECUTION_STATUS.md"), markdownStatus(status) + "\n");
  process.exit(4);
}
const scoreResult = runNode(scorer, ["--manifest", manifestPath, "--predictions", predictionsPath, "--out", scoreDir]);
fs.writeFileSync(path.join(outDir, "scorer.stdout.txt"), scoreResult.stdout);
fs.writeFileSync(path.join(outDir, "scorer.stderr.txt"), scoreResult.stderr);
if (scoreResult.code !== 0 || !fs.existsSync(path.join(scoreDir, "report.json"))) throw new Error(`Scorer failed (${scoreResult.code}): ${scoreResult.stderr || scoreResult.stdout}`);
const report = readJson(path.join(scoreDir, "report.json"));
const promotion = {
  schemaVersion: "sq-docbench-promotion-decision-v1",
  engine: report.engine,
  dataset: report.dataset,
  overall: report.gates,
  slices: Object.fromEntries([...new Set(manifest.documents.map((d) => d.inputKind))].map((slice) => {
    const m = report.slices?.[slice];
    if (!m) return [slice, { status: "NO_EVIDENCE" }];
    const checks = report.releaseGates ? Object.entries(report.releaseGates).map(([key, target]) => {
      const actual = key === "rowRecall" ? m.rowDetection.recall
        : key === "rowPrecision" ? m.rowDetection.precision
        : key === "skuExact" ? m.fields.sku?.exact
        : key === "unitPriceExact" ? m.fields.unitPrice?.exact
        : key === "autoApprovePrecision" ? m.autoApproval.precision
        : key === "maxUnsafeAutoApproveRate" ? m.autoApproval.unsafeRate
        : key === "groundingCoverage" ? m.grounding.coverage : null;
      const max = key.startsWith("max");
      return { key, actual, target, pass: actual != null && (max ? actual <= target : actual >= target) };
    }) : [];
    return [slice, { status: checks.length && checks.every((x) => x.pass) ? "PROMOTABLE" : "NOT_READY", checks }];
  })),
  productionPromotionAllowed: false,
  note: "Phase 13.1B is benchmark-only. Even a passing candidate requires an explicit later production phase.",
};
writeJson(path.join(outDir, "promotion-decision.json"), promotion);
const status = {
  schemaVersion: "sq-docbench-paddle-execution-status-v1",
  status: "EXECUTED",
  generatedAt: new Date().toISOString(),
  engine: adapter.engine,
  dataset: { id: manifest.id, version: manifest.version },
  executionConfigSha256,
  config: executionConfig.config,
  runtime: runtimeSummary(probe),
  outputs: {
    predictions: path.relative(outDir, predictionsPath),
    reportJson: path.relative(outDir, path.join(scoreDir, "report.json")),
    reportMd: path.relative(outDir, path.join(scoreDir, "report.md")),
    promotionJson: "promotion-decision.json",
  },
};
writeJson(path.join(outDir, "execution-status.json"), status);
fs.writeFileSync(path.join(outDir, "EXECUTION_STATUS.md"), markdownStatus(status) + "\n");
console.log(`EXECUTED ${adapter.engine.id}: gates=${report.gates.pass ? "PASS" : "FAIL"}; report=${path.join(scoreDir, "report.md")}`);
