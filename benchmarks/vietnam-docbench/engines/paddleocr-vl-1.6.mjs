import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { normalizePaddleOcrVlResult } from "./paddleocr-vl-normalize.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const bridge = path.join(here, "paddleocr_vl_bridge.py");
const pipelineVersion = process.env.SQ_PADDLEOCR_VL_PIPELINE_VERSION || "v1.6";
const backend = process.env.SQ_PADDLEOCR_VL_BACKEND || "native";

export const engine = Object.freeze({
  id: "paddleocr-vl-1.6-full-pipeline",
  version: "PaddleOCR-VL-1.6",
  config: {
    benchmarkOnly: true,
    fullPipeline: true,
    pipelineVersion,
    backend,
    device: process.env.SQ_PADDLEOCR_VL_DEVICE || "cpu",
    layoutDetection: true,
    orientationClassification: true,
    documentUnwarping: true,
    fieldConfidenceAvailable: false,
  },
});

export function supports(document) {
  return ["digital_pdf", "hybrid_pdf", "scan_pdf", "photo"].includes(document?.inputKind);
}

function execBridge(args, { timeoutMs = 30 * 60 * 1000 } = {}) {
  const python = process.env.SQ_PADDLEOCR_PYTHON || "python3";
  return new Promise((resolve, reject) => {
    const child = spawn(python, [bridge, ...args], { env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error(`PaddleOCR-VL bridge timed out after ${timeoutMs}ms`)); }, timeoutMs);
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`PaddleOCR-VL bridge failed (${code}): ${stderr.trim() || stdout.trim()}`));
      resolve({ stdout, stderr });
    });
  });
}

export async function runtimeProbe() {
  const { stdout } = await execBridge(["--probe"], { timeoutMs: 30_000 });
  return JSON.parse(stdout);
}

function safeName(s) { return String(s || "document").replace(/[^a-zA-Z0-9._-]+/g, "_"); }

export async function runDocument({ document, sourcePath }) {
  const started = Date.now();
  if (!supports(document)) return { runtimeMs: 0, estimatedCostVnd: 0, rows: [] };
  const rawRoot = process.env.SQ_PADDLEOCR_RAW_DIR || path.join(os.tmpdir(), "smartquote-paddleocr-vl-raw");
  fs.mkdirSync(rawRoot, { recursive: true });
  const rawPath = path.join(rawRoot, `${safeName(document.id)}.json`);
  await execBridge(["--input", sourcePath, "--out", rawPath]);
  const raw = JSON.parse(fs.readFileSync(rawPath, "utf8"));
  const rows = normalizePaddleOcrVlResult(raw);
  return {
    runtimeMs: Number(raw.runtimeMs) || Date.now() - started,
    estimatedCostVnd: backend === "native" ? 0 : null,
    rows,
    meta: { rawPath, pages: raw.pages?.length || 0 },
  };
}
