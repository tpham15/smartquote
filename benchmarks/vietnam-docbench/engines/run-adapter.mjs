#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { validateManifest } from "../lib/schema.mjs";
import { validateEngineAdapterModule, predictionBundle, requireSourceFile, blindDocumentContext, blindBenchmarkMeta } from "./protocol.mjs";

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) if (argv[i].startsWith("--")) {
    const key = argv[i].slice(2); const next = argv[i + 1];
    if (next && !next.startsWith("--")) { out[key] = next; i++; } else out[key] = true;
  }
  return out;
}
function readJson(p) { return JSON.parse(fs.readFileSync(p, "utf8")); }

const args = parseArgs(process.argv);
if (!args.manifest || !args.adapter || !args.out) {
  console.error("Usage: node .../run-adapter.mjs --manifest <private/manifest.json> --adapter <adapter.mjs> --out <predictions.json>");
  process.exit(2);
}
const manifestPath = path.resolve(args.manifest);
const manifest = validateManifest(readJson(manifestPath));
const adapterPath = path.resolve(args.adapter);
const adapter = validateEngineAdapterModule(await import(pathToFileURL(adapterPath).href));
const documents = [];

for (const document of manifest.documents) {
  const sourcePath = requireSourceFile(manifestPath, document);
  const start = Date.now();
  if (typeof adapter.supports === "function" && !adapter.supports(document)) {
    documents.push({ documentId: document.id, runtimeMs: 0, estimatedCostVnd: 0, rows: [] });
    continue;
  }
  const result = await adapter.runDocument({
    benchmark: blindBenchmarkMeta(manifest),
    document: blindDocumentContext(document),
    sourcePath,
  });
  documents.push({
    documentId: document.id,
    runtimeMs: result?.runtimeMs ?? Date.now() - start,
    estimatedCostVnd: result?.estimatedCostVnd ?? null,
    rows: Array.isArray(result?.rows) ? result.rows : [],
  });
}
const bundle = predictionBundle(adapter.engine, documents);
fs.mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true });
fs.writeFileSync(path.resolve(args.out), JSON.stringify(bundle, null, 2) + "\n");
console.log(`✓ Engine adapter ${adapter.engine.id}: ${documents.length} documents -> ${path.resolve(args.out)}`);
