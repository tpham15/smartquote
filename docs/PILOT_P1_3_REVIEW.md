# SmartQuote Pilot P1.3 — Digital PDF Column-Aware Review

## Verdict

**PASS for P1.3 scope.**

P1.3 improves deterministic selectable-text PDF extraction without changing Excel, BOM commercial logic, OCR/VLM routing, or quote lifecycle.

## What changed

1. Added `pdfColumnModel.js` — pure geometry/table logic.
2. Detects multiple table regions per page.
3. Merges nearby PDF text parts into visual cells before clustering.
4. Text columns cluster by left edge; numeric/right-aligned columns cluster by right edge.
5. Header labels are optional. When present they label roles; when absent roles are inferred conservatively from content.
6. `unitPrice`, `listPrice`, and `total` are read from their own columns.
7. Multiple unlabeled price columns without enough structural evidence produce `price_column_uncertain`; no commercial price is guessed.
8. Vietnamese price shorthand in price cells supports forms such as `850k`, `1,2 triệu`, `2tr4`, and grouped-digit formats.
9. Per-field bbox is retained for name/SKU/unit/quantity/unitPrice/listPrice/total/specs.
10. Grounding viewer prefers the exact price-cell bbox.
11. Rows handled by the column model are excluded from the old whole-row heuristic fallback.
12. Legacy heuristic remains available for regions that do not produce a trustworthy column model.
13. `productSanitizer` respects the explicit ambiguous-price decision and cannot recover a guessed price from raw row text.

## Safety invariant

For `pdf-a-column-v2`, the column decision is authoritative:

- explicit price column -> use that field;
- unit price + total -> keep them separate;
- multiple unlabeled prices -> `costPrice=0`, review required;
- whole-row quote arithmetic and generic sanitizer price recovery cannot override the ambiguity decision.

## Regression evidence

PASS in this review environment:

- `smoke:pilot-p13`
- P1.2 Golden Freeze + 5 commercial scenarios
- P1.1 Final Quote Lifecycle
- P0 Commercial Safety
- Phase 15 Quote Completeness
- Phase 14.2 Universal PDF Framework
- Phase 14.1A Semantic Variant Binding
- Phase 14.1 PDF v6
- Phase 14.0 Pilot Reliability
- Core Import Review
- tenant storage isolation
- plan-limit consistency
- white-label
- Vercel JSX guard
- JS/MJS syntax checks
- Python compile checks

P1.3 smoke also runs the actual production `extractColumnAwareProductsFromPdfPages()` and `normalizePdfItems()` offline by stubbing only network/browser-only imports. It verifies:

- `Đơn giá 1.200.000` remains cost price while `Thành tiền 2.400.000` stays line total;
- ambiguous `900.000 / 1.250.000` rows remain `costPrice=0` after normalization/sanitization;
- ambiguous rows are `need_review` and retain `price_column_uncertain`.

## Environment-limited gates

`npm ci` was attempted but package-registry access timed out in the build container. Therefore this environment cannot claim a clean Vite production build or dependency-backed real-file PDF execution.

Before paid-pilot deployment, run on Mac/CI with Node 22+:

```bash
npm ci
npm run build
npm run smoke:pilot-p13
npm run smoke:pilot
npm run smoke:pilot-release
```

The P1.2 private frozen corpus must be installed for `smoke:pilot-release`; the public GitHub artifact intentionally contains no private customer corpus.

## Product boundary after P1.3

- XLSX catalog/BOM/BOQ/RFQ: primary.
- Selectable-text structured PDF: stronger deterministic path, still review-gated.
- Multi-price ambiguous PDF: explicit review, no guessing.
- Scan/image PDF: assisted/review-heavy via existing route.
- CAD/DWG/BIM drawing takeoff: still outside automated pilot scope.
