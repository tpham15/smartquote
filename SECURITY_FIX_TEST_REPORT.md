# SmartQuote Pilot Security Fix — Test Report

## Scope

Emergency pre-pilot hardening only:

- protect dealer billing/subscription columns from browser updates;
- lock billing activation RPCs to service role / SQL admin;
- repair Node `smoke:pdf` so Vite `?url` does not break the release gate;
- keep existing customer billing request / paid-declaration workflow intact.

## PASS in build container

- `node scripts/pilot-security-billing-smoke.mjs`
- `node scripts/pdf-smoke.mjs`
- P1.4 Quote Clarity
- P1.3 PDF Column-Aware
- P1.2 Golden Freeze
- P1.2 Commercial Golden — 5/5
- P1.1 Final Quote Lifecycle
- P0 Commercial Safety
- Phase 15 Quote Completeness
- Phase 14.2 Universal PDF Framework
- Phase 14.1A Semantic Variant Binding
- Phase 14.1 PDF Engine v6
- Phase 14.0 VAT
- Phase 14.0 VAT lossless Excel
- Tenant storage isolation
- Plan limits consistency
- White-label scrub
- Vercel JSX guard
- Phase 12.6 bank-transfer checkout

`smoke:pdf` now executes the production deterministic parser through a test-only transformed module that removes only browser/network-only imports. It passed Lumi, Bisco and Forest fixtures after stale prompt-wording assertions were updated to the current production contract.

## Environment limitation

A clean `npm ci` attempt in the build container timed out at the npm registry, so tests that require installed npm dependencies (for example the full billing smoke importing the Supabase client) were not re-executed here. The user's Mac previously completed `npm ci`, production Vite build, quote-cloud smoke, API auth, and production QA successfully on the P1.4 lineage. Re-run the commands in `SECURITY_FIX_BEFORE_PILOT.md` on that Mac after applying this package.

## Live Supabase status

NOT YET CLAIMED AS FIXED until `supabase/smartquote_pilot_security_fix.sql` is executed on the real production Supabase project and its final verification row matches all `should_be_false=f` / `should_be_true=t` expectations.
