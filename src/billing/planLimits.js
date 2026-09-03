import { PLAN_LIMITS, PLAN_PRICE_VND, PLAN_ORDER, PLAN_CAPABILITIES } from './planCatalog.generated.js';

export { PLAN_LIMITS, PLAN_PRICE_VND, PLAN_ORDER, PLAN_CAPABILITIES };

export const BILLING_CYCLES = {
  monthly: { label: 'Theo tháng', months: 1 },
  annual: { label: 'Theo năm', months: 12 },
};

export function getPlanPriceVnd(plan, billingCycle = 'monthly') {
  return PLAN_PRICE_VND[String(plan || '').toLowerCase()]?.[billingCycle] || 0;
}

export function formatVnd(amount) {
  return `${Number(amount || 0).toLocaleString('vi-VN')}đ`;
}


export const FEATURE_LABELS = {
  products: 'sản phẩm catalog',
  quotes_per_month: 'báo giá/tháng',
  ai_claude_request: 'lượt AI Claude/tháng',
  web_scrape: 'lượt cào web/tháng',
  product_enrich: 'lượt tìm sản phẩm web/tháng',
  pdf_extract: 'file PDF AI/tháng',
  excel_export: 'lượt xuất Excel/tháng',
};

export function normalizePlan(plan) {
  const p = String(plan || 'trial').trim().toLowerCase();
  return PLAN_LIMITS[p] ? p : 'trial';
}

export function isFiniteLimit(value) {
  return Number.isFinite(value);
}

export function formatLimit(value) {
  if (value === Infinity || value < 0) return 'Không giới hạn';
  return Number(value || 0).toLocaleString('vi-VN');
}

export function monthStartIso(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0)).toISOString();
}

export function daysUntil(iso, now = new Date()) {
  if (!iso) return null;
  const target = new Date(iso);
  if (Number.isNaN(target.getTime())) return null;
  return Math.ceil((target.getTime() - now.getTime()) / 86400000);
}

export function isPast(iso, now = new Date()) {
  if (!iso) return false;
  const target = new Date(iso);
  if (Number.isNaN(target.getTime())) return false;
  return target.getTime() <= now.getTime();
}

export function normalizeBilling(billing = {}) {
  const dealer = billing.dealer || billing || {};
  const rawPlan = normalizePlan(dealer.plan || billing.plan || 'trial');
  const subscriptionStatus = String(dealer.subscription_status || billing.subscriptionStatus || (rawPlan === 'trial' ? 'trialing' : 'active')).toLowerCase();
  const trialEndsAt = dealer.trial_ends_at || dealer.trialEndsAt || billing.trialEndsAt || null;
  const currentPeriodEnd = dealer.current_period_end || dealer.currentPeriodEnd || billing.currentPeriodEnd || null;
  const trialExpired = rawPlan === 'trial' && isPast(trialEndsAt);
  const paidExpired = rawPlan !== 'trial' && currentPeriodEnd && isPast(currentPeriodEnd);
  const statusLocked = ['expired', 'canceled', 'past_due', 'unpaid'].includes(subscriptionStatus);
  const locked = rawPlan === 'expired' || trialExpired || paidExpired || statusLocked;
  const effectivePlan = locked ? 'expired' : rawPlan;
  return {
    plan: rawPlan,
    effectivePlan,
    label: PLAN_LIMITS[rawPlan]?.label || 'Trial',
    subscriptionStatus,
    trialEndsAt,
    currentPeriodEnd,
    trialDaysLeft: rawPlan === 'trial' ? daysUntil(trialEndsAt) : null,
    locked,
    lockReason: locked
      ? (trialExpired ? 'Trial đã hết hạn.' : paidExpired ? 'Gói hiện tại đã hết hạn.' : statusLocked ? `Workspace đang ở trạng thái ${subscriptionStatus}.` : 'Gói hiện tại đã hết hạn.')
      : '',
    limits: PLAN_LIMITS[effectivePlan] || PLAN_LIMITS.trial,
    usage: billing.usage || {},
    raw: billing,
  };
}

export function getLimitForPlan(plan, key) {
  const normalized = normalizePlan(plan);
  const value = PLAN_LIMITS[normalized]?.[key];
  return value === undefined || value === null ? 0 : value;
}

export function canUseFeature(billing, featureKey, units = 1) {
  const state = normalizeBilling(billing || {});
  if (state.locked) {
    return { ok: false, reason: state.lockReason, state, used: 0, limit: 0, remaining: 0 };
  }
  const limit = state.limits?.[featureKey];
  if (limit === Infinity || limit < 0 || limit === undefined) {
    return { ok: true, state, used: Number(state.usage?.[featureKey] || 0), limit, remaining: Infinity };
  }
  const used = Number(state.usage?.[featureKey] || 0);
  const requested = Math.max(1, Number(units) || 1);
  const ok = used + requested <= limit;
  const label = FEATURE_LABELS[featureKey] || featureKey;
  return {
    ok,
    state,
    used,
    limit,
    requested,
    remaining: Math.max(0, limit - used),
    reason: ok ? '' : `Gói ${state.label} đã hết quota ${label}: đã dùng ${used}/${limit} trong tháng này.`,
  };
}

export function canFitProductCount(billing, nextCount) {
  const state = normalizeBilling(billing || {});
  if (state.locked) return { ok: false, reason: state.lockReason, state, limit: 0 };
  const limit = state.limits?.products;
  if (limit === Infinity || limit < 0 || limit === undefined) return { ok: true, state, limit };
  const ok = Number(nextCount || 0) <= limit;
  return {
    ok,
    state,
    limit,
    reason: ok ? '' : `Gói ${state.label} giới hạn ${formatLimit(limit)} sản phẩm catalog. Sau thao tác này catalog sẽ có ${formatLimit(nextCount)} sản phẩm.`,
  };
}

export function buildUpgradeMessage(reason = '') {
  return `${reason || 'Tính năng này cần nâng cấp gói.'}\n\nChọn Nâng cấp để xem gói Starter / Pro / Business hoặc liên hệ Zalo để mở quota.`;
}
