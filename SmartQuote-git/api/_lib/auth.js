import { getSupabaseAdmin, isApiAuthDisabled } from './supabaseAdmin.js';
import { getDealerBillingLock } from './limits.js';

function getHeader(req, name) {
  const headers = req.headers || {};
  return headers[name] || headers[name.toLowerCase()] || headers[name.toUpperCase()];
}

function getBearerToken(req) {
  const raw = getHeader(req, 'authorization') || '';
  const match = String(raw).match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

function getRequestedDealerId(req) {
  return String(
    getHeader(req, 'x-smartquote-dealer-id')
    || getHeader(req, 'x-sq-dealer-id')
    || req.body?.dealerId
    || req.query?.dealerId
    || '',
  ).trim();
}

export async function requireApiAccess(req, res) {
  if (isApiAuthDisabled()) {
    return {
      ok: true,
      devMode: true,
      user: { id: 'local-dev-user', email: 'local-dev@smartquote.local' },
      dealerId: getRequestedDealerId(req) || 'local-dev-dealer',
      role: 'owner',
      dealer: { id: getRequestedDealerId(req) || 'local-dev-dealer', name: 'Local Dev', plan: 'business' },
      plan: 'business',
    };
  }

  const token = getBearerToken(req);
  if (!token) {
    res.status(401).json({ error: 'Bạn cần đăng nhập để gọi API này.' });
    return { ok: false };
  }

  let supabase;
  try {
    supabase = getSupabaseAdmin();
  } catch (error) {
    res.status(500).json({ error: error.message || 'Server auth chưa được cấu hình.' });
    return { ok: false };
  }

  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  const user = userData?.user;
  if (userError || !user?.id) {
    res.status(401).json({ error: 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn.' });
    return { ok: false };
  }

  const requestedDealerId = getRequestedDealerId(req);
  let query = supabase
    .from('dealer_members')
    .select('dealer_id, role, dealers(id, name, plan, trial_ends_at, subscription_status, current_period_end)')
    .eq('user_id', user.id)
    .order('created_at', { ascending: true })
    .limit(1);

  if (requestedDealerId) query = query.eq('dealer_id', requestedDealerId);

  const { data: membership, error: memberError } = await query.maybeSingle();
  if (memberError) {
    res.status(500).json({ error: memberError.message || 'Không kiểm tra được workspace đại lý.' });
    return { ok: false };
  }
  if (!membership?.dealer_id) {
    res.status(403).json({ error: 'Tài khoản này không thuộc workspace đại lý được yêu cầu.' });
    return { ok: false };
  }

  const dealer = Array.isArray(membership.dealers) ? membership.dealers[0] : membership.dealers;
  const billingLock = getDealerBillingLock(dealer || {});
  if (billingLock.locked) {
    res.status(402).json({
      error: billingLock.reason,
      billing: {
        plan: dealer?.plan || 'trial',
        effectivePlan: billingLock.effectivePlan,
        subscription_status: dealer?.subscription_status || 'trialing',
        trial_ends_at: dealer?.trial_ends_at || null,
        current_period_end: dealer?.current_period_end || null,
      },
    });
    return { ok: false };
  }

  return {
    ok: true,
    user,
    dealerId: membership.dealer_id,
    role: membership.role,
    dealer,
    plan: billingLock.effectivePlan || dealer?.plan || 'trial',
    supabase,
  };
}
