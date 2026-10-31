# P2.0 Test Report — Final Quote Learning Memory

## PASS
- Final quote observations are consolidated to one observation per product identity per quote.
- Duplicate observation replay is idempotent.
- 1–2 Final quotes remain observe-only.
- 3–4 Final quotes expose suggestion metadata without changing identity.
- 5+ Final quotes may fill missing/placeholder identity fields.
- Trusted learning never overwrites current cost/list/sale pricing.
- Same SKU across different suppliers remains isolated.
- Tenant-scoped local memory remains isolated.
- Origin survives Final quote snapshot learning.
- Cloud SQL requires a real Final quote before learning is written.
- Cloud table is SELECT-only to authenticated browser role; direct INSERT is revoked.
- Learning RPC is denied to anon and allowed to authenticated members.
- P1.5.5, P1.5.4, Bisco identity, P1.5.3.x, P1.5.2, P1.5.1, P1.5, P1.1, P0 and tenant-storage regressions PASS.

## Production build
`npm ci --prefer-offline --no-audit --no-fund` timed out in the container before Vite was installed, so production Vite build is **not claimed PASS here**. Run `npm ci && npm run build` on the deployment Mac before pushing.
