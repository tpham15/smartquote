#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readJson, semanticHash, sha256File, verifyInventory, writeJson } from "../benchmarks/vietnam-docbench/evidence-provenance.mjs";
import { buildRouteDecision } from "../benchmarks/vietnam-docbench/route-decision.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
function args(argv) { const out = {}; for (let i = 2; i < argv.length; i++) { const a = argv[i]; if (!a.startsWith("--")) continue; const k = a.slice(2), n = argv[i + 1]; if (n && !n.startsWith("--")) { out[k] = n; i++; } else out[k] = true; } return out; }
function run(script, argv) { return spawnSync(process.execPath, [script, ...argv], { cwd: root, encoding: "utf8", env: process.env }); }
function sameSemantic(a, b) { return semanticHash(a) === semanticHash(b); }
function markdown(v, handoff) {
  const lines = [
    "# Phase 13.1E — Imported Paddle evidence verification", "",
    `Trust status: **${v.trustStatus}**`,
    `Execution: **${v.executionStatus || "UNKNOWN"}**`,
    `Route decision: **${v.routeDecision || "NO_DECISION"}**`,
    `Production promotion allowed: **NO**`, "",
    "## Integrity", "",
    `- File inventory: ${v.integrityPass ? "PASS" : "FAIL"}`,
    `- Frozen identity: ${v.identityPass ? "PASS" : "FAIL"}`,
    `- Deterministic re-score: ${v.rescorePass == null ? "N/A" : v.rescorePass ? "PASS" : "FAIL"}`,
    `- Error-analysis replay: ${v.analysisPass == null ? "N/A" : v.analysisPass ? "PASS" : "FAIL"}`,
    `- Route-decision replay: ${v.decisionReplayPass == null ? "N/A" : v.decisionReplayPass ? "PASS" : "FAIL"}`, "",
  ];
  if (v.problems.length) lines.push("## Problems", "", ...v.problems.map((p) => `- ${p.type}${p.path ? `: ${p.path}` : ""}${p.detail ? ` — ${p.detail}` : ""}`), "");
  lines.push("## Canary handoff", "", `Status: **${handoff.status}**`, handoff.reason || "", "", "> 13.1E only verifies evidence and prepares a handoff. It never changes SmartQuote production routing.", "");
  return lines.join("\n");
}
const a = args(process.argv);
if (!a["evidence-dir"] || !a["private-root"]) { console.error("Usage: node scripts/phase131e-verify-evidence.mjs --evidence-dir <dir> --private-root <private corpus> [--out-dir <dir>]"); process.exit(2); }
const evidenceDir = path.resolve(a["evidence-dir"]), privateRoot = path.resolve(a["private-root"]);
const outDir = path.resolve(a["out-dir"] || path.join(privateRoot, "reports", "phase13.1E-import-verification"));
const manifestPath = path.join(evidenceDir, "evidence-manifest.json");
if (!fs.existsSync(manifestPath)) throw new Error(`Missing evidence-manifest.json: ${manifestPath}`);
const sealed = readJson(manifestPath);
const artifacts = path.join(evidenceDir, "artifacts");
const problems = verifyInventory(evidenceDir, sealed.files || []);
const integrityPass = problems.length === 0;
const localPaths = {
  runtimeLock: path.join(root, "benchmarks/vietnam-docbench/runtime/paddleocr-vl-1.6/runtime-lock.json"),
  adapter: path.join(root, "benchmarks/vietnam-docbench/engines/paddleocr-vl-1.6.mjs"),
  manifest: path.join(privateRoot, "manifest-paddle-pdf-subset.json"),
  freezeLock: path.join(privateRoot, "freeze-lock.json"),
};
for (const [name, p] of Object.entries(localPaths)) if (!fs.existsSync(p)) problems.push({ type: "missing_local_identity", path: name, detail: p });
const expected = sealed.fingerprints || {};
const identityChecks = fs.existsSync(localPaths.runtimeLock) && fs.existsSync(localPaths.adapter) && fs.existsSync(localPaths.manifest) && fs.existsSync(localPaths.freezeLock) ? [
  ["runtimeLockSha256", sha256File(localPaths.runtimeLock)], ["adapterSha256", sha256File(localPaths.adapter)], ["manifestSha256", sha256File(localPaths.manifest)], ["freezeLockSha256", sha256File(localPaths.freezeLock)],
] : [];
for (const [key, actual] of identityChecks) if (!expected[key] || expected[key] !== actual) problems.push({ type: "identity_mismatch", path: key, detail: `expected=${expected[key] || "missing"} local=${actual}` });
const identityPass = identityChecks.length === 4 && !problems.some((p) => ["missing_local_identity", "identity_mismatch"].includes(p.type));
let rescorePass = null, analysisPass = null, decisionReplayPass = null, routeDecision = sealed.routeDecision || null;
const statusPath = path.join(artifacts, "execution-status.json");
const executionStatus = fs.existsSync(statusPath) ? readJson(statusPath) : null;
if (!executionStatus) problems.push({ type: "missing_execution_status", path: "artifacts/execution-status.json" });
if (executionStatus?.status === "EXECUTED" && integrityPass && identityPass) {
  const predictions = path.join(artifacts, "predictions.json"), importedReport = path.join(artifacts, "score", "report.json"), importedAnalysis = path.join(artifacts, "error-analysis.json"), importedDecision = path.join(artifacts, "route-decision.json");
  for (const p of [predictions, importedReport, importedAnalysis, importedDecision]) if (!fs.existsSync(p)) problems.push({ type: "missing_executed_artifact", path: path.relative(evidenceDir, p) });
  if (!problems.some((p) => p.type === "missing_executed_artifact")) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sq131e-replay-"));
    const scoreDir = path.join(tmp, "score");
    let r = run(path.join(root, "benchmarks/vietnam-docbench/run.mjs"), ["--manifest", localPaths.manifest, "--predictions", predictions, "--out", scoreDir]);
    if (r.status !== 0) problems.push({ type: "rescore_failed", detail: r.stderr || r.stdout });
    else { rescorePass = sameSemantic(readJson(importedReport), readJson(path.join(scoreDir, "report.json"))); if (!rescorePass) problems.push({ type: "rescore_mismatch" }); }
    const analysisDir = path.join(tmp, "analysis");
    r = run(path.join(root, "benchmarks/vietnam-docbench/error-analysis.mjs"), ["--manifest", localPaths.manifest, "--predictions", predictions, "--out-dir", analysisDir]);
    if (r.status !== 0) problems.push({ type: "analysis_replay_failed", detail: r.stderr || r.stdout });
    else { analysisPass = sameSemantic(readJson(importedAnalysis), readJson(path.join(analysisDir, "error-analysis.json"))); if (!analysisPass) problems.push({ type: "analysis_replay_mismatch" }); }
    if (rescorePass && analysisPass) {
      const replay = buildRouteDecision({ executionStatus, report: readJson(path.join(scoreDir, "report.json")), errorAnalysis: readJson(path.join(analysisDir, "error-analysis.json")) });
      decisionReplayPass = sameSemantic(readJson(importedDecision), replay);
      routeDecision = replay.decision;
      if (!decisionReplayPass) problems.push({ type: "route_decision_replay_mismatch" });
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
const allPass = integrityPass && identityPass && (executionStatus?.status !== "EXECUTED" || (rescorePass && analysisPass && decisionReplayPass)) && problems.length === 0;
const trustStatus = allPass ? (executionStatus?.status === "EXECUTED" ? "TRUSTED_EXECUTED" : "TRUSTED_NONEXECUTED") : "REJECTED";
const canaryDecisions = new Set(["SCAN_REVIEW_CANARY_ELIGIBLE", "DIGITAL_REVIEW_CANARY_ELIGIBLE", "REVIEW_FALLBACK_CANDIDATE"]);
const handoff = {
  schemaVersion: "sq-phase131e-canary-handoff-v1", phase: "13.1E", generatedAt: new Date().toISOString(),
  status: trustStatus === "TRUSTED_EXECUTED" && canaryDecisions.has(routeDecision) ? "READY_FOR_EXPLICIT_CANARY_DESIGN" : "NOT_ELIGIBLE",
  reason: trustStatus !== "TRUSTED_EXECUTED" ? "Only trusted real executions can produce a canary handoff." : canaryDecisions.has(routeDecision) ? "Frozen evidence replayed successfully and the 13.1C review-only gate is eligible." : "Trusted evidence does not pass a review-only canary gate.",
  routeDecision, evidenceTrust: trustStatus, humanReviewRequired: true, autoApprovalAllowed: false, productionPromotionAllowed: false, productionRoutingChanged: false,
};
const verification = {
  schemaVersion: "sq-phase131e-evidence-verification-v1", phase: "13.1E", generatedAt: new Date().toISOString(), trustStatus,
  executionStatus: executionStatus?.status || null, routeDecision, integrityPass, identityPass, rescorePass, analysisPass, decisionReplayPass, problems,
  localIdentity: Object.fromEntries(identityChecks.map(([k, v]) => [k, v])), productionPromotionAllowed: false, productionRoutingChanged: false,
};
writeJson(path.join(outDir, "evidence-verification.json"), verification);
writeJson(path.join(outDir, "canary-handoff.json"), handoff);
fs.writeFileSync(path.join(outDir, "PHASE_13_1E_VERIFICATION.md"), markdown(verification, handoff) + "\n");
console.log(`Phase 13.1E verify: trust=${trustStatus}; execution=${verification.executionStatus}; decision=${routeDecision}; handoff=${handoff.status}`);
if (trustStatus === "REJECTED") process.exit(5);
