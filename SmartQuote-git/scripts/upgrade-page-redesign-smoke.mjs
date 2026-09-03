import { readFileSync } from 'node:fs';

const src = readFileSync('src/SmartQuote.jsx', 'utf8');
const pkg = readFileSync('package.json', 'utf8');
const fail = (message) => {
  console.error(`UpgradePage redesign smoke: FAIL — ${message}`);
  process.exit(1);
};
const assertIncludes = (needle, label = needle) => { if (!src.includes(needle)) fail(`missing ${label}`); };
const assertNotIncludes = (needle, label = needle) => { if (src.includes(needle)) fail(`still contains ${label}`); };

assertIncludes('function UpgradePage({ billing, usage = {}, cloud, locked = false, onBack })', 'drop-in UpgradePage signature');
assertIncludes('const PLAN_TAGLINES = {', 'PLAN_TAGLINES helper');
assertIncludes('free: "Bắt đầu miễn phí"', 'Free tagline');
assertIncludes('starter: "Thợ & đại lý nhỏ"', 'Starter tagline');
assertIncludes('pro: "Đại lý đang chạy đều"', 'Pro tagline');
assertIncludes('business: "Công ty & nhiều team"', 'Business tagline');

// UX principles from the handoff doc.
assertIncludes('<h1>Gói &amp; Sử dụng</h1>', 'new page title');
assertIncludes('className="pp-current"', 'current plan + usage block near top');
assertIncludes('const meterKeys = ["quotes_per_month", "ai_claude_request", "pdf_extract", "excel_export", "web_scrape", "product_enrich"]', 'meter keys without products/seats');
assertIncludes('const warn = !unlimited && pct >= 80;', '80 percent warning threshold');
assertIncludes('className={`pp-bar ${warn ? "warn" : ""}`}', 'warning class for meter bar');
assertIncludes('<div className="pp-grid">', 'pricing cards');
assertIncludes('onClick={() => setModalPlan(plan)}', 'upgrade opens modal instead of exposed form');
assertIncludes('{modalPlan && (', 'upgrade modal is conditional');
assertIncludes('<details className="pp-more">', 'payment/history in collapsed details');
assertIncludes('<summary>Thông tin thanh toán &amp; lịch sử', 'collapsed payment/history summary');
assertIncludes('requestManualUpgrade(cloud.dealerId, { plan, billingCycle, customerContact, customerNote })', 'keeps existing manual upgrade function');
assertIncludes('listBillingEvents(cloud.dealerId)', 'keeps billing history function');
assertIncludes('getPlanPriceVnd(plan, billingCycle)', 'keeps price helper');

// Technical copy must no longer appear in the customer-facing plan page.
assertNotIncludes('quota + capability', 'technical quota/capability copy');
assertNotIncludes('client/server', 'technical client/server copy');
assertNotIncludes('Deterministic-only · 0 AI cost', 'technical deterministic-only copy');
assertNotIncludes('className="manual-payment-card"', 'old exposed payment form');
assertNotIncludes('className="usage-card"', 'old quota card at bottom');
assertNotIncludes('className="upgrade-hero"', 'old upgrade hero');

// CSS block was appended.
assertIncludes('.plan-page{max-width:1080px', 'new plan page CSS');
assertIncludes('.pp-bar.warn>i{background:var(--c-warn,#c98a00);}', 'meter warning CSS');
assertIncludes('.pp-modal-bg{position:fixed;', 'modal CSS');
assertIncludes('.pp-more{margin-top:28px;', 'details CSS');

if (!pkg.includes('"smoke:upgrade-page"')) fail('missing package script smoke:upgrade-page');

console.log('UpgradePage redesign smoke: PASS');
