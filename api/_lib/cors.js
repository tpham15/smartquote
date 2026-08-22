import { enforceAllowedOrigin, resolveCorsOrigin, setSecurityHeaders } from './security.js';

export function setCorsHeaders(req, res, methods = 'POST, OPTIONS') {
  const origin = resolveCorsOrigin(req);
  setSecurityHeaders(res);
  if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', methods);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-SmartQuote-Dealer-Id, X-SmartQuote-Event, X-SmartQuote-Units, X-Request-Id');
  res.setHeader('Access-Control-Max-Age', '86400');
}

export function handleOptions(req, res, methods = 'POST, OPTIONS') {
  setCorsHeaders(req, res, methods);
  if (!enforceAllowedOrigin(req, res)) return true;
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return true;
  }
  return false;
}
