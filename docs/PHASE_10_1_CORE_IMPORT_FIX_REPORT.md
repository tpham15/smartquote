# SmartQuote Phase 10.1 — Core Import Engine Must-Fix Pack

## Scope

This patch addresses the high-risk import issues from the core import engine review:

1. Price scale hidden in header labels: `Đơn giá (1.000đ)`, `Giá nhập (triệu)`.
2. Uncertain cost-price column selection: ambiguous `Đơn giá` / `Giá` must require user review.
3. Billable service rows: labor/install/warranty survey lines with prices must not be swallowed as notes.
4. Merged Excel cells: fill down/right merged values before row normalization.
5. AI fallback: preserve deterministic good rows, parse AI prices through the safe parser, keep row trace where possible, and cap AI fallback sheets per import.
6. Sampling and price parsing guardrails: sample columns across the sheet, avoid phone/date/US-decimal false positives.

## Files changed

- `src/import-engine/mapColumns.js`
- `src/import-engine/extractItems.js`
- `src/import-engine/productSanitizer.js`
- `src/import-engine/classifyRows.js`
- `src/import-engine/normalizeWorkbook.js`
- `src/import-engine/validateItems.js`
- `src/import-engine/scoreConfidence.js`
- `src/import-engine/aiFallback.js`
- `src/import-engine/index.js`
- `scripts/core-import-review-smoke.mjs`
- `package.json`

## Behavior changes

### Price header scale

`mapColumns` now detects price units in header labels:

- `(1.000đ)`, `nghìn`, `nghin`, `k` → scale `1000`
- `(triệu)`, `tr`, `trieu`, `1.000.000` → scale `1000000`

`rowToItem` applies this scale when parsing price/list/current/MAP columns and records an issue `price_scaled_from_header`.

### Ambiguous cost-price column

If the chosen price column is ambiguous, such as `Đơn giá`, the item gets:

- issue `price_column_uncertain`
- status `review`

This forces preview confirmation before catalog merge.

### Billable service rows

Rows like:

- `Nhân công lắp đặt trọn gói 5.000.000`
- `Thi công hệ thống 12.000.000`
- `Bảo hành mở rộng 2.000.000`

are classified as product/service items, not notes. They get `kind: "service"` and do not require SKU.

### Merged cells

`normalizeWorkbook` now expands `ws['!merges']`, filling merged cell values into normalized row text and marking synthetic cells with:

```js
{ _merged: true, mergedFrom: "A2" }
```

### AI fallback

AI fallback no longer replaces the whole sheet. It only replaces review/rejected rows, preserving deterministic rows that were already good. It also:

- uses `parseSafePrice` instead of raw digit stripping
- preserves `rowIndex`/`rawText` when available
- caps fallback to `MAX_AI_FALLBACK_SHEETS_PER_IMPORT = 5` by default

## Tests run

```bash
node --check src/import-engine/mapColumns.js
node --check src/import-engine/extractItems.js
node --check src/import-engine/productSanitizer.js
node --check src/import-engine/classifyRows.js
node --check src/import-engine/normalizeWorkbook.js
node --check src/import-engine/validateItems.js
node --check src/import-engine/scoreConfidence.js
node --check src/import-engine/aiFallback.js
node --check src/import-engine/index.js
npm run smoke:phase10
npm run smoke:plan-limits
npm run smoke:core-review
```

Result: PASS.

## Not run in sandbox

`npm run build` was not re-run because dependency installation in the sandbox timed out and `node_modules` was incomplete. Run this locally/Vercel after download:

```bash
npm ci
npm run generate:plan-limits
npm run build
npm run smoke:phase10
npm run smoke:plan-limits
npm run smoke:core-review
```

## Remaining work

The next confidence step is not another generic code patch; it is the real-file fixture loop:

- gather 15–20 real supplier files
- verify every line and every price manually
- turn mistakes into regression fixtures
- target 0 price errors and 0 missing billable rows before wider sales rollout
