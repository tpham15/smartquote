# SmartQuote P1.5.5 — Start Here

P1.5.5 is the P1 identity-learning safety release on top of P1.5.4.

## Supabase

No new SQL is required for P1.5.5. If the environment has not yet been migrated through P1.5.3.1, run the existing `01_RUN_ON_SUPABASE.sql` once before deployment.

## Release check on Mac

```bash
npm ci
npm run smoke:pilot-p15.5
npm run smoke:pilot-p15.4
npm run smoke:pilot-p15.3.2
npm run smoke:pilot
npm run build
```

The private golden corpus is intentionally not included. For a paid-pilot release, also run it on the machine where the private corpus is installed:

```bash
npm run golden:pilot:private
```

## Important learning change

P1.5.5 uses a new safe correction-learning key (`sq_correction_learning_v2`). Old P1.5.4/plain-SKU learning is intentionally not imported because it can contain cross-supplier collisions. New corrections will accumulate again under supplier/brand-scoped identity.
