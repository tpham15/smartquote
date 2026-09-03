# Phase 10.2 — Old Quote Catalog Guard

## Problem

Khi user upload file báo giá cũ để lấy lại giá/catalog, file thường có các dòng hạng mục hoặc subtotal như:

- `IV/ Hệ thống mạng nội bộ + Wifi`
- `V/ Giải pháp cảm biến...`
- `Vật tư phụ (...)`
- `Tổng giá trị tiền hàng`, `Nhân công, lập trình hệ thống`

Các dòng này có tên + giá nên engine cũ dễ hiểu nhầm là sản phẩm catalog.

## Scope

Mục tiêu của Phase 10.2 là hỗ trợ luồng **Báo giá cũ / công trình cũ** để seed catalog an toàn:

1. Thêm lựa chọn mới trong Import Hub.
2. Tự bật guard nếu tên file giống báo giá cũ (`BG`, `BaoGia`, `Báo giá`, `quote`).
3. Bỏ qua dòng hạng mục/tổng nhóm/subtotal/vật tư phụ gộp khi lưu vào catalog.
4. Giữ lại sản phẩm thật có SKU/model rõ.
5. Không phá luồng bảng giá nhà cung cấp và không xóa logic giá an toàn đã có.

## Changed files

- `src/SmartQuote.jsx`
  - Add Import Hub card: `Báo giá cũ / công trình cũ`.
  - Pass `importSourceKind="old_quote"` into `Catalog` / `CatalogImporter`.
  - Add old quote sanitization wrapper and warning summary.
  - Catalog cleanup now catches old quote aggregate rows already imported before this fix.

- `src/import-engine/productSanitizer.js`
  - Add `isLikelyOldQuoteFileName`.
  - Add `isLikelyOldQuoteSectionRow`.
  - Add `isLikelyOldQuoteAggregateProduct`.
  - Mark old quote aggregate rows as `canonicalStatus: "skipped"`.
  - Treat skipped rows as unsafe for catalog merge.

- `src/import-engine/classifyRows.js`
  - Classify quote section/subtotal rows as `SECTION` before product extraction.

- `scripts/phase102-old-quote-guard-smoke.mjs`
  - Unit smoke test for old quote guards.

## Acceptance

- Old quote section row is detected and skipped.
- Old quote material package row is skipped in old quote mode.
- Real product with SKU, e.g. `SG1041P`, is not skipped.
- Normal non-quote service import is not skipped by old quote guard.
- Existing design system, billing, pricing, and core import smoke tests still pass.

## Local commands

```bash
npm ci
npm run build
npm run smoke:phase10.2
npm run smoke:core-review
npm run smoke:design-system-cleanup
```
