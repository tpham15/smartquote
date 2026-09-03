import { PLAN_LIMITS, PLAN_CAPABILITIES } from './planLimits.generated.js';

export { PLAN_LIMITS, PLAN_CAPABILITIES };

export function normalizePlan(plan) {
  const p = String(plan || 'trial').trim().toLowerCase();
  return PLAN_LIMITS[p] ? p : 'trial';
}

export function getMonthlyLimit(plan, eventType) {
  const normalized = normalizePlan(plan);
  const limit = PLAN_LIMITS[normalized]?.[eventType];
  if (limit === undefined || limit === null) return 0;
  return limit;
}


export const CAPABILITY_LABELS = {
  ai_import: 'Nhập bằng AI / đọc PDF',
  template_memory: 'Nhớ template nhà cung cấp',
  correction_learning: 'Học từ chỉnh sửa',
  branded_pdf: 'Báo giá PDF thương hiệu riêng',
  quote_variants_abc: 'Phương án báo giá A/B/C',
  bom_import: 'Nhập BOM/takeoff từ KTS',
  team_seats: 'Nhiều thành viên trong workspace',
  price_intelligence: 'Dữ liệu giá thị trường',
  api_access: 'Truy cập API',
  priority_support: 'Hỗ trợ ưu tiên',
};
export function hasPlanCapability(plan, capabilityKey) {
  const normalized = normalizePlan(plan);
  return PLAN_CAPABILITIES[normalized]?.[capabilityKey] === true;
}
export async function assertPlanCapability(auth, capabilityKey) {
  if (!capabilityKey || auth?.devMode) return { ok: true, capability: capabilityKey };
  const plan = normalizePlan(auth?.plan || auth?.dealer?.plan || 'trial');
  const label = CAPABILITY_LABELS[capabilityKey] || capabilityKey;
  if (auth?.supabase && !auth?.devMode) {
    const { data, error } = await auth.supabase.rpc('plan_has_capability', { plan_input: plan, capability_input: capabilityKey });
    if (error) {
      const msg = String(error.message || '');
      const err = new Error(/plan_has_capability|function .* does not exist|Could not find the function/i.test(msg)
        ? 'Capability RPC chưa được cấu hình. Hãy chạy supabase/phase10_plan_capabilities.sql trên Supabase.'
        : (error.message || `Không kiểm tra được quyền dùng ${label}.`));
      err.statusCode = 500;
      throw err;
    }
    if (data === true) return { ok: true, capability: capabilityKey, plan };
  } else if (hasPlanCapability(plan, capabilityKey)) {
    return { ok: true, capability: capabilityKey, plan };
  }
  const err = new Error(`Tính năng "${label}" chưa mở cho gói ${PLAN_LIMITS[plan]?.label || plan}. Vui lòng nâng cấp gói.`);
  err.statusCode = 403;
  err.capability = { plan, capability: capabilityKey, label };
  throw err;
}

export function monthStartIso(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0)).toISOString();
}


export function isPastIso(iso, now = new Date()) {
  if (!iso) return false;
  const target = new Date(iso);
  if (Number.isNaN(target.getTime())) return false;
  return target.getTime() <= now.getTime();
}

export function getDealerBillingLock(dealer = {}) {
  const plan = normalizePlan(dealer?.plan || 'trial');
  const status = String(dealer?.subscription_status || (plan === 'trial' ? 'trialing' : 'active')).toLowerCase();
  const trialExpired = plan === 'trial' && isPastIso(dealer?.trial_ends_at);
  const paidExpired = plan !== 'trial' && dealer?.current_period_end && isPastIso(dealer.current_period_end);
  const statusLocked = ['expired', 'canceled', 'past_due', 'unpaid'].includes(status);
  if (plan === 'expired' || trialExpired || paidExpired || statusLocked) {
    return {
      locked: true,
      effectivePlan: 'expired',
      reason: trialExpired ? 'Trial đã hết hạn. Vui lòng nâng cấp gói để tiếp tục dùng API.' : paidExpired ? 'Gói hiện tại đã hết hạn. Vui lòng gia hạn để tiếp tục dùng API.' : `Workspace đang ở trạng thái ${status}. Vui lòng nâng cấp/gia hạn gói.`,
    };
  }
  return { locked: false, effectivePlan: plan, reason: '' };
}
