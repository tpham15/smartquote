# SmartQuote FINAL P1.5.3.1 — Test Report

## Changes in this hotfix

1. `IndustryOnboarding.jsx`: the final CTA now uses `onClick={() => submit()}` so React's click event is not persisted as a business-type override.
2. `01_RUN_ON_SUPABASE.sql`: one master migration now applies the required pilot database changes in this order:
   - pilot security/billing hardening;
   - P1.5 industry profiles;
   - P1.5.2 catalog-image Storage/RLS;
   - P1.5.3 operational RPC hardening.

The industry step detects whether the industry column existed before this run. Existing pre-P1.5 workspaces are migrated to Smart Home only on the first introduction of the column; re-running the master does not overwrite intentionally NULL new-workspace onboarding state.

## Regression executed in packaging environment

PASS:
- P1.5.3.1 finalization smoke
- P1.5.3 release hardening
- P1.5.2 dealer image override
- P1.5.1 Bisco gate-motor identity
- P1.5 industry-neutral core
- P1.4 quote clarity
- billing security
- P1.3 PDF column-aware pricing
- P1.1 Final/Revision lifecycle
- P0 commercial safety

## Mac verification still required before deployment

Run `npm ci` and `npm run build` on the deployment Mac. The packaging container did not perform the final Vite build for this hotfix.
