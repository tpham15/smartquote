// SmartQuote Phase 8 — Product Enrichment from Web
// Gõ tên sản phẩm -> tìm web -> trích ảnh/giá/mã -> trả ứng viên để user duyệt.
import dns from 'node:dns/promises';
import net from 'node:net';
import { handleOptions, setCorsHeaders } from './_lib/cors.js';
import { assertBodySize, enforceAllowedOrigin, getRequestId, setRequestId } from './_lib/security.js';
import { nowMs, logApiEvent } from './_lib/logger.js';
import { assertRateLimit } from './_lib/rateLimit.js';
import { requireApiAccess } from './_lib/auth.js';
import { assertWithinQuota, recordUsage, sendQuotaError } from './_lib/usage.js';
import { assertExternalBudget, recordExternalApiUsage } from './_lib/externalUsage.js';

const MAX_QUERY_CHARS = 180;
const MAX_HTML_BYTES = 1_500_000;
const FETCH_TIMEOUT_MS = 10000;
const MAX_SERPER_RESULTS = 12;
const MAX_FETCH_PAGES = 8;
const MAX_CANDIDATES = 10;
const REDIRECT_LIMIT = 5;

export default async function handler(req, res) {
  const requestId = getRequestId(req);
  const start = nowMs();
  setRequestId(res, requestId);
  setCorsHeaders(req, res, 'POST, OPTIONS');
  if (handleOptions(req, res, 'POST, OPTIONS')) return;
  if (!enforceAllowedOrigin(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const auth = await requireApiAccess(req, res);
  if (!auth.ok) return;

  try {
    assertBodySize(req.body, Number(process.env.SMARTQUOTE_MAX_PRODUCT_ENRICH_BODY_BYTES || 200000), 'Product enrich request');
    await assertRateLimit(auth, req, { eventType: 'product_enrich', units: 1 });

    const payload = normalizeRequest(req.body || {});
    const plannedSerperCalls = estimateSerperCalls(payload);
    await assertExternalBudget(auth, { provider: 'serper', operation: 'product_enrich', plannedUnits: plannedSerperCalls });
    await assertWithinQuota(auth, { eventType: 'product_enrich', units: 1, meta: { query: payload.query, plannedSerperCalls } });
    const result = await enrichProduct(payload, auth);

    await recordUsage(auth, {
      eventType: 'product_enrich',
      units: 1,
      meta: {
        query: payload.query,
        preferredSites: payload.preferredSites,
        count: result.candidates.length,
        searchProvider: result.searchProvider,
        externalUsage: result.externalUsage || undefined,
      },
    });
    await logApiEvent(auth, {
      requestId,
      route: '/api/product-enrich',
      eventType: 'product_enrich',
      method: req.method,
      statusCode: 200,
      durationMs: nowMs() - start,
      meta: { candidateCount: result.candidates.length, preferredSites: payload.preferredSites.length, externalUsage: result.externalUsage || undefined },
    });

    return res.status(200).json({ ok: true, ...result });
  } catch (err) {
    const status = err.statusCode || (err?.quota ? 403 : 500);
    await logApiEvent(auth, {
      requestId,
      route: '/api/product-enrich',
      eventType: 'product_enrich',
      method: req.method,
      statusCode: status,
      durationMs: nowMs() - start,
      errorMessage: err.message,
    });
    if (err?.quota) return sendQuotaError(res, err);
    return res.status(status).json({ error: err.message || 'Product enrichment failed', quota: err.quota || undefined, rateLimit: err.rateLimit || undefined, externalBudget: err.externalBudget || undefined });
  }
}

function httpError(statusCode, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

function clampText(value, max = 200) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function normalizeRequest(body) {
  const query = clampText(body.query, MAX_QUERY_CHARS);
  if (!query || query.length < 2) throw httpError(400, 'Nhập tên sản phẩm cần tìm.');
  const preferredSites = normalizeSites(body.preferredSites || body.preferredSite || body.siteUrl || body.site || '');
  const limit = Math.max(1, Math.min(Number(body.limit) || MAX_CANDIDATES, MAX_CANDIDATES));
  const category = clampText(body.category || '', 80);
  const supplier = clampText(body.supplier || '', 80);
  const serperApiKey = clampText(body.serperApiKey || process.env.SERPER_API_KEY || process.env.SMARTQUOTE_SERPER_API_KEY || '', 240);
  if (!serperApiKey) {
    throw httpError(400, 'Chưa cấu hình Serper API Key. Điền key ở Cài đặt hoặc đặt SERPER_API_KEY trên server.');
  }
  return { query, preferredSites, limit, category, supplier, serperApiKey };
}

function normalizeSites(raw) {
  const parts = Array.isArray(raw) ? raw : String(raw || '').split(/[\n,;]/g);
  const sites = [];
  for (const part of parts) {
    const text = String(part || '').trim();
    if (!text) continue;
    let host = text;
    try { host = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`).hostname; }
    catch { host = text.replace(/^https?:\/\//i, '').split('/')[0]; }
    host = host.toLowerCase().replace(/^www\./, '').replace(/[^a-z0-9.\-]/g, '');
    if (!host || host.includes('..') || isBlockedHostname(host) || net.isIP(host)) continue;
    if (!sites.includes(host)) sites.push(host);
    if (sites.length >= 5) break;
  }
  return sites;
}

async function enrichProduct(payload, auth) {
  const externalUsage = { provider: 'serper', calls: 0, searchCalls: 0, imageCalls: 0, estimatedCostUsd: 0 };
  const searchQueries = buildSearchQueries(payload.query, payload.preferredSites);
  const searchResults = [];
  for (const q of searchQueries) {
    const data = await callSerper('search', payload.serperApiKey, { q, num: Math.min(MAX_SERPER_RESULTS, 10), gl: 'vn', hl: 'vi' }, auth, externalUsage);
    searchResults.push(...extractSerperSearchResults(data, q));
    if (searchResults.length >= MAX_SERPER_RESULTS) break;
  }

  // Ảnh search riêng giúp có fallback khi trang nguồn không có og:image/schema image.
  let imageResults = [];
  try {
    const imgQuery = payload.preferredSites[0] ? `${payload.query} site:${payload.preferredSites[0]}` : payload.query;
    const imgData = await callSerper('images', payload.serperApiKey, { q: imgQuery, num: 8, gl: 'vn', hl: 'vi' }, auth, externalUsage);
    imageResults = extractSerperImages(imgData);
  } catch {}

  const urls = uniqueBy(searchResults.map((r) => r.url).filter(Boolean), (x) => x).slice(0, MAX_FETCH_PAGES);
  const pageCandidates = [];
  for (const url of urls) {
    try {
      const html = await fetchHtml(url);
      pageCandidates.push(...extractCandidatesFromHtml(html, url, payload));
    } catch (error) {
      const fallback = searchResults.find((r) => r.url === url);
      if (fallback) pageCandidates.push(candidateFromSearchResult(fallback, payload));
    }
  }

  // Thêm shopping/search result nếu có giá sẵn.
  for (const r of searchResults) {
    if (r.price || r.imageUrl) pageCandidates.push(candidateFromSearchResult(r, payload));
  }

  let candidates = mergeCandidates(pageCandidates, payload.query)
    .map((c, index) => {
      const fallbackImage = !c.imageUrl ? imageResults[index]?.imageUrl : '';
      const enriched = { ...c, imageUrl: c.imageUrl || fallbackImage || '' };
      return { ...enriched, confidence: scoreCandidate(enriched, payload.query, payload.preferredSites) };
    })
    .filter((c) => c.name && (c.imageUrl || c.price || c.sku || c.sourceUrl))
    .sort((a, b) => (b.confidence || 0) - (a.confidence || 0))
    .slice(0, payload.limit);

  candidates = candidates.map((c) => ({
    name: cleanName(c.name),
    sku: cleanSku(c.sku),
    price: normalizePrice(c.price),
    priceText: c.priceText || (c.price ? `${Number(c.price).toLocaleString('vi-VN')}đ` : ''),
    imageUrl: c.imageUrl || '',
    sourceUrl: c.sourceUrl || '',
    sourceDomain: domainOf(c.sourceUrl) || c.sourceDomain || '',
    supplier: payload.supplier || c.supplier || domainOf(c.sourceUrl) || '',
    category: payload.category || c.category || '',
    description: clampText(c.description || '', 500),
    confidence: Number((c.confidence || 0).toFixed(2)),
    reasons: buildReasons(c),
    warnings: buildCandidateWarnings(c),
  }));

  return {
    query: payload.query,
    preferredSites: payload.preferredSites,
    searchProvider: 'serper',
    externalUsage,
    candidates,
    warnings: candidates.length
      ? ['Kết quả enrichment là đề xuất từ web. Nên kiểm tra lại mã, giá và biến thể trước khi lưu catalog.']
      : ['Không tìm thấy ứng viên đủ rõ. Thử nhập tên cụ thể hơn hoặc thêm website nguồn.'],
  };
}

function estimateSerperCalls(payload) {
  return Math.max(1, Math.min(buildSearchQueries(payload.query, payload.preferredSites).length + 1, 10));
}

function buildSearchQueries(query, sites = []) {
  const base = query.replace(/["']/g, ' ');
  if (!sites.length) return [`${base} giá mã sản phẩm`, `${base} sản phẩm nội thất giá`];
  return sites.slice(0, 3).map((site) => `${base} site:${site}`);
}

async function callSerper(kind, apiKey, body, auth, usageTracker) {
  const endpoint = kind === 'images' ? 'https://google.serper.dev/images' : 'https://google.serper.dev/search';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw httpError(response.status, data?.message || `Search provider returned ${response.status}`);
    try {
      const record = await recordExternalApiUsage(auth, {
        provider: 'serper',
        operation: kind === 'images' ? 'product_enrich_images' : 'product_enrich_search',
        units: 1,
        meta: { kind, query: clampText(body?.q, 160), resultCount: countSerperResults(data, kind) },
      });
      if (usageTracker) {
        usageTracker.calls += 1;
        if (kind === 'images') usageTracker.imageCalls += 1;
        else usageTracker.searchCalls += 1;
        usageTracker.estimatedCostUsd = Number((Number(usageTracker.estimatedCostUsd || 0) + Number(record?.estimated_cost_usd || 0)).toFixed(6));
      }
    } catch (trackingError) {
      // Budget was checked before the provider call. Tracking failure should not hide
      // useful search results from the user, but it is logged by the route-level API log.
      if (usageTracker) usageTracker.trackingWarning = trackingError.message || 'external usage tracking failed';
    }
    return data;
  } catch (err) {
    if (err.name === 'AbortError') throw httpError(504, 'Search provider timeout');
    if (err.statusCode) throw err;
    throw httpError(502, err.message || 'Search provider failed');
  } finally {
    clearTimeout(timeout);
  }
}

function countSerperResults(data = {}, kind = 'search') {
  if (kind === 'images') return Array.isArray(data.images) ? data.images.length : 0;
  return (Array.isArray(data.organic) ? data.organic.length : 0) + (Array.isArray(data.shopping) ? data.shopping.length : 0);
}

function extractSerperSearchResults(data = {}, query = '') {
  const out = [];
  for (const item of data.shopping || []) {
    out.push({
      kind: 'shopping',
      query,
      title: item.title || '',
      url: item.link || item.sourceUrl || '',
      imageUrl: item.imageUrl || item.thumbnailUrl || '',
      price: normalizePrice(item.price || item.extractedPrice),
      priceText: String(item.price || '').trim(),
      snippet: item.source || '',
      sourceDomain: item.source || domainOf(item.link),
    });
  }
  for (const item of data.organic || []) {
    out.push({
      kind: 'organic',
      query,
      title: item.title || '',
      url: item.link || '',
      imageUrl: item.imageUrl || '',
      price: normalizePrice(`${item.title || ''} ${item.snippet || ''}`),
      priceText: firstPriceText(`${item.title || ''} ${item.snippet || ''}`),
      snippet: item.snippet || '',
      sourceDomain: domainOf(item.link),
    });
  }
  return uniqueBy(out.filter((r) => r.url), (r) => r.url).slice(0, MAX_SERPER_RESULTS);
}

function extractSerperImages(data = {}) {
  return (data.images || [])
    .map((img) => ({ imageUrl: img.imageUrl || img.thumbnailUrl || '', sourceUrl: img.link || '', title: img.title || '' }))
    .filter((img) => img.imageUrl && !/encrypted-tbn|gstatic\.com\/images\?q=tbn/i.test(img.imageUrl))
    .slice(0, 10);
}

function candidateFromSearchResult(r, payload) {
  return {
    name: cleanName(r.title),
    sku: extractSku(`${r.title || ''} ${r.snippet || ''}`),
    price: normalizePrice(r.price || r.priceText || `${r.title || ''} ${r.snippet || ''}`),
    priceText: r.priceText || firstPriceText(`${r.title || ''} ${r.snippet || ''}`),
    imageUrl: r.imageUrl || '',
    sourceUrl: r.url || '',
    sourceDomain: r.sourceDomain || domainOf(r.url),
    supplier: payload.supplier || '',
    category: payload.category || '',
    description: clampText(r.snippet || '', 500),
    _sourceKind: r.kind || 'search',
  };
}

async function validatePublicUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') throw httpError(400, 'Missing URL');
  let parsed;
  try { parsed = new URL(rawUrl.trim()); }
  catch { throw httpError(400, 'Invalid URL'); }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw httpError(400, 'Only http/https URLs are supported');
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

function isBlockedHostname(hostname = '') {
  const h = hostname.toLowerCase().replace(/\.$/, '');
  return h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal') || h === 'metadata.google.internal';
}

function isPrivateIp(address = '') {
  if (!address) return true;
  if (net.isIP(address) === 4) {
    const p = address.split('.').map((x) => Number(x));
    if (p.length !== 4 || p.some((x) => !Number.isFinite(x))) return true;
    return p[0] === 10 || p[0] === 127 || (p[0] === 169 && p[1] === 254) || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) || (p[0] === 192 && p[1] === 168) || p[0] === 0;
  }
  const h = address.toLowerCase();
  return h === '::1' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80:') || h === '::';
}

async function fetchHtml(url, redirectDepth = 0) {
  if (redirectDepth > REDIRECT_LIMIT) throw httpError(310, 'Too many redirects while fetching product page');
  const parsedUrl = await validatePublicUrl(url);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(parsedUrl.href, {
      signal: controller.signal,
      redirect: 'manual',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; SmartQuoteProductEnrich/1.0)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'vi-VN,vi;q=0.9,en;q=0.8',
      },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location) throw httpError(502, 'Redirect missing Location header');
      const nextUrl = new URL(location, parsedUrl.href).href;
      await validatePublicUrl(nextUrl);
      return fetchHtml(nextUrl, redirectDepth + 1);
    }
    if (!response.ok) throw httpError(response.status, `Upstream returned ${response.status}`);
    const contentType = response.headers.get('content-type') || '';
    if (contentType && !/text\/html|application\/xhtml\+xml|text\/plain/i.test(contentType)) throw httpError(415, 'URL does not look like HTML');
    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength > MAX_HTML_BYTES) throw httpError(413, 'HTML page is too large');
    const buf = Buffer.from(await response.arrayBuffer());
    if (buf.length > MAX_HTML_BYTES) throw httpError(413, 'HTML page is too large');
    return buf.toString('utf8');
  } catch (err) {
    if (err.name === 'AbortError') throw httpError(504, 'Timeout fetching product page');
    if (err.statusCode) throw err;
    throw httpError(500, err.message || 'Fetch failed');
  } finally {
    clearTimeout(timeout);
  }
}

function extractCandidatesFromHtml(html, pageUrl, payload) {
  const candidates = [];
  const jsonProducts = extractJsonLdProducts(html, pageUrl);
  for (const p of jsonProducts) candidates.push({ ...p, supplier: payload.supplier || p.supplier || '', category: payload.category || p.category || '' });
  const meta = extractHtmlMetaCandidate(html, pageUrl, payload);
  if (meta) candidates.push(meta);
  return candidates;
}

function extractJsonLdProducts(html, pageUrl) {
  const out = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    const raw = decodeHtml(stripTags(m[1])).trim();
    if (!raw) continue;
    try {
      const data = JSON.parse(raw);
      const nodes = flattenJsonLd(data);
      for (const node of nodes) {
        if (!looksLikeProductNode(node)) continue;
        const offers = Array.isArray(node.offers) ? node.offers[0] : node.offers || {};
        const image = Array.isArray(node.image) ? node.image[0] : (node.image?.url || node.image);
        const brand = typeof node.brand === 'string' ? node.brand : (node.brand?.name || '');
        out.push({
          name: cleanName(node.name || node.headline || ''),
          sku: cleanSku(node.sku || node.mpn || node.productID || ''),
          price: normalizePrice(offers.price || offers.lowPrice || offers.highPrice || ''),
          priceText: firstPriceText(`${offers.price || ''}`),
          imageUrl: resolveUrl(image || '', pageUrl),
          sourceUrl: pageUrl,
          sourceDomain: domainOf(pageUrl),
          supplier: brand || domainOf(pageUrl),
          category: node.category || '',
          description: clampText(node.description || '', 500),
          _sourceKind: 'jsonld',
        });
      }
    } catch {}
  }
  return out;
}

function flattenJsonLd(data) {
  const out = [];
  const visit = (x) => {
    if (!x) return;
    if (Array.isArray(x)) return x.forEach(visit);
    if (typeof x !== 'object') return;
    out.push(x);
    if (x['@graph']) visit(x['@graph']);
    if (x.itemListElement) visit(x.itemListElement.map((it) => it.item || it));
  };
  visit(data);
  return out;
}

function looksLikeProductNode(node) {
  const type = node?.['@type'];
  const types = Array.isArray(type) ? type.map(String) : [String(type || '')];
  return types.some((t) => /Product/i.test(t)) || (!!node?.offers && !!node?.name);
}

function extractHtmlMetaCandidate(html, pageUrl, payload) {
  const text = decodeHtml(html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' '));
  const title = getMeta(html, 'property', 'og:title') || getMeta(html, 'name', 'twitter:title') || (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '');
  const desc = getMeta(html, 'property', 'og:description') || getMeta(html, 'name', 'description') || '';
  const image = getMeta(html, 'property', 'og:image') || getMeta(html, 'name', 'twitter:image') || extractFirstProductImage(html, pageUrl);
  const priceText = getMeta(html, 'property', 'product:price:amount') || getMeta(html, 'property', 'og:price:amount') || firstPriceText(text);
  const name = cleanName(title || payload.query);
  if (!name) return null;
  return {
    name,
    sku: extractSku(text),
    price: normalizePrice(priceText),
    priceText,
    imageUrl: resolveUrl(image, pageUrl),
    sourceUrl: pageUrl,
    sourceDomain: domainOf(pageUrl),
    supplier: payload.supplier || domainOf(pageUrl),
    category: payload.category || '',
    description: clampText(desc || '', 500),
    _sourceKind: 'html',
  };
}

function getMeta(html, attr, value) {
  const re = new RegExp(`<meta[^>]+${attr}=["']${escapeRegExp(value)}["'][^>]*>`, 'i');
  const tag = html.match(re)?.[0] || '';
  const content = tag.match(/content=["']([^"']+)["']/i)?.[1] || '';
  return decodeHtml(content.trim());
}

function extractFirstProductImage(html, pageUrl) {
  const imgRe = /<img[^>]+(?:src|data-src|data-lazy-src)=["']([^"']+)["'][^>]*>/gi;
  let m;
  while ((m = imgRe.exec(html))) {
    const tag = m[0];
    const src = m[1];
    if (!src || /logo|icon|sprite|avatar|banner|placeholder|loading/i.test(tag + src)) continue;
    const abs = resolveUrl(src, pageUrl);
    if (abs) return abs;
  }
  return '';
}

function mergeCandidates(candidates, query) {
  const map = new Map();
  for (const c of candidates || []) {
    const name = cleanName(c.name);
    if (!name) continue;
    const key = `${domainOf(c.sourceUrl)}:${slugify(name).slice(0, 80)}`;
    const prev = map.get(key);
    if (!prev) { map.set(key, { ...c, name }); continue; }
    map.set(key, {
      ...prev,
      ...c,
      name: betterText(prev.name, name, query),
      sku: prev.sku || c.sku || '',
      price: prev.price || c.price || 0,
      priceText: prev.priceText || c.priceText || '',
      imageUrl: prev.imageUrl || c.imageUrl || '',
      description: prev.description || c.description || '',
    });
  }
  return Array.from(map.values());
}

function scoreCandidate(c, query, sites = []) {
  const tokens = tokenize(query);
  const nameTokens = tokenize(c.name || '');
  const match = tokens.length ? tokens.filter((t) => nameTokens.includes(t)).length / tokens.length : 0;
  let score = 0.22 + match * 0.45;
  if (c.imageUrl) score += 0.12;
  if (c.price) score += 0.1;
  if (c.sku) score += 0.07;
  if (c._sourceKind === 'jsonld') score += 0.08;
  const domain = domainOf(c.sourceUrl);
  if (sites.some((s) => domain.endsWith(s))) score += 0.08;
  return Math.max(0.05, Math.min(score, 0.98));
}

function buildReasons(c) {
  const reasons = [];
  if (c._sourceKind === 'jsonld') reasons.push('Có Product schema');
  if (c.imageUrl) reasons.push('Có ảnh');
  if (c.price) reasons.push('Có giá');
  if (c.sku) reasons.push('Có mã/SKU');
  if (c.sourceUrl) reasons.push(`Nguồn ${domainOf(c.sourceUrl)}`);
  return reasons.slice(0, 5);
}

function buildCandidateWarnings(c) {
  const warnings = [];
  if (!c.sku) warnings.push('Không tìm thấy SKU rõ ràng');
  if (!c.price) warnings.push('Không tìm thấy giá rõ ràng');
  if (!c.imageUrl) warnings.push('Không tìm thấy ảnh rõ ràng');
  return warnings;
}

function tokenize(text = '') {
  return String(text).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').split(/\s+/).filter((t) => t.length >= 2 && !['gia','san','pham','noi','that','cua','cho','the','mau','hang'].includes(t)).slice(0, 12);
}

function cleanName(value = '') {
  return decodeHtml(String(value || '')).replace(/\s*[|\-–—]\s*(mua|giá|sale|khuyến mãi|chính hãng).*$/i, '').replace(/\s+/g, ' ').trim().slice(0, 160);
}

function cleanSku(value = '') {
  return String(value || '').replace(/^\s*(sku|mã sản phẩm|mã|model|mpn)\s*[:#-]?\s*/i, '').replace(/\s+/g, ' ').trim().slice(0, 80);
}

function extractSku(text = '') {
  const t = decodeHtml(String(text || '')).replace(/\s+/g, ' ');
  const patterns = [
    /(?:sku|mã\s*sản\s*phẩm|mã\s*sp|mã|model|mpn)\s*[:#-]?\s*([A-Z0-9][A-Z0-9._\/-]{2,40})/i,
    /\b([A-Z]{2,}[A-Z0-9]*[-_\/][A-Z0-9._\/-]{2,30})\b/,
  ];
  for (const re of patterns) {
    const m = t.match(re);
    if (m?.[1] && !/^(VND|VNĐ|HTML|HTTP|HTTPS)$/i.test(m[1])) return cleanSku(m[1]);
  }
  return '';
}

function firstPriceText(text = '') {
  const m = String(text || '').match(/(?:₫|đ|vnd)?\s*\d{1,3}(?:[.,]\d{3}){1,5}(?:\s*(?:₫|đ|vnd))?/i);
  return m ? m[0].trim() : '';
}

function normalizePrice(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
  const raw = firstPriceText(value) || String(value || '');
  if (!raw) return 0;
  const cleaned = raw.replace(/[^0-9.,]/g, '');
  const matches = cleaned.match(/\d{1,3}(?:[.,]\d{3})+|\d+/g) || [];
  if (!matches.length) return 0;
  const nums = matches.map((m) => Number(m.replace(/[.,]/g, ''))).filter((n) => Number.isFinite(n));
  const price = nums.find((n) => n >= 1000) || nums[0] || 0;
  return Math.round(price);
}

function resolveUrl(value, base) {
  const v = String(value || '').trim();
  if (!v || /^data:/i.test(v)) return '';
  try { return new URL(v, base).href; }
  catch { return ''; }
}

function domainOf(url = '') {
  try { return new URL(url).hostname.replace(/^www\./, ''); }
  catch { return ''; }
}

function slugify(text = '') {
  return String(text).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function betterText(a, b, query) {
  const score = (x) => tokenize(query).filter((t) => tokenize(x).includes(t)).length * 10 - Math.abs(String(x).length - String(query).length) / 20;
  return score(b) > score(a) ? b : a;
}

function uniqueBy(items, keyFn) {
  const seen = new Set();
  const out = [];
  for (const item of items || []) {
    const key = keyFn(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function stripTags(value = '') {
  return String(value || '').replace(/<[^>]+>/g, ' ');
}

function decodeHtml(s = '') {
  return String(s || '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&ndash;|&#8211;/g, '–')
    .replace(/&mdash;|&#8212;/g, '—')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => {
      try { return String.fromCharCode(Number(n)); } catch { return _; }
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => {
      try { return String.fromCharCode(parseInt(n, 16)); } catch { return _; }
    });
}

function escapeRegExp(value = '') {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
