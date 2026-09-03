# Phase 12.6 — Embedded Bank Transfer Checkout

## Goal

Put SmartQuote's manual bank-transfer flow directly inside **Gói & Sử dụng** without hard-coding founder banking data into source code.

The browser continues to create a tenant-scoped `billing_events` row first. That row supplies the exact plan, amount and unique transfer content. The checkout then renders a VietQR image from public bank configuration plus that billing-event data.

## User flow

1. Dealer chooses Starter / Pro / Business and monthly / annual.
2. SmartQuote calls `create_manual_billing_request`.
3. The returned billing event opens the payment checkout automatically.
4. Checkout shows:
   - exact amount;
   - VietQR;
   - bank name;
   - account number;
   - account owner;
   - unique transfer content;
   - copy buttons.
5. User clicks **Tôi đã chuyển khoản**.
6. `mark_manual_billing_event_paid` changes only that dealer's event from `pending` to `paid`.
7. Admin still verifies incoming money and activates the plan with the existing admin function.

`paid` is therefore a **customer declaration**, not proof of settlement and not plan activation.

## Environment configuration

Configure these in Vercel for Production (and Preview if you test there):

```env
VITE_SQ_PAYMENT_BANK_ID=YOUR_VIETQR_BANK_CODE_OR_BIN
VITE_SQ_PAYMENT_BANK=YOUR_BANK_DISPLAY_NAME
VITE_SQ_PAYMENT_ACCOUNT=YOUR_ACCOUNT_NUMBER
VITE_SQ_PAYMENT_OWNER=YOUR_ACCOUNT_NAME
VITE_SQ_PAYMENT_QR_TEMPLATE=compact2
VITE_SQ_SUPPORT_CONTACT=YOUR_ZALO_OR_HOTLINE
```

`VITE_SQ_PAYMENT_BANK_ID` is the VietQR/NAPAS code or BIN used to construct the QR image URL. No VietQR API key is required for the Quick Link flow.

Do **not** put passwords, OTPs, banking credentials, Supabase service-role keys or other secrets in any `VITE_*` variable. `VITE_*` values are bundled into frontend code and are public by design.

## Database migration

Run this once on the production Supabase project:

```text
supabase/phase12_6_bank_transfer_checkout.sql
```

It does two things:

- redefines new transfer content to an alphanumeric, VietQR-friendly value such as `SQ1A2B3C4DPROTHANG`;
- creates `mark_manual_billing_event_paid(uuid, uuid)` for authenticated members of the same dealer workspace.

The function is idempotent for an event already in `paid`. It rejects attempts to mutate another dealer's billing event and rejects terminal/admin-managed statuses.

## QR behavior

QR generation is pure frontend URL construction. Amount and transfer content always come from the returned `billing_events` row, not from arbitrary input fields.

If QR configuration is missing or the image cannot load, checkout falls back to the bank account + copy controls. The billing request remains usable.

## Admin activation remains unchanged

After verifying the bank transaction, use the existing function:

```sql
select public.admin_activate_manual_billing_event(
  '<BILLING_EVENT_ID>',
  '<BANK_TRANSACTION_REFERENCE>',
  'Đã xác nhận chuyển khoản'
);
```

Only that admin activation changes the dealer subscription to active.

## Dark mode / responsive

The checkout uses SmartQuote design tokens for both themes. At <=560px, payment fields become one column and QR shrinks to fit a 390px mobile viewport.

The QR image itself is not recolored because banking QR codes require their original high-contrast visual surface.
