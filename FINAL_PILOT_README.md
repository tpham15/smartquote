# SmartQuote P2.3.14.1 RC16.1 — Pilot Locked

RC16.1 = RC16 + sửa đúng 5 điểm của review lần 2, không thêm tính năng. Chi tiết xem `P2.3.14.1_RC16.1_RELEASE_NOTES.md`.

1. Phân quyền owner/admin/sales/viewer được thực thi **trong database** cho mọi đường ghi.
2. `finalize_quote` tự tính lại tổng tiền từ các dòng đã đóng băng và từ chối khi lệch.
3. Bộ nhớ gợi ý mẫu PDF tách theo doanh nghiệp.
4. `xlsx` 0.20.3 (tarball chính thức của SheetJS, có kiểm mã băm).
5. Script test chạy được ở thư mục có dấu cách.

## SQL (CÓ THAY ĐỔI)
- Chỉ dùng entry point gốc `01_RUN_ON_SUPABASE.sql`, chạy **2 lần** trên staging.
- Sau đó chạy `scripts/pilot-p23141-rc161-db-acceptance.sql`. Script chạy trong transaction và ROLLBACK ở cuối. Kết quả phải là `TOTAL | t | 50 ca | failed = 0`.
- Nguồn của migration: `supabase/phase23_14_1_rc161_pilot_lock.sql`.

## Gate trên Mac
```bash
npm ci                      # cần mạng tới cdn.sheetjs.com (xlsx 0.20.3, có kiểm mã băm)
npm run smoke:pilot-p23.14.1
npm run smoke:pilot-p23.14
npm run smoke:e2e-import
npm run smoke:pilot:offline
npm run smoke:all           # phải FAIL 0, đúng 3 SKIPPED
npm run build
npm run pilot:gate:bisco -- "/đường/dẫn/Form BG _Bisco Tech_V2_2025(1).xlsx"
npm run pilot:gate:roger -- "/đường/dẫn/file Roger.xlsx"
```
Nếu có lệnh nào fail thì không deploy.

Sau đó làm tiếp, theo thứ tự:
1. Staging: chạy SQL như trên, rồi `npm run qa:production`.
2. Deploy bản Preview, làm UAT-1..25 và 3 kiểm tra RC16.1 trong release notes.
3. Sao lưu DB production, deploy, gắn tag `pilot-rc16.1`.

## Thêm nhân viên (chưa có màn hình mời)
Chạy trong Supabase SQL editor:
```sql
insert into public.dealer_members (dealer_id, user_id, role)
values ('<dealer_id>', '<auth.users.id>', 'sales');  -- 'admin' | 'sales' | 'viewer'
```

## Golden
Cập nhật golden **chỉ** bằng `npm run golden:e2e-import:update`, và mọi thay đổi golden phải ghi vào release notes kèm lý do. Golden không đổi trong RC16.1.
