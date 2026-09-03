import assert from 'node:assert/strict';
import { isSameOriginRequest, resolveCorsOrigin } from '../api/_lib/security.js';

const previous = process.env.SMARTQUOTE_ALLOWED_ORIGIN;
process.env.SMARTQUOTE_ALLOWED_ORIGIN = 'https://app.smartquote.vn';
try {
  const previewReq = { headers: {
    origin: 'https://smartquote-preview.vercel.app',
    host: 'smartquote-preview.vercel.app',
    'x-forwarded-proto': 'https',
  }};
  assert.equal(isSameOriginRequest(previewReq), true);
  assert.equal(resolveCorsOrigin(previewReq), previewReq.headers.origin);

  const hostileReq = { headers: {
    origin: 'https://evil.example',
    host: 'app.smartquote.vn',
    'x-forwarded-proto': 'https',
  }};
  assert.equal(isSameOriginRequest(hostileReq), false);
  assert.equal(resolveCorsOrigin(hostileReq), '');
  console.log('Phase 12.4.3 JS same-origin API smoke: PASS');
} finally {
  if (previous == null) delete process.env.SMARTQUOTE_ALLOWED_ORIGIN;
  else process.env.SMARTQUOTE_ALLOWED_ORIGIN = previous;
}
