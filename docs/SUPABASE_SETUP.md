# SmartQuote Cloud trên Supabase

Mục tiêu của bản này: mỗi đại lý có tài khoản riêng, catalog/gói/cài đặt được lưu lên Supabase thay vì chỉ nằm trong trình duyệt.

## 1. Tạo project Supabase

1. Vào Supabase Dashboard.
2. New project.
3. Chọn region gần Việt Nam nhất nếu có thể.
4. Lưu lại Project URL và anon/publishable key trong Project Settings -> API.

## 2. Chạy database schema

1. Mở Supabase Dashboard -> SQL Editor.
2. Copy toàn bộ file `supabase/schema.sql`.
3. Run.

Schema tạo các bảng:

- `profiles`
- `dealers`
- `dealer_members`
- `dealer_app_state`

Và bật Row Level Security để đại lý này không đọc được dữ liệu của đại lý khác.

## 3. Cấu hình Auth

Vào Authentication -> Providers -> Email.

Để test nhanh, có thể tắt email confirmation trong môi trường dev. Nếu bật email confirmation, sau khi đăng ký user phải xác nhận email rồi mới đăng nhập được.

## 4. Tạo file môi trường

Copy `.env.example` thành `.env.local`:

```bash
cp .env.example .env.local
```

Điền:

```bash
VITE_SUPABASE_URL=https://YOUR_PROJECT_ID.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_OR_PUBLISHABLE_KEY
```

Không đưa service role key vào frontend.

## 5. Chạy app

```bash
npm install
npm run dev
```

Khi `VITE_SUPABASE_URL` và `VITE_SUPABASE_ANON_KEY` tồn tại, SmartQuote sẽ hiện màn hình đăng nhập/đăng ký.

## 6. Test multi-tenant

1. Đăng ký tài khoản A, tên đại lý A.
2. Import vài sản phẩm.
3. Đăng xuất.
4. Đăng ký tài khoản B, tên đại lý B.
5. Kiểm tra catalog của B trống, không thấy dữ liệu của A.
6. Đăng nhập lại A, catalog của A vẫn còn.

## 7. Cách đồng bộ hiện tại

Bản MVP này lưu cloud theo dạng snapshot JSON trong `dealer_app_state`:

- `products`
- `templates`
- `company`
- `markups`
- `suppliers`
- `name_map`

Cách này nhanh và ít phá code cũ. Khi sản phẩm ổn định hơn, có thể tách tiếp thành bảng chuẩn hóa như `catalog_items`, `quotes`, `quote_items`, `imports`.

## 8. Khi deploy Vercel

1. Import repo lên Vercel.
2. Vào Project Settings -> Environment Variables.
3. Thêm `VITE_SUPABASE_URL` và `VITE_SUPABASE_ANON_KEY`.
4. Redeploy.

Nếu dùng API scrape/PDF hiện tại, giữ nguyên thư mục `api/` và các env key liên quan.

## Phase 2 additions — protected APIs + quota

If your Supabase project was created before Phase 2, run this migration in SQL Editor:

```txt
supabase/phase2_usage_events.sql
```

Then add these server-only env vars in Vercel:

```txt
SUPABASE_URL=https://YOUR_PROJECT_ID.supabase.co
SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_KEY
ANTHROPIC_API_KEY=YOUR_ANTHROPIC_API_KEY
```

Do not put `SUPABASE_SERVICE_ROLE_KEY` in `.env.local` that gets exposed to the browser or in any `VITE_` variable.

## Phase 3 migration — Trial / Plan Gate

Nếu bạn đang nâng cấp từ bản Phase 2, chạy thêm file này trong SQL Editor:

```txt
supabase/phase3_billing_plans.sql
```

User mới sau migration sẽ tự có trial 7 ngày. User/workspace cũ sẽ được backfill `trial_ends_at = created_at + 7 days` nếu chưa có giá trị.

Để nâng cấp thủ công một đại lý trong Supabase SQL Editor:

```sql
update public.dealers
set plan = 'pro',
    subscription_status = 'active',
    current_period_end = now() + interval '30 days',
    plan_started_at = now()
where id = '<DEALER_ID>';
```

Các plan hợp lệ: `trial`, `starter`, `pro`, `business`, `expired`.
