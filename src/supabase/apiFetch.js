import { isSupabaseConfigured, supabase } from './client.js';
import { getTenantStorageScope } from '../storage/tenantStorage.js';

async function getAccessToken() {
  if (!isSupabaseConfigured || !supabase) return '';
  const { data } = await supabase.auth.getSession();
  return data?.session?.access_token || '';
}

function makeRequestId() {
  try { return crypto.randomUUID(); }
  catch { return `sq_${Date.now()}_${Math.random().toString(16).slice(2)}`; }
}

export async function smartQuoteFetch(input, init = {}, options = {}) {
  const headers = new Headers(init.headers || {});
  const token = await getAccessToken();
  if (token && !headers.has('Authorization')) headers.set('Authorization', `Bearer ${token}`);

  const dealerId = options.dealerId || getTenantStorageScope();
  if (dealerId && !headers.has('X-SmartQuote-Dealer-Id')) headers.set('X-SmartQuote-Dealer-Id', dealerId);
  if (options.eventType && !headers.has('X-SmartQuote-Event')) headers.set('X-SmartQuote-Event', options.eventType);
  if (options.units && !headers.has('X-SmartQuote-Units')) headers.set('X-SmartQuote-Units', String(options.units));
  if (!headers.has('X-Request-Id')) headers.set('X-Request-Id', makeRequestId());

  const timeoutMs = Number(options.timeoutMs || 120000);
  let timeout = null;
  let signal = init.signal;
  if (!signal && timeoutMs > 0) {
    const controller = new AbortController();
    signal = controller.signal;
    timeout = setTimeout(() => controller.abort(), timeoutMs);
  }

  try {
    return await fetch(input, {
      ...init,
      headers,
      signal,
    });
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
