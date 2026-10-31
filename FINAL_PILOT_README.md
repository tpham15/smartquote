# SmartQuote Final Pilot v1.0 — RC13 Candidate

Current release: **P2.3.11 / RC13 Candidate**, based on the RC12 importer/browser-UAT baseline.

## Pilot safety changes in RC13

- A lone generic `Đơn giá / Unit price / Price` column is no longer silently assumed to be supplier cost.
- Preview requires one file-level decision: **Giá nhập / giá vốn** or **Giá bán / niêm yết** (or edit mapping).
- Explicit cost headers such as `Giá nhập`, `Giá đại lý`, `Giá cấp 1`, `Cost`, etc. remain automatic.
- Quote tables proven by `SL × Đơn giá = Thành tiền` keep their fixed-price quote behavior.
- New workspaces default to markup **×1.20**; explicit existing pricing settings are preserved.
- Generic-price `core-review` is now inside the pilot offline release suite.

## Canonical setup

```bash
npm ci
npm run build
npm run smoke:pilot:offline
```

Supabase: use `01_RUN_ON_SUPABASE.sql` as the canonical pilot entrypoint. Other SQL/migration files are implementation history or supporting migration sources unless explicitly referenced by that master script.

## Required pre-deploy gate for RC13

```bash
npm run smoke:pilot-p23.11
npm run smoke:core-review
npm run smoke:pilot:offline
npm run build
```

Real-file gates (use your local reviewed files):

```bash
npm run pilot:gate:bisco -- "<PATH_TO_BISCO_XLSX>"
npm run pilot:gate:roger -- "<PATH_TO_ROGER_PDF>"
```

Then perform a short browser UAT:

1. Import a workbook whose only price header is `Đơn giá` and verify SmartQuote blocks save until a role is chosen.
2. Choose **Giá nhập / giá vốn** and verify the value remains cost price.
3. Repeat and choose **Giá bán / niêm yết**; verify cost stays empty and list price receives the value.
4. Create a new workspace and verify default markup is ×1.20.
5. Re-check Roger 88/88 and Bisco 9/9.

## Packaging rules

The distributable ZIP must not contain:

- `.env` / `.env.local`
- `.git`
- `node_modules`
- `.venv`
- local pilot reports or customer/source files

See `P2.3.11_RC13_RELEASE_NOTES.md` for the exact behavioral change and verification status.
