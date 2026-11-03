# SmartQuote RC16.1 — Checklist trước khi GO pilot

> **Pilot candidate**, không phải production-ready. Tài liệu này bổ sung hướng dẫn Git; không thay thế RC16.1 release notes.

## 1) Freeze và bảo mật

- [ ] GitHub private, repo không có key, `.env.local`, `.vercel`, file báo giá thật hoặc dữ liệu khách không được phép phân phối.
- [ ] Dùng đúng code RC16.1; không bổ sung tính năng trong nhánh pilot.
- [ ] Các thay đổi sau RC16.1 phải có commit riêng, test và ghi nhật ký; không sửa SQL production tùy tiện.

## 2) Release gate trên Mac

```bash
node --version                # phải >= 22
npm ci                       # tải SheetJS 0.20.3 từ cdn.sheetjs.com
npm run smoke:pilot-p23.14.1
npm run smoke:pilot-p23.14
npm run smoke:e2e-import
npm run smoke:pilot:offline
npm run smoke:all
npm run build
npm run pilot:gate:bisco -- "/DUONG_DAN/Form BG _Bisco Tech_V2_2025(1).xlsx"
npm run pilot:gate:roger -- "/DUONG_DAN/FILE_ROGER_THAT"
```

- [ ] `smoke:all` không FAIL, chỉ SKIPPED có giải thích như release notes (bản gốc báo 3 SKIPPED).
- [ ] Bisco/Roger với file thật đạt gate; dữ liệu giá/SKU được người dùng nghiệp vụ xác nhận.

## 3) Supabase STAGING (không chạy trên production khi chưa backup)

- [ ] Backup dữ liệu staging (và snapshot production trước nâng cấp).
- [ ] Trên staging dùng entrypoint `01_RUN_ON_SUPABASE.sql` (RC16.1 hướng dẫn chạy **2 lần** để kiểm tính idempotence).
- [ ] Chạy `scripts/pilot-p23141-rc161-db-acceptance.sql`, phải có `failed = 0` (50 ca) và kiểm tra transaction rollback đúng như hướng dẫn.
- [ ] `npm run qa:production` PASS với môi trường staging đã cấu hình (lệnh kiểm tra theo source).
- [ ] Tài khoản `viewer` không ghi/sửa/xóa dữ liệu; owner/admin/sales đúng quyền; tài khoản A không đọc được workspace B.

## 4) Vercel PREVIEW

- [ ] Preview build thành công, API Python/JavaScript hoạt động ở runtime tương ứng.
- [ ] Chạy UAT-1..25 (theo release notes).
- [ ] Kiểm tra 2 workspace trên cùng trình duyệt: gợi ý PDF không lẫn.
- [ ] Chốt Final Quote, mở lại, đối chiếu giá/tổng tiền, xuất PDF và Excel.
- [ ] Kiểm tra khoảng chênh 1 VND nếu từng gặp ở RC16.1; không gửi báo giá chưa duyệt.
- [ ] Kiểm tra mọi tính năng cần trả phí có quota/plan gate đúng, server key không xuất hiện trong bundle frontend.

## 5) Cho doanh nghiệp thử dùng

- [ ] Chỉ mời sử dụng với dữ liệu thật sau khi đạt tất cả gate bảo mật và kiểm thử triển khai.
- [ ] Giới hạn 1–2 user đầu tiên; người có trách nhiệm đối chiếu giá trước khi gửi khách.
- [ ] Có quy trình sao lưu/khôi phục, ghi nhận lỗi và hỗ trợ khách.
- [ ] Sau 7–14 ngày pilot: đo số báo giá hoàn thành, thời gian tiết kiệm, sai sót, ý định trả phí.

> **Lưu ý:** Các bài test trên container của lần audit trước không thay thế gate trên Mac/Supabase/Vercel. Không khai báo đã GO nếu chưa có bằng chứng đạt.
