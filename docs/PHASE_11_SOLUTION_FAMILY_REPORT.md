# Phase 11 — Solution Family / Brand Option Engine

## Mục tiêu

Cho SmartQuote tạo báo giá nhanh theo **bộ giải pháp / phương án theo hãng** như Lumi, Erfinden, Schneider, Tiết kiệm, Cao cấp.

## Phạm vi đã làm

- Thêm sub-tab `Mẫu & Gói > Bộ giải pháp`.
- Thêm seed mẫu:
  - Bộ Lumi Villa
  - Bộ Erfinden Villa
  - Bộ Schneider Villa
  - Phương án Tiết kiệm
  - Phương án Cao cấp
- Mỗi bộ gồm ma trận `nhóm hạng mục → brand chính → fallback → product cố định`.
- Thêm helper match sản phẩm trong catalog theo category/brand.
- Thêm nút trong màn báo giá: `Tạo từ bộ giải pháp`.
- Modal preview cho biết nhóm nào match được sản phẩm, nhóm nào còn thiếu.
- Có 2 cách áp dụng:
  - Thêm vào báo giá hiện tại.
  - Tạo báo giá mới từ bộ này.
- Lưu `solutionFamilies` vào local state/cloud snapshot, cùng cơ chế với templates/company/markups.

## Không làm trong phase này

- Không thêm bảng Supabase riêng cho solution families.
- Không tự thay toàn bộ báo giá theo brand trong một click sau khi đã có nhiều dòng tùy biến; phase này tạo báo giá nháp từ bộ.
- Không sửa `src/import-engine/**`.

## Test

```bash
npm run smoke:phase11
```
