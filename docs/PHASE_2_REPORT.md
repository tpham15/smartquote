# SmartQuote Phase 2 — API Auth + Server-side Quota

## Goal

Protect expensive/server-side APIs before public SaaS launch:

- `/api/claude`
- `/api/pdf-extract`
- `/api/web-products`
- `/api/excel`

Also harden `/api/img` with SSRF/private-network guardrails because image tags cannot easily send Authorization headers.

## What changed

### Server auth helpers

Added:

```txt
api/_lib/cors.js
api/_lib/supabaseAdmin.js
api/_lib/auth.js
api/_lib/limits.js
api/_lib/usage.js
api/auth_guard.py
```

Each protected API now requires:

```txt
Authorization: Bearer <Supabase access token>
X-SmartQuote-Dealer-Id: <dealer_id>
```

The server verifies the JWT with Supabase, checks the user belongs to the requested `dealer_id`, checks monthly quota, then records usage.

### Frontend authenticated fetch

Added:

```txt
src/supabase/apiFetch.js
```

Replaced direct fetch calls for:

```txt
/api/claude
/api/pdf-extract
/api/web-products
/api/excel
```

with `smartQuoteFetch()`, which attaches the current Supabase access token and active dealer id.

### Supabase schema

Added table:

```txt
usage_events
```

Run one of these in Supabase SQL Editor:

- New project: run the full `supabase/schema.sql`
- Existing project: run `supabase/phase2_usage_events.sql`

### Quota limits in this phase

```txt
Trial:
- Claude AI requests: 50/month
- Web scrape: 3/month
- PDF extract: 3/month
- Excel export: 10/month

Starter:
- Claude AI requests: 300/month
- Web scrape: 20/month
- PDF extract: 10/month
- Excel export: 100/month

Pro:
- Claude AI requests: 1500/month
- Web scrape: 100/month
- PDF extract: 50/month
- Excel export: 1000/month

Business:
- Claude AI requests: 6000/month
- Web scrape: 500/month
- PDF extract: 300/month
- Excel export: 5000/month
```

These are code-level defaults in `api/_lib/limits.js` and `api/auth_guard.py`. Phase 3 should move plan status/trial dates into DB-driven gating.

## Required Vercel environment variables

Frontend:

```txt
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
```

Server-only:

```txt
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
ANTHROPIC_API_KEY
```

Never expose `SUPABASE_SERVICE_ROLE_KEY` in frontend code.

Optional:

```txt
SMARTQUOTE_ALLOWED_ORIGIN=https://your-domain.vn
SMARTQUOTE_API_AUTH_DISABLED=true   # local only, never production
```

## API behavior

### Not logged in

Protected endpoints return:

```txt
401 Bạn cần đăng nhập để gọi API này.
```

### Wrong dealer/workspace

Protected endpoints return:

```txt
403 Tài khoản này không thuộc workspace đại lý được yêu cầu.
```

### Over quota

Protected endpoints return:

```txt
403 Đã vượt quota ...
```

with a `quota` object in JSON.

## Tests run

```bash
npm ci
node --check api/claude.js
node --check api/web-products.js
node --check api/pdf-extract.js
node --check api/img.js
python3 -m py_compile api/excel.py api/auth_guard.py
npm run build
npm run smoke:api-auth
npm run smoke:tenant
npm run smoke:import
npm run smoke:bom
npm run smoke:pdf
npm audit --omit=dev
```

Result:

```txt
Build: PASS
API auth/quota smoke: PASS
Tenant smoke: PASS
Import smoke: PASS
BOM smoke: PASS
PDF smoke: PASS
Audit: FAIL only because xlsx has known high-severity advisories and no fix available in current package.
```

## Current score

```txt
Phase 0: 8/10
Phase 1 + 1.1: 8.5/10
Phase 2: 8/10

Private beta readiness: 8.3/10
Public ads readiness: 6.5/10
```

## Remaining before public ads

- Phase 3: trial expiry + plan gates in DB/UI.
- Phase 4: save/reopen quotes in cloud.
- Add real browser E2E test against Supabase/Vercel.
- Replace or isolate `xlsx` in Phase 7.
- Consider signed/cached image proxy if `/api/img` traffic becomes costly.
