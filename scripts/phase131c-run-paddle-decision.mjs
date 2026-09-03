#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import dns from "node:dns/promises";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) { const key = a.slice(2), next = argv[i + 1]; if (next && !next.startsWith("--")) { out[key] = next; i++; } else out[key] = true; }
    else if (!out.privateRoot) out.privateRoot = a;
  }
  return out;
}
function run(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { cwd: root, encoding: "utf8", env: process.env, ...opts });
}
function writeJson(p, v) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(v, null, 2) + "\n"); }
async function networkEvidence() {
  const hosts = ["pypi.org", "www.paddlepaddle.org.cn", "paddle-model-ecology.bj.bcebos.com"];
  const results = [];
  for (const host of hosts) {
    const started = Date.now();
    try { const r = await dns.lookup(host); results.push({ host, dnsReady: true, addressFamily: r.family, elapsedMs: Date.now() - started }); }
    catch (e) { results.push({ host, dnsReady: false, errorCode: e.code || null, error: e.message, elapsedMs: Date.now() - started }); }
  }
  return { schemaVersion: "sq-phase131c-network-evidence-v1", generatedAt: new Date().toISOString(), results };
}

const a = parseArgs(process.argv);
if (!a.privateRoot) {
  console.error("Usage: node scripts/phase131c-run-paddle-decision.mjs /absolute/path/to/private-corpus");
  process.exit(2);
}
const privateRoot = path.resolve(a.privateRoot);
const manifest = path.join(privateRoot, "manifest-paddle-pdf-subset.json");
const fullManifest = path.join(privateRoot, "manifest.json");
const lock = path.join(privateRoot, "freeze-lock.json");
if (![manifest, fullManifest, lock].every(fs.existsSync)) throw new Error("Private frozen benchmark package is incomplete");
const outDir = path.join(privateRoot, "reports", "phase13.1C-paddleocr-vl-1.6");
fs.mkdirSync(outDir, { recursive: true });
writeJson(path.join(outDir, "network-evidence.json"), await networkEvidence());

const localPython = path.join(root, ".venv_paddleocr_vl", "bin", "python");
if (!process.env.SQ_PADDLEOCR_PYTHON) process.env.SQ_PADDLEOCR_PYTHON = fs.existsSync(localPython) ? localPython : "python3";
process.env.SQ_PADDLEOCR_VL_PIPELINE_VERSION ||= "v1.6";
process.env.SQ_PADDLEOCR_VL_BACKEND ||= "native";
process.env.SQ_PADDLEOCR_VL_DEVICE ||= "cpu";
process.env.SQ_PADDLEOCR_RAW_DIR ||= path.join(privateRoot, "raw", "phase13.1C-paddleocr-vl-1.6");

let r = run(process.execPath, [path.join(root, "scripts/phase130b-freeze-corpus.mjs"), "--verify", "--manifest", fullManifest, "--lock", lock]);
fs.writeFileSync(path.join(outDir, "freeze-verify.stdout.txt"), r.stdout || "");
fs.writeFileSync(path.join(outDir, "freeze-verify.stderr.txt"), r.stderr || "");
if (r.status !== 0) throw new Error(`Frozen corpus verification failed: ${r.stderr || r.stdout}`);

r = run(process.execPath, [
  path.join(root, "benchmarks/vietnam-docbench/paddleocr-vl-benchmark.mjs"),
  "--manifest", manifest,
  "--adapter", path.join(root, "benchmarks/vietnam-docbench/engines/paddleocr-vl-1.6.mjs"),
  "--out-dir", outDir,
]);
fs.writeFileSync(path.join(outDir, "benchmark.stdout.txt"), r.stdout || "");
fs.writeFileSync(path.join(outDir, "benchmark.stderr.txt"), r.stderr || "");
if (r.status !== 0) throw new Error(`Paddle benchmark orchestrator failed: ${r.stderr || r.stdout}`);

const statusPath = path.join(outDir, "execution-status.json");
const status = JSON.parse(fs.readFileSync(statusPath, "utf8"));
let analysisPath = null, reportPath = null;
if (status.status === "EXECUTED") {
  const predictions = path.join(outDir, "predictions.json");
  reportPath = path.join(outDir, "score", "report.json");
  r = run(process.execPath, [path.join(root, "benchmarks/vietnam-docbench/error-analysis.mjs"), "--manifest", manifest, "--predictions", predictions, "--out-dir", outDir]);
  if (r.status !== 0) throw new Error(`Error analysis failed: ${r.stderr || r.stdout}`);
  fs.writeFileSync(path.join(outDir, "analysis.stdout.txt"), r.stdout || "");
  fs.writeFileSync(path.join(outDir, "analysis.stderr.txt"), r.stderr || "");
  analysisPath = path.join(outDir, "error-analysis.json");
}
r = run(process.execPath, [
  path.join(root, "benchmarks/vietnam-docbench/route-decision.mjs"),
  "--status", statusPath,
  ...(reportPath ? ["--report", reportPath] : []),
  ...(analysisPath ? ["--analysis", analysisPath] : []),
  "--out-dir", outDir,
]);
if (r.status !== 0) throw new Error(`Route decision failed: ${r.stderr || r.stdout}`);
fs.writeFileSync(path.join(outDir, "decision.stdout.txt"), r.stdout || "");
fs.writeFileSync(path.join(outDir, "decision.stderr.txt"), r.stderr || "");
const decision = JSON.parse(fs.readFileSync(path.join(outDir, "route-decision.json"), "utf8"));
const executionSummary = {
  schemaVersion: "sq-phase131c-run-summary-v1",
  generatedAt: new Date().toISOString(),
  dataset: status.dataset,
  engine: status.engine,
  executionStatus: status.status,
  routeDecision: decision.decision,
  productionChanged: false,
  outputDir: outDir,
};
writeJson(path.join(outDir, "phase13.1C-summary.json"), executionSummary);
console.log(`Phase 13.1C: execution=${status.status}; decision=${decision.decision}; output=${outDir}`);
