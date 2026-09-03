#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { evaluateGates, DEFAULT_RELEASE_GATES } from "./lib/gates.mjs";

function args(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) if (argv[i].startsWith("--")) {
    const k = argv[i].slice(2), v = argv[i + 1];
    if (v && !v.startsWith("--")) { out[k] = v; i++; } else out[k] = true;
  }
  return out;
}
const a = args(process.argv);
if (!a.report || !a.slice) {
  console.error("Usage: node benchmarks/vietnam-docbench/promotion-check.mjs --report <report.json> --slice <digital_pdf|scan_pdf|xlsx|...>");
  process.exit(2);
}
const report = JSON.parse(fs.readFileSync(path.resolve(a.report), "utf8"));
const metrics = report.slices?.[a.slice];
if (!metrics) {
  console.log(`NOT_READY ${report.engine?.id || "engine"} slice=${a.slice}: no benchmark evidence`);
  process.exit(a["fail-if-not-ready"] ? 1 : 0);
}
const gates = evaluateGates(metrics, report.releaseGates || DEFAULT_RELEASE_GATES);
const status = gates.pass ? "PROMOTABLE" : "NOT_READY";
console.log(`${status} ${report.engine?.id || "engine"} slice=${a.slice}`);
for (const check of gates.checks) console.log(`  ${check.pass ? "✓" : "✗"} ${check.key}: ${check.actual ?? "n/a"} ${check.direction} ${check.target}`);
if (a["fail-if-not-ready"] && !gates.pass) process.exit(1);
