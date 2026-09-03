import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { normalizePaddleOfficialApiResult } from "./paddleocr-official-api-normalize.mjs";

const cli = process.env.SQ_PADDLEOCR_CLI || "paddleocr";
const model = "PaddleOCR-VL-1.6";
const backend = "official-api";

export const engine = Object.freeze({
  id: "paddleocr-vl-1.6-official-api",
  version: model,
  config: {
    benchmarkOnly: true,
    hostedInference: true,
    backend,
    modelType: "doc_parsing",
    model,
    layoutDetection: true,
    chartRecognition: false,
    prettifyMarkdown: false,
    fieldConfidenceAvailable: false,
    productionPromotionAllowed: false,
  },
});

export function supports(document) {
  return ["digital_pdf", "hybrid_pdf", "scan_pdf", "photo"].includes(document?.inputKind);
}

export function runtimeProbe() {
  const tokenConfigured = Boolean(process.env.PADDLEOCR_ACCESS_TOKEN);
  const uploadAcknowledged = process.env.SQ_PADDLEOCR_OFFICIAL_API_ACK_UPLOAD === "YES";
  const r = spawnSync(cli, ["api", "--help"], { encoding: "utf8", env: process.env });
  const clientReady = r.status === 0;
  return {
    schemaVersion: "sq-paddleocr-official-api-probe-v1",
    backend,
    model,
    clientCommand: path.basename(cli),
    clientReady,
    clientError: clientReady ? null : String(r.stderr || r.stdout || r.error?.message || "paddleocr api unavailable").trim(),
    tokenConfigured,
    uploadAcknowledged,
    ready: clientReady && tokenConfigured && uploadAcknowledged,
  };
}

function safeName(s) { return String(s || "document").replace(/[^a-zA-Z0-9._-]+/g, "_"); }

function execCli(args, { timeoutMs = 45 * 60 * 1000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cli, args, { env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`PaddleOCR official API timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`paddleocr api failed (${code}): ${stderr.trim() || stdout.trim()}`));
      resolve({ stdout, stderr });
    });
  });
}

export async function runDocument({ document, sourcePath }) {
  const started = Date.now();
  if (!supports(document)) return { runtimeMs: 0, estimatedCostVnd: null, rows: [] };
  if (!process.env.PADDLEOCR_ACCESS_TOKEN) throw new Error("PADDLEOCR_ACCESS_TOKEN is required for official API benchmarking");
  if (process.env.SQ_PADDLEOCR_OFFICIAL_API_ACK_UPLOAD !== "YES") {
    throw new Error("Refusing hosted upload until SQ_PADDLEOCR_OFFICIAL_API_ACK_UPLOAD=YES is set explicitly");
  }

  const rawRoot = process.env.SQ_PADDLEOCR_RAW_DIR || path.join(os.tmpdir(), "smartquote-paddleocr-official-api-raw");
  fs.mkdirSync(rawRoot, { recursive: true });
  const rawPath = path.join(rawRoot, `${safeName(document.id)}.json`);
  const requestTimeout = process.env.SQ_PADDLEOCR_API_REQUEST_TIMEOUT_SEC || "300";
  const pollTimeout = process.env.SQ_PADDLEOCR_API_POLL_TIMEOUT_SEC || "1800";
  const args = [
    "api",
    "--model_type", "doc_parsing",
    "--model", model,
    "--file_path", sourcePath,
    "--request_timeout", requestTimeout,
    "--poll_timeout", pollTimeout,
    "--use_layout_detection", "True",
    "--use_chart_recognition", "False",
    "--prettify_markdown", "False",
    "--output", rawPath,
  ];
  await execCli(args);
  if (!fs.existsSync(rawPath)) throw new Error(`Official API client returned success but did not create ${rawPath}`);
  const raw = JSON.parse(fs.readFileSync(rawPath, "utf8"));
  const rows = normalizePaddleOfficialApiResult(raw);
  return {
    runtimeMs: Date.now() - started,
    estimatedCostVnd: null,
    rows,
    meta: {
      backend,
      model,
      jobId: raw?.jobId || raw?.job_id || raw?.result?.jobId || null,
      pages: raw?.pages?.length || raw?.result?.pages?.length || raw?.data?.pages?.length || 0,
      rawPath,
    },
  };
}
