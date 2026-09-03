#!/usr/bin/env node
import path from "node:path";
import fs from "node:fs";
import { pathToFileURL, fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const localCli = path.join(root, ".venv_paddleocr_api", "bin", "paddleocr");
if (!process.env.SQ_PADDLEOCR_CLI && fs.existsSync(localCli)) process.env.SQ_PADDLEOCR_CLI = localCli;
const adapter = await import(pathToFileURL(path.join(root, "benchmarks/vietnam-docbench/engines/paddleocr-official-api-1.6.mjs")).href + `?doctor=${Date.now()}`);
const p = adapter.runtimeProbe();
console.log(JSON.stringify({
  schemaVersion: "sq-phase131f-doctor-v1",
  model: "PaddleOCR-VL-1.6",
  backend: "official-api",
  clientReady: p.clientReady,
  tokenConfigured: p.tokenConfigured,
  uploadAcknowledged: p.uploadAcknowledged,
  ready: p.ready,
  note: "Token value is never printed. Hosted execution uploads benchmark PDFs to PaddleOCR official API only after explicit upload acknowledgement.",
}, null, 2));
process.exit(p.ready ? 0 : 3);
