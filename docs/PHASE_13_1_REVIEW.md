# SmartQuote Phase 13.1 — Final Review

## Result

PASS for the Phase 13.1 scope: native-first routing, route telemetry, multi-engine benchmark protocol, route-specific promotion gates, and production isolation of experimental engines.

## What changed

### Production-safe changes

- Added `src/import-engine/documentRouter.js` with frozen routing policy `sq-document-router-v1`.
- `/api/pdf-extract` now returns additive `probe` metadata (page/text density + classification). Existing response fields are unchanged.
- `pdfCatalogPipeline.js` consumes the router after text extraction and emits a `route` progress event.
- The existing scan boundary is preserved: fewer than 80 total selectable characters remains scan/page-vision mode; digital/hybrid PDFs continue through the existing text pipeline.
- `hybrid_pdf` is now diagnosed explicitly, but sparse-page selective vision is only recommended metadata in 13.1; it is not a new execution path yet.

### Benchmark/R&D changes

- Versioned engine registry for current SmartQuote + PaddleOCR-VL + PP-StructureV3 + MinerU + generic VLM fallback.
- Experimental engines are registry metadata only and are never selected as production primaries.
- Added a generic ESM engine adapter protocol and runner.
- Added current SmartQuote native-only adapter for XLSX/BOM/digital-PDF benchmarking when normal npm dependencies are installed.
- Added route audit and route-slice promotion checker.
- Added engine adapter contract documentation.

## Real frozen-corpus route audit

Frozen Vietnam DocBench v0.1 was used with derived PDF text-density probes. Ground truth and source files were not changed.

- Documents: 5
- Input-kind matches: 5/5 (100%)
- Lumi image-only scan -> `scan_pdf` -> `smartquote_pdf_page_vision_v3`
- Old quote digital PDF -> `digital_pdf` -> `smartquote_pdf_text_v3`
- Matrix BOM XLSX -> `xlsx` -> `smartquote_bom_native_v1`
- Complex quote XLSX -> `xlsx` -> `smartquote_excel_native_v2`
- Bisco distributor PDF -> `digital_pdf` -> `smartquote_pdf_text_v3`

The route audit intentionally uses the frozen manifest's document-type label so Phase 13.1 measures input routing independently. Automatic document-type classification exists in the router but is confidence-gated and is not claimed as benchmarked on v0.1 yet.

## Promotion-gate result for current deterministic PDF baseline

The existing Phase 13.0A deterministic PDF report was evaluated on the `digital_pdf` slice:

- Row recall: 61.54% -> FAIL vs 98.5%
- Row precision: 50.00% -> FAIL vs 99.5%
- SKU exact: 100% -> PASS
- Unit-price exact: 100% -> PASS
- Auto-approve precision: n/a -> FAIL
- Grounding coverage: 0% -> FAIL

Result: `NOT_READY` for promotion. Correct SKU/price on matched rows does not compensate for missed/false rows or missing grounding.

## Tests

Phase 13.1 tests: 25/25 PASS, including:

- exact preservation of the current 80-char scan boundary;
- scan/digital/hybrid PDF classification;
- native XLSX/BOM routing;
- confidence-gated document-type inference;
- experimental-engine production isolation;
- engine adapter protocol;
- all previous Phase 13 matcher/normalization/freeze tests.

Additional regressions PASS:

- Phase 13.0B freeze verification against the real private corpus;
- Phase 13.0A private corpus audit;
- Phase 13.0.1 FixPack;
- Phase 12.6.1 auth UI;
- Phase 12.6 billing;
- Dark Mode Step 6;
- Phase 12.5.6 UI spacing;
- Phase 12.5.5 Excel orphan drawing cleanup;
- Phase 12.4.3 same-origin API;
- tenant isolation;
- white-label scrub;
- Vercel JSX guard.

## Build/runtime limitation

The package has no `node_modules`. `npm ci --offline` cannot complete in this environment because npm cache is missing `yallist-3.1.1`. Therefore the new `smartquote-current-native` adapter and a full Vite production build could not be executed here. The adapter is syntax-checked and deliberately loads `xlsx`/`pdfjs-dist` only at execution time. Normal project installation is required to run it.

This limitation does not affect the pure router, route audit, frozen scorer, or regression results above.

## Frozen-corpus integrity

Phase 13.1 does not modify the frozen manifest, source documents, ground truth, policy, or freeze lock. Explicit Phase 13.0B freeze verification still passes:

- version 0.1.0
- 5 documents
- 156 product rows
- 23 non-product traps
- manifest SHA-256 prefix `55c89d74aff8...`

## Recommendation for Phase 13.2

Do not promote any external engine yet. First run the included adapter protocol against the frozen corpus for PaddleOCR-VL / PP-StructureV3 / MinerU, then compare route slices. Phase 13.2 should focus on Document Graph + grounding only after at least one candidate demonstrates better row recall/precision without weakening price safety.
