# SmartQuote — Security Fix Before Paid Assisted Pilot

## Critical gate

Before accepting paid pilot users on the live Supabase project, run:

`supabase/smartquote_pilot_security_fix.sql`

in **Supabase Dashboard → SQL Editor** for the production project.

The migration closes two billing privilege paths:

1. authenticated workspace owners/admins can no longer change `plan`, `subscription_status`, `trial_ends_at`, `current_period_end`, or `plan_started_at` directly;
2. `admin_activate_manual_billing_event` and `admin_activate_dealer_plan` are explicitly denied to `anon` and `authenticated`, granted to `service_role`, and also self-check the caller role inside the SECURITY DEFINER function.

Normal browser operations remain supported:

- read own dealer/workspace through RLS;
- update safe dealer profile fields `name`, `phone`, `address`;
- create workspace;
- save quotes/catalog/app state;
- create a manual billing request;
- mark the caller's own pending billing event as paid;
- server-side quota/rate-limit operations.

## What to verify after running the SQL

The SQL ends with one verification row.

Every column whose name ends with `_should_be_false` must be `f`.
Every column whose name ends with `_should_be_true` must be `t`.

Do not continue to paid pilot if any result differs.

## Local release checks

After applying the source package on the Mac:

```bash
npm ci
npm run smoke:pilot-security
npm run smoke:pdf
npm run smoke:billing
npm run build
```

Then run production QA with server-side Supabase credentials loaded temporarily in the shell:

```bash
npm run qa:production
```

The public release gate remains:

```bash
npm run smoke:pilot-release
```

`smoke:pilot-release` intentionally still requires the private Golden Corpus. Do not weaken that gate merely to obtain a green result.

## Remaining pilot boundaries

These are not part of this emergency billing fix:

- `xlsx` 0.18.5 remains a dependency risk; for the first assisted pilot accept only trusted spreadsheets from known pilot customers/suppliers and plan a separate SheetJS migration/regression phase.
- Add a React ErrorBoundary as a separate small hardening phase.
- Use a Supabase plan/back-up posture appropriate for paid production data before relying on the service commercially.
- Customer-facing data terms should disclose external processing where SmartQuote sends content to configured AI/search providers.
