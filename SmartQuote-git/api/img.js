// Vercel Serverless — proxy ảnh tránh CORS/hotlink
import dns from 'node:dns/promises';
import net from 'node:net';
import { assertMemoryIpRateLimit } from './_lib/rateLimit.js';
import { enforceAllowedOrigin, getRequestId, setRequestId, setSecurityHeaders } from './_lib/security.js';


function httpError(statusCode, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

function isBlockedHostname(hostname = '') {
  const h = hostname.toLowerCase().replace(/\.$/, '');
  return h === 'localhost'
    || h.endsWith('.localhost')
    || h.endsWith('.local')
    || h.endsWith('.internal')
    || h === 'metadata.google.internal';
}

function isPrivateIp(address = '') {
  if (!address) return true;
  if (net.isIP(address) === 4) {
    const p = address.split('.').map((x) => Number(x));
    return p[0] === 10
      || p[0] === 127
      || (p[0] === 169 && p[1] === 254)
      || (p[0] === 172 && p[1] >= 16 && p[1] <= 31)
      || (p[0] === 192 && p[1] === 168)
      || p[0] === 0;
  }
  const h = address.toLowerCase();
  return h === '::1' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80:') || h === '::';
}

async function validatePublicImageUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw httpError(400, 'Invalid URL');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw httpError(400, 'Invalid protocol');
  if (!parsed.hostname || parsed.username || parsed.password) throw httpError(400, 'Invalid public URL');
  if (isBlockedHostname(parsed.hostname)) throw httpError(400, 'Private/internal URLs are not allowed');
  const ipLiteral = net.isIP(parsed.hostname) ? parsed.hostname : '';
  if (ipLiteral && isPrivateIp(ipLiteral)) throw httpError(400, 'Private/internal IPs are not allowed');
  if (!ipLiteral) {
    try {
      const records = await dns.lookup(parsed.hostname, { all: true, verbatim: false });
      if (records.some((r) => isPrivateIp(r.address))) throw httpError(400, 'Private/internal hosts are not allowed');
    } catch (err) {
      if (err.statusCode) throw err;
    }
  }
  return parsed;
}

async function fetchPublicImage(parsed, redirectDepth = 0) {
  if (redirectDepth > 5) throw httpError(310, 'Too many redirects while fetching image');
  const safeUrl = await validatePublicImageUrl(parsed.href || parsed);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(safeUrl.href, {
      signal: controller.signal,
      redirect: 'manual',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'image/webp,image/avif,image/apng,image/*,*/*;q=0.8',
        'Accept-Language': 'vi-VN,vi;q=0.9,en;q=0.8',
        'Referer': `${safeUrl.protocol}//${safeUrl.host}/`,
      },
    });
    clearTimeout(timeout);

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location) throw httpError(502, 'Upstream redirect missing Location header');
      const nextUrl = new URL(location, safeUrl.href).href;
      // Validate each redirect target; this blocks public-to-private SSRF redirects.
      const nextParsed = await validatePublicImageUrl(nextUrl);
      return fetchPublicImage(nextParsed, redirectDepth + 1);
    }
    return response;
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}

export default async function handler(req, res) {
  const requestId = getRequestId(req);
  setRequestId(res, requestId);
  setSecurityHeaders(res);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Request-Id');
  res.setHeader('Access-Control-Max-Age', '86400');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  // Lấy url từ query — dùng WHATWG URL API thay url.parse()
  const reqUrl = new URL(req.url, `https://${req.headers.host}`);
  const imgUrl = reqUrl.searchParams.get('url');

  if (!imgUrl) return res.status(400).json({ error: 'Missing url param' });

  try {
    assertMemoryIpRateLimit(req, { keyPrefix: 'img', limit: Number(process.env.SMARTQUOTE_IMG_RATE_LIMIT_PER_MIN || 180), windowMs: 60_000 });
  } catch (err) {
    return res.status(err.statusCode || 429).json({ error: err.message, rateLimit: err.rateLimit || undefined });
  }

  // Validate URL hợp lệ + chặn SSRF tới private/internal network.
  let parsed;
  try {
    parsed = await validatePublicImageUrl(imgUrl);
  } catch (err) {
    return res.status(err.statusCode || 400).json({ error: err.message || 'Invalid URL' });
  }

  // Block Google thumbnail (không proxy được)
  if (imgUrl.includes('encrypted-tbn') || imgUrl.includes('gstatic.com/images?q=tbn')) {
    return res.status(403).json({ error: 'Google thumbnail not supported' });
  }

  try {
    const response = await fetchPublicImage(parsed);

    if (!response.ok) {
      return res.status(response.status).json({ error: `Upstream ${response.status}` });
    }

    const contentType = response.headers.get('content-type') || 'image/jpeg';
    if (!contentType.startsWith('image/')) {
      return res.status(400).json({ error: 'Not an image' });
    }

    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength > 5 * 1024 * 1024) {
      return res.status(413).json({ error: 'Image is too large' });
    }
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > 5 * 1024 * 1024) {
      return res.status(413).json({ error: 'Image is too large' });
    }
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=3600');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.status(200).send(Buffer.from(buffer));

  } catch (err) {
    if (err.name === 'AbortError') {
      return res.status(504).json({ error: 'Timeout fetching image' });
    }
    return res.status(500).json({ error: err.message });
  }
}
