# SmartQuote P2.3.14.1 RC16.1 — test report

Generated: 2026-11-01
Môi trường đã dùng: container Linux, Node v22.23.4, PostgreSQL 16 có lớp giả lập Supabase (auth.uid(), các role anon/authenticated/service_role, storage.objects), Chromium/Playwright.
Trạng thái: **RC16.1 — Pilot Locked**, chưa phải GO. Các mục ở phần "Chưa chạy" phải hoàn tất trên Mac và staging.

## 1. Đã chạy và PASS trên code RC16.1 cuối cùng

| Lệnh / kiểm tra | Kết quả |
|---|---|
| `npm run smoke:all` (thư mục bình thường) | `TOTAL 109 · PASS 106 · SKIPPED 3 · FAIL 0` |
| `npm run smoke:all` từ `/tmp/Thư mục Test/SmartQuote RC16.1/` | `TOTAL 109 · PASS 106 · SKIPPED 3 · FAIL 0` |
| `npm run smoke:pilot:offline` (nằm trong smoke:all; nay bắt đầu bằng p23.14.1) | PASS |
| `npm run smoke:pilot-p23.14.1` (mới) | PASS |
| `npm run smoke:e2e-import` | PASS, golden không đổi |
| `npm run build` | PASS (xlsx 0.20.3) |

3 dòng SKIPPED vẫn như RC16, đều có lý do: `smoke:pilot` và `smoke:pilot-release` cần Supabase thật; `smoke:phase12.5.3` cần dữ liệu riêng không có trong gói.

## 2. Database (PostgreSQL 16 + lớp giả lập Supabase)

| Kiểm tra | Kết quả |
|---|---|
| Cài mới: `supabase/schema.sql` | 0 lỗi, các cột kiểm tra `should_be` đều đúng |
| Nâng cấp: DB RC16 → `01_RUN_ON_SUPABASE.sql` lần 1 và lần 2 | 0 lỗi; 46/46 giá trị `should_be` đúng ở mỗi lần |
| `scripts/pilot-p23141-rc161-db-acceptance.sql` trên DB **RC16** | **failed = 26 / 50**: tái hiện đúng các phát hiện của review (`docs/RC16_1_DB_ACCEPTANCE_RED_ON_RC16.txt`) |
| Cùng script trên RC16.1, cài mới | **failed = 0 / 50** |
| Cùng script trên RC16.1, nâng cấp | **failed = 0 / 50** (`docs/RC16_1_DB_ACCEPTANCE_GREEN.txt`) |
| Kiểm chéo tổng tiền: 198 báo giá ngẫu nhiên tính bằng code app (`quoteMath.js` + `quoteCommercialSafety.js`) rồi chốt qua `finalize_quote` | 198/198 chốt được; tổng server = tổng trình duyệt ở cả 198 báo giá |

50 ca trong script acceptance gồm:
- vai trò (viewer, sales, sales khác, admin, owner, người ngoài);
- báo giá: lưu, xóa Draft, đổi trạng thái, chốt, xóa Final;
- danh mục: đồng bộ, log nhập;
- `dealer_app_state`: products, thông tin công ty, hệ số giá;
- Storage ảnh sản phẩm;
- billing;
- thành viên: tự thêm, tự nâng vai trò, người ngoài chen vào;
- tổng tiền Final: sửa grand, khai thấp tiền hàng, % ngoài 0–100, thiếu calc, sửa cột total;
- hồi quy RC14 M2 / RC15 F1: Final bất biến, trạng thái bán hàng, dữ liệu học lấy từ snapshot, anon.

## 3. xlsx 0.18.5 → 0.20.3

| Kiểm tra | Kết quả |
|---|---|
| Đọc 51 file Excel bằng cả hai bản, so ở mức từng ô (`normalizeWorkbook`) và mức sản phẩm (`importFileForUI`) | **51/51 giống hệt** |
| `package-lock.json` ghim đúng URL và SHA-512 chính thức; bỏ 8 gói phụ | PASS (`smoke:pilot-p23.14.1`) |
| Đổi mã băm trong lock | `smoke:vercel-registry` FAIL đúng như mong đợi |

Bộ 51 file gồm: fixture trong dự án, file sinh ra từ các smoke trước đó, file có ô gộp, định dạng ₫, ngày, dòng ẩn, công thức, nhiều sheet, `.xls` BIFF8 và `.csv`.

**Lưu ý:** container không kết nối được cdn.sheetjs.com (proxy chặn, 403). Mọi test 0.20.3 ở đây dùng bản sao `@e965/xlsx@0.20.3` trên npm, có provenance. Bản sao này **không** nằm trong gói. Trên Mac, `npm ci` sẽ cài tarball chính thức và kiểm mã băm; khi đó phải chạy lại `smoke:all`.

## 4. Kiểm tra trên trình duyệt (Playwright, bản xem trước local, chưa có Supabase)

UAT-18…25 PASS trên bản build dùng xlsx 0.20.3. Các bước đã thử: nhập bảng giá, nhập báo giá cũ, Sửa mapping, xuất Excel bằng `XLSX.writeFile` trên trình duyệt, in PDF. Không có lỗi JavaScript trên trang.

## 5. Mutation test: cố tình đưa lỗi cũ quay lại, test phải báo đỏ

- Dùng lại `pdfTemplateMemory.js` của RC16 → báo: *workspace B must NOT see workspace A's PDF hint*.
- Dùng lại `new URL(import.meta.url).pathname` → `smoke:pilot-p23.14.1` FAIL.
- Đổi mã băm xlsx trong lock → `smoke:vercel-registry` FAIL.
- Chạy test DB trên RC16 → 26 ca đỏ.

## 6. Chưa chạy ở đây (bắt buộc trước GO)

- `npm ci` trên Mac với tarball SheetJS chính thức, rồi chạy lại `smoke:all` và `build`.
- Bisco 9 và Roger 88 với file thật.
- Staging Supabase thật:
  - `01_RUN_ON_SUPABASE.sql` 2 lần;
  - `pilot-p23141-rc161-db-acceptance.sql` (failed = 0);
  - `npm run qa:production`.
- Vercel Preview có Supabase thật:
  - UAT-1…25;
  - chốt báo giá rồi đối chiếu `serverVerifiedTotals`;
  - 2 workspace trên cùng trình duyệt không thấy gợi ý PDF của nhau;
  - tài khoản viewer bị chặn mọi thao tác ghi.
