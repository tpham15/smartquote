# SmartQuote P1.5.3.1 — Pilot Finalization

This hotfix makes two narrowly scoped changes:

1. The onboarding `Vào SmartQuote →` button now calls `submit()` through a zero-argument wrapper, so React's click event can no longer overwrite the selected `business_type`.
2. All required live Supabase pilot migrations are consolidated into one master file: `01_RUN_ON_SUPABASE.sql`.

## Supabase

Open Supabase → SQL Editor → New query and run the entire file:

`01_RUN_ON_SUPABASE.sql`

It applies, in order:
1. pilot billing/security hardening;
2. P1.5 industry profiles;
3. P1.5.2 catalog image Storage/RLS;
4. P1.5.3 server-only RPC hardening.

The last result row is the verification row. Every column ending `_should_be_false` must be `false`; every column ending `_should_be_true` must be `true`.

## Mac check

```bash
npm ci
npm run smoke:pilot-p15.3.1
npm run smoke:pilot-p15.3
npm run smoke:pilot-p15.2
npm run smoke:pilot-p15.1
npm run smoke:pilot-p15
npm run smoke:pilot-security
npm run build
```

Do not run `npm audit fix --force` immediately before pilot deployment.
