# SmartQuote Vietnam Document Intelligence Benchmark (Phase 13.0)

This benchmark is the evaluation gate for every future document engine. It deliberately measures **commercial-data correctness**, not generic OCR character error rate.

## What it measures

- Product-row precision / recall / F1
- False-product rate
- SKU exact match
- Unit-price exact match
- Quantity / unit / line-total exact match
- Product-name exact and token F1
- Trusted-row accuracy (all GT-defined critical fields correct)
- Auto-approve precision, coverage, and unsafe-auto-approve rate
- Source grounding coverage (page/sheet/row/bbox)
- Slices by input kind, document type, and difficulty tags

## Dataset design

Recommended first private benchmark: 30–50 real Vietnamese commercial documents, balanced across:

- supplier price lists
- old quotations
- BOM/takeoff sheets
- XLSX, digital PDF, scanned PDF, and phone photos
- clean + difficult cases (merged cells, borderless tables, stamps, blur, multi-page tables, missing SKU)

**Do not commit customer documents or customer ground truth.** Put them under `benchmarks/vietnam-docbench/private/`; this folder is gitignored.

## Run

```bash
npm run bench:phase13:smoke

node benchmarks/vietnam-docbench/run.mjs \
  --manifest benchmarks/vietnam-docbench/private/manifest.json \
  --predictions benchmarks/vietnam-docbench/private/predictions/current-smartquote.json \
  --out benchmarks/vietnam-docbench/reports/current-smartquote
```

Add `--fail-on-gates` in CI only after the real baseline dataset has been curated and versioned.

## Engine contract

Every engine must emit `sq-docbench-predictions-v1`. Use `adapters/smartquote-preview.mjs` for current SmartQuote `ImportPreviewResult`. PaddleOCR-VL / PP-StructureV3 / MinerU / other VLM adapters can be added later without changing scoring.

## Important

The release gates are initial R&D targets, not a claim that current SmartQuote already meets them. Establish baseline first, then compare engines on the same frozen dataset.

## Benchmark policy versioning (13.0.1)

Every manifest must declare `benchmarkPolicy: "sq-docbench-policy-v1"`. The policy freezes:

- row-match threshold
- SKU/name/price/source matching weights
- numeric separator interpretation
- descriptive rounding tolerance

**Changing any of these values means changing benchmark semantics and requires a new policy id.** Do not tune v1 weights to improve one engine's score.

### Field-aware numeric parsing

Ambiguous Vietnamese commercial numbers are interpreted by field:

- price fields (`unitPrice`, `listPrice`, `lineTotal`): a single separator followed by exactly three digits is thousands-preferred, so `12.345` → `12345`.
- quantity: a single dot/comma is decimal-preferred, so `12.345` → `12.345`.
- multiple 3-digit groups such as `1.234.567` remain grouped thousands for both policies.
- mixed separators use the last separator as decimal, e.g. `1.234,56` → `1234.56`.

Ground truth should still use numeric JSON whenever possible so parsing policy is evaluated on predictions, not accidentally encoded into labels.

### Strict price vs within-rounding

`fields.*.exact` remains strict and is the authoritative correctness metric. Price fields also report `withinRoundingRate` using the v1 descriptive tolerance of ±1,000 VND. This secondary metric is diagnostic only: it helps distinguish likely rounding-policy differences from larger extraction errors and is **not** a release gate.

## Tests

Pure benchmark functions use Node's built-in test runner:

```bash
npm run test:phase13
npm run smoke:phase13.0.1
```

Keep smoke tests for end-to-end benchmark behavior; add table-driven unit tests for normalizers, matcher policy, adapters, and metrics when those functions change.

## Frozen real-corpus verification (Phase 13.0B)

A real corpus is considered frozen only when its manifest declares two-pass source review and a `freeze-lock.json` verifies every source/ground-truth checksum plus the benchmark policy fingerprint.

Verify an installed private corpus:

```bash
npm run smoke:phase13.0B
```

Or verify directly:

```bash
node scripts/phase130b-freeze-corpus.mjs \
  --manifest /absolute/private/manifest.json \
  --lock /absolute/private/freeze-lock.json \
  --verify
```

Creating a new freeze lock is intentionally explicit:

```bash
node scripts/phase130b-freeze-corpus.mjs \
  --manifest /absolute/private/manifest.json \
  --create --reviewer-confirmed
```

After a lock exists, any change to a source document, ground-truth JSON, manifest, or scoring-policy fingerprint makes verification fail. Correct a frozen label by releasing a new benchmark version, never by silently editing the old one.

## Native-first routing and engine adapters (Phase 13.1)

Phase 13.1 adds `sq-document-router-v1` and a common adapter runner. Routing is intentionally separate from scoring:

- native spreadsheet before OCR/VLM;
- native PDF text before vision when selectable text is usable;
- scan/image PDF goes to page vision;
- hybrid PDF is diagnosed explicitly;
- external engines stay experimental until route-slice release gates pass.

Audit routing on a private corpus:

```bash
node benchmarks/vietnam-docbench/route-audit.mjs \
  --manifest /private/manifest.json \
  --probes /private/route-probes.phase13.1.json \
  --out /private/reports/phase13.1-route-audit
```

See `ENGINE_ADAPTER_CONTRACT.md` for plugging PaddleOCR-VL, PP-StructureV3, MinerU or another document engine into the same frozen scorer.

## PaddleOCR-VL benchmark candidate (Phase 13.1A)

Phase 13.1A adds a **benchmark-only** adapter for the complete PaddleOCR-VL 1.6 document parsing pipeline. It is not selected by the production document router.

Key constraints:

- PDFs/images only; XLSX stays native-first.
- Candidate adapters run label-blind and cannot receive ground-truth paths or expected row counts.
- Paddle table HTML is converted deterministically into the existing `sq-docbench-predictions-v1` schema.
- The adapter never emits `auto_approved`: PaddleOCR-VL document parsing does not provide a reliable per-field confidence signal suitable for SmartQuote's safety gate.
- Raw Paddle output may be retained only in a private benchmark directory.

See `engines/PADDLEOCR_VL_SETUP.md` for runtime setup and execution commands.

## PaddleOCR-VL decision layer (Phase 13.1C)

Phase 13.1C adds private row-level error diagnostics and a route-decision dossier on top of the Phase 13.1B execution benchmark. The frozen scorer and dataset are unchanged. If the Paddle runtime is unavailable, the flow records `BLOCKED_RUNTIME` and does not emit predictions or accuracy numbers. If execution succeeds, `error-analysis.mjs` explains misses, false products, field errors and grounding by document/page, and `route-decision.mjs` evaluates whether evidence is sufficient for a later review-only canary. Production promotion remains disabled in 13.1C.

## Locked PaddleOCR-VL execution environment (Phase 13.1D)

Phase 13.1D freezes an external execution environment for the real PaddleOCR-VL-1.6 PDF-slice benchmark. The runtime lock pins PaddleOCR 3.7.0 and PaddlePaddle 3.2.1 and provides separate Linux CPU and NVIDIA CUDA 12.6 Docker profiles.

The execution sequence is deliberately fail-closed:

1. build/select the locked image;
2. mount the PRIVATE frozen corpus and a persistent model cache;
3. run the 13.1D runtime doctor;
4. verify the frozen corpus;
5. execute the existing label-blind Paddle adapter;
6. score with the unchanged frozen scorer;
7. generate row-level error analysis and the Phase 13.1C route decision;
8. emit a fingerprinted 13.1D execution-evidence bundle.

No 13.1D code is imported by the SmartQuote production document router. See `docs/PHASE_13_1D_ACTUAL_PADDLE_EXECUTION_ENVIRONMENT.md`.

## Remote evidence verification (Phase 13.1E)

Phase 13.1E treats an external GPU benchmark host as an untrusted transport boundary. A completed 13.1D execution is sealed with a SHA-256 file inventory, then imported next to the trusted frozen private corpus. SmartQuote re-scores the imported predictions locally, rebuilds error analysis, and recomputes the 13.1C route decision before any canary handoff can be issued.

A one-byte post-seal mutation is covered by smoke tests and must return `REJECTED`. No 13.1E output changes production routing; a trusted eligible result only becomes `READY_FOR_EXPLICIT_CANARY_DESIGN`.

See `docs/PHASE_13_1E_REMOTE_EVIDENCE_TRUST_BOUNDARY.md`.

## PaddleOCR Official API candidate (Phase 13.1F)

Phase 13.1F adds a hosted `PaddleOCR-VL-1.6` benchmark path for operators without local GPU hardware. The hosted service receives the source PDF, but frozen labels/scoring remain local. Execution requires both `PADDLEOCR_ACCESS_TOKEN` and the explicit privacy acknowledgement `SQ_PADDLEOCR_OFFICIAL_API_ACK_UPLOAD=YES`.

The official API returns per-page Markdown rather than the local pipeline result schema, so 13.1F uses a dedicated deterministic Markdown-table normalizer. Output remains review-only and cannot change production routing.

See `docs/PHASE_13_1F_PADDLEOCR_OFFICIAL_API_BENCHMARK.md`.
