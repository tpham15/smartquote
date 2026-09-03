#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { sha256File, writeJson } from "../benchmarks/vietnam-docbench/evidence-provenance.mjs";
import { buildRouteDecision, markdownDecision } from "../benchmarks/vietnam-docbench/route-decision.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2), next = argv[i + 1];
      if (next && !next.startsWith("--")) { out[key] = next; i++; } else out[key] = true;
    } else if (!out.privateRoot) out.privateRoot = a;
  }
  return out;
}
function runNode(script, argv) {
  return spawnSync(process.execPath, [script, ...argv], { cwd: root, encoding: "utf8", env: process.env });
}
function writeText(p, text) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text || ""); }
function readJson(p) { return JSON.parse(fs.readFileSync(p, "utf8")); }
function statusMarkdown(s) {
  return [
    "# Phase 13.1F — PaddleOCR Official API execution", "",
    `Status: **${s.status}**`,
    `Backend: **${s.backend}**`,
    `Model: **${s.model}**`,
    `Dataset: **${s.dataset.id}@${s.dataset.version}**`, "",
    "## Client / auth", "",
    `- Hosted API client ready: ${s.client.clientReady ? "YES" : "NO"}`,
    `- Access token configured: ${s.client.tokenConfigured ? "YES" : "NO"}`,
    `- External upload explicitly acknowledged: ${s.client.uploadAcknowledged ? "YES" : "NO"}`,
    `- Production routing changed: NO`,
    `- Production promotion allowed: NO`, "",
    ...(s.blocker ? ["## Blocker", "", s.blocker, "", "> No predictions or accuracy values are created when the hosted execution is blocked.", ""] : []),
  ].join("\n");
}

const a = parseArgs(process.argv);
if (!a.privateRoot) {
  console.error("Usage: node scripts/phase131f-run-official-api.mjs /absolute/path/to/private-corpus [--out-dir <dir>]");
  process.exit(2);
}
const privateRoot = path.resolve(a.privateRoot);
const manifest = path.join(privateRoot, "manifest-paddle-pdf-subset.json");
const fullManifest = path.join(privateRoot, "manifest.json");
const lock = path.join(privateRoot, "freeze-lock.json");
for (const p of [manifest, fullManifest, lock]) if (!fs.existsSync(p)) throw new Error(`Private frozen benchmark package incomplete: ${p}`);
const adapterPath = path.join(root, "benchmarks/vietnam-docbench/engines/paddleocr-official-api-1.6.mjs");
const outDir = path.resolve(a["out-dir"] || path.join(privateRoot, "reports", "phase13.1F-paddleocr-official-api-1.6"));
const rawDir = path.join(outDir, "raw");
fs.mkdirSync(outDir, { recursive: true });
process.env.SQ_PADDLEOCR_RAW_DIR = rawDir;
const localCli = path.join(root, ".venv_paddleocr_api", "bin", "paddleocr");
if (!process.env.SQ_PADDLEOCR_CLI && fs.existsSync(localCli)) process.env.SQ_PADDLEOCR_CLI = localCli;

let r = runNode(path.join(root, "scripts/phase130b-freeze-corpus.mjs"), ["--verify", "--manifest", fullManifest, "--lock", lock]);
writeText(path.join(outDir, "freeze-verify.stdout.txt"), r.stdout);
writeText(path.join(outDir, "freeze-verify.stderr.txt"), r.stderr);
if (r.status !== 0) throw new Error(`Frozen corpus verification failed: ${r.stderr || r.stdout}`);

const adapter = await import(pathToFileURL(adapterPath).href + `?phase131f=${Date.now()}`);
const probe = adapter.runtimeProbe();
const manifestJson = readJson(manifest);
const identity = {
  schemaVersion: "sq-phase131f-hosted-execution-identity-v1",
  phase: "13.1F",
  generatedAt: new Date().toISOString(),
  backend: "paddleocr-official-api",
  modelType: "doc_parsing",
  model: "PaddleOCR-VL-1.6",
  manifestSha256: sha256File(manifest),
  freezeLockSha256: sha256File(lock),
  adapterSha256: sha256File(adapterPath),
  dataset: { id: manifestJson.id, version: manifestJson.version },
  client: {
    commandConfigured: Boolean(process.env.SQ_PADDLEOCR_CLI),
    clientReady: Boolean(probe.clientReady),
    tokenConfigured: Boolean(probe.tokenConfigured),
    uploadAcknowledged: Boolean(probe.uploadAcknowledged),
    customBaseUrlConfigured: Boolean(process.env.PADDLEOCR_BASE_URL),
  },
  secretsSerialized: false,
  externalDocumentUpload: true,
  productionPromotionAllowed: false,
  productionRoutingChanged: false,
};
writeJson(path.join(outDir, "hosted-execution-identity.json"), identity);

const baseStatus = {
  schemaVersion: "sq-phase131f-execution-status-v1",
  phase: "13.1F",
  generatedAt: new Date().toISOString(),
  backend: "paddleocr-official-api",
  model: "PaddleOCR-VL-1.6",
  engine: adapter.engine,
  dataset: identity.dataset,
  client: identity.client,
  productionPromotionAllowed: false,
  productionRoutingChanged: false,
};
if (!probe.ready) {
  const reasons = [];
  if (!probe.clientReady) reasons.push(`PaddleOCR official API client unavailable${probe.clientError ? `: ${probe.clientError}` : "."}`);
  if (!probe.tokenConfigured) reasons.push("PADDLEOCR_ACCESS_TOKEN is not configured.");
  if (!probe.uploadAcknowledged) reasons.push("SQ_PADDLEOCR_OFFICIAL_API_ACK_UPLOAD=YES is required before frozen PDFs may leave the machine.");
  const status = { ...baseStatus, status: "BLOCKED_RUNTIME", blocker: reasons.join(" "), outputs: null };
  writeJson(path.join(outDir, "execution-status.json"), status);
  writeText(path.join(outDir, "EXECUTION_STATUS.md"), statusMarkdown(status) + "\n");
  const decision = buildRouteDecision({ executionStatus: status });
  writeJson(path.join(outDir, "route-decision.json"), decision);
  writeText(path.join(outDir, "ROUTE_DECISION.md"), markdownDecision(decision) + "\n");
  console.log(`Phase 13.1F: BLOCKED_RUNTIME; ${status.blocker}`);
  process.exit(a["fail-if-blocked"] ? 3 : 0);
}

const predictions = path.join(outDir, "predictions.json");
r = runNode(path.join(root, "benchmarks/vietnam-docbench/engines/run-adapter.mjs"), ["--manifest", manifest, "--adapter", adapterPath, "--out", predictions]);
writeText(path.join(outDir, "adapter.stdout.txt"), r.stdout);
writeText(path.join(outDir, "adapter.stderr.txt"), r.stderr);
if (r.status !== 0 || !fs.existsSync(predictions)) {
  const status = { ...baseStatus, status: "FAILED_INFERENCE", blocker: `Official API adapter failed with exit code ${r.status}.`, outputs: null };
  writeJson(path.join(outDir, "execution-status.json"), status);
  writeText(path.join(outDir, "EXECUTION_STATUS.md"), statusMarkdown(status) + "\n");
  throw new Error(r.stderr || r.stdout || status.blocker);
}

const scoreDir = path.join(outDir, "score");
r = runNode(path.join(root, "benchmarks/vietnam-docbench/run.mjs"), ["--manifest", manifest, "--predictions", predictions, "--out", scoreDir]);
writeText(path.join(outDir, "scorer.stdout.txt"), r.stdout);
writeText(path.join(outDir, "scorer.stderr.txt"), r.stderr);
if (r.status !== 0) throw new Error(`Scorer failed: ${r.stderr || r.stdout}`);

r = runNode(path.join(root, "benchmarks/vietnam-docbench/error-analysis.mjs"), ["--manifest", manifest, "--predictions", predictions, "--out-dir", outDir]);
writeText(path.join(outDir, "analysis.stdout.txt"), r.stdout);
writeText(path.join(outDir, "analysis.stderr.txt"), r.stderr);
if (r.status !== 0) throw new Error(`Error analysis failed: ${r.stderr || r.stdout}`);

const reportPath = path.join(scoreDir, "report.json");
const analysisPath = path.join(outDir, "error-analysis.json");
const status = {
  ...baseStatus,
  status: "EXECUTED",
  outputs: {
    predictions: "predictions.json",
    scoreReport: "score/report.json",
    errorAnalysis: "error-analysis.json",
    rawDirectory: "raw/",
  },
};
writeJson(path.join(outDir, "execution-status.json"), status);
writeText(path.join(outDir, "EXECUTION_STATUS.md"), statusMarkdown(status) + "\n");
const decision = buildRouteDecision({ executionStatus: status, report: readJson(reportPath), errorAnalysis: readJson(analysisPath) });
writeJson(path.join(outDir, "route-decision.json"), decision);
writeText(path.join(outDir, "ROUTE_DECISION.md"), markdownDecision(decision) + "\n");
const summary = {
  schemaVersion: "sq-phase131f-summary-v1",
  phase: "13.1F",
  generatedAt: new Date().toISOString(),
  backend: "paddleocr-official-api",
  model: "PaddleOCR-VL-1.6",
  executionStatus: status.status,
  routeDecision: decision.decision,
  score: readJson(reportPath).overall || null,
  productionPromotionAllowed: false,
  productionRoutingChanged: false,
};
writeJson(path.join(outDir, "phase13.1F-summary.json"), summary);
console.log(`Phase 13.1F: EXECUTED; decision=${decision.decision}; output=${outDir}`);
