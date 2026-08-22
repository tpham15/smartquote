import { getClientIp } from './security.js';
import { normalizePlan } from './limits.js';

export const API_RATE_LIMITS = {
  free: { ai_claude_request: 0, web_scrape: 0, product_enrich: 0, pdf_extract: 0, excel_export: 2 },
  trial: {
    ai_claude_request: 10,
    web_scrape: 2,
    product_enrich: 2,
    pdf_extract: 2,
    excel_export: 5,
  },
  starter: {
    ai_claude_request: 20,
    web_scrape: 3,
    product_enrich: 5,
    pdf_extract: 3,
    excel_export: 10,
  },
  pro: {
    ai_claude_request: 60,
    web_scrape: 8,
    product_enrich: 20,
    pdf_extract: 8,
    excel_export: 30,
  },
  business: {
    ai_claude_request: 120,
    web_scrape: 15,
    product_enrich: 40,
    pdf_extract: 15,
    excel_export: 60,
  },
  expired: {
    ai_claude_request: 0,
    web_scrape: 0,
    product_enrich: 0,
    pdf_extract: 0,
    excel_export: 0,
  },
};

export function minuteWindowStartIso(now = new Date()) {
  const d = new Date(now);
  d.setUTCSeconds(0, 0);
  return d.toISOString();
}

export function getPerMinuteLimit(plan, eventType) {
  const normalized = normalizePlan(plan);
  return API_RATE_LIMITS[normalized]?.[eventType] ?? 10;
}

export function getRateLimitKey(auth, req, eventType) {
  const dealer = auth?.dealerId || 'anonymous';
  const ip = getClientIp(req).replace(/[^a-zA-Z0-9:.\-_]/g, '_').slice(0, 80);
  return `${dealer}:${eventType}:${ip}`;
}

export async function assertRateLimit(auth, req, { eventType, units = 1 }) {
  if (auth?.devMode || String(process.env.SMARTQUOTE_RATE_LIMIT_DISABLED || '').toLowerCase() === 'true') {
    return { allowed: true, limit: Infinity, count: 0, resetAt: null };
  }
  if (!auth?.supabase) return { allowed: true, limit: Infinity, count: 0, resetAt: null };

  const plan = normalizePlan(auth?.plan || auth?.dealer?.plan || 'trial');
  const limit = getPerMinuteLimit(plan, eventType);
  const increment = Math.max(1, Math.min(Number(units) || 1, 100));
  const windowStart = minuteWindowStartIso();
  const key = getRateLimitKey(auth, req, eventType);

  const { data, error } = await auth.supabase.rpc('smartquote_increment_rate_limit', {
    p_key: key,
    p_window_start: windowStart,
    p_limit: limit,
    p_increment: increment,
  });
  if (error) {
    const err = new Error(`Rate limit chưa được cấu hình. Hãy chạy supabase/phase7_hardening.sql. (${error.message})`);
    err.statusCode = 500;
    throw err;
  }
  const result = Array.isArray(data) ? data[0] : data;
  if (!result?.allowed) {
    const err = new Error('Bạn thao tác quá nhanh. Vui lòng thử lại sau khoảng 1 phút.');
    err.statusCode = 429;
    err.rateLimit = { plan, eventType, limit, count: result?.count || limit, resetAt: result?.reset_at || null };
    throw err;
  }
  return { allowed: true, plan, eventType, limit, count: result?.count || increment, resetAt: result?.reset_at || null };
}

const memoryBuckets = globalThis.__smartQuoteIpRateBuckets || new Map();
globalThis.__smartQuoteIpRateBuckets = memoryBuckets;

export function assertMemoryIpRateLimit(req, { keyPrefix = 'public', limit = 120, windowMs = 60_000 } = {}) {
  const now = Date.now();
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const key = `${keyPrefix}:${getClientIp(req)}:${windowStart}`;
  const current = memoryBuckets.get(key) || 0;
  memoryBuckets.set(key, current + 1);
  // Opportunistic cleanup to avoid unbounded growth in warm serverless instances.
  if (memoryBuckets.size > 5000) {
    for (const k of memoryBuckets.keys()) {
      const ts = Number(String(k).split(':').pop());
      if (!Number.isFinite(ts) || now - ts > windowMs * 5) memoryBuckets.delete(k);
    }
  }
  if (current + 1 > limit) {
    const err = new Error('Bạn thao tác quá nhanh. Vui lòng thử lại sau.');
    err.statusCode = 429;
    err.rateLimit = { limit, count: current + 1, resetAt: new Date(windowStart + windowMs).toISOString() };
    throw err;
  }
  return { allowed: true, limit, count: current + 1, resetAt: new Date(windowStart + windowMs).toISOString() };
}
