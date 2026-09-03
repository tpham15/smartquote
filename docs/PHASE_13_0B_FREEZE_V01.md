# Phase 13.0B — Second-pass review & freeze Vietnam DocBench v0.1

## Scope

Phase 13.0B does not change production OCR/import behavior and does not add a new OCR/VLM engine. It turns the Phase 13.0A draft corpus into a versioned, mutation-detecting benchmark suitable for fair engine comparison.

## Freeze contract

A frozen corpus must satisfy all of the following:

- every source file still matches its SHA-256 recorded in the manifest;
- every ground-truth file has completed two-pass source review;
- each manifest document is marked `frozen_second_pass_verified`;
- expected product-row counts match ground truth;
- numeric consistency checks still pass;
- `freeze-lock.json` pins the manifest hash, source hashes, GT hashes, row counts, and `sq-docbench-policy-v1` fingerprint;
- mutation of either source or GT makes verification fail;
- corrections after freeze require a new dataset version.

## v0.1 review results

The private v0.1 corpus contains 5 documents, 156 product rows, and 23 explicit non-product traps.

Second-pass review used the original source documents rather than SmartQuote predictions:

- Lumi image-only scan: 53 rows re-counted as 21 + 26 + 6 across pages 1–3; SKU and price values visually checked against the scan.
- Old quotation PDF: 14 product rows checked against PDF layout text, including quantity, unit price, and line total.
- Matrix BOM XLSX: 30 non-zero area×product cells checked against the physical sheet; zero cells remain absent and the total row remains non-product.
- Complex quotation XLSX: 34 product rows checked against worksheet rows; formula-backed lighting fields were checked against cached OOXML values stored in the submitted file rather than recalculating external links.
- Bisco distributor PDF: 25 rows checked; `unitPrice` is explicitly the NPP/distributor price and `listPrice` is the retail price. Duplicate SKU `22F005` is intentionally preserved because it appears in two distinct physical commercial rows.

No critical factual label correction was required in the second pass. The pass did clarify source-fidelity conventions for merged family labels, cached formula values, multiple price columns, and duplicate SKU rows before freeze.

## Production isolation

`src/**` is intentionally unchanged from Phase 13.0A. The real corpus stays under the ignored private benchmark path and is never included in the public Git/Vercel package.

## Commands

```bash
npm run test:phase13
npm run smoke:phase13.0B
```

For a separately stored private corpus:

```bash
node scripts/phase130b-freeze-corpus.mjs --manifest /path/manifest.json --verify
```

## Self-check hardening discovered during freeze

The 13.0A private package contained a hand-built `predictions-perfect.json` that was stale for the first Bisco row (`VULCAN 24V 22F005` versus frozen canonical SKU `22F005`). A frozen benchmark must not rely on a manually maintained “perfect” prediction fixture.

13.0B therefore generates the self-check prediction directly from the frozen GT at runtime and requires every applicable metric to be exactly 100%. This self-check is run only after the freeze lock verifies, so it tests scorer/alignment consistency without becoming a second source of truth.
