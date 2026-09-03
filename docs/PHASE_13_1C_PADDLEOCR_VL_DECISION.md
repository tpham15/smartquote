# Phase 13.1C — PaddleOCR-VL real-run decision layer

## Goal

Phase 13.1C closes the gap between “adapter can execute” and “SmartQuote has enough evidence to decide whether PaddleOCR-VL deserves a scan/hybrid role”.

The phase does **not** change production routing.

## What 13.1C adds

1. **Real-run orchestration**
   - verifies the frozen Vietnam DocBench package before inference;
   - records network/runtime evidence;
   - invokes the Phase 13.1B PaddleOCR-VL benchmark runner;
   - never converts a missing runtime into empty predictions.

2. **Private row-level error analysis**
   - missed product rows;
   - false product rows;
   - likely non-product traps emitted as products;
   - SKU / price / quantity / unit / total / name / section mismatches;
   - missing grounding;
   - unsafe auto-approvals;
   - per-document and per-page breakdowns.

3. **Route decision dossier**
   - full frozen production-gate result remains unchanged;
   - a separate `reviewOnlyExtraction` view evaluates extraction gates only when the candidate emits zero auto-approved rows;
   - possible evidence states are `BLOCKED_RUNTIME`, `KEEP_EXPERIMENTAL`, `SCAN_REVIEW_CANARY_ELIGIBLE`, `DIGITAL_REVIEW_CANARY_ELIGIBLE`, or `REVIEW_FALLBACK_CANDIDATE`;
   - `productionPromotionAllowed` is hard-coded `false` in this phase.

## Commands

Run the complete 13.1C flow against the PRIVATE frozen corpus:

```bash
npm run bench:phase13.1C:paddle -- /absolute/path/to/SmartQuote-VietnamDocBench-v0.1-Phase13.1C-PADDLE-PRIVATE
```

Run regression:

```bash
npm run smoke:phase13.1C
```

Run analysis manually after a successful execution:

```bash
npm run bench:phase13.1C:analyze -- \
  --manifest /private/manifest-paddle-pdf-subset.json \
  --predictions /private/reports/phase13.1C-paddleocr-vl-1.6/predictions.json \
  --out-dir /private/reports/phase13.1C-paddleocr-vl-1.6
```

## Build-container execution on 2026-09-03

The frozen corpus verified successfully. The real PaddleOCR-VL execution then stopped fail-closed with:

```text
status = BLOCKED_RUNTIME
python = 3.13.5
paddleocr = not installed
paddlex = not installed
paddle = not installed
PaddleOCRVL class import = unavailable
```

DNS checks also failed for:

- `pypi.org`
- `www.paddlepaddle.org.cn`
- Paddle model storage

Therefore this environment cannot install the runtime or download model weights. 13.1C intentionally emitted no Paddle predictions and no accuracy score.

Execution config SHA-256:

`a82dbc643a045720e13877d092677c8ca49787341713532bcdaa339eee24d776`

## Analyzer proof on real frozen labels

To verify that the new error-analysis layer works on real private evidence, it was also executed against the existing deterministic digital-PDF baseline:

- 2 documents
- 39 ground-truth products
- 48 predicted products
- 24 matched
- 15 missed products
- 24 false products
- 8 matched rows with critical-field failures
- 24 matched rows missing grounding

These are **current deterministic baseline** diagnostics, not PaddleOCR-VL results.

## Production boundary

Phase 13.1C does not import PaddleOCR into `src/**` and does not change the document router. A later explicit canary/production phase is required even if PaddleOCR-VL eventually produces a passing review-only slice decision.
