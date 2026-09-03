#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runtimeDir = path.join(root, "benchmarks/vietnam-docbench/runtime/paddleocr-vl-1.6");
const lock = JSON.parse(fs.readFileSync(path.join(runtimeDir, "runtime-lock.json"), "utf8"));
assert.equal(lock.phase, "13.1D");
assert.equal(lock.pipelineVersion, "v1.6");
assert.equal(lock.packages.paddleocr, "3.7.0");
assert.equal(lock.packages.paddlepaddle, "3.2.1");
assert.equal(lock.productionPromotionAllowed, false);

for (const name of ["Dockerfile.cpu", "Dockerfile.gpu-cu126"]) {
  const text = fs.readFileSync(path.join(runtimeDir, name), "utf8");
  assert.match(text, /PADDLEPADDLE_VERSION=3\.2\.1/);
  assert.match(text, /PADDLEOCR_VERSION=3\.7\.0/);
  assert.match(text, /paddleocr\[doc-parser\]/);
  assert.match(text, /SQ_PADDLEOCR_VL_PIPELINE_VERSION=v1\.6/);
}
const gpuDockerfile = fs.readFileSync(path.join(runtimeDir, "Dockerfile.gpu-cu126"), "utf8");
assert.match(gpuDockerfile, /cu126/);
assert.match(gpuDockerfile, /paddlepaddle-gpu/);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sq131d-smoke-"));
const privateRoot = path.join(tmp, "private");
fs.mkdirSync(path.join(privateRoot, "files"), { recursive: true });
fs.writeFileSync(path.join(privateRoot, "files", "doc.pdf"), "fixture");
const doc = { id: "d1", inputKind: "scan_pdf", documentType: "supplier_price_list", sourceFile: "files/doc.pdf" };
fs.writeFileSync(path.join(privateRoot, "manifest.json"), JSON.stringify({ id: "smoke", version: "0.0.0", benchmarkPolicy: "sq-docbench-policy-v1", documents: [doc] }));
fs.writeFileSync(path.join(privateRoot, "manifest-paddle-pdf-subset.json"), JSON.stringify({ id: "smoke-paddle", version: "0.0.0", benchmarkPolicy: "sq-docbench-policy-v1", documents: [doc] }));
fs.writeFileSync(path.join(privateRoot, "freeze-lock.json"), "{}\n");
const doctorOut = path.join(tmp, "doctor.json");
const doctor = spawnSync("python3", [path.join(root, "scripts/phase131d-runtime-doctor.py"), "--private-root", privateRoot, "--out", doctorOut], { encoding: "utf8" });
assert.ok([0, 3].includes(doctor.status), doctor.stderr || doctor.stdout);
const doctorJson = JSON.parse(fs.readFileSync(doctorOut, "utf8"));
assert.equal(doctorJson.schemaVersion, "sq-phase131d-runtime-doctor-v1");
assert.equal(doctorJson.productionPromotionAllowed, false);
assert.equal(doctorJson.corpus.requiredFilesPresent, true);
assert.equal(doctorJson.corpus.documentSourcesResolvable, true);
assert.ok(["READY", "BLOCKED_RUNTIME", "BLOCKED_MODEL_CACHE", "READY_RUNTIME_BLOCKED_MODEL_DOWNLOAD"].includes(doctorJson.status));

// A non-ready doctor must stop before benchmark execution and must not create prediction evidence.
const blockedDoctor = { ...doctorJson, status: "BLOCKED_RUNTIME", blocker: "smoke-blocker" };
fs.writeFileSync(doctorOut, JSON.stringify(blockedDoctor, null, 2));
const run = spawnSync(process.execPath, [path.join(root, "scripts/phase131d-run-execution.mjs"), privateRoot, "--doctor", doctorOut, "--profile", "cpu"], { encoding: "utf8" });
assert.notEqual(run.status, 0);
assert.match(`${run.stderr}\n${run.stdout}`, /runtime doctor is not READY/);
assert.equal(fs.existsSync(path.join(privateRoot, "reports", "phase13.1D-paddleocr-vl-1.6", "predictions.json")), false);

const runnerText = fs.readFileSync(path.join(root, "scripts/phase131d-run-docker.sh"), "utf8");
assert.match(runnerText, /--gpus all/);
assert.match(runnerText, /PADDLE_PDX_CACHE_HOME/);
assert.match(runnerText, /phase131d-runtime-doctor\.py/);
assert.match(runnerText, /phase131d-run-execution\.mjs/);

fs.rmSync(tmp, { recursive: true, force: true });
console.log("✓ Phase 13.1D runtime smoke PASS");
