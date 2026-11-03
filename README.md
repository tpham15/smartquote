# SmartQuote — RC16.1.1 Flexible Pricing Pilot — RC16.1 Pilot (GitHub-ready)

**Phiên bản:** SmartQuote P2.3.14.1 / RC16.1 — Pilot Locked **candidate** (2026-11-01).  
**Trạng thái:** Chưa được xác nhận `GO` cho production; vẫn cần hoàn tất các release gate bên dưới.

Đây là **toàn bộ source** từ ZIP RC16.1 được đóng gói để push lên **GitHub private repository**, không phải bản RC16 cũ. Không chỉnh sửa logic, SQL nghiệp vụ, `package.json`, `package-lock.json` hay cấu hình Vercel của phần mềm. Chỉ thêm tài liệu Git và quy tắc bỏ qua file nhạy cảm.

## Bắt đầu ở đâu?

1. Đọc **[`GITHUB_PUSH_MAC.md`](./GITHUB_PUSH_MAC.md)** để push repo từ MacBook. Có hướng dẫn cả repo mới và repo đã có.
2. Đọc **[`PILOT_DEPLOY_CHECKLIST.md`](./PILOT_DEPLOY_CHECKLIST.md)** trước khi nối GitHub với Vercel/Supabase.
3. Đọc [`FINAL_PILOT_README.md`](./FINAL_PILOT_README.md) và [`P2.3.14.1_RC16.1_RELEASE_NOTES.md`](./P2.3.14.1_RC16.1_RELEASE_NOTES.md) để biết chính xác các gate của RC16.1.

### Cấu trúc

- `src/` — React/Vite app
- `api/` — API functions cho Vercel
- `supabase/` và `01_RUN_ON_SUPABASE.sql` — database/migrations (phải backup trước khi chạy)
- `public/` — static assets
- `scripts/` — các bộ test và gate
- `tests/`, `benchmarks/` — fixtures và test assets, không đưa private customer corpus vào repo
- `vercel.json`, `package*.json`, `.env.example` — cấu hình deploy

### Cài và thử trên Mac (Node.js 22+)

```bash
npm ci
npm run smoke:pilot-p23.14.1
npm run smoke:pilot-p23.14
npm run smoke:e2e-import
npm run smoke:pilot:offline
npm run smoke:all
npm run build
```

`npm ci` **cần internet**, trong đó có `cdn.sheetjs.com` để lấy SheetJS 0.20.3 theo `package-lock.json`. Không thay URL phụ thuộc chỉ để vượt lỗi mạng. Các gate với file Bisco/Roger thật, Supabase staging và Vercel Preview vẫn bắt buộc (xem checklist).

### Bảo mật GitHub

- **Để repository ở chế độ Private.** Không public mã nguồn, quy trình nghiệp vụ, fixture PDF/Excel nếu chưa rà soát quyền phân phối.
- Không đưa `.env`, `.env.local`, `SUPABASE_SERVICE_ROLE_KEY`, API key, bảng giá khách hàng, ảnh nhà khách vào Git.
- `.env.example` chỉ chứa tên biến và các giá trị placeholder; có thể commit.
- `VITE_*` là cấu hình **frontend**, không đưa bất kỳ secret nào vào `VITE_*`.
- Nếu Vercel đã liên kết repo cũ, push nhánh `pilot/rc16.1` để kiểm thử Preview; không tự động thay production khi chưa qua gate.

### Bảo toàn source

`docs/RC16_1_ORIGINAL_SOURCE_SHA256SUMS.txt` là bản manifest gốc từ file ZIP đã cung cấp. `SHA256SUMS.txt` ở root đã được tạo lại để bao gồm tài liệu Git-ready và `.gitignore` cập nhật. RC16.1.1 có thay đổi chủ đích ở Final Quote Gate, giá bán riêng, hệ số và BOM; xem `RC16.1.1_FLEXIBLE_PRICING_RELEASE_NOTES.md`. Manifest gốc chỉ dùng để đối chiếu RC16.1, không phải để xác nhận checksum bản vá.

### RC16.1.1 Golden fixture lock

The commercial regression has been versioned to **0.1.1** to reflect the new at-cost/below-cost Final policy. See [`RC16.1.1_GOLDEN_FIX_RELEASE_NOTES.md`](./RC16.1.1_GOLDEN_FIX_RELEASE_NOTES.md). Run `npm run smoke:pilot-p12` before the full suite.
