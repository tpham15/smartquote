# Phase 13.1 — Native-first Document Router + Engine Benchmark Layer

## Goal

Route every commercial document to the cheapest/highest-fidelity native path before vision/VLM, while keeping experimental OCR/document models benchmark-only until they pass frozen Vietnam DocBench gates.

## Production routing policy (`sq-document-router-v1`)

- XLSX/XLS/CSV -> native spreadsheet parser.
- XLSX with explicit BOM intent -> native BOM parser.
- Digital PDF -> native PDF text/table pipeline first.
- Hybrid PDF -> native text first, page vision remains fallback and sparse-page vision is marked recommended for a later execution phase.
- Image-only/scan PDF -> page vision first.
- Image -> image vision route.

Phase 13.1 preserves the existing PDF scan threshold: total selectable text below 80 characters is scan/image mode. It adds a `hybrid_pdf` diagnosis without changing the existing digital-PDF execution path.

## PDF probe

`/api/pdf-extract` now returns a non-breaking `probe` object:

- page count;
- total text chars;
- chars per page;
- selectable-page count and ratio;
- average chars per page;
- router classification and reasons.

Existing fields remain unchanged.

## Experimental engine isolation

The benchmark registry knows about PaddleOCR-VL, PP-StructureV3, MinerU and generic VLM fallback, but all are marked `experimental`. They do not appear in production imports. The production route always selects a SmartQuote engine first.

An external engine is eligible for promotion only after it passes frozen release gates on the **specific input slice** it would serve. An overall benchmark score is not sufficient.

## Benchmark adapter protocol

`benchmarks/vietnam-docbench/engines/run-adapter.mjs` provides one common runner for current/future engines. Adapters emit the existing `sq-docbench-predictions-v1` schema, so every engine is scored by the same frozen matcher/metrics.

A native-only current SmartQuote adapter is included. It intentionally makes no network/Claude call:

- XLSX -> current Excel v2;
- BOM XLSX -> current BOM parser;
- digital PDF -> current deterministic PDF text heuristic;
- scan/photo -> unsupported in this native-only adapter and therefore returns no rows.

This distinction prevents a misleading claim that an offline deterministic baseline represents the full production AI pipeline.

## Promotion discipline

`promotion-check.mjs` evaluates one report slice against the frozen release gates. `NOT_READY` means the engine stays experimental even if it is faster or cheaper.

## Privacy

The route-audit probe file and real corpus remain private. No customer source document or private ground truth is added to the public package/Git.

## Commands

```bash
npm run smoke:phase13.1

node benchmarks/vietnam-docbench/route-audit.mjs \
  --manifest /private/manifest.json \
  --probes /private/route-probes.phase13.1.json \
  --out /private/reports/phase13.1-route-audit \
  --fail-on-mismatch
```

When normal npm dependencies are installed:

```bash
node benchmarks/vietnam-docbench/engines/run-adapter.mjs \
  --manifest /private/manifest.json \
  --adapter benchmarks/vietnam-docbench/engines/current-smartquote-native.mjs \
  --out /private/predictions-current-native.json
```
