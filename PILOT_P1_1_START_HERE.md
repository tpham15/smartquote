# SmartQuote Pilot P1.1 — Final Quote Gate + Draft / Final / Revision

## Mục tiêu
P1.1 làm cho báo giá đủ an toàn để dùng trong assisted paid pilot:

- Draft được phép chỉnh sửa và lưu cloud, nhưng **không được export gửi khách**.
- Final chỉ được tạo khi deterministic Final Quote Gate PASS.
- Final khóa nội dung thương mại; muốn thay đổi phải tạo **Revision mới**.
- Revision mới là quote record mới, không overwrite bản Final trước.
- Final snapshot giữ product, SKU, cost, sale price, customer/VAT và company commercial settings (đặc biệt labor %).
- Quote cloud list hiển thị DRAFT/FINAL + revision và không còn lỗi runtime do component list bị thiếu.

## Final Quote Gate
Một quote chỉ Ready to Final khi:

1. Có ít nhất 1 dòng thiết bị.
2. Có tên khách hàng / công trình.
3. VAT hợp lệ 0–100%.
4. Không có dòng mất product.
5. Không có dòng thiếu sale price.
6. Tất cả dòng có cost để kiểm tra margin.
7. Không có dòng bán bằng hoặc dưới cost.
8. Product/price snapshot đã tạo đủ cho mọi dòng active.

Nếu thiếu số báo giá, khi Final SmartQuote tự tạo mã `SQ-YYYYMMDD-HHMMSS`.

## Lifecycle

### Draft
- Có thể thêm/xóa/swap sản phẩm, đổi qty/note/VAT/customer.
- Có thể lưu Draft cloud.
- Không thể export Excel/PDF.

### Final
- Nội dung khóa.
- Chỉ sales status (chưa gửi / đã gửi / đã chốt / thua) được cập nhật.
- Excel/PDF chỉ export khi Final gate vẫn PASS.

### Revision
- Tạo từ Final bằng nút `Tạo Rev N`.
- `activeQuoteId` được reset để lần save tiếp theo tạo record mới.
- Nếu product còn trong live catalog: revision bỏ price snapshot cũ và dùng catalog hiện tại.
- Nếu product đã biến mất khỏi catalog: giữ snapshot cũ để operator thay thế có chủ đích.
- Company commercial snapshot cũ được bỏ; revision dùng company settings hiện tại.

## Regression gate

```bash
npm run smoke:pilot-p11
npm run smoke:pilot-p0
npm run smoke:phase15
npm run smoke:phase14.2
```

Full pilot gate (cần dependencies + production env):

```bash
node -v       # Node >=22
npm ci
npm run build
npm run smoke:pilot
```

## Known environment limitation của build artifact này
Trong container review, `npm ci` bị timeout khi truy cập package registry, nên Vite build / smoke dùng Supabase runtime chưa thể chạy sạch ở đây. Các regression không cần dependency install đã PASS. Phải chạy clean build trên Mac/CI trước deploy.
