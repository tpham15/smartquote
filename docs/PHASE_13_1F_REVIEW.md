# SmartQuote Phase 13.1F — Self-review

## Result

**PASS for implementation scope. Real hosted PaddleOCR-VL accuracy remains pending operator credentials and explicit permission to upload the private benchmark PDFs.**

## Scope

Phase 13.1F adds a no-local-GPU benchmark path using the PaddleOCR official hosted API while preserving SmartQuote's frozen Vietnam DocBench scorer, label blindness and production isolation.

Frozen candidate slice remains:

- 3 PDF documents
- 92 product rows
- 8 non-product traps
- model: `PaddleOCR-VL-1.6`
- task: `doc_parsing`
- backend identity: `paddleocr-official-api`

## Added

- `benchmarks/vietnam-docbench/engines/paddleocr-official-api-1.6.mjs`
  - official API client probe
  - pinned model/task arguments
  - token presence as boolean only
  - mandatory hosted-upload acknowledgement
  - raw response retention in private reports
  - review-only predictions
- `benchmarks/vietnam-docbench/engines/paddleocr-official-api-normalize.mjs`
  - dedicated hosted-output normalizer
  - per-page `markdownText` support
  - multiple Markdown tables per page
  - HTML tables embedded in Markdown
  - deterministic reuse of the existing SmartQuote table-field mapping
- `scripts/phase131f-setup-official-api.sh`
- `scripts/phase131f-doctor.mjs`
- `scripts/phase131f-run-official-api.mjs`
- `scripts/phase131f-smoke.mjs`
- Phase 13.1F docs and package scripts

## Why a separate normalizer is required

The local PaddleOCR-VL pipeline used in 13.1A-D exposes structured parsing blocks such as `parsing_res_list`. The official hosted document-parsing API returns per-page Markdown output. Treating those schemas as identical would produce a misleading benchmark, so 13.1F maps hosted Markdown tables through a separate deterministic boundary.

## Privacy boundary

Hosted inference causes source documents to leave the operator's machine. 13.1F therefore requires both:

1. `PADDLEOCR_ACCESS_TOKEN`
2. `SQ_PADDLEOCR_OFFICIAL_API_ACK_UPLOAD=YES`

No upload occurs unless both are present. Token values are never written to execution identity, status, predictions, score reports or raw-output paths.

A smoke test uses a sentinel token and scans generated evidence to verify it is absent.

## Functional verification

PASS:

- Phase 13.1F end-to-end fake hosted client smoke
- official API Markdown normalization
- multiple tables on one page
- retail vs distributor price mapping
- review-only / no invented confidence
- token + upload-ack gate
- token non-leak check
- full Phase 13.1F orchestrator against the real frozen 3-PDF manifest with a fake API client
- frozen scorer and error analysis invoked from the full orchestrator
- 32/32 Vietnam DocBench unit tests
- Phase 13.1E evidence trust-boundary smoke
- Phase 13.1D runtime smoke
- Phase 13.1C error/decision smoke
- Phase 13.1B execution smoke
- Phase 13.1A adapter smoke
- Phase 13.1 document router
- Phase 13.0B freeze mutation smoke
- Phase 13.0.1 fix-pack

Additional regressions PASS:

- Phase 12.6.1 Auth UI
- Phase 12.6 billing
- Dark Mode Step 6
- Phase 12.5.6 spacing/alignment
- Phase 12.5.5 orphan drawing cleanup
- Phase 12.4.3 same-origin API (Python + JS)
- tenant storage isolation
- white-label scrub
- Vercel JSX guard

## Full-orchestrator fake execution

A fake `paddleocr api` client was run against the actual frozen 3-PDF manifest. The test deliberately emitted unrelated product rows, producing 0 recall / 0 precision and `KEEP_EXPERIMENTAL`. This number is **not a PaddleOCR result**; its only purpose is to prove that the complete 92-row orchestration reaches frozen scoring, error analysis and route decision without label access during inference.

The sentinel API token did not appear anywhere in the generated report tree.

## Current environment execution

The actual hosted runner was invoked without a fake client.

Result: `BLOCKED_RUNTIME` because:

- `paddleocr api` client is not installed in this container;
- no `PADDLEOCR_ACCESS_TOKEN` is configured;
- no explicit hosted-upload acknowledgement is configured.

Frozen corpus verification completed before this block. No private PDF was uploaded, no `predictions.json` was created and no real accuracy numbers were manufactured.

## Production isolation

Phase 13.1F changes benchmark/docs/scripts/package-script files only.

- no production router change
- no `src/**` behavior change
- no `api/**` behavior change
- no SQL migration
- no billing/auth/catalog change
- `productionPromotionAllowed = false`
- `productionRoutingChanged = false`
- all hosted rows remain human-review-only

## Review conclusion

Phase 13.1F implementation: **PASS**.

The next meaningful action is not another parser phase. Install the hosted API client on the operator machine, set the token locally, explicitly authorize upload of the frozen PDFs, and run the one-command 92-row benchmark. The resulting score should determine whether a later phase is Paddle-specific error correction or a review-only canary design.
