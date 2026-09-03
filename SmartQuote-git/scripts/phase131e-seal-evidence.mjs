#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fileInventory, readJson, sha256Text, writeJson } from "../benchmarks/vietnam-docbench/evidence-provenance.mjs";
import { canonicalJson } from "../benchmarks/vietnam-docbench/lib/freeze.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
function args(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) { const key = a.slice(2), next = argv[i + 1]; if (next && !next.startsWith("--")) { out[key] = next; i++; } else out[key] = true; }
    else if (!out.privateRoot) out.privateRoot = a;
  }
  return out;
}
const a = args(process.argv);
if (!a.privateRoot) { console.error("Usage: node scripts/phase131e-seal-evidence.mjs /private/root [--source-report <dir>] [--out-dir <dir>]"); process.exit(2); }
const privateRoot = path.resolve(a.privateRoot);
const sourceReport = path.resolve(a["source-report"] || path.join(privateRoot, "reports", "phase13.1D-paddleocr-vl-1.6"));
const evidenceDir = path.resolve(a["out-dir"] || path.join(privateRoot, "reports", "phase13.1E-evidence-bundle"));
const evidenceFile = path.join(sourceReport, "phase13.1D-execution-evidence.json");
const statusFile = path.join(sourceReport, "execution-status.json");
const decisionFile = path.join(sourceReport, "route-decision.json");
for (const p of [sourceReport, evidenceFile, statusFile, decisionFile]) if (!fs.existsSync(p)) throw new Error(`Missing required Phase 13.1D evidence: ${p}`);
const evidence = readJson(evidenceFile), status = readJson(statusFile), decision = readJson(decisionFile);
if (evidence.productionPromotionAllowed !== false || decision.productionPromotionAllowed !== false) throw new Error("Unsafe evidence: productionPromotionAllowed must remain false");
if (fs.existsSync(evidenceDir)) fs.rmSync(evidenceDir, { recursive: true, force: true });
fs.mkdirSync(evidenceDir, { recursive: true });
fs.cpSync(sourceReport, path.join(evidenceDir, "artifacts"), { recursive: true });
const files = fileInventory(path.join(evidenceDir, "artifacts"));
const manifest = {
  schemaVersion: "sq-phase131e-sealed-evidence-v1",
  phase: "13.1E",
  generatedAt: new Date().toISOString(),
  sourcePhase: "13.1D",
  engine: evidence.engine || status.engine || null,
  dataset: evidence.dataset || status.dataset || null,
  executionStatus: status.status,
  routeDecision: decision.decision,
  runtimeProfile: evidence.runtimeProfile || null,
  mode: evidence.mode || null,
  fingerprints: evidence.fingerprints || {},
  files,
  fileCount: files.length,
  productionPromotionAllowed: false,
  humanReviewRequired: true,
};
manifest.inventorySha256 = sha256Text(canonicalJson(files));
writeJson(path.join(evidenceDir, "evidence-manifest.json"), manifest);
console.log(`Phase 13.1E sealed evidence: status=${manifest.executionStatus}; decision=${manifest.routeDecision}; files=${manifest.fileCount}; dir=${evidenceDir}`);
