import { redact } from './security.js';

export function nowMs() { return Date.now(); }

export async function logApiEvent(auth, event = {}) {
  const payload = {
    dealer_id: auth?.dealerId || null,
    user_id: auth?.user?.id || null,
    request_id: event.requestId || null,
    route: event.route || '',
    event_type: event.eventType || null,
    method: event.method || '',
    status_code: Number(event.statusCode || 0) || null,
    duration_ms: Number(event.durationMs || 0) || null,
    error_message: event.errorMessage ? String(event.errorMessage).slice(0, 500) : null,
    meta: redact(event.meta || {}),
  };

  const line = `[sq-api] ${payload.request_id || '-'} ${payload.method} ${payload.route} status=${payload.status_code || '-'} duration=${payload.duration_ms || '-'}ms dealer=${payload.dealer_id || '-'} event=${payload.event_type || '-'}`;
  if (payload.status_code && payload.status_code >= 500) console.error(line, payload.error_message || '');
  else if (payload.status_code && payload.status_code >= 400) console.warn(line, payload.error_message || '');
  else console.log(line);

  if (!auth?.supabase || auth?.devMode) return null;
  try {
    const { data, error } = await auth.supabase
      .from('api_logs')
      .insert(payload)
      .select('id')
      .single();
    if (error) throw error;
    return data;
  } catch (err) {
    console.warn('[sq-api] api_logs insert skipped:', err?.message || err);
    return null;
  }
}
