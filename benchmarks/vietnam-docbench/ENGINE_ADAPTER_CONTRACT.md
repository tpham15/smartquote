# Phase 13.1 engine adapter contract

External OCR/document engines are benchmark-only until they pass the frozen DocBench gates for the slice they would serve. They are never selected in production merely because they exist in the registry.

An adapter is an ESM module exporting:

```js
export const engine = { id: "paddleocr-vl", version: "...", config: {} };
export function supports(document) { return true; }
export async function runDocument({ document, sourcePath, manifest }) {
  return { runtimeMs: 1234, estimatedCostVnd: 0, rows: [] };
}
```

Each row uses the existing `sq-docbench-predictions-v1` row shape (`kind`, `status`, `source`, `fields`). The adapter may call a local Python process, HTTP service, GPU server, or vendor API, but credentials and model binaries must stay outside Git.

Run it with:

```bash
node benchmarks/vietnam-docbench/engines/run-adapter.mjs \
  --manifest /private/manifest.json \
  --adapter /path/to/adapter.mjs \
  --out /private/predictions-paddle.json

node benchmarks/vietnam-docbench/run.mjs \
  --manifest /private/manifest.json \
  --predictions /private/predictions-paddle.json \
  --out /private/reports/paddle
```

Promotion rule: pass the frozen release gates on the **specific input slice** (`scan_pdf`, `digital_pdf`, `xlsx`, etc.). Overall score alone is not sufficient.

## Phase 13.1A label-blind execution

`run-adapter.mjs` now passes a **blind document context** to candidate adapters. The adapter receives only inference-time metadata (`id`, `inputKind`, `documentType`, `industry`, `supplier`, `tags`) plus `sourcePath`. It does not receive ground-truth paths, expected row counts, review evidence, source hashes, release gates, or the full manifest.

This is intentional benchmark hygiene: engine code must not be able to read the answer key while generating predictions.

## PaddleOCR-VL note

The Phase 13.1A adapter targets the complete `PaddleOCR-VL-1.6` pipeline. A standalone PaddleOCR-VL 0.9B recognition service is not treated as equivalent because the full pipeline also performs layout analysis, region handling, reading order and result assembly.
