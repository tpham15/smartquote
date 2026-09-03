#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { sha256File } from "../benchmarks/vietnam-docbench/evidence-provenance.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixture = path.join(root, "benchmarks/vietnam-docbench/fixtures/smoke");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sq131e-smoke-"));
const priv = path.join(tmp, "private"), report = path.join(priv, "reports", "phase13.1D-paddleocr-vl-1.6");
fs.mkdirSync(report, { recursive: true });
for (const name of ["manifest.json", "gt-supplier.json", "gt-scan.json", "gt-bom.json"]) fs.copyFileSync(path.join(fixture, name), path.join(priv, name));
fs.copyFileSync(path.join(fixture, "manifest.json"), path.join(priv, "manifest-paddle-pdf-subset.json"));
fs.writeFileSync(path.join(priv, "freeze-lock.json"), JSON.stringify({ schemaVersion: "smoke-freeze", note: "identity-only smoke" }) + "\n");
fs.copyFileSync(path.join(fixture, "predictions-perfect.json"), path.join(report, "predictions.json"));
const manifest = path.join(priv, "manifest-paddle-pdf-subset.json"), predictions = path.join(report, "predictions.json");
function run(script, args) { return spawnSync(process.execPath, [script, ...args], { cwd: root, encoding: "utf8" }); }
let r = run(path.join(root, "benchmarks/vietnam-docbench/run.mjs"), ["--manifest", manifest, "--predictions", predictions, "--out", path.join(report, "score")]);
assert.equal(r.status, 0, r.stderr || r.stdout);
r = run(path.join(root, "benchmarks/vietnam-docbench/error-analysis.mjs"), ["--manifest", manifest, "--predictions", predictions, "--out-dir", report]);
assert.equal(r.status, 0, r.stderr || r.stdout);
const pred = JSON.parse(fs.readFileSync(predictions, "utf8"));
const status = { schemaVersion: "sq-docbench-paddle-execution-status-v1", status: "EXECUTED", engine: pred.engine, dataset: { id: "phase13-smoke", version: "1.0.0" }, outputs: { predictions: "predictions.json", reportJson: "score/report.json" } };
fs.writeFileSync(path.join(report, "execution-status.json"), JSON.stringify(status, null, 2));
r = run(path.join(root, "benchmarks/vietnam-docbench/route-decision.mjs"), ["--status", path.join(report, "execution-status.json"), "--report", path.join(report, "score/report.json"), "--analysis", path.join(report, "error-analysis.json"), "--out-dir", report]);
assert.equal(r.status, 0, r.stderr || r.stdout);
const runtimeLock = path.join(root, "benchmarks/vietnam-docbench/runtime/paddleocr-vl-1.6/runtime-lock.json");
const adapter = path.join(root, "benchmarks/vietnam-docbench/engines/paddleocr-vl-1.6.mjs");
const evidence = {
  schemaVersion: "sq-phase131d-execution-evidence-v1", phase: "13.1D", runtimeProfile: "smoke", mode: "offline", executionStatus: "EXECUTED",
  engine: pred.engine, dataset: status.dataset,
  fingerprints: { runtimeLockSha256: sha256File(runtimeLock), adapterSha256: sha256File(adapter), manifestSha256: sha256File(manifest), freezeLockSha256: sha256File(path.join(priv, "freeze-lock.json")), pipFreezeSha256: null },
  productionPromotionAllowed: false, productionChanged: false,
};
fs.writeFileSync(path.join(report, "phase13.1D-execution-evidence.json"), JSON.stringify(evidence, null, 2));
fs.writeFileSync(path.join(report, "runtime-doctor.json"), JSON.stringify({ status: "READY", productionPromotionAllowed: false }));
fs.copyFileSync(runtimeLock, path.join(report, "runtime-lock.json"));
fs.writeFileSync(path.join(report, "execution-config.json"), "{}\n");
fs.writeFileSync(path.join(report, "pip-freeze.txt"), "paddleocr==3.7.0\npaddlepaddle==3.2.1\n");
const bundle = path.join(priv, "reports", "phase13.1E-evidence-bundle");
r = run(path.join(root, "scripts/phase131e-seal-evidence.mjs"), [priv, "--out-dir", bundle]);
assert.equal(r.status, 0, r.stderr || r.stdout);
const sealed = JSON.parse(fs.readFileSync(path.join(bundle, "evidence-manifest.json"), "utf8"));
assert.equal(sealed.schemaVersion, "sq-phase131e-sealed-evidence-v1");
assert.equal(sealed.productionPromotionAllowed, false);
assert.ok(sealed.fileCount >= 8);
const verifiedDir = path.join(priv, "reports", "verified");
r = run(path.join(root, "scripts/phase131e-verify-evidence.mjs"), ["--evidence-dir", bundle, "--private-root", priv, "--out-dir", verifiedDir]);
assert.equal(r.status, 0, r.stderr || r.stdout);
let verification = JSON.parse(fs.readFileSync(path.join(verifiedDir, "evidence-verification.json"), "utf8"));
assert.equal(verification.trustStatus, "TRUSTED_EXECUTED");
assert.equal(verification.integrityPass, true);
assert.equal(verification.identityPass, true);
assert.equal(verification.rescorePass, true);
assert.equal(verification.analysisPass, true);
assert.equal(verification.decisionReplayPass, true);
const handoff = JSON.parse(fs.readFileSync(path.join(verifiedDir, "canary-handoff.json"), "utf8"));
assert.equal(handoff.productionPromotionAllowed, false);
assert.equal(handoff.productionRoutingChanged, false);
// Tamper with one byte after sealing: verification must fail before evidence can be trusted.
fs.appendFileSync(path.join(bundle, "artifacts", "predictions.json"), " \n");
const rejectedDir = path.join(priv, "reports", "rejected");
r = run(path.join(root, "scripts/phase131e-verify-evidence.mjs"), ["--evidence-dir", bundle, "--private-root", priv, "--out-dir", rejectedDir]);
assert.notEqual(r.status, 0);
verification = JSON.parse(fs.readFileSync(path.join(rejectedDir, "evidence-verification.json"), "utf8"));
assert.equal(verification.trustStatus, "REJECTED");
assert.ok(verification.problems.some((x) => x.type === "hash_mismatch" || x.type === "size_mismatch"));
fs.rmSync(tmp, { recursive: true, force: true });
console.log("✓ Phase 13.1E evidence trust-boundary smoke PASS");
