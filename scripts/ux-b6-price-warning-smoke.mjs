import { readFileSync } from 'node:fs';

const src = readFileSync('src/SmartQuote.jsx', 'utf8');
const fail = (message) => {
  console.error(`UX B6 price warning smoke: FAIL — ${message}`);
  process.exit(1);
};
const assertIncludes = (needle, label = needle) => {
  if (!src.includes(needle)) fail(`missing ${label}`);
};

// B6.1: price safety issues get explicit row treatment and badge.
assertIncludes('price_column_uncertain', 'price column uncertain issue code');
assertIncludes('price_scaled_from_header', 'price scaled from header issue code');
assertIncludes('hasPriceSafetyIssue', 'price safety issue helper');
assertIncludes('ci-row-price-warn', 'price warning row class');
assertIncludes('ci-price-tag', 'Kiểm tra giá badge class');
assertIncludes('Kiểm tra giá', 'visible price-check label');

// B6.2: price-column uncertainty must show a mandatory confirmation strip.
assertIncludes('ci-price-confirm-strip', 'price confirmation strip');
assertIncludes('Chúng tôi chưa chắc cột nào là GIÁ MUA VÀO.', 'mandatory price confirmation copy');
assertIncludes('Tôi đã kiểm tra cột giá', 'explicit price-confirm action');
assertIncludes('Chọn lại cột giá', 'remap price column action');
assertIncludes('confirmPriceColumnSafety', 'price confirmation handler');

// B6.3: saving catalog is blocked while unconfirmed red-price rows remain.
assertIncludes('priceColumnUncertainRows().length > 0 && !priceColumnConfirmed', 'blocking condition for unconfirmed price column');
assertIncludes('Cần xác nhận cột GIÁ MUA VÀO trước khi lưu', 'disabled-save title');
assertIncludes('Chưa thể lưu catalog vì còn', 'applyImport hard block message');
assertIncludes('acceptedAtPreview: true', 'confirmed rows are explicitly marked user accepted');

console.log('UX B6 price warning smoke: PASS');
