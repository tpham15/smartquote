# Phase 14.0 — Quote-table PDF pilot fix

## Scope

Small deterministic fixpack discovered during the final controlled-pilot rehearsal. It does **not** reopen Phase 13 OCR/model R&D and does not change production routing.

## Problems fixed

1. **`SL × Đơn giá = Thành tiền` was treated as price ambiguity.**
   - Quote-table arithmetic is now a strong structural signal.
   - When the last two money cells satisfy `quantity × unitPrice = lineTotal`, `costPrice` is the unit price and the line total is retained only as quote evidence.
   - A line total is never promoted to `listPrice` merely because it is the right-most money value.

2. **Document header/contact rows could become false products.**
   - Tax-code / phone / address / contact metadata is classified structurally as non-catalog content before product creation.
   - Section subtotals and quote summary/service rows are also catalog-ineligible.

3. **Wrapped table cells could lose SKU/name fragments.**
   - The deterministic PDF path now infers table column geometry from the header and reconstructs wrapped product/SKU cells from following visual rows in the same columns.
   - Letter-only segmented model codes such as `LM-PCB` and `TU-DAUGHI` are accepted when their shape is model-like.

4. **AI candidates could inflate a clean quote-table catalog.**
   - A selectable-text PDF with a recognized quotation table header now treats deterministic table rows as the catalog identity source of truth.
   - AI may enrich only a compatible deterministic product; it cannot append a new identity merely because its text looks plausible.
   - AI-only PDF rows are always `need_review` unless they are reconciled into a grounded deterministic anchor or explicitly reviewed by the user.
   - Resolved stale price/OCR/AI warnings are removed after the stronger deterministic row wins.

5. **Blocking rows were visually too aggressive in dark mode.**
   - Full-row dark red was replaced by a subtle semantic row surface plus a red left indicator.
   - Grounding panel shadows/highlights now consume theme tokens instead of hard-coded light-mode RGBA shadows.

6. **PDF cache invalidation.**
   - The PDF cache schema was bumped so a previously imported PDF is reparsed instead of reusing stale pre-fix predictions.

## Real-file validation

The fix was privately exercised against a three-page real Vietnamese quotation used during the pilot rehearsal. The source file is **not** committed or packaged.

Observed deterministic reconstruction after the fix:

- 28 line items reconstructed from the four quote sections.
- 17 unique catalog identities after SKU/name deduplication.
- all 17 deterministic identities were clean/auto-approved in the local geometry replay.
- the previously problematic sensor model was reconstructed with its SKU and unit price intact.
- simulated AI-only/truncated duplicates did not increase the 17-product catalog.
- company header/contact metadata: 0 catalog rows.
- section subtotals: 0 catalog rows.
- labor/quote summary: 0 catalog rows.
- line totals: not stored as retail/list prices.
- wrapped SKUs and previously missing model fields reconstructed from table geometry.

The real quotation's extracted page/row geometry was replayed locally through the deterministic parser (private evidence only; not packaged). The resulting check was `28 line-items → 17 unique products → 17 clean`, with no header/subtotal/labor rows admitted. Exact deployed `/api/pdf-extract` + hosted AI execution must still be rechecked once on Vercel because the build container cannot install the full dependency set from the network.

## Regression evidence

PASS in the build environment:

- `smoke:phase14.0:quote-table-pdf`
- Phase 14.0 pilot reliability smoke
- Phase 14.0 VAT UI/export + lossless Excel VAT smoke
- deterministic PDF Lumi/Bisco/Forest fixtures
- Dark Mode Step 5 + Step 6
- Vietnam DocBench 32/32
- core import review
- tenant isolation
- white-label scrub
- Vercel JSX guard
- auth UI / bank-transfer checkout
- spacing / orphan drawing cleanup
- same-origin API (Python + JS)
- plan gate / plan-limit consistency / API auth
- billing smoke (also corrected stale test-source coverage for the existing Free plan)
- auth recovery / hardening

## Pilot rule

This fix improves deterministic quote-table PDFs; it does not make all PDFs unattended-safe. `need_review` remains human-review territory, especially scans/image PDFs and layouts whose columns cannot be reconstructed confidently.
