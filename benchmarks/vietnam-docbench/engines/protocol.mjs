import fs from "node:fs";
import path from "node:path";
import { validatePredictions } from "../lib/schema.mjs";

export function validateEngineAdapterModule(mod) {
  if (!mod?.engine?.id) throw new Error("Engine adapter must export `engine` with id");
  if (typeof mod.runDocument !== "function") throw new Error("Engine adapter must export async runDocument(context)");
  return mod;
}

export function predictionBundle(engine, documents) {
  return validatePredictions({
    schemaVersion: "sq-docbench-predictions-v1",
    engine: {
      id: engine.id,
      version: engine.version || "unversioned",
      config: engine.config || {},
    },
    documents,
  });
}

export function resolveSourcePath(manifestPath, document) {
  return path.resolve(path.dirname(manifestPath), document.sourceFile || "");
}

export function requireSourceFile(manifestPath, document) {
  const sourcePath = resolveSourcePath(manifestPath, document);
  if (!document.sourceFile || !fs.existsSync(sourcePath)) throw new Error(`${document.id}: source file missing: ${sourcePath}`);
  return sourcePath;
}

// Candidate adapters receive only information available at inference time.
// Ground-truth paths, expected row counts, review evidence, hashes and release gates
// are deliberately withheld so an adapter cannot tune itself against labels while running.
export function blindDocumentContext(document = {}) {
  const allowed = ["id", "inputKind", "documentType", "industry", "supplier", "tags"];
  return Object.fromEntries(allowed.filter((k) => document[k] !== undefined).map((k) => [k, document[k]]));
}

export function blindBenchmarkMeta(manifest = {}) {
  return {
    id: manifest.id || "",
    version: manifest.version || "",
    benchmarkPolicy: manifest.benchmarkPolicy || "",
  };
}
