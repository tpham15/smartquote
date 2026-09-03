import { getMonthlyLimit, monthStartIso, normalizePlan } from './limits.js';

export function normalizeUnits(units = 1) {
  const n = Number(units);
  if (!Number.isFinite(n) || n <= 0) return 1;
  return Math.max(1, Math.min(Math.ceil(n), 10000));
}

export async function getUsageThisMonth(auth, eventType) {
  if (!auth?.supabase || auth.devMode) return 0;
  const since = monthStartIso();
  const { data, error } = await auth.supabase
    .from('usage_events')
    .select('units')
    .eq('dealer_id', auth.dealerId)
    .eq('event_type', eventType)
    .gte('created_at', since)
    .limit(10000);
  if (error) throw error;
  return (data || []).reduce((sum, row) => sum + (Number(row.units) || 0), 0);
}

function rememberConsumedUsage(auth, eventType, payload = {}) {
  if (!auth) return;
  if (!auth.__consumedUsage) auth.__consumedUsage = {};
  auth.__consumedUsage[eventType] = payload;
}

export async function assertWithinQuota(auth, { eventType, units = 1, meta = {} }) {
  const normalizedUnits = normalizeUnits(units);
  const plan = normalizePlan(auth?.plan || auth?.dealer?.plan || 'trial');
  const limit = getMonthlyLimit(plan, eventType);
  if (limit === Infinity || limit < 0 || auth?.devMode) {
    return { allowed: true, plan, limit, used: 0, remaining: Infinity };
  }

  // Phase 7.1: Prefer atomic quota consumption in Postgres. This closes the
  // check-then-insert race where parallel API calls could exceed monthly quota.
  if (auth?.supabase && auth?.dealerId && auth?.user?.id) {
    const { data, error } = await auth.supabase.rpc('consume_usage_quota', {
      target_dealer_id: auth.dealerId,
      target_user_id: auth.user.id,
      target_event_type: eventType,
      requested_units: normalizedUnits,
      event_meta: meta || {},
    });
    if (!error) {
      rememberConsumedUsage(auth, eventType, data || {});
      return {
        allowed: true,
        plan: data?.plan || plan,
        eventType,
        limit: data?.limit ?? limit,
        used: data?.used_before ?? 0,
        requested: normalizedUnits,
        remaining: data?.remaining ?? Math.max(0, limit - normalizedUnits),
      };
    }
    // Missing migration should fail closed with a clear setup message, not silently
    // fall back in production. Local/dev mode is already handled above.
    const msg = String(error.message || '');
    if (/consume_usage_quota|function .* does not exist|Could not find the function/i.test(msg)) {
      const err = new Error('Quota RPC chưa được cấu hình. Hãy chạy supabase/phase7_1_must_fix.sql trên Supabase.');
      err.statusCode = 500;
      throw err;
    }
    const err = new Error(error.message || `Đã vượt quota ${eventType} của gói ${plan}.`);
    err.statusCode = /vượt quota|quota/i.test(msg) ? 403 : 500;
    err.quota = { plan, eventType, limit, requested: normalizedUnits };
    throw err;
  }

  const used = await getUsageThisMonth(auth, eventType);
  if (used + normalizedUnits > limit) {
    const err = new Error(`Đã vượt quota ${eventType} của gói ${plan}. Đã dùng ${used}/${limit} trong tháng này.`);
    err.statusCode = 403;
    err.quota = { plan, eventType, limit, used, requested: normalizedUnits, remaining: Math.max(0, limit - used) };
    throw err;
  }
  return { allowed: true, plan, eventType, limit, used, requested: normalizedUnits, remaining: Math.max(0, limit - used - normalizedUnits) };
}

export async function recordUsage(auth, { eventType, units = 1, meta = {} }) {
  if (!auth?.supabase || auth.devMode) return null;
  const consumed = auth.__consumedUsage?.[eventType];
  if (consumed?.event_id) {
    const { data, error } = await auth.supabase
      .from('usage_events')
      .update({ meta: { ...(meta || {}), consumedAt: consumed.consumed_at || null } })
      .eq('id', consumed.event_id)
      .select('id')
      .single();
    if (error) throw error;
    delete auth.__consumedUsage[eventType];
    return data;
  }
  const payload = {
    dealer_id: auth.dealerId,
    user_id: auth.user?.id,
    event_type: eventType,
    units: normalizeUnits(units),
    meta: meta || {},
  };
  const { data, error } = await auth.supabase
    .from('usage_events')
    .insert(payload)
    .select('id')
    .single();
  if (error) throw error;
  return data;
}

export function sendQuotaError(res, error) {
  return res.status(error.statusCode || 500).json({
    error: error.message || 'Quota check failed',
    quota: error.quota || undefined,
  });
}
