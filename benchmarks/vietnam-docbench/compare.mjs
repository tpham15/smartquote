#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

function args(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) if (argv[i].startsWith("--")) {
    const k = argv[i].slice(2); const v = argv[i + 1];
    if (v && !v.startsWith("--")) { out[k] = v; i++; } else out[k] = true;
  }
  return out;
}
const a = args(process.argv);
if (!a.reports) {
  console.error("Usage: node benchmarks/vietnam-docbench/compare.mjs --reports a/report.json,b/report.json [--out comparison.md]");
  process.exit(2);
}
const paths = String(a.reports).split(",").map((x) => path.resolve(x.trim())).filter(Boolean);
const reports = paths.map((p) => JSON.parse(fs.readFileSync(p, "utf8")));
const pct = (v) => v == null ? "n/a" : `${(v * 100).toFixed(2)}%`;
const num = (v) => v == null ? "n/a" : String(v);
const rows = reports.map((r) => {
  const m = r.overall;
  const runtime = (r.documents || []).reduce((s, d) => s + (Number(d.runtimeMs) || 0), 0);
  const cost = (r.documents || []).reduce((s, d) => s + (Number(d.estimatedCostVnd) || 0), 0);
  return {
    engine: `${r.engine.id}${r.engine.version ? `@${r.engine.version}` : ""}`,
    gate: r.gates?.pass ? "PASS" : "FAIL",
    recall: m.rowDetection.recall,
    precision: m.rowDetection.precision,
    sku: m.fields.sku?.exact,
    price: m.fields.unitPrice?.exact,
    trusted: m.trustedRows.accuracy,
    autoPrecision: m.autoApproval.precision,
    unsafe: m.autoApproval.unsafeRate,
    grounding: m.grounding.coverage,
    runtime, cost,
  };
});
rows.sort((x, y) => Number(y.gate === "PASS") - Number(x.gate === "PASS") || (y.autoPrecision ?? -1) - (x.autoPrecision ?? -1) || (y.price ?? -1) - (x.price ?? -1) || (y.recall ?? -1) - (x.recall ?? -1));
const md = [
  "# SmartQuote Vietnam DocBench — Engine Comparison",
  "",
  "| Engine | Gates | Row recall | Row precision | SKU exact | Price exact | Trusted rows | Auto precision | Unsafe auto | Grounding | Runtime ms | Cost VND |",
  "|---|:---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
  ...rows.map((r) => `| ${r.engine} | ${r.gate} | ${pct(r.recall)} | ${pct(r.precision)} | ${pct(r.sku)} | ${pct(r.price)} | ${pct(r.trusted)} | ${pct(r.autoPrecision)} | ${pct(r.unsafe)} | ${pct(r.grounding)} | ${num(r.runtime)} | ${num(r.cost)} |`),
  "",
  "> Ranking prioritizes passing safety gates, then auto-approve precision, price exactness, and row recall. Runtime/cost are reported but do not override correctness gates.",
  "",
].join("\n");
if (a.out) { fs.mkdirSync(path.dirname(path.resolve(a.out)), { recursive: true }); fs.writeFileSync(path.resolve(a.out), md); console.log(`Comparison: ${path.resolve(a.out)}`); }
else console.log(md);
