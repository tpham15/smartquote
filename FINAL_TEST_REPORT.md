# SmartQuote Pilot P1.4 — Quote Clarity Test Report

Date: 2026-09-08
Baseline: SmartQuote Pilot P1.3.1 GitHubReady
Scope: quote-screen UX simplification only

## What changed

1. Quote workflow no longer shows normal plan pill / “Xem gói” in the top bar; locked billing state still surfaces.
2. The large PlanBanner (plan/catalog/quota card) is hidden on the Quote screen but remains available elsewhere.
3. Quote management is compacted to one title/status line, `Lưu nháp`, and a progressive `⋯ Quản lý` menu.
4. Sales pipeline status appears only for Final quotes; `Lưu trạng thái` is colocated with that control.
5. `Tạo bản sao` remains available under `⋯ Quản lý`, so capability is preserved without primary-screen clutter.
6. Customer form defaults to `Khách hàng / Công ty *`, phone, and project. Address/category/quote number are under `+ Thông tin thêm`.
7. Final Quote Gate shows actionable blockers only by default. Passed checks are collapsed behind `Xem N kiểm tra đã đạt`.
8. Technical snapshot dependency is hidden while the quote has zero product lines; it appears if it becomes a real blocker after products exist.
9. Gross-margin empty state no longer says “missing cost 0 lines”.
10. User-facing copy replaces mixed `Ready to send / gate / Final` jargon with Vietnamese action language where appropriate.

## Automated PASS

- `smoke:pilot-p14` — Quote Clarity
- P1.3 PDF Column-Aware
- P1.2 Commercial Golden — 5/5 scenarios
- P1.1 Final Quote Lifecycle
- P0 Commercial Safety
- Phase 15 Quote Completeness
- Phase 14.2 / 14.1A / 14.1 regressions
- Phase 14 VAT + Excel VAT
- Tenant storage isolation
- Plan limits consistency
- White-label scrub
- Phase 12.4.1 Vercel JSX guard
- UX B5 progressive disclosure
- API auth/quota
- JS/MJS syntax checks
- Python compile checks
- `git diff --check`
- P1.3.1 clean baseline -> `git apply --check` -> P1.4 patch -> regression PASS
- Final P1.4 ZIP unpacked and re-tested -> PASS

## Packaging / privacy

Final public ZIP contains no:

- `.env`
- `.env.local`
- `node_modules`
- `dist`
- `__pycache__`
- private Vietnam DocBench corpus (only `.gitkeep`)

## Build note

A fresh `npm ci` was attempted in the container but timed out while accessing npm. Therefore a full Vite build was not re-run in this container. The user had already proven `npm ci` and `npm run build` PASS on the P1.3 Mac environment immediately before this UX-only phase. After applying P1.4 on that same Mac folder, run:

```bash
npm run smoke:pilot-p14
npm run smoke:pilot-p11
npm run build
```

No pricing, PDF extraction, catalog, Supabase schema, auth, or quote-lifecycle business rule was weakened by P1.4.
