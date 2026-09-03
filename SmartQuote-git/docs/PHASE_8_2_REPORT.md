# SmartQuote Phase 8.2 — Quota Source Cleanup + Cost Tracking + Production QA Pack

## Goal

Remove hidden drift between SQL/client/API plan limits, add operational tracking for Serper cost, and provide a mandatory real Supabase 2-user QA checklist before launch.

## Changes

### 1. SQL remains the single source of truth

Canonical file:

```txt
supabase/phase8_1_plan_limits_source.sql
```

Runtime tables:

```txt
plan_catalog
plan_limit_catalog
```

Generated files:

```txt
src/billing/planCatalog.generated.js
api/_lib/planLimits.generated.js
api/plan_limits_generated.py
```

`src/supabase/billingStore.js` now imports prices from the generated SQL source instead of carrying another price map.

### 2. Removed hard-coded quota/price logic from old SQL functions

Updated:

```txt
supabase/phase6_billing_events.sql
supabase/phase7_1_must_fix.sql
supabase/phase8_product_enrichment.sql
supabase/schema.sql
```

`smartquote_plan_price_vnd()` now reads from `plan_catalog`.

`usage_monthly_limit()` now reads from `plan_limit_catalog`.

### 3. External API usage/cost tracking

New SQL:

```txt
supabase/phase8_2_operational_guardrails.sql
```

New tables:

```txt
external_api_budget_catalog
external_api_usage
```

New helper:

```txt
api/_lib/externalUsage.js
```

`/api/product-enrich` now:

- checks Serper monthly budget before calling Serper;
- records Serper search/image calls;
- stores estimated cost in `external_api_usage`;
- includes `externalUsage` in API logs and product_enrich usage metadata.

Default estimated Serper unit cost is stored in SQL and can be overridden by env:

```txt
SMARTQUOTE_SERPER_UNIT_COST_USD
SMARTQUOTE_SERPER_MONTHLY_BUDGET_USD
SMARTQUOTE_SERPER_STARTER_MONTHLY_BUDGET_USD
SMARTQUOTE_SERPER_PRO_MONTHLY_BUDGET_USD
SMARTQUOTE_SERPER_BUSINESS_MONTHLY_BUDGET_USD
```

### 4. Guard tests

New script:

```bash
npm run smoke:phase82
```

Updated:

```bash
npm run smoke:plan-limits
npm run smoke:billing
npm run smoke:api-auth
npm run smoke:phase8
```

These tests now fail if old SQL files reintroduce hard-coded plan quota/price logic outside the canonical SQL source/generated files.

### 5. Production QA pack

New checklist:

```txt
docs/PRODUCTION_QA_2_USER_CHECKLIST.md
```

New script:

```bash
npm run qa:production
```

This checks production env/schema basics, then the docs walk through the mandatory two-user A/B tenant isolation test.

## Supabase migration order

If your project is already on Phase 8.1, run:

```txt
supabase/phase8_2_operational_guardrails.sql
```

If creating a fresh project, run:

```txt
supabase/schema.sql
```

## Remaining limitations

- `xlsx` still has a high-severity advisory with no npm fix available.
- `qa:production` checks schema/env, but the 2-user isolation test is still manual.
- Serper unit cost is an estimate; verify against the real Serper dashboard after pilot usage.
- Billing remains manual, which is acceptable for pilot but not fully self-serve.
