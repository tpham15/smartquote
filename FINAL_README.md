# SmartQuote P1.5.5 — P1 Identity Learning Safety

P1.5.5 adds variant-safe fuzzy matching, exact-SKU precedence over stale corrections, supplier/brand-scoped correction learning, and end-to-end separation of Supplier / Brand / Origin. See `P1.5.5_RELEASE_NOTES.md`, `P1.5.5_TEST_REPORT.md`, and `PILOT_P1_5_5_START_HERE.md`.

No new SQL migration is required on top of the existing P1.5.3.1 pilot master SQL.

# SmartQuote P1.5.4 — P0 Identity Safety

P1.5.4 hardens product identity matching/deduplication before pilot. See `P1.5.4_RELEASE_NOTES.md` and `P1.5.4_TEST_REPORT.md`. No new SQL migration is required.

# SmartQuote FINAL — P1.5.3.1 Assisted Pilot

This build includes P0 through P1.5.3 plus the P1.5.3.1 pilot-finalization hotfix.

## One Supabase file

Before pilot deployment, run exactly this file in Supabase SQL Editor:

`01_RUN_ON_SUPABASE.sql`

It consolidates the required security, industry-profile, catalog-image Storage and release-hardening migrations in the correct order. The final result row is self-checking: all `*_should_be_false` values must be false; all `*_should_be_true` values must be true.

## Mac release check

```bash
npm ci
npm run smoke:pilot-p15.3.1
npm run smoke:pilot-p15.3
npm run smoke:pilot-p15.2
npm run smoke:pilot-p15.1
npm run smoke:pilot-p15
npm run smoke:pilot-security
npm run smoke:pilot-p14
npm run smoke:pilot-p13
npm run smoke:pilot-p12
npm run smoke:pilot-p11
npm run smoke:pilot-p0
npm run smoke:pdf
npm run smoke:billing
npm run smoke:quotes
npm run smoke:api-auth
npm run build
```

The real/private golden corpus is intentionally not shipped. Do not commit `.env`, service-role keys, private customer files, `node_modules` or `dist`.

## P1.5.3.2 — Bisco product identity hotfix
For quotation imports with a long `Thông số sản phẩm` cell, SmartQuote now preserves the first commercial product line as the product name. `Cổng tự động` remains a category only. No new SQL migration is required. Re-import any catalog rows already saved with the wrong derived name.
