# SmartQuote UX B7.1 — Fix Pack Report

## Scope

This patch is a follow-up to UX B1–B7. It keeps the UX-spec constraints: no changes under `src/import-engine/**`, no new localStorage/sessionStorage, and no feature rewrite.

## Fixes

1. Added a clear header upgrade entry (`Xem gói` / `Gia hạn`) next to the plan pill.
2. Added `smoke:ux-b7.1` to catch UX-regression patterns after B7.
3. Tightened the import preview price-confirm UX: when red price uncertainty is present, the hero action is disabled and says `Cần xác nhận cột giá`.
4. Kept catalog import as the only prominent file entry; rare catalog tools are moved into `⋯ Công cụ nâng cao`.
5. Made manual product creation secondary (`+ Thêm thủ công`) instead of another primary action.
6. Made quote cloud management more compact with `quote-manage-bar` and the existing `⋯ Quản lý` disclosure.
7. Removed a duplicated `Hạng mục` customer field.
8. Removed hard-coded disabled primary background in the import-save button; the disabled state now uses button CSS.

## Tests run in sandbox

```bash
npm run smoke:ux-b7.1
npm run smoke:ux-b7
npm run smoke:ux-b6
npm run smoke:ux-b5
npm run smoke:ux-b4
npm run smoke:ux-b3
npm run smoke:ux-b2
npm run smoke:ux-b1
npm run smoke:phase10
npm run smoke:core-review
npm run smoke:plan-limits
tsc --noEmit --allowJs --jsx react --moduleResolution node --target ES2020 --module ESNext --skipLibCheck src/SmartQuote.jsx
```

All commands above passed.

## Build note

`npm run build` could not be completed in the sandbox because `npm ci` could not fetch packages from npm registry (`EAI_AGAIN registry.npmjs.org`), so Vite was not installed. Run this locally or on Vercel:

```bash
npm ci
npm run build
npm run smoke:ux-b7.1
```
