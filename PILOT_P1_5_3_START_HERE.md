# SmartQuote P1.5.3 — START HERE

## 1. Apply live Supabase hardening

Open Supabase Dashboard → SQL Editor → New query and run the entire file:

`supabase/phase15_3_pilot_release_hardening.sql`

At the bottom:
- every `*_should_be_false` must be `false`;
- every `*_should_be_true` must be `true`.

This is required even if the earlier billing security migration already passed.

## 2. Mac regression

```bash
npm ci
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

## 3. Production sanity after Vercel deploy

Test with a Lighting workspace:
1. Login.
2. Import catalog.
3. Import a KTS/BOM file and confirm generated sections do not contain Smart Home/Lumi wording.
4. Create and Finalize a quote.
5. Export default Excel and confirm the summary title is `TỔNG HỢP HẠNG MỤC`.
6. Refresh/reopen quote.
7. Upload a dealer product image and confirm Serper does not overwrite it.

## 4. Private golden corpus

The archive does not ship customer documents. If you enforce the strict paid-release gate, install your existing private Vietnam DocBench corpus and run:

```bash
npm run golden:pilot:private
npm run golden:pilot:baseline:verify
```

Do not recreate the baseline just to obtain a green result.
