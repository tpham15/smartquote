# SmartQuote FINAL P2.0 — Learning Memory Foundation

This build is based on P1.5.5 Identity Learning Safety and adds tenant-scoped learning from Final quotes.

## Main behavior
- Final quotes become human-confirmed learning evidence.
- 1–2 confirmations: observe.
- 3–4 confirmations: suggest.
- 5+ confirmations: trusted identity memory.
- Historical prices/margins are reference-only; SmartQuote never auto-applies them.
- Cloud observations persist per workspace and are protected by RLS + Final-quote RPC guard.

## Supabase
Run `01_RUN_ON_SUPABASE.sql`. It contains all prior pilot migrations plus P2.0.
If the previous master is already live, `supabase/phase20_quote_learning.sql` is sufficient for the upgrade.

## Release test
Run:

```bash
npm ci
npm run smoke:pilot-p20
npm run smoke:pilot-p15.5
npm run smoke:pilot-p15.4
npm run smoke:pilot-p15.3.2
npm run smoke:pilot-p11
npm run smoke:pilot-p0
npm run smoke:tenant
npm run build
```

See `P2.0_RELEASE_NOTES.md` and `P2.0_TEST_REPORT.md`.
