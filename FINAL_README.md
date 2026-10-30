# SmartQuote — FINAL Assisted Pilot Build

Final packaged build: **Pilot P1.4**

Includes the hardened sequence:
- P0 — commercial pricing safety and immutable quote snapshots
- P1.1 — Draft / Final / Revision lifecycle and Final Quote Gate
- P1.2 — golden commercial regression / release gates
- P1.3 — digital PDF column-aware price binding
- P1.4 — quote-screen clarity / reduced UI clutter

## Verified before packaging

The supplied P1.4 candidate passed its available regression suite, including P1.4, P1.3, P1.2, P1.1, P0, Phase 15, PDF Phase 14.x, VAT, tenant storage, plan limits, API auth, white-label and Vercel JSX guards. The production Vite build was also verified on the user's Mac during final pre-pilot testing.

## Final Mac check

```bash
npm ci
npm run smoke:pilot-p14
npm run smoke:pilot-p13
npm run smoke:pilot-p12
npm run smoke:pilot-p11
npm run smoke:pilot-p0
npm run smoke:quotes
npm run smoke:api-auth
npm run build
```

For production Supabase schema QA, provide `SUPABASE_URL` and a server-side Supabase secret/service-role key only in the shell environment, then run:

```bash
npm run qa:production
```

Do not commit production secrets. Do not run `npm audit fix --force` immediately before the pilot without a dedicated dependency regression cycle.

## Privacy boundary

This package intentionally excludes:
- `.env` / `.env.local`
- `node_modules`
- build `dist`
- `.git`
- real/private customer golden corpus
- private benchmark ground truth

The private Vietnam DocBench folder is intentionally shipped only with its placeholder when present.

## Mandatory security migration before paid pilot

This package includes a post-P1.4 billing security hardening migration. Before accepting paid pilot users, read `SECURITY_FIX_BEFORE_PILOT.md` and execute `supabase/smartquote_pilot_security_fix.sql` on the live Supabase project. Source changes alone do not change the production database.
