#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sq131f-smoke-"));
const fakeCli = path.join(tmp, "paddleocr");
const source = path.join(tmp, "sample.pdf");
const gt = path.join(tmp, "gt.json");
const manifest = path.join(tmp, "manifest.json");
const predictions = path.join(tmp, "predictions.json");
const score = path.join(tmp, "score");
const rawDir = path.join(tmp, "raw");
const sentinel = "phase131f-secret-token-must-not-leak";

fs.writeFileSync(source, "%PDF-1.4\n% synthetic benchmark placeholder\n");
fs.writeFileSync(gt, JSON.stringify({
  schemaVersion: "sq-docbench-ground-truth-v1",
  documentId: "official-api-smoke",
  rows: [{ rowId: "r1", kind: "product", source: { page: 1, row: 3 }, fields: { name: "Cổng mở xoay", sku: "22F005", section: "", unit: "", quantity: null, unitPrice: 19765000, listPrice: 41900000, lineTotal: null, specs: "" }, acceptance: { criticalFields: ["sku", "unitPrice"] } }],
}, null, 2));
fs.writeFileSync(manifest, JSON.stringify({
  schemaVersion: "sq-docbench-manifest-v1",
  benchmarkPolicy: "sq-docbench-policy-v1",
  id: "phase131f-smoke",
  version: "0.0.1",
  releaseGates: { rowRecall: 0.98, rowPrecision: 0.99, skuExact: 0.99, unitPriceExact: 0.99, autoApprovePrecision: 0.999, maxUnsafeAutoApproveRate: 0.001, groundingCoverage: 0 },
  documents: [{ id: "official-api-smoke", inputKind: "scan_pdf", documentType: "supplier_price_list", sourceFile: "sample.pdf", groundTruth: "gt.json" }],
}, null, 2));

const fakeScript = `#!/usr/bin/env node\nconst fs=require('fs');\nconst a=process.argv.slice(2);\nif(a[0]==='api' && a.includes('--help')) process.exit(0);\nconst oi=a.indexOf('--output'); const fi=a.indexOf('--file_path');\nif(a[0]!=='api'||oi<0||fi<0) process.exit(9);\nconst output=a[oi+1];\nconst payload={jobId:'fake-job',pages:[{pageIndex:0,markdownText:'| STT | Tên sản phẩm | Mã | Giá bán lẻ | Giá NPP |\\n|---|---|---|---:|---:|\\n| 1 | Cổng mở xoay | 22F005 | 41.900.000 | 19.765.000 |'}]};\nfs.mkdirSync(require('path').dirname(output),{recursive:true}); fs.writeFileSync(output,JSON.stringify(payload,null,2)+'\\n');\n`;
fs.writeFileSync(fakeCli, fakeScript);
fs.chmodSync(fakeCli, 0o755);

const env = { ...process.env, SQ_PADDLEOCR_CLI: fakeCli, PADDLEOCR_ACCESS_TOKEN: sentinel, SQ_PADDLEOCR_OFFICIAL_API_ACK_UPLOAD: "YES", SQ_PADDLEOCR_RAW_DIR: rawDir };
let r = spawnSync(process.execPath, [path.join(root, "benchmarks/vietnam-docbench/engines/run-adapter.mjs"), "--manifest", manifest, "--adapter", path.join(root, "benchmarks/vietnam-docbench/engines/paddleocr-official-api-1.6.mjs"), "--out", predictions], { cwd: root, encoding: "utf8", env });
assert.equal(r.status, 0, r.stderr || r.stdout);
const pred = JSON.parse(fs.readFileSync(predictions, "utf8"));
assert.equal(pred.documents[0].rows.length, 1);
assert.equal(pred.documents[0].rows[0].fields.sku, "22F005");
assert.equal(pred.documents[0].rows[0].status, "need_review");

r = spawnSync(process.execPath, [path.join(root, "benchmarks/vietnam-docbench/run.mjs"), "--manifest", manifest, "--predictions", predictions, "--out", score], { cwd: root, encoding: "utf8", env });
assert.equal(r.status, 0, r.stderr || r.stdout);
const report = JSON.parse(fs.readFileSync(path.join(score, "report.json"), "utf8"));
assert.equal(report.overall.rowDetection.recall, 1);
assert.equal(report.overall.rowDetection.precision, 1);
assert.equal(report.overall.fields.sku.exact, 1);
assert.equal(report.overall.fields.unitPrice.exact, 1);

for (const dir of [rawDir, score]) {
  for (const name of fs.readdirSync(dir, { recursive: true })) {
    const p = path.join(dir, name);
    if (fs.existsSync(p) && fs.statSync(p).isFile()) assert.equal(fs.readFileSync(p, "utf8").includes(sentinel), false, `token leaked into ${p}`);
  }
}
assert.equal(fs.readFileSync(predictions, "utf8").includes(sentinel), false, "token leaked into predictions");

const adapterCode = fs.readFileSync(path.join(root, "benchmarks/vietnam-docbench/engines/paddleocr-official-api-1.6.mjs"), "utf8");
assert.match(adapterCode, /SQ_PADDLEOCR_OFFICIAL_API_ACK_UPLOAD/);
assert.match(adapterCode, /PaddleOCR-VL-1\.6/);
assert.match(adapterCode, /productionPromotionAllowed:\s*false/);

fs.rmSync(tmp, { recursive: true, force: true });
console.log("✓ Phase 13.1F official API smoke PASS");
