# SmartQuote Billing Admin Runbook

## 1. Xem yêu cầu thanh toán đang pending

```sql
select
  be.id,
  d.name as dealer_name,
  be.plan,
  be.billing_cycle,
  be.amount_vnd,
  be.status,
  be.transfer_content,
  be.customer_contact,
  be.customer_note,
  be.created_at
from public.billing_events be
join public.dealers d on d.id = be.dealer_id
where be.status in ('pending','paid')
order by be.created_at desc;
```

## 2. Kích hoạt sau khi đã nhận tiền

```sql
select public.admin_activate_manual_billing_event(
  '<BILLING_EVENT_ID>',
  '<MA_GIAO_DICH_NGAN_HANG>',
  'Đã xác nhận chuyển khoản'
);
```

## 3. Kích hoạt nhanh cho dealer không có billing event

```sql
select public.admin_activate_dealer_plan(
  '<DEALER_ID>',
  'pro',
  1,
  'Kích hoạt thủ công 1 tháng'
);
```

## 4. Gia hạn năm

```sql
select public.admin_activate_dealer_plan(
  '<DEALER_ID>',
  'business',
  12,
  'Gia hạn năm'
);
```

## 5. Khóa workspace thủ công

```sql
update public.dealers
set subscription_status = 'canceled',
    updated_at = now()
where id = '<DEALER_ID>';
```

## 6. Mở lại workspace bị khóa

```sql
update public.dealers
set subscription_status = 'active',
    current_period_end = now() + interval '30 days',
    updated_at = now()
where id = '<DEALER_ID>';
```
