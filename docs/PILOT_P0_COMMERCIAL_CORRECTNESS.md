# SmartQuote Pilot P0 — Commercial Correctness & Quote Immutability

## Verdict

**Code gate: PASS for assisted pilot candidate, subject to clean dependency install/build on the deployment machine.**

This patch intentionally does not change PDF/OCR routing. It closes business-correctness gaps discovered in Phase 15 before paid pilot use.

## Fixed P0 issues

1. **BOM cost-only pricing no longer silently becomes a 0% margin quote.**
   - BOM composer accepts an explicit/default markup factor.
   - Cost-only/markup rows at factor `<= 1` are flagged as `pricingNeedsReviewCount`.
   - BOM UI disables Create Quote until pricing is reviewed.
   - Generated quote lines preserve the chosen factor.

2. **Gross margin uses true cost and never hides losses.**
   - Fixed-price products use `costPrice` as cost, not list/sale price.
   - Negative margin is displayed as negative instead of clamped to zero.
   - If cost is unknown, margin is shown as unknown rather than a fake 100%.
   - Export/final save requires explicit confirmation for at/below-cost or unknown-cost rows.

3. **Saved quotes are immutable commercial snapshots.**
   - Each saved line stores product identity/spec snapshot, unit sale price snapshot and cost snapshot in `rooms` JSONB.
   - Reopening a quote overlays saved snapshots over the current catalog.
   - Supplier/catalog repricing no longer changes an already-saved quotation.
   - Editing factor/product intentionally clears the affected sale snapshot so a new snapshot is made on save.

4. **No silent BOM/takeoff line loss.**
   - Core BOM rows must be Resolve or explicit Ignore before Create Quote.
   - Required Quote Completeness recommendations must be Add or explicit Skip.
   - Matrix takeoff blocks Create Quote while a positive-quantity column is unmapped.
   - Legacy KTS/AIReader blocks Create Quote while an unmatched row has no manual product selection.

5. **Provider secrets stay server-side.**
   - Product enrichment API accepts Serper key only from server env (`SERPER_API_KEY` / `SMARTQUOTE_SERPER_API_KEY`).
   - Browser no longer asks for or calls Serper with a user-entered key.
   - Legacy `googleApiKey/googleCx` values are scrubbed from company state on load/import.
   - Auto image fetch now uses authenticated `/api/product-enrich`.

6. **One pilot smoke command.**
   - `npm run smoke:pilot-p0`
   - `npm run smoke:phase15`
   - `npm run smoke:pilot` aggregates commercial P0 + Phase 15 + PDF + VAT + tenant + auth + quote/cloud + production QA checks.

## Tests executed in this audit container

PASS:

- `npm run smoke:pilot-p0`
- `npm run smoke:phase15`
- `npm run smoke:phase14.2`
- `npm run smoke:phase14.0:vat`
- `node scripts/phase140-pilot-reliability-smoke.mjs`
- `npm run smoke:tenant`
- `npm run smoke:plan-limits`
- `npm run smoke:white-label`
- `npm run smoke:phase12.4.1`
- `npm run smoke:api-auth`
- `npm run smoke:hardening`
- `npm run smoke:phase12.6.1`
- `npm run smoke:phase12.6`
- `npm run smoke:phase12.5.6`
- `npm run smoke:dark-mode-step6`
- Phase 14.0 catalog preview cleanup
- Phase 14.0 non-catalog disposition
- all `.js/.mjs` syntax checks
- all `src/*.jsx` parse checks via TypeScript parser
- Python compile checks

Environment-blocked, **not source-failed**:

- `npm ci` — registry transport timed out; offline cache is missing `yallist` and other packages.
- `npm run build` — cannot run until dependencies are installed.
- `npm run smoke:quotes` — imports `@supabase/supabase-js`, unavailable without `node_modules`.
- `npm run qa:production` — same dependency-install blocker.
- Phase 14 PDF tests that import `pdfjs-dist` / `xlsx` — same dependency-install blocker.

## Mandatory deployment-machine gate

Run on the Mac/CI that will deploy the pilot, Node 22+:

```bash
node -v
npm ci
npm run build
npm run smoke:pilot
```

Then deploy and run the two-user tenant isolation checklist. Do not put customer files into the environment until all four commands pass.

## Pilot operating boundary remains unchanged

- Excel BOM/BOQ/RFQ: preferred.
- Digital structured PDF: assisted/review.
- Scan PDF: review-heavy.
- CAD/DWG/BIM / architect drawing takeoff: not automated.
- Public/anonymous spreadsheet upload: not enabled for pilot.
