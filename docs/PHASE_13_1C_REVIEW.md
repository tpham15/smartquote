# SmartQuote Phase 13.1C — Self-review

## Result

**PASS for implementation and benchmark integrity. Real PaddleOCR-VL accuracy remains BLOCKED_RUNTIME in this container.**

This distinction is intentional: Phase 13.1C is complete as tooling and decision infrastructure, but it does not claim an OCR accuracy result that could not be executed.

## Frozen benchmark

The Paddle slice remains unchanged:

- dataset: `smartquote-vietnam-docbench-paddleocr-vl-pdf-slice@0.1.0`
- 3 PDFs
- 92 frozen product rows
- 8 non-product traps
- 1 scan PDF + 2 digital PDFs

No ground truth, source document, release gate, or frozen scorer semantics were changed.

## Added

- `benchmarks/vietnam-docbench/error-analysis.mjs`
- `benchmarks/vietnam-docbench/route-decision.mjs`
- `scripts/phase131c-run-paddle-decision.mjs`
- `scripts/phase131c-error-decision-smoke.mjs`
- `docs/PHASE_13_1C_PADDLEOCR_VL_DECISION.md`
- package scripts for 13.1C run / analysis / route decision / smoke

## Real execution attempt

Result: `BLOCKED_RUNTIME`.

Observed runtime:

- Python 3.13.5
- `paddleocr`: absent
- `paddlex`: absent
- `paddle`: absent
- `PaddleOCRVL`: cannot import
- backend: native
- device: CPU

Network evidence:

- PyPI DNS: failed (`EAI_AGAIN`)
- Paddle package host DNS: failed (`EAI_AGAIN`)
- Paddle model host DNS: failed (`EAI_AGAIN`)

Execution fingerprint:

`a82dbc643a045720e13877d092677c8ca49787341713532bcdaa339eee24d776`

Fail-closed verification:

- no Paddle `predictions.json`
- no Paddle `score/report.json`
- no Paddle error-analysis report
- no synthetic accuracy number
- route decision = `BLOCKED_RUNTIME`
- production promotion = false

## Real private-corpus analyzer validation

The new analyzer was run against the existing SmartQuote deterministic digital-PDF predictions:

| Metric | Result |
|---|---:|
| Documents | 2 |
| GT products | 39 |
| Predicted products | 48 |
| Matched | 24 |
| Missed products | 15 |
| False products | 24 |
| Critical matched-row failures | 8 |
| Missing-grounding matched rows | 24 |

Dominant diagnostic errors:

- missing grounding: 24
- name mismatch: 24
- unit mismatch: 18
- section mismatch: 12
- line-total mismatch: 8
- quantity mismatch: 8

This validates row-level error reporting on frozen real labels without pretending these numbers describe PaddleOCR-VL.

## Automated regression

PASS:

- Phase 13.1C error-analysis + decision smoke
- Phase 13.1B Paddle execution smoke
- Phase 13.1A Paddle adapter smoke
- Vietnam DocBench unit suite: 29/29
- Phase 13.1 document-router smoke
- Phase 13.0B freeze smoke
- Phase 13.0.1 DocBench fix-pack smoke
- syntax checks for all new 13.1C Node modules

Production isolation:

- `src/**` byte-identical to Phase 13.1B
- no production Paddle imports
- no router change
- no API, auth, billing, Supabase, catalog, quotation or Excel-engine change

## Build status

`npm run build` was attempted but the source artifact has no installed `node_modules`, so the command stops at `vite: not found`. This environment also has no DNS access, so dependencies cannot be installed here. This is an environment/package-install blocker, not a detected source regression.

## Review score

Implementation quality: **9.5/10**.

The remaining missing evidence is the only evidence that matters for the candidate decision: a real PaddleOCR-VL run over the frozen 92-row slice. Until that exists, SmartQuote should not alter production routing.
