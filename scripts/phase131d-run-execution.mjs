#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

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
function run(cmd, args) { return spawnSync(cmd, args, { cwd: root, encoding: "utf8", env: process.env }); }
function readJson(p) { return JSON.parse(fs.readFileSync(p, "utf8")); }
function writeJson(p, v) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(v, null, 2) + "\n"); }
function sha256(p) { return crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex"); }
function capture(outDir, name, result) {
  fs.writeFileSync(path.join(outDir, `${name}.stdout.txt`), result.stdout || "");
  fs.writeFileSync(path.join(outDir, `${name}.stderr.txt`), result.stderr || "");
  fs.writeFileSync(path.join(outDir, `${name}.exit-code.txt`), `${result.status ?? 1}\n`);
}
function markdown(summary) {
  const lines = [
    "# Phase 13.1D — Actual PaddleOCR-VL execution evidence",
    "",
    `Execution status: **${summary.executionStatus}**`,
    `Route decision: **${summary.routeDecision || "NO_DECISION"}**`,
    `Runtime profile: **${summary.runtimeProfile}**`,
    `Mode: **${summary.mode}**`,
    `Production routing changed: **NO**`,
    "",
    "## Frozen execution identity",
    "",
    `- Runtime lock SHA-256: \`${summary.fingerprints.runtimeLockSha256}\``,
    `- Adapter SHA-256: \`${summary.fingerprints.adapterSha256}\``,
    `- Paddle manifest SHA-256: \`${summary.fingerprints.manifestSha256}\``,
    `- Freeze lock SHA-256: \`${summary.fingerprints.freezeLockSha256}\``,
    "",
    "## Observed runtime",
    "",
    `- Python: ${summary.runtime?.python || "n/a"}`,
    `- PaddleOCR: ${summary.runtime?.paddleocr || "n/a"}`,
    `- PaddleX: ${summary.runtime?.paddlex || "n/a"}`,
    `- PaddlePaddle: ${summary.runtime?.paddle || "n/a"}`,
    `- Node: ${summary.nodeVersion || "n/a"}`,
    `- Device: ${summary.runtime?.device || "n/a"}`,
    `- Runtime image ID: ${summary.runtimeImageId || "n/a"}`,
    "",
  ];
  if (summary.executionStatus === "EXECUTED") {
    lines.push("## Result", "", "Real PaddleOCR-VL predictions were produced, scored with the frozen scorer, analyzed row-by-row, and passed into the unchanged route-decision layer.", "");
  } else {
    lines.push("## Result", "", summary.blocker || "Execution did not complete.", "", "> No missing runtime/model state is converted into fake predictions or accuracy metrics.", "");
  }
  lines.push("## Boundary", "", "Phase 13.1D is execution infrastructure only. `productionPromotionAllowed` remains false; any production canary requires a separate explicit phase.", "");
  return lines.join("\n");
}

const a = parseArgs(process.argv);
if (!a.privateRoot) {
  console.error("Usage: node scripts/phase131d-run-execution.mjs /private/root --doctor <doctor.json> [--profile cpu|gpu-cu126] [--mode online|offline]");
  process.exit(2);
}
const privateRoot = path.resolve(a.privateRoot);
const manifest = path.join(privateRoot, "manifest-paddle-pdf-subset.json");
const fullManifest = path.join(privateRoot, "manifest.json");
const freezeLock = path.join(privateRoot, "freeze-lock.json");
const doctorPath = path.resolve(a.doctor || path.join(privateRoot, "reports", "phase13.1D-runtime-doctor.json"));
const runtimeLock = path.join(root, "benchmarks/vietnam-docbench/runtime/paddleocr-vl-1.6/runtime-lock.json");
const adapter = path.join(root, "benchmarks/vietnam-docbench/engines/paddleocr-vl-1.6.mjs");
for (const p of [manifest, fullManifest, freezeLock, doctorPath, runtimeLock, adapter]) if (!fs.existsSync(p)) throw new Error(`Missing required Phase 13.1D input: ${p}`);

const doctor = readJson(doctorPath);
if (doctor.status !== "READY") throw new Error(`Phase 13.1D runtime doctor is not READY: ${doctor.status}: ${doctor.blocker || "unknown blocker"}`);
const outDir = path.join(privateRoot, "reports", "phase13.1D-paddleocr-vl-1.6");
fs.mkdirSync(outDir, { recursive: true });
fs.copyFileSync(doctorPath, path.join(outDir, "runtime-doctor.json"));
fs.copyFileSync(runtimeLock, path.join(outDir, "runtime-lock.json"));

let r = run(process.execPath, [path.join(root, "scripts/phase130b-freeze-corpus.mjs"), "--verify", "--manifest", fullManifest, "--lock", freezeLock]);
capture(outDir, "freeze-verify", r);
if (r.status !== 0) throw new Error(`Frozen corpus verification failed: ${r.stderr || r.stdout}`);

process.env.SQ_PADDLEOCR_PYTHON ||= "python3";
process.env.SQ_PADDLEOCR_VL_PIPELINE_VERSION = "v1.6";
process.env.SQ_PADDLEOCR_VL_BACKEND = "native";
process.env.SQ_PADDLEOCR_RAW_DIR ||= path.join(privateRoot, "raw", "phase13.1D-paddleocr-vl-1.6");

r = run(process.execPath, [
  path.join(root, "benchmarks/vietnam-docbench/paddleocr-vl-benchmark.mjs"),
  "--manifest", manifest,
  "--adapter", adapter,
  "--out-dir", outDir,
]);
capture(outDir, "benchmark", r);
if (r.status !== 0) throw new Error(`Paddle benchmark orchestrator failed (${r.status}): ${r.stderr || r.stdout}`);

const statusPath = path.join(outDir, "execution-status.json");
const status = readJson(statusPath);
let reportPath = null, analysisPath = null;
if (status.status === "EXECUTED") {
  reportPath = path.join(outDir, "score", "report.json");
  r = run(process.execPath, [path.join(root, "benchmarks/vietnam-docbench/error-analysis.mjs"), "--manifest", manifest, "--predictions", path.join(outDir, "predictions.json"), "--out-dir", outDir]);
  capture(outDir, "analysis", r);
  if (r.status !== 0) throw new Error(`Error analysis failed: ${r.stderr || r.stdout}`);
  analysisPath = path.join(outDir, "error-analysis.json");
}

r = run(process.execPath, [
  path.join(root, "benchmarks/vietnam-docbench/route-decision.mjs"),
  "--status", statusPath,
  ...(reportPath ? ["--report", reportPath] : []),
  ...(analysisPath ? ["--analysis", analysisPath] : []),
  "--out-dir", outDir,
]);
capture(outDir, "decision", r);
if (r.status !== 0) throw new Error(`Route decision failed: ${r.stderr || r.stdout}`);
const decision = readJson(path.join(outDir, "route-decision.json"));

const pipFreezePath = path.join(outDir, "pip-freeze.txt");
const pipFreeze = spawnSync(process.env.SQ_PADDLEOCR_PYTHON || "python3", ["-m", "pip", "freeze"], { cwd: root, encoding: "utf8", env: process.env });
fs.writeFileSync(pipFreezePath, pipFreeze.stdout || "");
fs.writeFileSync(path.join(outDir, "pip-freeze.stderr.txt"), pipFreeze.stderr || "");
const nodeVersion = process.version.replace(/^v/, "");

const summary = {
  schemaVersion: "sq-phase131d-execution-evidence-v1",
  phase: "13.1D",
  generatedAt: new Date().toISOString(),
  runtimeProfile: a.profile || "unknown",
  mode: a.mode || "online",
  runtimeImageId: process.env.SQ_PADDLE_RUNTIME_IMAGE_ID || null,
  nodeVersion,
  executionStatus: status.status,
  routeDecision: decision.decision,
  blocker: status.blocker || null,
  runtime: status.runtime || doctor.runtime,
  dataset: status.dataset,
  engine: status.engine,
  fingerprints: {
    runtimeLockSha256: sha256(runtimeLock),
    adapterSha256: sha256(adapter),
    manifestSha256: sha256(manifest),
    freezeLockSha256: sha256(freezeLock),
    pipFreezeSha256: fs.existsSync(pipFreezePath) ? sha256(pipFreezePath) : null,
  },
  outputs: status.outputs,
  productionPromotionAllowed: false,
  productionChanged: false,
};
writeJson(path.join(outDir, "phase13.1D-execution-evidence.json"), summary);
fs.writeFileSync(path.join(outDir, "PHASE_13_1D_EXECUTION.md"), markdown(summary) + "\n");
console.log(`Phase 13.1D: execution=${summary.executionStatus}; decision=${summary.routeDecision}; output=${outDir}`);
