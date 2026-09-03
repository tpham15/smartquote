# SmartQuote Phase 14.0 — Self-review

## Result

**PASS for implementation scope; PILOT DATA NOT YET COLLECTED.**

Phase 14.0 changes the development objective from engine infrastructure to user-verifiable reliability.

## Implemented

1. `businessValidator.js`
   - dealer > retail: blocking error;
   - duplicate SKU in import: blocking error;
   - price-change anomaly versus current catalog;
   - a human-approved warning stays accepted on final import, while blocking business errors can never be bypassed by Approve;
   - reusable line/subtotal/VAT/grand-total invariants.

2. `pdfEvidence.js` + PDF pipeline hardening
   - explicit positive-evidence score;
   - price-only/noise rows cannot become heuristic products;
   - low evidence -> skipped;
   - medium evidence -> review;
   - strong evidence -> existing safe auto-approve path.

3. Source grounding
   - `/api/pdf-extract` exposes page geometry + row/part bbox;
   - source metadata survives normalization and preview conversion;
   - price click opens the original local PDF page;
   - exact price part is highlighted when text geometry exists;
   - scan/image PDFs degrade honestly to page-level evidence;
   - PDF cache schema bumped to prevent stale ungrounded cache hits.

4. Correction evidence
   - append-only tenant-scoped local events;
   - before/after, action, issues and source location retained;
   - UI shows correction-evidence count in processing details.

## Automated verification completed in this environment

PASS:

- `node scripts/phase140-pilot-reliability-smoke.mjs` (including warning-acceptance vs hard-error bypass regression)
- core import review smoke
- deterministic PDF smoke on Lumi/Bisco/Forest fixtures
- Dark Mode Step 6 QA
- Phase 12.5.6 spacing/alignment
- Phase 12.5.5 drawing cleanup
- Phase 12.4.3 same-origin API (Python + JS)
- tenant storage isolation
- white-label scrub
- Vercel JSX guard
- Vietnam DocBench unit suite: 32/32
- Phase 13.1F smoke
- Phase 13.1E smoke
- Phase 13.1D smoke
- Phase 13.1C error/decision smoke
- Node syntax checks for new pure modules and modified PDF/API modules

`npm install` was attempted so a full Vite build and the xlsx-dependent import smoke could run, but package installation could not complete because this build container cannot reach the npm registry. `smoke:import` therefore could not run here (`xlsx` unavailable). This is an environment limitation, not reported as a PASS.

## Scope isolation

No new:

- OCR model;
- GPU/Docker requirement;
- Phase 13 engine route;
- database migration;
- billing policy;
- Supabase table;
- external correction-data upload.

`documentRouter.js` is unchanged from 13.1F.

## Known boundaries

### Grounding

Exact bbox highlight is available for selectable-text PDFs processed by `/api/pdf-extract`. Image-only scans may only provide page-level evidence because there is no deterministic pdfjs text coordinate to highlight. This is intentional and visible to the user.

### Price history

Phase 14 compares a newly imported price with the current catalog value. True multi-version supplier price history / commercial diff remains a post-pilot feature, because it needs repeated real customer imports.

### Correction data

Correction evidence is local/tenant-scoped in 14.0. It is sufficient to test whether corrections are valuable before adding a cloud data pipeline or consent model.

### Pilot status

Code completion is not the success gate. Phase 14.0 is successful only after real companies use it. Do not continue infrastructure phases before reviewing pilot evidence.

## Recommendation

Ship this build to 5 real companies. Observe import -> review -> correction -> quote creation. The next phase should be chosen from measured bottlenecks, not from the old 13.x roadmap.
