# Phase 12.4.3 — Same-origin SmartQuote API Fix

## Bug
A Vercel/custom-domain deployment could return `Origin không được phép gọi SmartQuote API.` when `SMARTQUOTE_ALLOWED_ORIGIN(S)` still pointed at another production/preview hostname, even though the frontend was calling its own relative `/api/...` endpoint.

## Fix
`api/auth_guard.py` now always accepts a true same-origin request when the normalized `Origin` matches `X-Forwarded-Host`/`Host` plus `X-Forwarded-Proto`. Cross-origin requests still require the configured allowlist (or `*`).

This keeps production CORS protection while avoiding self-blocking on Vercel preview URLs and custom-domain aliases.

## Verification
Run:

```bash
npm run smoke:phase12.4.3
npm run smoke:phase12.4.2
```
