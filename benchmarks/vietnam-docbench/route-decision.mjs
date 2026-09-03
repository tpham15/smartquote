#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const REVIEW_ONLY_KEYS = ["rowRecall", "rowPrecision", "skuExact", "unitPriceExact", "groundingCoverage"];

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) if (argv[i].startsWith("--")) {
    const key = argv[i].slice(2), next = argv[i + 1];
    if (next && !next.startsWith("--")) { out[key] = next; i++; } else out[key] = true;
  }
  return out;
}
function readJson(p) { return JSON.parse(fs.readFileSync(p, "utf8")); }
function writeJson(p, v) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(v, null, 2) + "\n"); }
function metricValue(m, key) {
  if (!m) return null;
  if (key === "rowRecall") return m.rowDetection?.recall ?? null;
  if (key === "rowPrecision") return m.rowDetection?.precision ?? null;
  if (key === "skuExact") return m.fields?.sku?.exact ?? null;
  if (key === "unitPriceExact") return m.fields?.unitPrice?.exact ?? null;
  if (key === "autoApprovePrecision") return m.autoApproval?.precision ?? null;
  if (key === "maxUnsafeAutoApproveRate") return m.autoApproval?.unsafeRate ?? null;
  if (key === "groundingCoverage") return m.grounding?.coverage ?? null;
  return null;
}
function checks(metrics, gates, keys) {
  return keys.map((key) => {
    const actual = metricValue(metrics, key); const target = gates[key]; const max = key.startsWith("max");
    return { key, actual, target, direction: max ? "<=" : ">=", pass: actual != null && (max ? actual <= target : actual >= target) };
  });
}
function sliceDecision(metrics, gates) {
  if (!metrics) return { status: "NO_EVIDENCE", fullProduction: null, reviewOnlyExtraction: null };
  const full = checks(metrics, gates, Object.keys(gates));
  const review = checks(metrics, gates, REVIEW_ONLY_KEYS.filter((k) => k in gates));
  const autoTotal = metrics.autoApproval?.total ?? 0;
  return {
    status: review.length && review.every((x) => x.pass) && autoTotal === 0 ? "REVIEW_ONLY_CANDIDATE" : "NOT_READY",
    fullProduction: { pass: full.length > 0 && full.every((x) => x.pass), checks: full },
    reviewOnlyExtraction: { pass: review.length > 0 && review.every((x) => x.pass), checks: review, requiresZeroAutoApprovedRows: true, observedAutoApprovedRows: autoTotal },
  };
}

export function buildRouteDecision({ executionStatus, report = null, errorAnalysis = null }) {
  const base = {
    schemaVersion: "sq-docbench-route-decision-v1",
    generatedAt: new Date().toISOString(),
    engine: executionStatus.engine || report?.engine || null,
    dataset: executionStatus.dataset || report?.dataset || null,
    executionStatus: executionStatus.status,
    productionPromotionAllowed: false,
    phase: "13.1C",
  };
  if (executionStatus.status !== "EXECUTED" || !report) {
    return {
      ...base,
      decision: "BLOCKED_RUNTIME",
      slices: {},
      rationale: [executionStatus.blocker || "PaddleOCR-VL runtime did not execute; no routing decision can be made without real predictions."],
      nextAction: "Run the frozen 92-row PDF slice in an environment with the official PaddleOCR-VL runtime, then rerun the same 13.1C command.",
    };
  }
  const gates = report.releaseGates || {};
  const sliceNames = ["scan_pdf", "hybrid_pdf", "digital_pdf", "photo"];
  const slices = Object.fromEntries(sliceNames.map((name) => [name, sliceDecision(report.slices?.[name], gates)]));
  const scan = slices.scan_pdf;
  const digital = slices.digital_pdf;
  let decision = "KEEP_EXPERIMENTAL";
  if (scan.status === "REVIEW_ONLY_CANDIDATE" && digital.status === "REVIEW_ONLY_CANDIDATE") decision = "REVIEW_FALLBACK_CANDIDATE";
  else if (scan.status === "REVIEW_ONLY_CANDIDATE") decision = "SCAN_REVIEW_CANARY_ELIGIBLE";
  else if (digital.status === "REVIEW_ONLY_CANDIDATE") decision = "DIGITAL_REVIEW_CANARY_ELIGIBLE";
  const rationale = [];
  if (report.gates?.pass) rationale.push("Full frozen release gates passed overall.");
  else rationale.push("Full production release gates did not pass overall; direct production-primary promotion is forbidden.");
  rationale.push("PaddleOCR-VL adapter is review-only and must emit zero auto-approved rows in Phase 13.1C.");
  if (errorAnalysis) rationale.push(`Row diagnostics: ${errorAnalysis.summary.missedProducts} missed products, ${errorAnalysis.summary.falseProducts} false products, ${errorAnalysis.summary.criticalMatchedRowFailures} matched rows with critical-field failures.`);
  return {
    ...base,
    decision,
    overallFullProductionPass: Boolean(report.gates?.pass),
    slices,
    errorSummary: errorAnalysis?.summary || null,
    rationale,
    nextAction: decision === "SCAN_REVIEW_CANARY_ELIGIBLE" || decision === "REVIEW_FALLBACK_CANDIDATE"
      ? "Eligible only for an explicit later canary phase that routes output to human review; do not change production routing in 13.1C."
      : "Keep PaddleOCR-VL experimental and fix the dominant row/field errors before any production routing phase.",
  };
}

export function markdownDecision(d) {
  const lines = [
    "# Phase 13.1C — PaddleOCR-VL route decision",
    "",
    `Decision: **${d.decision}**`,
    `Execution: **${d.executionStatus}**`,
    `Production promotion allowed in this phase: **NO**`,
    "",
    "## Rationale",
    "",
    ...(d.rationale || []).map((x) => `- ${x}`),
    "",
  ];
  if (Object.keys(d.slices || {}).length) {
    lines.push("## Slice decisions", "", "| Slice | Status | Full production | Review-only extraction |", "|---|---|:---:|:---:|", ...Object.entries(d.slices).map(([k, v]) => `| ${k} | ${v.status} | ${v.fullProduction?.pass ? "PASS" : "FAIL/NA"} | ${v.reviewOnlyExtraction?.pass ? "PASS" : "FAIL/NA"} |`), "");
  }
  lines.push("## Next action", "", d.nextAction || "", "");
  return lines.join("\n");
}

const args = parseArgs(process.argv);
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!args.status) { console.error("Usage: node benchmarks/vietnam-docbench/route-decision.mjs --status <execution-status.json> [--report <report.json>] [--analysis <error-analysis.json>] [--out-dir <dir>]"); process.exit(2); }
  const executionStatus = readJson(path.resolve(args.status));
  const report = args.report && fs.existsSync(path.resolve(args.report)) ? readJson(path.resolve(args.report)) : null;
  const errorAnalysis = args.analysis && fs.existsSync(path.resolve(args.analysis)) ? readJson(path.resolve(args.analysis)) : null;
  const decision = buildRouteDecision({ executionStatus, report, errorAnalysis });
  const outDir = path.resolve(args["out-dir"] || path.join(here, "reports", "phase13.1C"));
  writeJson(path.join(outDir, "route-decision.json"), decision);
  fs.writeFileSync(path.join(outDir, "ROUTE_DECISION.md"), markdownDecision(decision) + "\n");
  console.log(`Phase 13.1C route decision: ${decision.decision}`);
}
