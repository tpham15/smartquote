#!/usr/bin/env node
import fs from 'node:fs';
import assert from 'node:assert/strict';

const app = fs.readFileSync(new URL('../src/SmartQuote.jsx', import.meta.url), 'utf8');
const lifecycle = fs.readFileSync(new URL('../src/quote/quoteLifecycle.js', import.meta.url), 'utf8');

// 1) Quote screen should not spend primary vertical space on plan/quota chrome.
assert(app.includes('tab !== "quote" && <PlanBanner'), 'PlanBanner must be hidden on quote workflow');
assert(app.includes('billingStatus?.locked && <span className="plan-pill locked">'), 'topbar plan state should only surface when account is locked');
assert(!app.includes('Quota báo giá tháng này:'), 'monthly quote quota must not clutter quote-management card');
assert(!app.includes('Lưu bản sao Draft'), 'duplicate draft-copy action must not clutter primary quote controls');

// 2) Quote management should expose one compact lifecycle title and progressive advanced controls.
assert(app.includes('Báo giá mới'), 'compact quote title missing');
assert(app.includes('Lưu nháp'), 'primary draft save action missing');
assert(app.includes('quoteManageOpen &&'), 'advanced quote management must remain progressive');
assert(app.includes('{isFinalQuote && ('), 'sales pipeline should only be visible for Final quote workflow');

// 3) Customer fields use progressive disclosure and unambiguous labels.
assert(app.includes('label="Khách hàng / Công ty *"'), 'customer/company label must be explicit');
assert(app.includes('+ Thông tin thêm'), 'customer advanced fields need progressive disclosure');
assert(app.includes('quote-customer-extra'), 'customer advanced field group missing');
assert(!app.includes('label="Tên khách hàng / Công trình"'), 'ambiguous old customer/project label must be removed');

// 4) Final gate defaults to blockers only; passed checks are opt-in.
assert(app.includes('actionableFinalBlockers'), 'actionable blocker projection missing');
assert(app.includes('visibleQuoteChecks = showPassedQuoteChecks ? finalQuoteGate.checks : actionableFinalBlockers'), 'gate must default to blocker-only view');
assert(app.includes('Xem ${passedQuoteChecks.length} kiểm tra đã đạt'), 'passed-check disclosure control missing');
assert(app.includes('Chưa thể chốt báo giá'), 'friendly blocked-state wording missing');
assert(app.includes('Sẵn sàng để chốt'), 'friendly ready-state wording missing');
assert(!app.includes('Draft · Chưa Ready to send'), 'mixed-language gate wording must be removed');
assert(!app.includes('gate cần xử lý trước khi xuất'), 'technical gate jargon must not remain in primary quote UI');

// Empty quote should not surface the technical snapshot dependency as a separate action.
assert(app.includes('item.id === "snapshot" && finalQuoteGate.lineCount === 0'), 'empty-quote snapshot blocker should be hidden until actionable');
assert(lifecycle.includes('label: "Thêm ít nhất 1 thiết bị"'), 'friendly device blocker label missing');
assert(lifecycle.includes('label: "Nhập khách hàng / công ty"'), 'friendly customer blocker label missing');
assert(lifecycle.includes('label: "Hoàn tất dữ liệu sản phẩm và giá"'), 'friendly snapshot blocker label missing');

// Margin summary should be quiet when there are zero missing-cost rows.
assert(app.includes('commercialAssessment.unknownCostCount > 0 ? `Lãi gộp — · thiếu giá vốn'), 'margin issue should only display when missing costs exist');

console.log('✓ Pilot P1.4 Quote Clarity smoke PASS');
console.log('  - plan/quota chrome removed from quote workflow');
console.log('  - quote lifecycle controls compacted; sales status is progressive');
console.log('  - customer fields use progressive disclosure');
console.log('  - Final Gate defaults to actionable blockers, passed checks collapse');
console.log('  - empty-state margin/snapshot copy no longer reads like debug output');
