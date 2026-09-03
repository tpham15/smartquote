#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { validateManifest } from "../benchmarks/vietnam-docbench/lib/schema.mjs";

function args(argv) {
  const o = {};
  for (let i = 2; i < argv.length; i++) if (argv[i].startsWith("--")) {
    const k = argv[i].slice(2), n = argv[i + 1];
    if (n && !n.startsWith("--")) { o[k] = n; i++; } else o[k] = true;
  }
  return o;
}
function readJson(p) { return JSON.parse(fs.readFileSync(p, "utf8")); }
function sha256(p) { return crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex"); }
const a = args(process.argv);
if (!a.manifest || !a.out) {
  console.error("Usage: node scripts/phase131a-make-paddle-subset.mjs --manifest <private/manifest.json> --out <private/manifest-paddle-pdf-subset.json>");
  process.exit(2);
}
const source = path.resolve(a.manifest);
const manifest = validateManifest(readJson(source));
const kinds = new Set(["digital_pdf", "hybrid_pdf", "scan_pdf", "photo"]);
const documents = manifest.documents.filter((d) => kinds.has(d.inputKind));
const out = {
  ...manifest,
  id: `${manifest.id}-paddleocr-vl-pdf-slice`,
  documents,
  derivedBenchmark: {
    phase: "13.1A",
    sourceManifestSha256: sha256(source),
    sourceDatasetId: manifest.id,
    sourceDatasetVersion: manifest.version,
    supportedInputKinds: [...kinds],
    engineCandidate: "PaddleOCR-VL-1.6",
  },
};
fs.writeFileSync(path.resolve(a.out), JSON.stringify(out, null, 2) + "\n");
console.log(`✓ PaddleOCR-VL slice: ${documents.length}/${manifest.documents.length} documents -> ${path.resolve(a.out)}`);
