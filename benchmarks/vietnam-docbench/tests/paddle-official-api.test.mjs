import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { markdownTablesToGrids, normalizePaddleOfficialApiResult } from "../engines/paddleocr-official-api-normalize.mjs";

const markdown = `# Bảng giá\n\n| STT | Tên sản phẩm | Mã | Giá bán lẻ | Giá NPP |\n|---|---|---|---:|---:|\n| 1 | Cổng mở xoay | 22F005 | 41.900.000 | 19.765.000 |\n\nGhi chú\n\n| STT | Tên sản phẩm | Mã | Giá |\n|---|---|---|---:|\n| 2 | Cảm biến | LM-MDZ/2.0 | 1.540.000 |`;

test("official API normalizer splits multiple markdown tables on one page", () => {
  const grids = markdownTablesToGrids(markdown);
  assert.equal(grids.length, 2);
  const rows = normalizePaddleOfficialApiResult({ jobId: "j1", pages: [{ markdownText: markdown }] });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].fields.sku, "22F005");
  assert.equal(rows[0].fields.unitPrice, 19765000);
  assert.equal(rows[0].fields.listPrice, 41900000);
  assert.equal(rows[1].fields.sku, "LM-MDZ/2.0");
  assert.equal(rows[1].fields.unitPrice, 1540000);
  assert.equal(rows[0].source.page, 1);
});

test("official API output is always review-only and carries no invented confidence", () => {
  const rows = normalizePaddleOfficialApiResult({ pages: [{ pageIndex: 2, markdownText: markdown }] });
  assert.ok(rows.length > 0);
  assert.ok(rows.every((r) => r.status === "need_review"));
  assert.ok(rows.every((r) => r.confidence == null));
  assert.ok(rows.every((r) => r.meta.backend === "paddleocr-official-api"));
  assert.equal(rows[0].source.page, 3);
});

test("official API adapter requires both token and explicit hosted-upload acknowledgement", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sq131f-probe-"));
  const fake = path.join(tmp, "paddleocr");
  fs.writeFileSync(fake, "#!/usr/bin/env bash\nexit 0\n");
  fs.chmodSync(fake, 0o755);
  const old = { cli: process.env.SQ_PADDLEOCR_CLI, token: process.env.PADDLEOCR_ACCESS_TOKEN, ack: process.env.SQ_PADDLEOCR_OFFICIAL_API_ACK_UPLOAD };
  try {
    process.env.SQ_PADDLEOCR_CLI = fake;
    delete process.env.PADDLEOCR_ACCESS_TOKEN;
    delete process.env.SQ_PADDLEOCR_OFFICIAL_API_ACK_UPLOAD;
    let mod = await import(pathToFileURL(path.resolve("benchmarks/vietnam-docbench/engines/paddleocr-official-api-1.6.mjs")).href + `?a=${Date.now()}`);
    assert.equal(mod.runtimeProbe().ready, false);
    process.env.PADDLEOCR_ACCESS_TOKEN = "sentinel-token";
    mod = await import(pathToFileURL(path.resolve("benchmarks/vietnam-docbench/engines/paddleocr-official-api-1.6.mjs")).href + `?b=${Date.now()}`);
    assert.equal(mod.runtimeProbe().ready, false);
    process.env.SQ_PADDLEOCR_OFFICIAL_API_ACK_UPLOAD = "YES";
    mod = await import(pathToFileURL(path.resolve("benchmarks/vietnam-docbench/engines/paddleocr-official-api-1.6.mjs")).href + `?c=${Date.now()}`);
    assert.equal(mod.runtimeProbe().ready, true);
  } finally {
    if (old.cli == null) delete process.env.SQ_PADDLEOCR_CLI; else process.env.SQ_PADDLEOCR_CLI = old.cli;
    if (old.token == null) delete process.env.PADDLEOCR_ACCESS_TOKEN; else process.env.PADDLEOCR_ACCESS_TOKEN = old.token;
    if (old.ack == null) delete process.env.SQ_PADDLEOCR_OFFICIAL_API_ACK_UPLOAD; else process.env.SQ_PADDLEOCR_OFFICIAL_API_ACK_UPLOAD = old.ack;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
