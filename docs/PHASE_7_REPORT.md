# SmartQuote Supabase — Phase 7 Report

## Mục tiêu

Phase 7 harden bản SmartQuote SaaS trước khi chạy ads nhỏ/public beta:

- Siết CORS và security headers.
- Thêm request id + API logging.
- Thêm DB-backed per-minute rate limit theo dealer/user/IP.
- Thêm body-size guard cho API tốn tài nguyên.
- Hardening image proxy và Excel image fetch chống SSRF/quá tải.
- Thêm SQL migration, env checklist và smoke test.

## File chính đã thêm/sửa

```txt
api/_lib/security.js
api/_lib/logger.js
api/_lib/rateLimit.js
api/_lib/cors.js
api/claude.js
api/pdf-extract.js
api/web-products.js
api/img.js
api/auth_guard.py
api/excel.py
api/excel_builder.py
src/supabase/apiFetch.js
supabase/phase7_hardening.sql
scripts/hardening-smoke.mjs
vercel.json
.env.example
docs/PRODUCTION_DEPLOY_CHECKLIST.md
```

## API hardening

Các API đã có thêm rate limit + logging:

```txt
/api/claude
/api/pdf-extract
/api/web-products
/api/excel
```

Các API này vẫn cần Supabase JWT từ Phase 2 và plan/quota từ Phase 3. Phase 7 thêm một lớp rate-limit theo phút để chống spam nhanh ngay cả khi monthly quota chưa hết.

`/api/img` vẫn public vì được gọi từ thẻ `<img>`, nhưng đã có:

```txt
- SSRF guard localhost/private/internal IP
- Content-Type phải là image/*
- Max image 5MB
- In-memory IP rate limit
- Security headers
```

## Rate limit mặc định theo phút

```txt
Trial:
- Claude: 10/min
- Web scrape: 2/min
- PDF extract: 2/min
- Excel export: 5/min

Starter:
- Claude: 20/min
- Web scrape: 3/min
- PDF extract: 3/min
- Excel export: 10/min

Pro:
- Claude: 60/min
- Web scrape: 8/min
- PDF extract: 8/min
- Excel export: 30/min

Business:
- Claude: 120/min
- Web scrape: 15/min
- PDF extract: 15/min
- Excel export: 60/min
```

Monthly quota vẫn giữ từ Phase 3.

## Supabase cần chạy thêm

Nếu project đã chạy tới Phase 6, chạy file:

```txt
supabase/phase7_hardening.sql
```

Nó tạo:

```txt
api_rate_limits
api_logs
smartquote_increment_rate_limit()
admin_prune_api_logs()
```

Nếu tạo project mới từ đầu, chạy:

```txt
supabase/schema.sql
```

## Env production cần set

```bash
SMARTQUOTE_ALLOWED_ORIGIN=https://app.smartquote.vn
SUPABASE_URL=https://YOUR_PROJECT_ID.supabase.co
SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_KEY
VITE_SUPABASE_URL=https://YOUR_PROJECT_ID.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_ANON_KEY
ANTHROPIC_API_KEY=YOUR_ANTHROPIC_API_KEY
```

Tùy chọn:

```bash
SMARTQUOTE_MAX_CLAUDE_BODY_BYTES=1200000
SMARTQUOTE_MAX_WEB_SCRAPE_BODY_BYTES=100000
SMARTQUOTE_MAX_PDF_BODY_BYTES=20000000
SMARTQUOTE_MAX_EXCEL_BODY_BYTES=2500000
SMARTQUOTE_IMG_RATE_LIMIT_PER_MIN=180
```

Không set `SMARTQUOTE_API_AUTH_DISABLED=true` hoặc `SMARTQUOTE_RATE_LIMIT_DISABLED=true` trên production.

## Lưu ý về `xlsx`

`npm audit --omit=dev` vẫn báo 1 high advisory ở package `xlsx` và upstream hiện không có fix tự động. Phase 7 chưa thay library vì việc đó có thể làm vỡ parser Excel hiện tại. Mitigation hiện tại:

- Excel parse chủ yếu client-side, không parse file Excel upload trên server.
- API server đã có body-size guard.
- Phase sau nên thay dần `xlsx` bằng parser khác hoặc cô lập parser trong worker/sandbox.

## Test đã chạy

```bash
npm ci
npm run build
npm run smoke:hardening
npm run smoke:billing
npm run smoke:catalog
npm run smoke:quotes
npm run smoke:plan
npm run smoke:api-auth
npm run smoke:tenant
npm run smoke:import
npm run smoke:bom
npm run smoke:pdf
npm audit --omit=dev
```

Kết quả:

```txt
Build: PASS
Hardening smoke: PASS
Billing smoke: PASS
Catalog smoke: PASS
Quote cloud smoke: PASS
Plan gate smoke: PASS
API auth/quota smoke: PASS
Tenant storage smoke: PASS
Import smoke: PASS
BOM smoke: PASS
PDF smoke: PASS
Audit: FAIL do package xlsx high severity advisory, no fix available
```

## Tự chấm Phase 7

```txt
Phase 7: 8/10
```

Chưa 10/10 vì:

- Chưa có E2E test production thật với Vercel + Supabase.
- Chưa thay được `xlsx`.
- API logs mới là basic table, chưa tích hợp Sentry/Logtail.
- Rate limit DB đủ tốt cho beta, nhưng traffic lớn nên dùng Upstash/Redis hoặc Vercel Firewall/WAF.
