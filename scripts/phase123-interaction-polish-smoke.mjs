import fs from 'node:fs';
import assert from 'node:assert/strict';

const app = fs.readFileSync(new URL('../src/SmartQuote.jsx', import.meta.url), 'utf8');
const interaction = fs.readFileSync(new URL('../src/ui/interaction.jsx', import.meta.url), 'utf8');

assert.doesNotMatch(app, /\b(?:window\.)?(?:alert|confirm|prompt)\s*\(/, 'native browser dialogs must not remain in SmartQuote.jsx');
assert.match(app, /InteractionHost/, 'InteractionHost must be mounted by SmartQuote');
assert.match(interaction, /export const notify/, 'shared toast API missing');
assert.match(interaction, /success:/, 'success toast missing');
assert.match(interaction, /error:/, 'error toast missing');
assert.match(interaction, /warning:/, 'warning toast missing');
assert.match(interaction, /info:/, 'info toast missing');
assert.match(interaction, /export function confirmAction/, 'custom confirm API missing');
assert.match(interaction, /requireText/, 'typed destructive confirmation support missing');

assert.match(app, /label: "\+ Tạo báo giá"/, 'quote contextual CTA missing');
assert.match(app, /label: "Nhập sản phẩm"/, 'catalog contextual CTA missing');
assert.match(app, /label: "\+ Tạo gói"/, 'room-pack contextual CTA missing');
assert.doesNotMatch(app, /tab !== "data" \|\| effectiveSubView !== "import"[\s\S]{0,180}>Nhập file</, 'old global import CTA must be removed');

assert.doesNotMatch(app, /Duyệt cảnh báo nhẹ/, 'competing preview CTA wording must be removed');
assert.doesNotMatch(app, /Merge[^\n]{0,80}catalog/, 'technical Merge wording must not be the primary import CTA');
assert.match(app, /Thêm \$\{getPreviewCounts\(parsed\)\.clean\} sản phẩm vào danh mục/, 'clear import primary action missing');
assert.match(app, /Xem \{importResult\.summary\.needReview\} dòng cần kiểm tra/, 'review rows secondary action missing');

assert.match(app, /Chưa có gói phòng/, 'room-pack empty state title missing');
assert.match(app, /\+ Tạo gói đầu tiên/, 'room-pack empty state CTA missing');
assert.match(app, /Mới bắt đầu/, 'softer new-user badge wording missing');
assert.doesNotMatch(app, />Người mới bắt đầu</, 'old all-caps-prone new-user wording must be removed');
assert.match(app, /\.topbar \.crumb small\{color:var\(--muted\)/, 'topbar subtitle contrast override missing');

console.log('Phase 12.3 interaction polish smoke: PASS');
