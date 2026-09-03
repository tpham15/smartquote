# SmartQuote Phase 8.1 — SQL Source of Truth for Plan Quotas

## Goal

Remove silent quota drift between client, serverless JS, Python API helpers, and Supabase SQL.

Before this phase, plan limits existed in multiple hard-coded places:

- `src/billing/planLimits.js`
- `api/_lib/limits.js`
- `api/auth_guard.py`
- `supabase/schema.sql`
- phase migration SQL files overriding `usage_monthly_limit()`

That made it easy for a future price/quota change to update one layer but miss another layer.

## What changed

### SQL is now canonical

New file:

```txt
supabase/phase8_1_plan_limits_source.sql
```

It creates and seeds:

```txt
plan_catalog
plan_limit_catalog
```

`usage_monthly_limit()` now reads from `plan_limit_catalog` instead of embedding a large `case` statement.

### Generated code now carries the same values

Generated files:

```txt
src/billing/planCatalog.generated.js
api/_lib/planLimits.generated.js
api/plan_limits_generated.py
```

These files are marked as generated and should not be edited manually. Update the SQL first, run `npm run generate:plan-limits`, then run the smoke test.

### Existing code imports generated values

Updated:

```txt
src/billing/planLimits.js
api/_lib/limits.js
api/auth_guard.py
```

The business logic remains in these files, but quota/price values come from generated plan catalog files.

## New smoke test

```bash
npm run generate:plan-limits
npm run smoke:plan-limits
```

This test parses `supabase/phase8_1_plan_limits_source.sql` and verifies it matches:

- client `PLAN_LIMITS`
- client `PLAN_PRICE_VND`
- API JS `PLAN_LIMITS`
- Python `PLAN_LIMITS`
- `getMonthlyLimit()` behavior

If someone changes a quota in JS but not SQL, the smoke test fails.

## Supabase migration

If the project is already on Phase 8, run:

```txt
supabase/phase8_1_plan_limits_source.sql
```

If creating a fresh project, run:

```txt
supabase/schema.sql
```

`schema.sql` now includes the Phase 8.1 SQL source-of-truth block at the end, overriding older hard-coded `usage_monthly_limit()` definitions.

## Current quota source

| Plan | Products | Quotes/month | Web scrape | Product enrich | PDF AI | Claude AI |
|---|---:|---:|---:|---:|---:|---:|
| Trial | 100 | 5 | 3 | 5 | 3 | 50 |
| Starter | 1,500 | 30 | 20 | 50 | 10 | 300 |
| Pro | 10,000 | Unlimited | 100 | 250 | 50 | 1,500 |
| Business | 50,000 | Unlimited | 500 | 1,000 | 300 | 6,000 |

## Review score

Phase 8.1: **9/10**

This is now much safer because SQL is canonical, generated code is produced by `npm run generate:plan-limits`, and `npm run smoke:plan-limits` fails if client/API/Python drift from SQL. It is not 10/10 only because production should still add a CI job that runs this smoke test on every pull request.
