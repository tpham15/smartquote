#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateManifest, validateGroundTruth, validatePredictions } from "./lib/schema.mjs";
import { alignProductRows, pairAffinity } from "./lib/match.mjs";
import { fieldCorrect, groundingPresent, criticalRowCorrect } from "./lib/metrics.mjs";
import { normalizeSku, normalizeText, numberForField, tokenF1, normalizeStatus } from "./lib/normalize.mjs";
import { resolveDocBenchPolicy } from "./lib/policy.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const FIELDS = ["sku", "name", "unit", "quantity", "unitPrice", "listPrice", "lineTotal", "section"];
const CRITICAL_DEFAULT = ["sku", "unitPrice"];

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) continue;
    const key = argv[i].slice(2); const next = argv[i + 1];
    if (next && !next.startsWith("--")) { out[key] = next; i++; } else out[key] = true;
  }
  return out;
}
function readJson(p) { return JSON.parse(fs.readFileSync(p, "utf8")); }
function writeJson(p, v) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(v, null, 2) + "\n"); }
function resolveFrom(base, p) { return path.isAbsolute(p) ? p : path.resolve(base, p); }
function pct(v) { return v == null ? "n/a" : `${(v * 100).toFixed(2)}%`; }
function printable(v) { return v == null ? null : v; }

function expectedField(field, value) {
  if (["sku", "name", "unit", "section"].includes(field)) return String(value ?? "").trim() !== "";
  return numberForField(field, value) != null;
}
function sourceSummary(row) {
  const s = row?.source || {};
  return { page: s.page ?? null, sheet: s.sheet ?? null, row: s.row ?? null, bbox: Array.isArray(s.bbox) ? s.bbox : null };
}
function fieldDiffs(gt, pred) {
  const diffs = [];
  const critical = new Set(gt.acceptance?.criticalFields || CRITICAL_DEFAULT);
  for (const field of FIELDS) {
    const gv = gt.fields?.[field];
    if (!expectedField(field, gv)) continue;
    const pv = pred.fields?.[field];
    if (fieldCorrect(field, gv, pv)) continue;
    const item = { field, critical: critical.has(field), expected: printable(gv), actual: printable(pv) };
    if (field === "name") item.tokenF1 = Number(tokenF1(gv, pv).toFixed(6));
    if (["quantity", "unitPrice", "listPrice", "lineTotal"].includes(field)) {
      const g = numberForField(field, gv); const p = numberForField(field, pv);
      item.absoluteDelta = g != null && p != null ? Math.abs(g - p) : null;
      item.ratio = g && p != null ? Number((p / g).toFixed(6)) : null;
    }
    diffs.push(item);
  }
  return diffs;
}
function likelyTrap(falsePositive, nonProducts, policy) {
  if (!nonProducts.length) return null;
  let best = null;
  for (const trap of nonProducts) {
    const affinity = pairAffinity(trap, falsePositive, policy);
    const nameF1 = tokenF1(trap.fields?.name, falsePositive.fields?.name);
    const samePage = trap.source?.page != null && falsePositive.source?.page != null && String(trap.source.page) === String(falsePositive.source.page);
    const score = Math.max(affinity, nameF1 * 0.7 + (samePage ? 0.2 : 0));
    if (!best || score > best.score) best = { trap, score, nameF1, samePage };
  }
  if (!best || best.score < 0.38) return null;
  return { rowId: best.trap.rowId, score: Number(best.score.toFixed(6)), name: best.trap.fields?.name || "", source: sourceSummary(best.trap) };
}
function classifyMatchedPair(pair) {
  const diffs = fieldDiffs(pair.gt, pair.pred);
  const errors = [];
  for (const diff of diffs) {
    errors.push({
      type: `${diff.field}_mismatch`,
      severity: diff.critical ? "critical" : (diff.field === "name" || diff.field === "section" ? "medium" : "high"),
      ...diff,
    });
  }
  if (!groundingPresent(pair.pred)) errors.push({ type: "missing_grounding", severity: "high" });
  if (normalizeStatus(pair.pred.status) === "auto_approved" && !criticalRowCorrect(pair.gt, pair.pred)) {
    errors.push({ type: "unsafe_auto_approve", severity: "critical" });
  }
  return {
    gtRowId: pair.gt.rowId,
    predictionId: pair.pred.predictionId || null,
    affinity: Number(pair.affinity.toFixed(6)),
    criticalCorrect: criticalRowCorrect(pair.gt, pair.pred),
    source: { groundTruth: sourceSummary(pair.gt), prediction: sourceSummary(pair.pred) },
    fields: { groundTruth: pair.gt.fields || {}, prediction: pair.pred.fields || {} },
    errors,
  };
}
function countTypes(items) {
  const counts = {};
  for (const item of items) for (const err of item.errors || []) counts[err.type] = (counts[err.type] || 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}
function pageBuckets(docAnalysis) {
  const buckets = {};
  const touch = (page) => {
    const key = page == null ? "unknown" : String(page);
    buckets[key] ||= { matched: 0, missedProducts: 0, falseProducts: 0, criticalMismatches: 0, missingGrounding: 0 };
    return buckets[key];
  };
  for (const m of docAnalysis.matchedRows) {
    const b = touch(m.source.groundTruth.page ?? m.source.prediction.page);
    b.matched++;
    b.criticalMismatches += m.errors.filter((e) => e.severity === "critical").length;
    b.missingGrounding += m.errors.filter((e) => e.type === "missing_grounding").length;
  }
  for (const m of docAnalysis.missedProducts) touch(m.source.page).missedProducts++;
  for (const f of docAnalysis.falseProducts) touch(f.source.page).falseProducts++;
  return buckets;
}

export function analyzePredictions({ manifest, manifestPath, predictions }) {
  const manifestDir = path.dirname(manifestPath);
  const policy = resolveDocBenchPolicy(manifest.benchmarkPolicy);
  const predMap = new Map(predictions.documents.map((d) => [d.documentId, d]));
  const documents = [];
  for (const doc of manifest.documents) {
    const gt = validateGroundTruth(readJson(resolveFrom(manifestDir, doc.groundTruth)), doc.id);
    const predDoc = predMap.get(doc.id) || { documentId: doc.id, rows: [] };
    const alignment = alignProductRows(gt.rows, predDoc.rows || [], policy);
    const nonProducts = gt.rows.filter((r) => r.kind === "non_product");
    const matchedRows = alignment.pairs.map(classifyMatchedPair);
    const missedProducts = alignment.falseNegatives.map((r) => ({
      rowId: r.rowId, type: "missed_product", severity: "critical", source: sourceSummary(r), fields: r.fields || {}, tags: doc.tags || [],
    }));
    const falseProducts = alignment.falsePositives.map((r) => ({
      predictionId: r.predictionId || null, type: "false_product", severity: "critical", source: sourceSummary(r), fields: r.fields || {},
      likelyNonProductTrap: likelyTrap(r, nonProducts, policy),
    }));
    const docAnalysis = {
      documentId: doc.id,
      inputKind: doc.inputKind,
      documentType: doc.documentType,
      supplier: doc.supplier || "",
      tags: doc.tags || [],
      counts: {
        groundTruthProducts: alignment.gtProducts.length,
        predictedProducts: alignment.predictedProducts.length,
        matched: alignment.pairs.length,
        missedProducts: missedProducts.length,
        falseProducts: falseProducts.length,
        nonProductTraps: nonProducts.length,
      },
      matchedRows,
      missedProducts,
      falseProducts,
    };
    docAnalysis.errorTypeCounts = countTypes(matchedRows);
    docAnalysis.pageBreakdown = pageBuckets(docAnalysis);
    documents.push(docAnalysis);
  }
  const summary = {
    documents: documents.length,
    groundTruthProducts: documents.reduce((s, d) => s + d.counts.groundTruthProducts, 0),
    predictedProducts: documents.reduce((s, d) => s + d.counts.predictedProducts, 0),
    matched: documents.reduce((s, d) => s + d.counts.matched, 0),
    missedProducts: documents.reduce((s, d) => s + d.counts.missedProducts, 0),
    falseProducts: documents.reduce((s, d) => s + d.counts.falseProducts, 0),
    likelyTrapFalseProducts: documents.reduce((s, d) => s + d.falseProducts.filter((x) => x.likelyNonProductTrap).length, 0),
  };
  const allMatched = documents.flatMap((d) => d.matchedRows);
  summary.errorTypeCounts = countTypes(allMatched);
  summary.criticalMatchedRowFailures = allMatched.filter((m) => !m.criticalCorrect).length;
  summary.missingGroundingRows = allMatched.filter((m) => m.errors.some((e) => e.type === "missing_grounding")).length;
  return {
    schemaVersion: "sq-docbench-error-analysis-v1",
    generatedAt: new Date().toISOString(),
    benchmarkPolicy: policy.id,
    engine: predictions.engine,
    dataset: { id: manifest.id, version: manifest.version },
    summary,
    documents,
  };
}

export function markdownAnalysis(a) {
  const s = a.summary;
  const lines = [
    `# DocBench Error Analysis — ${a.engine.id}`,
    "",
    `Dataset: **${a.dataset.id}@${a.dataset.version}**`,
    `Documents: ${s.documents}`,
    `GT products: ${s.groundTruthProducts}`, `Predicted products: ${s.predictedProducts}`,
    `Matched: ${s.matched}`, `Missed products: ${s.missedProducts}`, `False products: ${s.falseProducts}`,
    `Likely non-product traps emitted as products: ${s.likelyTrapFalseProducts}`,
    `Matched rows with critical-field failures: ${s.criticalMatchedRowFailures}`,
    "",
    "## Error taxonomy",
    "",
    "| Error | Count |",
    "|---|---:|",
    ...Object.entries(s.errorTypeCounts).map(([k, v]) => `| ${k} | ${v} |`),
    "",
    "## Per document",
    "",
    "| Document | Input | GT | Pred | Matched | Missed | False |",
    "|---|---|---:|---:|---:|---:|---:|",
    ...a.documents.map((d) => `| ${d.documentId} | ${d.inputKind} | ${d.counts.groundTruthProducts} | ${d.counts.predictedProducts} | ${d.counts.matched} | ${d.counts.missedProducts} | ${d.counts.falseProducts} |`),
    "",
    "> This report is private benchmark evidence because it contains frozen ground-truth row values.",
  ];
  return lines.join("\n");
}

const args = parseArgs(process.argv);
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!args.manifest || !args.predictions) {
    console.error("Usage: node benchmarks/vietnam-docbench/error-analysis.mjs --manifest <manifest.json> --predictions <predictions.json> [--out-dir <dir>]");
    process.exit(2);
  }
  const manifestPath = path.resolve(args.manifest);
  const manifest = validateManifest(readJson(manifestPath));
  const predictions = validatePredictions(readJson(path.resolve(args.predictions)));
  const analysis = analyzePredictions({ manifest, manifestPath, predictions });
  const outDir = path.resolve(args["out-dir"] || path.join(here, "reports", predictions.engine.id, "error-analysis"));
  writeJson(path.join(outDir, "error-analysis.json"), analysis);
  fs.writeFileSync(path.join(outDir, "error-analysis.md"), markdownAnalysis(analysis) + "\n");
  console.log(`Error analysis ${predictions.engine.id}: missed=${analysis.summary.missedProducts}, false=${analysis.summary.falseProducts}, critical-field-failures=${analysis.summary.criticalMatchedRowFailures}`);
}
