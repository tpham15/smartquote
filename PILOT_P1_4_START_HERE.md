# SmartQuote Pilot P1.4 — Quote Clarity

Scope: quote-screen UX simplification only. No pricing, PDF extraction, catalog, Supabase schema, or lifecycle rules are weakened.

## Changes

- Hide normal plan/quota chrome from the quote workflow; locked billing state remains visible.
- Compact quote management to one lifecycle title + Save Draft + progressive Manage menu.
- Sales pipeline status appears only for Final quotes.
- Customer form defaults to customer/company, phone, project; address/category/quote number live under “Thông tin thêm”.
- Final Quote Gate shows only actionable blockers by default and collapses passed checks.
- Hide the snapshot dependency while the quote has zero lines; it appears if it becomes a real blocker after products exist.
- Quiet gross-margin empty state: do not say “missing cost 0 lines”.

## Smoke

```bash
npm run smoke:pilot-p14
npm run smoke:pilot-p13
npm run smoke:pilot-p12
npm run smoke:pilot-p11
npm run smoke:pilot-p0
```

Production release gate remains `npm run smoke:pilot-release`.
