import crypto from 'node:crypto';

export function parseCsvEnv(value = '') {
  return String(value || '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}

export function getAllowedOrigins() {
  const configured = parseCsvEnv(process.env.SMARTQUOTE_ALLOWED_ORIGIN || process.env.SMARTQUOTE_ALLOWED_ORIGINS || '');
  return configured;
}

function normalizeOrigin(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw.includes('://') ? raw : `https://${raw}`);
    const defaultPort = (url.protocol === 'https:' && url.port === '443') || (url.protocol === 'http:' && url.port === '80');
    return `${url.protocol}//${url.hostname.toLowerCase()}${url.port && !defaultPort ? `:${url.port}` : ''}`;
  } catch {
    return raw.replace(/\/$/, '').toLowerCase();
  }
}

export function isOriginAllowed(origin = '') {
  const allowed = getAllowedOrigins();
  if (allowed.includes('*')) return true;
  const normalized = normalizeOrigin(origin);
  if (!normalized) return true; // server-to-server / requests without Origin
  return allowed.map(normalizeOrigin).includes(normalized);
}

export function isSameOriginRequest(req) {
  const origin = normalizeOrigin(req?.headers?.origin || '');
  if (!origin) return true;
  const forwardedHost = String(req?.headers?.['x-forwarded-host'] || req?.headers?.host || '').split(',')[0].trim();
  if (!forwardedHost) return false;
  const proto = String(req?.headers?.['x-forwarded-proto'] || 'https').split(',')[0].trim().toLowerCase() || 'https';
  return origin === normalizeOrigin(`${proto}://${forwardedHost}`);
}

export function resolveCorsOrigin(req) {
  const origin = String(req.headers?.origin || '').trim();
  const allowed = getAllowedOrigins();
  if (isSameOriginRequest(req)) return origin || '';
  if (allowed.includes('*')) return '*';
  if (!origin) return allowed[0] || '';
  return isOriginAllowed(origin) ? origin : '';
}

export function setSecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
}

export function enforceAllowedOrigin(req, res) {
  const origin = String(req.headers?.origin || '').trim();
  if (!origin || isSameOriginRequest(req) || isOriginAllowed(origin)) return true;
  setSecurityHeaders(res);
  res.status(403).json({ error: 'Origin không được phép gọi SmartQuote API.' });
  return false;
}

export function getRequestId(req) {
  const existing = req.headers?.['x-request-id'] || req.headers?.['x-vercel-id'];
  return String(existing || crypto.randomUUID()).slice(0, 80);
}

export function setRequestId(res, requestId) {
  if (requestId) res.setHeader('X-Request-Id', requestId);
}

export function getClientIp(req) {
  const header = req.headers?.['x-forwarded-for'] || req.headers?.['x-real-ip'] || req.socket?.remoteAddress || '';
  return String(header).split(',')[0].trim() || 'unknown';
}

export function bodySizeBytes(body) {
  if (body == null) return 0;
  if (Buffer.isBuffer(body)) return body.length;
  if (typeof body === 'string') return Buffer.byteLength(body);
  try { return Buffer.byteLength(JSON.stringify(body)); }
  catch { return 0; }
}

export function assertBodySize(body, maxBytes, label = 'Request') {
  const size = bodySizeBytes(body);
  if (maxBytes && size > maxBytes) {
    const err = new Error(`${label} quá lớn. Vui lòng tách file/dữ liệu nhỏ hơn rồi thử lại.`);
    err.statusCode = 413;
    err.sizeBytes = size;
    err.maxBytes = maxBytes;
    throw err;
  }
  return size;
}

export function redact(value) {
  if (value == null) return value;
  if (typeof value === 'string') {
    if (value.length > 240) return `${value.slice(0, 120)}…${value.slice(-40)}`;
    return value.replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, 'Bearer [redacted]');
  }
  if (Array.isArray(value)) return value.slice(0, 20).map(redact);
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (/token|key|secret|password|authorization/i.test(k)) out[k] = '[redacted]';
      else out[k] = redact(v);
    }
    return out;
  }
  return value;
}
