# SmartQuote Pilot P0 — START HERE

This folder is the Phase 15 source plus the **Commercial Correctness & Quote Immutability** P0 fix pack.

## What changed

- BOM pricing factor is explicit; cost-only ×1 is blocked from BOM quote creation.
- Gross margin uses true cost, negative margin is visible, unknown cost is not faked.
- Saved cloud quotes freeze product/cost/unit-sale snapshots inside `rooms` JSONB.
- BOM, KTS/AIReader and matrix takeoff cannot silently drop unresolved positive-quantity lines.
- Required quote-completeness items must be Add or explicit Skip before BOM quote creation.
- Partial Solution Family creation requires explicit confirmation.
- Serper/provider secret is server-side only; legacy browser keys are scrubbed.
- Added `smoke:pilot-p0`, `smoke:phase15`, and aggregate `smoke:pilot` commands.

See `docs/PILOT_P0_COMMERCIAL_CORRECTNESS.md` for the full audit/test result.

## Required on your Mac / CI before deploy

```bash
node -v       # must be Node 22+
npm ci
npm run build
npm run smoke:pilot
```

If any command fails, do not deploy that revision to pilot users.

## Suggested Git commands

```bash
git status
git add api/product-enrich.js package.json \
  src/SmartQuote.jsx \
  src/import-engine/bom/bomQuoteComposer.js \
  src/quote/quoteCommercialSafety.js \
  scripts/pilot-p0-commercial-safety-smoke.mjs \
  docs/PILOT_P0_COMMERCIAL_CORRECTNESS.md \
  PILOT_P0_START_HERE.md

git commit -m "Pilot P0 harden quote commercial correctness"
git push origin main
```

## Pilot boundary

This is a **controlled / assisted pilot candidate**, not public unattended upload. Prefer Excel; structured digital PDF remains review-assisted; scan PDF is review-heavy; CAD/DWG/BIM takeoff is not automated.
