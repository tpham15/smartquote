# RC15 staging acceptance

Run in this order on staging:

1. Back up the staging database.
2. Execute root `01_RUN_ON_SUPABASE.sql` twice. The second execution must be idempotent.
3. Confirm every output column ending `_should_be_*` has the expected boolean value.
4. Execute/read `scripts/pilot-p2313-quote-status-staging.sql` and perform F1-1..F1-7 with authenticated test users from two separate workspaces.
5. Re-run RC14 M2-1..M2-9.
6. Run `npm run qa:production` with staging credentials.
7. Deploy a Vercel Preview and perform RC14 UAT-1..9 plus RC15 UAT-10..17.
8. Run real-file gates for Bisco and Roger after F3 changes.

## RC15 browser UAT additions
- UAT-10: Final -> sales status `sent` -> reload/second device stays `sent`; total unchanged.
- UAT-11: disconnect network -> status change errors, dropdown reverts, no fake “Đã lưu”.
- UAT-12: existing cost 100k + imported generic price 250k chosen as list -> cost remains 100k, list 250k, no “Giá nhập thay đổi”.
- UAT-13: list 90k below existing cost 120k -> yellow `Giá bán thấp hơn giá nhập đang có`.
- UAT-14: manually created DL-12W-30 without supplier + `bang_gia_den.xlsx` same SKU/name -> preview Update, save leaves one row.
- UAT-15: same SKU with explicit conflicting suppliers -> preview asks Update/Add new; save follows choice.
- UAT-16: legacy exact duplicate SKU+name -> Catalog shows duplicate warning/filter.
- UAT-17: real Roger re-import 88→88, Bisco 9→9, zero unresolved `Cần chọn` rows.
