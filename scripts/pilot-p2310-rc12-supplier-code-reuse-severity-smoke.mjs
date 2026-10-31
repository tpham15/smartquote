#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { applyCommercialValidation } from '../src/import-engine/businessValidator.js';
import { isUnsafeImportedProduct, isNonBlockingImportAdvisoryIssue } from '../src/import-engine/productSanitizer.js';
import { productsToImportPreviewResult } from '../src/import-engine/previewResult.js';

const base = (overrides = {}) => ({
  name: 'Sản phẩm', sku: 'FU', supplier: 'Roger', costPrice: 3_600_000, listPrice: 10_600_000,
  _meta: { confidence: 0.92, status: 'new', canonicalStatus: 'auto_approved', issues: [] },
  ...overrides,
});

// Golden-shaped supplier-code reuse: same supplier code, visibly distinct sellable products.
const distinct = Array.from({ length: 8 }, (_, i) => base({
  name: `Đế Inox FU10${i + 1}/R - cấu hình ${i + 1}`,
  costPrice: 3_600_000 + i * 100_000,
  listPrice: 10_600_000 + i * 100_000,
  _meta: {
    confidence: 0.68,
    status: 'review',
    canonicalStatus: 'need_review',
    issues: [{
      code: 'supplier_sku_reused_for_distinct_products',
      level: 'warning',
      message: 'Nhà cung cấp dùng cùng mã FU cho nhiều sản phẩm/cấu hình khác nhau; SmartQuote giữ riêng, không tự gộp',
      field: 'sku',
    }],
  },
}));

const distinctValidated = applyCommercialValidation(distinct).products;
assert.equal(distinctValidated.length, 8, 'supplier code reuse must preserve every distinct product');
for (const p of distinctValidated) {
  const issues = p?._meta?.issues || [];
  assert.equal(issues.some(x => String(x?.code || '').includes('duplicate_sku_in_import') && x?.level === 'error'), false,
    'grounded supplier-code reuse must not become duplicate-SKU error');
  assert.ok(issues.some(x => x?.code === 'supplier_sku_reused_for_distinct_products'), 'source-grounded reuse warning must remain visible');
  assert.equal(p?._meta?.canonicalStatus, 'need_review', 'distinct reused supplier code remains review, not failed/auto-approved');
  assert.equal(isUnsafeImportedProduct(p), false, 'grounded supplier-code advisory must remain importable');
  assert.ok((p?._meta?.issues || []).some(isNonBlockingImportAdvisoryIssue), 'reuse warning must be recognized as non-blocking advisory');
}
const distinctPreview = productsToImportPreviewResult({ products: distinctValidated, fileName: 'Roger.pdf', engine: 'pdf-a-column-v2' });
assert.equal(distinctPreview.summary.failed, 0, 'supplier-code reuse must create zero failed rows');
assert.equal(distinctPreview.summary.needReview, 8, 'supplier-code reuse remains visible as review');

// Same code + distinct names without an upstream PDF collision issue: validator itself must warn, not error.
const genericReuse = applyCommercialValidation([
  base({ sku: 'X1', name: 'Bộ điều khiển cửa X1 - bản A', _meta: { confidence: 0.9, issues: [] } }),
  base({ sku: 'X1', name: 'Bộ điều khiển cửa X1 - bản B', _meta: { confidence: 0.9, issues: [] } }),
]).products;
for (const p of genericReuse) {
  const issues = p?._meta?.issues || [];
  assert.ok(issues.some(x => x?.code === 'pilot_business_supplier_code_reused' && x?.level === 'warning'), 'distinct-name SKU reuse should receive warning');
  assert.equal(issues.some(x => x?.code === 'pilot_business_duplicate_sku_in_import'), false, 'distinct-name SKU reuse must not receive duplicate error');
}

// True duplicate: same SKU + same visible product name remains a hard commercial error.
const trueDuplicate = applyCommercialValidation([
  base({ sku: 'DUP-1', name: 'Motor DUP-1', _meta: { confidence: 0.9, issues: [] } }),
  base({ sku: 'DUP-1', name: 'Motor DUP-1', _meta: { confidence: 0.9, issues: [] } }),
]).products;
for (const p of trueDuplicate) {
  const issues = p?._meta?.issues || [];
  assert.ok(issues.some(x => x?.code === 'pilot_business_duplicate_sku_in_import' && x?.level === 'error'), 'true duplicate SKU must stay blocking');
  assert.equal(isUnsafeImportedProduct(p), true, 'true duplicate SKU must remain unsafe to import');
}


// UI wiring: the primary/footer import count must use importable rows, not only rows with zero warnings.
const smartQuoteSource = fs.readFileSync(new URL('../src/SmartQuote.jsx', import.meta.url), 'utf8');
assert.match(smartQuoteSource, /const readyCount = c\.willImport;/, 'preview hero must count non-blocking advisories as importable');
assert.match(smartQuoteSource, /Thêm \$\{getPreviewCounts\(parsed\)\.willImport\} sản phẩm vào danh mục/, 'footer import CTA must use willImport');
assert.ok(smartQuoteSource.includes('c.advisoryOnly') && smartQuoteSource.includes('cảnh báo không chặn'), 'preview must explain non-blocking advisory count');

console.log('✓ P2.3.10 RC12 supplier-code reuse severity smoke PASS');
console.log('  - distinct supplier-code reuse = REVIEW/WARNING, never blocking duplicate error');
console.log('  - source-grounded collision warning stays visible but is importable/non-blocking');
console.log('  - true same-product duplicate SKU remains ERROR');
