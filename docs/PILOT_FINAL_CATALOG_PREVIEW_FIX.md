# Pilot Final — Catalog preview / quotation-table fix

## Scope

This fix is intentionally narrow and remains inside Phase 14.0 pilot reliability.
No OCR/VLM engine change and no production routing change.

## Fixed

1. Selectable-text quotation tables with arithmetic-proven rows (`qty × unit price = line total`) use deterministic table identities as the catalog source of truth.
2. AI can enrich a matching deterministic product, but cannot append extra catalog identities when the deterministic quote-table baseline is strong.
3. Wrapped/truncated model codes are normalized and reconstructed, including suffixes split to following visual lines.
4. Common pdfjs Vietnamese glyph fragmentation around accented letters is repaired before product identity matching.
5. Catalog dedupe accepts a truncated SKU only when its model stem is compatible with the full SKU and product identity agrees.
6. Positive-evidence provenance is no longer emitted as a customer-facing issue.
7. Preview issue lists ignore `info` diagnostics and de-duplicate product/line copies of the same warning/error.
8. Review/error rows no longer receive a full amber/red fill; status is shown with a thin left indicator and badges/messages.

## Private real-file verification

The user-supplied quotation was inspected transiently and is NOT included in this repository or package.
Its table structure contains 28 product line-items and collapses to 17 catalog product identities after SKU/name normalization and cross-section dedupe.
The private geometry replay produced 17/17 auto-approved identities with no actionable issues.

## Regression

PASS:

- `smoke:phase14.0:quote-table-pdf`
- `smoke:phase14.0:catalog-preview`
- Phase 14.0 pilot reliability smoke
- deterministic PDF smoke (Lumi/Bisco/Forest)
- core import review smoke
- Dark Mode Step 6
- Phase 12.5.6 spacing/alignment
- Vercel JSX guard
- Vietnam DocBench 32/32
- VAT UI/export + lossless Excel VAT
- API auth/quota, plan gate, plan-limit consistency, tenant isolation, white-label

Full dependency-backed production build should still be run by the user's normal GitHub/Vercel deployment workflow.
