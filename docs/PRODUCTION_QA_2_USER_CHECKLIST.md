# SmartQuote Production QA — 2-user Supabase isolation checklist

Run this once on the real Supabase/Vercel production stack before sending paid traffic.
Smoke tests are useful, but this checklist proves RLS, auth headers, quota, and tenant isolation with real users.

## Prerequisites

1. Deploy frontend/API to Vercel production or preview.
2. Run the full `supabase/schema.sql`, or all migrations through `supabase/phase8_2_operational_guardrails.sql`.
3. Set production env:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `ANTHROPIC_API_KEY`
   - `SERPER_API_KEY`
4. Run:

```bash
npm run qa:production
```

## Test A — user A cannot leak into user B

1. Open a clean/private browser profile.
2. Register User A, example: `qa-a+<date>@yourdomain.com`.
3. Create/import at least 3 catalog items for Dealer A.
4. Create one quote for Dealer A and save it to cloud.
5. Create one billing request from the upgrade screen.
6. Log out.
7. Register User B in the same browser profile, example: `qa-b+<date>@yourdomain.com`.
8. Confirm Dealer B catalog is empty.
9. Confirm Dealer B quote list is empty.
10. Confirm Dealer B billing request list does not show User A's billing event.
11. Add 1 catalog item and 1 quote for Dealer B.
12. Log out, log back in as User A.
13. Confirm User A still sees only Dealer A's 3 catalog items and 1 quote.
14. Confirm User A does not see Dealer B's item/quote.

Expected result: no cross-workspace data appears in catalog, quotes, billing events, import rows, or local cache.

## Test B — API must reject cross-dealer access

1. Get User A Supabase access token from browser devtools or Supabase session.
2. Get Dealer B id from Supabase dashboard.
3. Call any protected API with token A but `X-SmartQuote-Dealer-Id: <dealer B id>`.

Example:

```bash
curl -i https://YOUR_APP_DOMAIN/api/product-enrich \
  -H "Authorization: Bearer USER_A_ACCESS_TOKEN" \
  -H "X-SmartQuote-Dealer-Id: DEALER_B_ID" \
  -H "Content-Type: application/json" \
  -d '{"query":"ghế ăn gỗ sồi"}'
```

Expected result: `403` with message similar to `Tài khoản này không thuộc workspace đại lý được yêu cầu.`

Repeat for:

```txt
/api/claude
/api/pdf-extract
/api/web-products
/api/excel
/api/product-enrich
```

## Test C — trial/paid expiry

1. In Supabase SQL Editor, set Dealer A to expired paid plan:

```sql
update public.dealers
set plan = 'pro',
    subscription_status = 'active',
    current_period_end = now() - interval '1 day'
where id = '<DEALER_A_ID>';
```

2. Refresh User A app.
3. Try product enrichment and PDF AI.

Expected result: app/API blocks with payment/renewal message even though `subscription_status = active`.

## Test D — quota and external Serper budget

1. Set Dealer B to trial.
2. Run product enrichment until trial quota is exhausted.
3. Confirm UI blocks further calls.
4. Confirm API returns quota/budget error if called directly.
5. In Supabase, check:

```sql
select event_type, sum(units)
from public.usage_events
where dealer_id = '<DEALER_B_ID>'
group by event_type;

select provider, operation, sum(units), sum(estimated_cost_usd)
from public.external_api_usage
where dealer_id = '<DEALER_B_ID>'
group by provider, operation;
```

Expected result: `usage_events` tracks product_enrich quota, and `external_api_usage` tracks Serper calls/cost estimate.

## Test E — manual billing activation

1. User B creates a Pro monthly billing request.
2. Confirm `billing_events.status = pending`.
3. Activate with:

```sql
select public.admin_activate_manual_billing_event(
  '<BILLING_EVENT_ID>',
  '<BANK_REFERENCE>',
  'QA activation'
);
```

4. Refresh User B app.

Expected result: Dealer B plan becomes `pro`, `subscription_status = active`, `current_period_end` is in the future, and Pro quotas display.

## Pass criteria

Do not launch paid traffic until all pass:

- User A never sees User B data.
- Token A + dealer_id B is rejected by every protected API.
- Expired paid plan is blocked even when status is still `active`.
- Product enrichment records both quota usage and Serper external usage.
- Manual billing activation updates plan and unlocks quota.
