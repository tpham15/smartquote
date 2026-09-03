#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { validateManifest } from "./lib/schema.mjs";
import { planDocumentRoute } from "../../src/import-engine/documentRouter.js";
import { candidateEnginesForRoute } from "./engines/registry.mjs";

function args(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) if (argv[i].startsWith("--")) {
    const k = argv[i].slice(2), v = argv[i + 1];
    if (v && !v.startsWith("--")) { out[k] = v; i++; } else out[k] = true;
  }
  return out;
}
function readJson(p) { return JSON.parse(fs.readFileSync(p, "utf8")); }
function expectedKind(kind) { return kind; }
function fmtPct(v) { return `${(Number(v || 0) * 100).toFixed(1)}%`; }

const a = args(process.argv);
if (!a.manifest || !a.probes) {
  console.error("Usage: node benchmarks/vietnam-docbench/route-audit.mjs --manifest <manifest.json> --probes <route-probes.json> [--out <dir>]");
  process.exit(2);
}
const manifestPath = path.resolve(a.manifest);
const manifest = validateManifest(readJson(manifestPath));
const probes = readJson(path.resolve(a.probes));
const probeMap = new Map((probes.documents || []).map((d) => [d.documentId, d]));
const rows = [];
for (const doc of manifest.documents) {
  const probe = probeMap.get(doc.id) || {};
  const route = planDocumentRoute({
    fileName: probe.fileName || doc.sourceFile || doc.id,
    mimeType: probe.mimeType || "",
    pdfProbe: probe.pdf || null,
    explicitType: doc.documentType,
  });
  const expected = expectedKind(doc.inputKind);
  const kindMatch = route.inputKind === expected;
  rows.push({
    documentId: doc.id,
    expectedInputKind: expected,
    routedInputKind: route.inputKind,
    kindMatch,
    inputConfidence: route.inputConfidence,
    documentType: route.documentType,
    primaryEngine: route.primaryEngine,
    fallbacks: route.fallbacks,
    experimentalCandidates: route.experimentalCandidates,
    candidateEngines: candidateEnginesForRoute(route).map((e) => ({ id: e.id, status: e.status })),
    route,
  });
}
const matched = rows.filter((r) => r.kindMatch).length;
const report = {
  schemaVersion: "sq-document-route-audit-v1",
  routerPolicy: rows[0]?.route?.routerPolicy || "sq-document-router-v1",
  generatedAt: new Date().toISOString(),
  dataset: { id: manifest.id, version: manifest.version },
  summary: { documents: rows.length, kindMatched: matched, kindAccuracy: rows.length ? matched / rows.length : null },
  documents: rows,
};
const md = [
  "# Phase 13.1 — Native-first Route Audit",
  "",
  `Dataset: ${manifest.id} v${manifest.version}`,
  `Input-kind routing accuracy: **${matched}/${rows.length} (${fmtPct(report.summary.kindAccuracy)})**`,
  "",
  "| Document | Expected | Routed | Primary | Experimental candidates | Match |",
  "|---|---|---|---|---|:---:|",
  ...rows.map((r) => `| ${r.documentId} | ${r.expectedInputKind} | ${r.routedInputKind} | ${r.primaryEngine} | ${r.experimentalCandidates.join(", ")} | ${r.kindMatch ? "✅" : "❌"} |`),
  "",
  "> Document type is supplied from the frozen manifest in this audit so Phase 13.1 measures input routing independently from future document-type classification work.",
  "",
].join("\n");
const outDir = path.resolve(a.out || "benchmarks/vietnam-docbench/reports/phase13.1-route-audit");
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "report.json"), JSON.stringify(report, null, 2) + "\n");
fs.writeFileSync(path.join(outDir, "report.md"), md + "\n");
console.log(`✓ Route audit: ${matched}/${rows.length} input kinds matched -> ${outDir}`);
if (a["fail-on-mismatch"] && matched !== rows.length) process.exit(1);
