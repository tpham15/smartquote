#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ENGINE_REGISTRY } from "../benchmarks/vietnam-docbench/engines/registry.mjs";
import { engine, supports } from "../benchmarks/vietnam-docbench/engines/paddleocr-vl-1.6.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bridge = path.join(root, "benchmarks/vietnam-docbench/engines/paddleocr_vl_bridge.py");
const runner = fs.readFileSync(path.join(root, "benchmarks/vietnam-docbench/engines/run-adapter.mjs"), "utf8");

assert.equal(ENGINE_REGISTRY.paddleocr_vl.status, "experimental");
assert.equal(ENGINE_REGISTRY.paddleocr_vl.benchmarkDefaultVersion, "PaddleOCR-VL-1.6");
assert.equal(ENGINE_REGISTRY.paddleocr_vl.fullPipelineRequired, true);
assert.equal(engine.config.fullPipeline, true);
assert.equal(engine.config.pipelineVersion, process.env.SQ_PADDLEOCR_VL_PIPELINE_VERSION || "v1.6");
assert.equal(engine.config.benchmarkOnly, true);
assert.equal(engine.config.fieldConfidenceAvailable, false);
assert.equal(supports({ inputKind: "scan_pdf" }), true);
assert.equal(supports({ inputKind: "digital_pdf" }), true);
assert.equal(supports({ inputKind: "xlsx" }), false);
assert.match(runner, /blindDocumentContext\(document\)/);
assert.match(runner, /blindBenchmarkMeta\(manifest\)/);
assert.doesNotMatch(runner, /runDocument\(\{\s*manifestPath,\s*manifest,\s*document/);

const probe = spawnSync(process.env.SQ_PADDLEOCR_PYTHON || "python3", [bridge, "--probe"], { encoding: "utf8" });
assert.equal(probe.status, 0, probe.stderr);
const runtime = JSON.parse(probe.stdout);
assert.equal(runtime.schemaVersion, "sq-paddleocr-vl-runtime-probe-v1");
assert.equal(runtime.pipelineVersion, process.env.SQ_PADDLEOCR_VL_PIPELINE_VERSION || "v1.6");
assert.equal(typeof runtime.ready, "boolean");

// Experimental engines must not be imported anywhere in production import-engine source.
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const p = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(p) : [p];
  });
}
for (const file of walk(path.join(root, "src/import-engine"))) {
  if (!file.endsWith(".js") || path.basename(file) === "documentRouter.js") continue;
  const text = fs.readFileSync(file, "utf8");
  assert.doesNotMatch(text, /paddleocr-vl-1\.6|paddleocr_vl_bridge|PaddleOCRVL/);
}

console.log(`Phase 13.1A PaddleOCR-VL smoke: PASS (runtime ${runtime.ready ? "READY" : "NOT_INSTALLED"})`);
