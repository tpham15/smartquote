# SmartQuote — Final Pilot Audit

## Verdict

**GO for a controlled pilot with human review.**

**NOT YET GO for unattended/self-service extraction where SmartQuote output is trusted without review.**

The purpose of the pilot is to measure real workflow value and collect correction evidence, not to prove perfect OCR.

## What is ready

### Excel / quotation workflow

- Excel remains the default quote-export format.
- The primary CTA is **Xuất báo giá** and uses the selected Excel template.
- PDF is a secondary export action.
- Lossless Excel-template tests preserve static workbook fidelity.
- Quote totals, labor, VAT and grand total are wired into export paths.

### VAT

- Default VAT is 8% and is configurable per quotation.
- VAT is calculated on merchandise + labor.
- VAT is included in UI totals, PDF, generic Excel and template Excel output.
- Example verified: 74,969,000 + 7,496,900 = 82,465,900 before tax; VAT 8% = 6,597,272; grand total = 89,063,172.

### Business validation

Deterministic validation runs independently of AI confidence, including:

- dealer price above retail price;
- duplicate SKU;
- abnormal price jumps;
- quantity × unit price mismatch when those fields are available;
- subtotal / VAT / grand-total consistency.

Hard errors cannot be silently cleared by approving a soft warning.

### PDF evidence / grounding

- Selectable-text PDF rows retain page/row/source geometry where available.
- The UI can show source evidence for verification.
- Phase 14 positive-evidence gating reduces false products without raising the threshold in a way that would aggressively hurt recall.
- **Low-evidence PDF rows marked `pdf_ocr_uncertain` are manual-review-only and cannot be bulk-approved.**

### Correction evidence

Correction telemetry is append-only and tenant-scoped in browser storage.

The pilot build adds JSON export with:

- edit / approve / delete events;
- before/after values;
- file/import/line identity;
- source locator where available;
- exported/unexported counters.

No cloud upload is introduced in this pilot build.

## Accuracy boundary

Historical frozen-benchmark results show that the deterministic PDF baseline must not be treated as unattended extraction. Matched SKU/price fields were strong, but row-level recall/precision and grounding were not yet at release-gate levels.

Phase 14 improves false-product handling and review safety, but this build does **not** claim a new end-to-end real-corpus PDF accuracy percentage. The pilot must therefore keep human review in the loop, especially for PDFs and scans.

Practical operating rule:

1. Prefer native Excel when the supplier provides it.
2. Review every row shown as **Cần xem lại**.
3. Never bulk-approve `pdf_ocr_uncertain` rows.
4. Treat image-only / scanned PDFs as review-heavy inputs.

## Residual false-product risk

Synthetic probes confirm some non-product-looking lines can still reach the review queue at the evidence threshold, for example payment/bank/spec-like text containing a price-like number. They do **not** auto-approve.

This is intentionally left for pilot evidence rather than expanding a guessed denylist. Real customer delete/edit events should determine which structural rules are worth adding next.

## Workflow to pilot

Recommended pilot path:

1. Import supplier catalog / historical quotation.
2. Review validation warnings and uncertain extraction rows.
3. Import accepted products to catalog.
4. Build a customer quotation.
5. Confirm merchandise, labor, VAT and total.
6. Use **Xuất báo giá** for the Excel working file.
7. Use PDF only when a final fixed-format copy is needed.
8. Export pilot correction evidence before browser storage is cleared.

## Security / dependency boundary

The current SheetJS `xlsx` dependency is an old 0.18.x line with known security advisories and no clean patched npm upgrade path. Do not accept arbitrary public spreadsheet uploads during this controlled pilot. Use trusted files from known pilot companies/suppliers only.

Do not perform a blind SheetJS migration immediately before the pilot because SmartQuote relies on custom import/export and lossless OOXML behavior. Treat dependency migration as a separate post-pilot task with an Excel regression matrix.

## Final automated verification

The final source passed the available static/regression suite, including:

- Phase 14 Pilot Reliability smoke;
- VAT calculation and lossless-template VAT smoke;
- deterministic PDF fixture smoke where dependencies permit;
- Excel template/fidelity/merge/image-geometry regressions;
- DocBench 32/32 unit tests;
- plan-limit consistency;
- auth/billing/tenant isolation/white-label guards;
- Dark Mode Step 6;
- Vercel JSX guard.

Stale quota/fidelity smoke expectations found during the audit were corrected to current source-of-truth values.

## Environment limitations of this audit

A clean `npm ci` / full Vite build could not be completed inside the audit container because external package-registry access timed out. The repository now declares Node >=22 to match the installed Supabase SDK requirement.

Before deploying the pilot, run on the developer Mac or CI with Node 22:

```bash
node -v
npm ci
npm run build
npm run smoke:phase14.0
npm run qa:production
```

If all pass, deploy to the pilot environment and execute the two-user tenant/isolation checklist in `docs/PRODUCTION_QA_2_USER_CHECKLIST.md`.

One image-geometry smoke also depends on an external real workbook fixture that is intentionally not shipped in the public GitHub package; run it only when that fixture is available.

## Pilot gates

Do not open another R&D phase merely because the code is ready.

Collect at least:

- **5 real companies**;
- **30 real commercial documents**;
- **10 quotations produced from imported data**;
- review time per document;
- edits/deletes/approved warnings;
- false-product delete reasons;
- document types causing the most review;
- whether imported data actually reaches a customer quotation.

Only reopen extraction R&D if the pilot proves extraction quality is a material source of lost deals or excessive review time.
