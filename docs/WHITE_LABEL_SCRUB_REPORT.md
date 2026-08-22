# SmartQuote — White-label privacy scrub

## Mục tiêu

Loại dữ liệu riêng của báo giá tham chiếu khỏi source phát hành và bảo đảm dealer mới không kế thừa business rule của dealer trước.

## Đã scrub

- Tên khách/công trình, tên công ty, địa chỉ, mã số thuế, số điện thoại, người báo giá, số báo giá và website của dữ liệu tham chiếu.
- Tên file báo giá thật trong UI, docs và smoke test.
- Fixture giá/khối lượng lấy từ báo giá tham chiếu; test được thay bằng dữ liệu tổng hợp.
- Heuristic nhận diện riêng tên dealer trong tên file.
- Default nhân công và markup của workspace mới được chuyển về trạng thái trung lập.
- Quick factor, preview giá catalog và tổng gói chỉ dùng cấu hình của chính dealer, không còn hệ số giá hard-code từ dữ liệu tham chiếu.
- Cache Python `__pycache__`/`.pyc` không được đóng gói trong bản sạch.

## Giữ lại có chủ đích

Tên hãng/SKU/catalog công khai dùng cho parser và solution engine vẫn được giữ khi chúng không phải dữ liệu riêng của dealer.

Giá gói SmartQuote và các giới hạn kỹ thuật như kích thước file/image cũng được giữ vì đó là dữ liệu sản phẩm SmartQuote, không phải dữ liệu thương mại của dealer.

## Regression guard

Chạy:

```bash
npm run smoke:white-label
```

Smoke test xác nhận workspace mới dùng pricing trung lập, fixture chỉ chứa dữ liệu tổng hợp và các luồng tính giá lấy cấu hình theo từng dealer.
