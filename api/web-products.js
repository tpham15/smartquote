// Vercel Serverless — cào danh sách sản phẩm từ URL web công khai.
// Không dùng dependency ngoài; ưu tiên schema.org JSON-LD, sau đó fallback HTML heuristic.
import dns from 'node:dns/promises';
import net from 'node:net';

const MAX_HTML_BYTES = 2_500_000;
const MAX_ITEMS = 300;
const MAX_CRAWL_PAGES = 32;
const CRAWL_CONCURRENCY = 5;
const FETCH_TIMEOUT_MS = 12000;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { url, supplier = '', limit = MAX_ITEMS, crawl = true, maxPages = MAX_CRAWL_PAGES } = req.body || {};
    const target = await validatePublicUrl(url);
    const itemLimit = Math.max(1, Math.min(Number(limit) || MAX_ITEMS, MAX_ITEMS));
    const pageLimit = Math.max(1, Math.min(Number(maxPages) || MAX_CRAWL_PAGES, MAX_CRAWL_PAGES));

    const result = await scrapeCatalogUrl(target.href, {
      supplier,
      limit: itemLimit,
      crawl: crawl !== false,
      maxPages: pageLimit,
    });

    return res.status(200).json({
      ok: true,
      sourceUrl: target.href,
      hostname: target.hostname,
      siteName: result.siteName,
      engine: 'web-scrape-v6-strict-product-list-crawl',
      count: result.items.length,
      pagesScanned: result.pagesScanned,
      crawlPages: result.pageSummaries,
      items: result.items,
      warnings: buildWarnings(result.items, result.combinedHtml, result),
    });
  } catch (err) {
    const status = err.statusCode || 500;
    return res.status(status).json({ error: err.message || 'Scrape failed' });
  }
}

function httpError(statusCode, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

async function validatePublicUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') throw httpError(400, 'Missing url');
  let parsed;
  try { parsed = new URL(rawUrl.trim()); }
  catch { throw httpError(400, 'Invalid URL'); }

  if (!['http:', 'https:'].includes(parsed.protocol)) throw httpError(400, 'Only http/https URLs are supported');
  if (!parsed.hostname || parsed.username || parsed.password) throw httpError(400, 'Invalid public URL');
  if (isBlockedHostname(parsed.hostname)) throw httpError(400, 'Private/internal URLs are not allowed');

  const ipLiteral = net.isIP(parsed.hostname) ? parsed.hostname : '';
  if (ipLiteral && isPrivateIp(ipLiteral)) throw httpError(400, 'Private/internal IPs are not allowed');

  // DNS guardrail chống SSRF cơ bản. Nếu DNS fail, cứ để fetch trả lỗi rõ ràng hơn.
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
    if (p.length !== 4 || p.some((x) => !Number.isFinite(x))) return true;
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

async function fetchHtml(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; SmartQuoteBot/1.0; +https://smartquote.local)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'vi-VN,vi;q=0.9,en;q=0.8',
      },
    });
    clearTimeout(timeout);
    if (!response.ok) throw httpError(response.status, `Upstream returned ${response.status}`);
    const contentType = response.headers.get('content-type') || '';
    if (contentType && !/text\/html|application\/xhtml\+xml|text\/plain/i.test(contentType)) {
      throw httpError(415, 'URL does not look like an HTML product page');
    }
    const buf = Buffer.from(await response.arrayBuffer());
    if (buf.length > MAX_HTML_BYTES) throw httpError(413, 'HTML page is too large to scrape safely');
    return buf.toString('utf8');
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') throw httpError(504, 'Timeout fetching URL');
    if (err.statusCode) throw err;
    throw httpError(500, err.message || 'Fetch failed');
  }
}

async function scrapeCatalogUrl(sourceUrl, opts = {}) {
  const visited = new Set();
  const queued = new Set();
  const pages = [];
  const allItems = [];

  const addQueue = (rawUrl, baseUrl = sourceUrl) => {
    const normalized = normalizeCrawlUrl(rawUrl, baseUrl, sourceUrl);
    if (!normalized) return;
    if (visited.has(normalized) || queued.has(normalized)) return;
    if (queued.size + visited.size >= Math.max(1, opts.maxPages || MAX_CRAWL_PAGES) * 3) return;
    queued.add(normalized);
  };

  const readPage = async (pageUrl, depth = 0) => {
    const normalized = normalizeCrawlUrl(pageUrl, sourceUrl, sourceUrl);
    if (!normalized || visited.has(normalized)) return null;
    visited.add(normalized);
    const html = await fetchHtml(normalized);
    const pageItems = extractProductsFromHtml(html, normalized, { ...opts, limit: opts.limit || MAX_ITEMS });
    const pageTitle = extractPageTitle(html, normalized);
    pages.push({ url: normalized, html, count: pageItems.length, depth, title: pageTitle });
    allItems.push(...pageItems.map((item) => ({ ...item, crawledFrom: normalized })));

    if (opts.crawl !== false && pages.length < (opts.maxPages || MAX_CRAWL_PAGES)) {
      for (const link of extractCatalogCrawlLinks(html, normalized, sourceUrl)) addQueue(link.url, normalized);
    }
    return { html, items: pageItems };
  };

  const first = await readPage(sourceUrl, 0);

  while (opts.crawl !== false && queued.size && pages.length < (opts.maxPages || MAX_CRAWL_PAGES)) {
    const batch = [...queued].slice(0, Math.min(CRAWL_CONCURRENCY, (opts.maxPages || MAX_CRAWL_PAGES) - pages.length));
    batch.forEach((u) => queued.delete(u));
    const settled = await Promise.allSettled(batch.map((u) => readPage(u, 1)));
    // Bỏ qua trang crawl fail; vẫn trả các sản phẩm đã đọc được.
    for (const r of settled) {
      if (r.status === 'rejected') continue;
    }
    if (allItems.length >= (opts.limit || MAX_ITEMS) && pages.length >= 4) break;
  }

  const items = dedupeItems(allItems).slice(0, opts.limit || MAX_ITEMS);
  return {
    items,
    pagesScanned: pages.length,
    siteName: extractSiteName(first?.html || '', new URL(sourceUrl).hostname),
    combinedHtml: pages.map((p) => p.html.slice(0, 180000)).join('\n'),
    pageSummaries: pages.map((p) => ({ url: p.url, count: p.count, title: p.title })).slice(0, 40),
  };
}

function extractPageTitle(html, fallbackUrl = '') {
  const h1 = String(html || '').match(/<h1[^>]*>([\s\S]{1,160}?)<\/h1>/i);
  if (h1) return cleanName(h1[1]);
  const title = String(html || '').match(/<title[^>]*>([\s\S]{1,160}?)<\/title>/i);
  if (title) return cleanName(title[1]);
  try { return new URL(fallbackUrl).pathname || fallbackUrl; } catch { return fallbackUrl; }
}

function extractCatalogCrawlLinks(html, pageUrl, rootUrl) {
  const cleaned = String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ');
  const anchors = [];
  const anchorRe = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = anchorRe.exec(cleaned))) {
    const attrs = m[1] || '';
    const href = attrValue(attrs, 'href');
    const rel = attrValue(attrs, 'rel');
    const klass = attrValue(attrs, 'class');
    const text = cleanName(stripTags(m[2] || '') || attrValue(attrs, 'title') || attrValue(attrs, 'aria-label'));
    anchors.push({ index: m.index, end: anchorRe.lastIndex, href, text, rel, klass });
  }

  const out = [];
  const seen = new Set();
  for (let i = 0; i < anchors.length; i++) {
    const a = anchors[i];
    const url = normalizeCrawlUrl(a.href, pageUrl, rootUrl);
    if (!url) continue;
    if (url === normalizeCrawlUrl(pageUrl, pageUrl, rootUrl)) continue;
    if (seen.has(url)) continue;

    const nextAnchorStart = anchors[i + 1]?.index ?? cleaned.length;
    const after = cleaned.slice(a.end, Math.min(nextAnchorStart, a.end + 550));
    const nearbyText = visibleText(after);
    const productPriceNearby = !!parsePrice(nearbyText);

    const isMore = /^xem\s*th[eê]m$/i.test(a.text);
    const isPagination = isPaginationLink(a, url, pageUrl);
    const isCategory = isProbablyCategoryLink(a.text, url);

    // Link sản phẩm trên grid thường có giá ngay sau anchor. Không crawl từng detail page vì chậm,
    // chỉ crawl category/subcategory/pagination để lấy đủ danh sách.
    if (!isPagination && !isMore && productPriceNearby) continue;
    if (!isMore && !isPagination && !isCategory) continue;

    seen.add(url);
    out.push({ url, text: a.text, reason: isPagination ? 'pagination' : isMore ? 'more' : 'category' });
  }
  return out;
}

function normalizeCrawlUrl(rawUrl, baseUrl, rootUrl) {
  const raw = String(rawUrl || '').trim();
  if (!raw || raw.startsWith('#') || /^(mailto:|tel:|javascript:|data:|blob:)/i.test(raw)) return '';
  let url;
  let root;
  try {
    url = new URL(decodeHtmlEntities(raw), baseUrl);
    root = new URL(rootUrl || baseUrl);
  } catch {
    return '';
  }
  if (!['http:', 'https:'].includes(url.protocol)) return '';
  if (url.hostname !== root.hostname) return '';
  if (isBlockedHostname(url.hostname) || (net.isIP(url.hostname) && isPrivateIp(url.hostname))) return '';
  if (/\.(?:jpg|jpeg|png|webp|gif|svg|pdf|zip|rar|docx?|xlsx?|pptx?|mp4|mp3)(?:$|[?#])/i.test(url.pathname)) return '';
  if (/\/(?:cart|checkout|gio-hang|thanh-toan|my-account|tai-khoan|wp-admin|wp-json|feed)\b/i.test(url.pathname)) return '';
  url.hash = '';
  // Giữ lại query phân trang; bỏ tracking/sort/filter để tránh crawl vô hạn.
  const keep = new URLSearchParams();
  for (const [k, v] of url.searchParams.entries()) {
    if (/^(paged?|product-page)$/i.test(k) && /^\d{1,4}$/.test(v)) keep.set(k, v);
  }
  url.search = keep.toString();
  return url.href.replace(/\/$/, '');
}

function isPaginationLink(anchor = {}, url = '', pageUrl = '') {
  const text = cleanName(anchor.text || '');
  const klass = String(anchor.klass || '').toLowerCase();
  const rel = String(anchor.rel || '').toLowerCase();
  if (/^(?:\d{1,3}|next|prev|sau|trước|›|»|←|→)$/.test(text.toLowerCase())) return true;
  if (/\b(next|prev)\b/.test(rel) || /page-numbers|pagination|paginate/.test(klass)) return true;
  try {
    const u = new URL(url);
    const p = new URL(pageUrl);
    if (u.hostname !== p.hostname) return false;
    if (/\/page\/\d+\/?$/i.test(u.pathname)) return true;
    if ([...u.searchParams.keys()].some((k) => /^(paged?|product-page)$/i.test(k))) return true;
  } catch {}
  return false;
}

function isProbablyCategoryLink(text = '', url = '') {
  const raw = cleanName(text);
  const t = normalizeVietnamese(raw);
  if (!t || t.length > 80) return false;
  if (/\b(gioi thieu|giai phap|tin tuc|doi tac|tuyen dung|lien he|catalog|video|nha phan phoi|trang chu|menu|search|tim kiem|tieng viet|tieng anh)\b/.test(t)) return false;
  if (isSpecificProductAnchorText(raw)) return false;

  // Nhóm category phổ biến. Cố tình chặt hơn bản cũ để không crawl trang chi tiết sản phẩm.
  const broadCategory = /\b(cong tac|den led|den ngoai troi|den san vuon|den gan tuong|cam bien|khoa cua|bo dieu khien|hong ngoai|rem cua|o cam|o mang|wallpad|aptomat|module|thiet bi dien thong minh|bluetooth|zigbee|wifi|downlight|spotlight|ray nam cham)\b/.test(t);
  if (!broadCategory) return false;

  try {
    const path = normalizeVietnamese(new URL(url).pathname.replace(/[\/_-]+/g, ' '));
    const slugLooksLikeText = t.split(' ').every((w) => w.length < 2 || path.includes(w));
    const explicitCategoryPath = /\b(category|product category|danh muc|san pham|thiet bi dien thong minh)\b/.test(path);
    return explicitCategoryPath || slugLooksLikeText;
  } catch {
    return true;
  }
}

function isSpecificProductAnchorText(text = '') {
  const s = cleanName(text);
  const t = normalizeVietnamese(s);
  if (!t) return false;
  // Product detail names thường có model/spec/separator; category thường ngắn và rộng.
  if (/[|,()]/.test(s)) return true;
  if (/\d/.test(s)) return true;
  if (/\b(luto|lumes|luso|daikin|meanwell|premium|hub|mesh|ble|rgbww|tunable|dimmable|chong giat|cua cuon|binh nong lanh|nut xoay|kinh phang|vien bo|vien thang|am tran|gan noi|khong vien)\b/.test(t)) return true;
  return false;
}

function normalizeVietnamese(value = '') {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}


export function __testExtractProductsFromHtml(html, sourceUrl = 'https://example.com/', opts = {}) {
  return extractProductsFromHtml(html, sourceUrl, { limit: MAX_ITEMS, ...opts });
}

function extractProductsFromHtml(html, sourceUrl, opts = {}) {
  const jsonLd = extractJsonLdProducts(html, sourceUrl, opts);
  const nextData = extractEmbeddedJsonProducts(html, sourceUrl, opts);
  const htmlCards = extractHtmlCardProducts(html, sourceUrl, opts);

  const all = [...jsonLd, ...nextData, ...htmlCards]
    .filter((item) => item && (item.name || item.sku) && (Number(item.price || 0) > 0 || item.image || item.sku));

  return dedupeItems(all).slice(0, opts.limit || MAX_ITEMS);
}

function extractJsonLdProducts(html, sourceUrl, opts = {}) {
  const out = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) && out.length < (opts.limit || MAX_ITEMS)) {
    const raw = decodeHtmlEntities(stripCdata(m[1])).trim();
    for (const json of parseJsonLoose(raw)) {
      collectSchemaProducts(json, out, sourceUrl, opts);
    }
  }
  return out;
}

function extractEmbeddedJsonProducts(html, sourceUrl, opts = {}) {
  const out = [];
  const patterns = [
    /<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i,
    /<script[^>]+id=["']__NUXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i,
  ];
  for (const re of patterns) {
    const m = re.exec(html);
    if (!m) continue;
    for (const json of parseJsonLoose(decodeHtmlEntities(stripCdata(m[1])).trim())) {
      collectGenericProducts(json, out, sourceUrl, opts, 0);
    }
  }
  return out;
}

function extractHtmlCardProducts(html, sourceUrl, opts = {}) {
  // Phase v6: ưu tiên “product list/card” có cấu trúc.
  // Không quét toàn bộ visible text khi đã có danh sách sản phẩm rõ ràng, vì các trang SEO như Lumi
  // có phần bài viết dài phía dưới; fallback text từng nhầm mô tả/đoạn marketing thành sản phẩm.
  const linked = extractLinkedPriceProducts(html, sourceUrl, opts);
  const cards = extractStructuredCardProducts(html, sourceUrl, opts);
  const strong = dedupeItems([...linked, ...cards]);

  if (strong.length >= 2 || hasProductListSignals(html)) {
    return strong;
  }

  const out = [...strong];
  // Chỉ dùng fallback text khi thật sự không tìm thấy card/link sản phẩm.
  // Fallback này dành cho website rất đơn giản, không dành cho phần bài viết SEO/description.
  out.push(...extractVisibleTextProducts(html, sourceUrl, opts));

  if (out.length < 3 && !isLikelySeoArticlePage(html)) {
    const text = visibleText(html);
    const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
    for (const line of lines) {
      if (out.length >= (opts.limit || MAX_ITEMS)) break;
      const price = parsePrice(line);
      if (!price || !looksLikeProductLine(line)) continue;
      const name = removePriceFragments(line);
      if (looksLikeProductName(name)) out.push(toItem({ name, price: price.value, rawText: line, sourceUrl, opts, confidence: 0.45 }));
    }
  }
  return out;
}

function extractStructuredCardProducts(html, sourceUrl, opts = {}) {
  const out = [];
  const compact = String(html || '').replace(/\n/g, ' ');

  // Ưu tiên các node thường là card sản phẩm thật. Tránh regex quá rộng trên div class="product..."
  // vì trang chi tiết có nhiều block mô tả cũng chứa chữ product/price.
  const strictCardRe = /<(li|article)\b[^>]*(?:class|id)=["'][^"']*(?:product|san-pham|woocommerce)[^"']*["'][^>]*>([\s\S]{40,9000}?)<\/\1>/gi;
  let m;
  while ((m = strictCardRe.exec(compact)) && out.length < (opts.limit || MAX_ITEMS) * 3) {
    const item = productFromHtmlBlock(m[2], sourceUrl, opts);
    if (item) out.push(item);
  }

  // Generic div chỉ được dùng khi block có tín hiệu card mạnh: có link + ảnh + giá trong phạm vi ngắn.
  const divCardRe = /<div\b[^>]*(?:class|id)=["'][^"']*(?:product-small|product-card|product-item|product-grid|product-loop|wc-block-grid__product|item-product|san-pham)[^"']*["'][^>]*>([\s\S]{80,7000}?)<\/div>/gi;
  while ((m = divCardRe.exec(compact)) && out.length < (opts.limit || MAX_ITEMS) * 3) {
    const block = m[1];
    if (!/<a\b/i.test(block) || !/<img\b/i.test(block) || !/(?:class=["'][^"']*price|₫|\bvnđ\b|\bvnd\b)/i.test(block)) continue;
    const item = productFromHtmlBlock(block, sourceUrl, opts);
    if (item) out.push(item);
  }
  return out;
}

function hasProductListSignals(html = '') {
  const s = String(html || '');
  const productClassHits = (s.match(/class=["'][^"']*(?:products|product-small|product-card|product-item|woocommerce-loop-product|wc-block-grid__product|add_to_cart_button)[^"']*["']/gi) || []).length;
  const priceHits = (s.match(/(?:₫|\bvnđ\b|\bvnd\b|class=["'][^"']*price)/gi) || []).length;
  const linkedProductHits = (s.match(/<a\b[^>]+href=["'][^"']+\.html["'][^>]*>[\s\S]{0,220}?(?:Công tắc|Đèn|Cảm biến|Module|Ổ cắm|Aptomat|Khóa|Rèm|Wallpad|Bộ điều khiển)/gi) || []).length;
  return (productClassHits >= 2 && priceHits >= 2) || (linkedProductHits >= 3 && priceHits >= 3);
}

function isLikelySeoArticlePage(html = '') {
  const text = visibleText(html).slice(0, 9000);
  const headingHits = (text.match(/\n\s*(?:#{1,4}\s*)?\d+(?:\.\d+)*\.\s+/g) || []).length;
  return headingHits >= 3 || /(?:mục lục|lợi ích|lưu ý khi lựa chọn|thiết bị điện thông minh là gì|thương hiệu smarthome|cải thiện chất lượng cuộc sống)/i.test(text);
}

function extractLinkedPriceProducts(html, sourceUrl, opts = {}) {
  const out = [];
  const cleaned = String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ');
  const anchorRe = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  const anchors = [];
  let m;
  while ((m = anchorRe.exec(cleaned))) {
    const href = attrValue(m[1], 'href');
    const title = attrValue(m[1], 'title') || attrValue(m[1], 'aria-label');
    const innerText = cleanName(stripTags(m[2]));
    const imgAlt = cleanName((m[2].match(/<img[^>]+(?:alt|title)=["']([^"']{3,180})["']/i) || [])[1] || '');
    const image = extractBestImage(m[0], sourceUrl);
    const imageOnly = !innerText && !!imgAlt;
    const text = cleanName(title || innerText || imgAlt);
    anchors.push({ index: m.index, end: anchorRe.lastIndex, href, text, html: m[0], imageOnly, image });
  }

  for (let i = 0; i < anchors.length && out.length < (opts.limit || MAX_ITEMS) * 2; i++) {
    const a = anchors[i];
    if (!looksLikeProductName(a.text)) continue;
    if (a.imageOnly) continue;
    if (isProbablyNavLink(a.text, a.href)) continue;

    const nextAnchorStart = anchors[i + 1]?.index ?? cleaned.length;
    const windowEnd = Math.min(cleaned.length, a.end + 700, nextAnchorStart);
    const slice = cleaned.slice(a.end, windowEnd);
    const textSlice = visibleText(slice);
    const price = parsePrice(textSlice);
    if (!price) continue;

    // Nếu trước giá đã xuất hiện một link có text sản phẩm khác, giá đó nhiều khả năng thuộc sản phẩm kế tiếp.
    const pricePos = textSlice.indexOf(price.raw);
    const rawBeforePrice = pricePos >= 0 ? textSlice.slice(0, pricePos) : textSlice;
    if (/\S{3,}/.test(rawBeforePrice) && anchors[i + 1]?.index < a.end + slice.length && anchors[i + 1].index < a.end + Math.max(60, slice.indexOf(price.raw))) continue;

    out.push(toItem({
      name: a.text,
      price: price.value,
      image: extractBestImage(a.html + slice, sourceUrl) || nearestAnchorImage(anchors, i, cleaned, sourceUrl),
      url: absoluteUrl(a.href, sourceUrl),
      rawText: `${a.text} ${textSlice}`.trim(),
      sourceUrl,
      opts,
      confidence: 0.66,
    }));
  }
  return out;
}

function extractVisibleTextProducts(html, sourceUrl, opts = {}) {
  const out = [];
  const lines = visibleText(html)
    .split('\n')
    .map((line) => cleanName(line))
    .filter(Boolean);

  let currentCategory = '';
  for (let i = 0; i < lines.length && out.length < (opts.limit || MAX_ITEMS) * 2; i++) {
    const line = lines[i];
    if (isCategoryHeading(line, lines[i + 1])) {
      currentCategory = line;
      continue;
    }
    if (!looksLikeProductName(line)) continue;
    if (isProbablyNavLine(line) || /^hết hàng$/i.test(line)) continue;
    if (/^xem thêm$/i.test(lines[i + 1] || '')) continue;

    const search = [lines[i + 1], lines[i + 2], lines[i + 3]].filter(Boolean);
    let price = null;
    let priceLine = '';
    for (const candidate of search) {
      if (looksLikeSectionBreak(candidate)) break;
      price = parsePrice(candidate);
      if (price) { priceLine = candidate; break; }
    }
    if (!price) continue;

    out.push(toItem({
      name: line,
      price: price.value,
      category: currentCategory,
      rawText: `${line} ${priceLine}`.trim(),
      sourceUrl,
      opts,
      confidence: 0.62,
    }));
  }
  return out;
}

function collectSchemaProducts(node, out, sourceUrl, opts = {}) {
  if (!node || out.length >= (opts.limit || MAX_ITEMS)) return;
  if (Array.isArray(node)) {
    for (const x of node) collectSchemaProducts(x, out, sourceUrl, opts);
    return;
  }
  if (typeof node !== 'object') return;

  const type = Array.isArray(node['@type']) ? node['@type'].join(' ') : String(node['@type'] || '');
  if (/Product/i.test(type)) {
    out.push(toItem({
      name: pickText(node.name, node.headline),
      sku: pickText(node.sku, node.mpn, node.productID, node.model),
      brand: normalizeBrand(node.brand || node.manufacturer),
      category: pickText(node.category),
      description: stripTags(pickText(node.description)),
      image: normalizeImage(node.image),
      price: offerPrice(node.offers),
      url: absoluteUrl(pickText(node.url), sourceUrl),
      rawText: pickText(node.name, node.sku, node.description),
      sourceUrl,
      opts,
      confidence: 0.86,
    }));
  }

  for (const key of ['@graph', 'itemListElement', 'hasVariant', 'isVariantOf', 'offers', 'mainEntity', 'mainEntityOfPage']) {
    if (node[key]) collectSchemaProducts(node[key], out, sourceUrl, opts);
  }
  if (type.includes('ItemList') && Array.isArray(node.itemListElement)) {
    for (const el of node.itemListElement) collectSchemaProducts(el.item || el, out, sourceUrl, opts);
  }
}

function collectGenericProducts(node, out, sourceUrl, opts = {}, depth = 0) {
  if (!node || depth > 8 || out.length >= (opts.limit || MAX_ITEMS)) return;
  if (Array.isArray(node)) {
    const productish = node.filter((x) => x && typeof x === 'object' && (x.name || x.title || x.productName) && (x.price || x.salePrice || x.regularPrice || x.image || x.sku));
    if (productish.length >= 2) {
      for (const x of productish) {
        if (out.length >= (opts.limit || MAX_ITEMS)) break;
        out.push(toItem({
          name: pickText(x.name, x.title, x.productName),
          sku: pickText(x.sku, x.code, x.model, x.mpn),
          brand: normalizeBrand(x.brand || x.manufacturer),
          category: pickText(x.category, x.categoryName),
          description: pickText(x.description, x.shortDescription, x.summary),
          image: normalizeImage(x.image || x.images || x.thumbnail || x.featuredImage),
          price: parsePriceValue(x.price || x.salePrice || x.finalPrice || x.regularPrice || x.priceNumber),
          url: absoluteUrl(pickText(x.url, x.slug, x.path, x.href), sourceUrl),
          rawText: pickText(x.name, x.title, x.sku, x.price),
          sourceUrl,
          opts,
          confidence: 0.68,
        }));
      }
      return;
    }
    for (const x of node) collectGenericProducts(x, out, sourceUrl, opts, depth + 1);
    return;
  }
  if (typeof node !== 'object') return;
  for (const value of Object.values(node)) collectGenericProducts(value, out, sourceUrl, opts, depth + 1);
}

function productFromHtmlBlock(block, sourceUrl, opts = {}) {
  const rawText = visibleText(block).replace(/\n+/g, ' · ');
  const price = parsePrice(rawText);
  const name = findNameInBlock(block, rawText, price?.raw);
  const sku = findSku(rawText);
  if (!name || /giỏ hàng|thêm vào|xem nhanh|mua ngay|add to cart/i.test(name)) return null;
  if (!price?.value && !sku) return null;

  return toItem({
    name,
    sku,
    price: price?.value || 0,
    image: extractBestImage(block, sourceUrl),
    url: extractFirstLink(block, sourceUrl),
    rawText,
    sourceUrl,
    opts,
    confidence: price?.value ? 0.58 : 0.42,
  });
}

function findNameInBlock(block, rawText, priceRaw = '') {
  const candidates = [];

  // Ưu tiên text/title trong link sản phẩm. Không lấy alt ảnh nếu alt chỉ là "– 1.404.000đ...".
  const anchorRe = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let a;
  while ((a = anchorRe.exec(block))) {
    const attrs = a[1] || '';
    const inner = a[2] || '';
    candidates.push({ value: attrValue(attrs, 'title'), source: 'a-title' });
    candidates.push({ value: attrValue(attrs, 'aria-label'), source: 'a-aria' });
    candidates.push({ value: stripTags(inner), source: 'a-text' });
  }

  const imgRe = /<img\b([^>]*)>/gi;
  let im;
  while ((im = imgRe.exec(block))) {
    const attrs = im[1] || '';
    candidates.push({ value: attrValue(attrs, 'alt'), source: 'img-alt' });
    candidates.push({ value: attrValue(attrs, 'title'), source: 'img-title' });
  }

  const best = candidates
    .map((c) => cleanName(c.value))
    .find((x) => x && !isBadNameCandidate(x) && looksLikeProductName(x));
  if (best) return best;

  const lines = visibleText(block).split('\n').map(cleanName).filter(Boolean);
  const good = lines.find((line) => line.length >= 4 && line.length <= 160 && !isBadNameCandidate(line) && !/mua ngay|thêm vào|giỏ hàng|xem nhanh|chi tiết/i.test(line));
  if (good) return good;
  if (priceRaw) {
    const recovered = cleanName(rawText.replace(priceRaw, '').split('·')[0]);
    return isBadNameCandidate(recovered) ? '' : recovered;
  }
  const first = cleanName(rawText.split('·')[0]);
  return isBadNameCandidate(first) ? '' : first;
}


function isBadNameCandidate(value = '') {
  const s = cleanName(value);
  const low = s.toLowerCase();
  if (!s) return true;
  if (/^(image|banner|flag icon|logo|placeholder)$/i.test(s)) return true;
  if (/khoảng\s*giá|gia\s*tu|giá\s*từ|₫|\bvnd\b|\bvnđ\b/i.test(low)) return true;
  if (/^[–—-]\s*\d/.test(s)) return true;
  if (s.length < 4 || s.length > 155) return true;
  if (isLikelyMarketingText(s)) return true;
  return false;
}

function toItem({ name, sku = '', brand = '', category = '', description = '', image = '', price = 0, url = '', rawText = '', sourceUrl, opts = {}, confidence = 0.7 }) {
  const n = cleanName(name);
  const p = Number(price || 0) || 0;
  return {
    name: n,
    sku: cleanSku(sku || findSku(`${n} ${rawText}`)),
    brand: cleanName(brand),
    supplier: cleanName(opts.supplier || brand || ''),
    category: cleanName(category) || 'Web catalog',
    description: cleanDescription(description),
    image: absoluteUrl(image, sourceUrl),
    price: p,
    listPrice: p,
    publicPrice: p,
    url: absoluteUrl(url || sourceUrl, sourceUrl),
    rawText: rawText || n,
    confidence,
    issues: p > 0 ? [] : [{ code: 'missing_price', level: 'warning', message: 'Không thấy giá trên web, cần kiểm tra thủ công', field: 'costPrice' }],
  };
}

function dedupeItems(items = []) {
  const seen = new Map();
  const out = [];
  for (const item of items) {
    const key = dedupeKey(item);
    if (!key || key.length < 3) continue;
    if (seen.has(key)) {
      const idx = seen.get(key);
      out[idx] = chooseBetter(out[idx], item);
    } else {
      seen.set(key, out.length);
      out.push(item);
    }
  }
  return out;
}

function dedupeKey(item = {}) {
  // Không dùng URL category page làm khóa chính.
  // Bản v2 đã để url mặc định = sourceUrl cho các dòng text fallback,
  // khiến hàng chục sản phẩm trên cùng một trang bị gộp thành 1 dòng.
  // Với web category, tên sản phẩm là tín hiệu ổn định nhất; SKU/URL chỉ là fallback.
  const nameKey = normalizeDedupeText(item.name);
  if (nameKey) return `name:${nameKey}`;
  const skuKey = normalizeDedupeText(item.sku);
  if (skuKey) return `sku:${skuKey}`;
  const urlKey = normalizeDedupeUrl(item.url);
  if (urlKey) return `url:${urlKey}`;
  return '';
}

function normalizeDedupeText(value = '') {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, 140);
}

function normalizeDedupeUrl(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const u = new URL(raw);
    u.hash = '';
    // Bỏ query tracking; URL chỉ dùng fallback khi không có tên.
    [...u.searchParams.keys()].forEach((k) => { if (/^(utm_|fbclid|gclid)/i.test(k)) u.searchParams.delete(k); });
    return u.href.toLowerCase().replace(/[\s]+/g, '');
  } catch {
    return raw.toLowerCase().replace(/[\s]+/g, '');
  }
}

function chooseBetter(a, b) {
  const sa = (a.price ? 2 : 0) + (a.image ? 1 : 0) + (a.sku ? 1 : 0) + (a.description ? 1 : 0) + Number(a.confidence || 0);
  const sb = (b.price ? 2 : 0) + (b.image ? 1 : 0) + (b.sku ? 1 : 0) + (b.description ? 1 : 0) + Number(b.confidence || 0);
  return sb > sa ? { ...a, ...b } : { ...b, ...a };
}

function buildWarnings(items, html, result = {}) {
  const warnings = [];
  if (!items.length) warnings.push('Không trích được sản phẩm rõ ràng. Website có thể render bằng JS hoặc chặn bot. Hãy thử trang danh mục có HTML tĩnh hoặc import Excel/PDF.');
  else if (items.length < 3) warnings.push('Chỉ trích được ít sản phẩm; có thể đây là trang chi tiết hoặc web render bằng JavaScript.');
  if (/cloudflare|enable javascript|window\.__NUXT__|data-reactroot/i.test(html) && items.length < 5) {
    warnings.push('Trang có dấu hiệu render bằng JavaScript; scraper chỉ đọc HTML server trả về nên có thể thiếu sản phẩm.');
  }
  if (result.pagesScanned > 1) warnings.push(`Đã đọc ${result.pagesScanned} trang category/pagination để gom đủ sản phẩm.`);
  if (result.pagesScanned >= MAX_CRAWL_PAGES) warnings.push(`Đã chạm giới hạn ${MAX_CRAWL_PAGES} trang crawl; nếu web còn nhiều trang, tăng maxPages trong API.`);
  return warnings;
}

function parseJsonLoose(raw) {
  const out = [];
  if (!raw) return out;
  try { out.push(JSON.parse(raw)); return out; } catch {}
  // Một số site đặt nhiều JSON-LD object liên tiếp.
  const chunks = raw.split(/\s*(?=\{\s*"@context"|\[\s*\{\s*"@context")/g).filter(Boolean);
  for (const c of chunks) {
    try { out.push(JSON.parse(c)); } catch {}
  }
  return out;
}

function stripCdata(s) {
  return String(s || '').replace(/^\s*<!\[CDATA\[/, '').replace(/\]\]>\s*$/, '');
}

function visibleText(html) {
  return decodeHtmlEntities(String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<(br|\/p|\/li|\/div|\/article|\/h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\r/g, '\n')
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/\n\s+/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim());
}

function stripTags(s) {
  return visibleText(String(s || '')).replace(/\n+/g, ' ');
}

const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  ndash: '–', mdash: '—', hellip: '…', laquo: '«', raquo: '»',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', times: '×', reg: '®', copy: '©', trade: '™', deg: '°',
};

function decodeHtmlEntities(str) {
  let out = String(str || '');
  for (let pass = 0; pass < 3; pass++) {
    const prev = out;
    out = out
      .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
      .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
      .replace(/&([a-z][a-z0-9]+);/gi, (m, name) => NAMED_ENTITIES[name.toLowerCase()] ?? m);
    if (out === prev) break;
  }
  return out;
}

function pickText(...values) {
  for (const v of values) {
    if (v == null) continue;
    if (typeof v === 'string' || typeof v === 'number') {
      const t = String(v).trim();
      if (t) return t;
    } else if (typeof v === 'object') {
      const t = pickText(v.name, v.title, v.value, v['@id']);
      if (t) return t;
    }
  }
  return '';
}

function normalizeBrand(v) {
  if (Array.isArray(v)) return normalizeBrand(v[0]);
  if (v && typeof v === 'object') return pickText(v.name, v.title, v.brand);
  return pickText(v);
}

function normalizeImage(v) {
  if (Array.isArray(v)) return normalizeImage(v[0]);
  if (v && typeof v === 'object') return pickText(v.url, v.contentUrl, v.src, v.secure_url);
  return pickText(v);
}

function offerPrice(offers) {
  if (Array.isArray(offers)) return offerPrice(offers[0]);
  if (!offers || typeof offers !== 'object') return parsePriceValue(offers);
  return parsePriceValue(offers.price || offers.lowPrice || offers.highPrice || offers.priceSpecification?.price);
}

function parsePriceValue(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.round(v);
  const found = parsePrice(String(v ?? ''));
  return found?.value || 0;
}

function parsePrice(text) {
  const s = String(text || '');
  const re = /(?:₫|đ|vnd|vnđ|usd|\$)?\s*(\d{1,3}(?:[.,]\d{3}){1,5}|\d{5,12})(?:\s*(?:₫|đ|vnd|vnđ|usd|\$))?/gi;
  const candidates = [];
  let m;
  while ((m = re.exec(s))) {
    const value = Number(m[1].replace(/[^\d]/g, ''));
    if (Number.isFinite(value) && value >= 1000 && value <= 1_000_000_000) candidates.push({ value, raw: m[0] });
  }
  return candidates[0] || null;
}

function looksLikeProductLine(line) {
  const s = line.toLowerCase();
  if (line.length < 8 || line.length > 220) return false;
  if (/tổng cộng|subtotal|total|giỏ hàng|cart|shipping|giao hàng|bảo hành|hotline|email|địa chỉ/.test(s)) return false;
  return /[a-zà-ỹ]/i.test(line) && parsePrice(line);
}

function looksLikeProductName(line) {
  const s = cleanName(line);
  const low = s.toLowerCase();
  if (s.length < 4 || s.length > 155) return false;
  if (parsePrice(s)) return false;
  if (!/[a-zà-ỹ]/i.test(s)) return false;
  if (/^(menu|tìm kiếm|search|liên hệ|catalogue|catalog|video|trang chủ|giới thiệu|tin tức|đối tác|tuyển dụng|nhà phân phối|tiếng việt|tiếng anh)$/i.test(s)) return false;
  if (/^(xem thêm|mua ngay|thêm vào giỏ hàng|add to cart|hết hàng|khoảng giá)$/i.test(s)) return false;
  if (/^(thiết bị điện thông minh|bắt đầu với lumi)$/i.test(s)) return false;
  if (/^\d+(?:\.\d+)*\.\s+/.test(s)) return false;
  if (/^(ví dụ|trong thời đại|các thiết bị|những sản phẩm|với khả năng|bộ điều khiển .* giúp|cảm biến .* đóng vai trò)/i.test(low)) return false;
  if (isLikelyMarketingText(s)) return false;
  return true;
}

function isLikelyMarketingText(value = '') {
  const s = cleanName(value);
  const n = normalizeVietnamese(s);
  if (!n) return false;
  const words = n.split(' ').filter(Boolean);
  const wordCount = words.length;
  const commaCount = (s.match(/[,;:]/g) || []).length;
  if (wordCount > 22) return true;
  if (wordCount > 15 && commaCount >= 2) return true;
  if (/[:.!?…]$/.test(s) && wordCount > 8) return true;
  if (/^(dac biet|day la|voi |tu viec|duoi day|tham khao|chung toi|nha thong minh|lumi la|lumi luon|viec lua chon|mot trong|cac thiet bi|nhung thiet bi|thiet bi dien thong minh tao ra)/.test(n)) return true;
  if (/\b(nguoi dung|khach hang|thi truong|phat trien|lua chon|khong gian|giai phap|thuong hieu|thiet ke hien dai|giup ban|cho phep|mang den|dam bao|cung cap|dap ung|trai nghiem|cuoc song|chat luong hang dau|make in vietnam|tu hao smart home)\b/.test(n) && wordCount > 9) return true;
  return false;
}

function isCategoryHeading(line, nextLine = '') {
  const s = cleanName(line);
  if (!s || parsePrice(s)) return false;
  if (/^xem thêm$/i.test(s)) return false;
  // Trên Lumi/WooCommerce category page, tiêu đề nhóm thường đứng ngay trước link "Xem thêm".
  if (/^xem thêm$/i.test(cleanName(nextLine))) return true;
  return false;
}

function looksLikeSectionBreak(line) {
  const s = cleanName(line);
  if (!s) return true;
  if (/^xem thêm$/i.test(s)) return true;
  if (/^\d+(?:\.\d+)*\.\s+/.test(s)) return true;
  return false;
}

function isProbablyNavLine(line) {
  const s = cleanName(line).toLowerCase();
  return /^(menu|tìm kiếm|search|liên hệ|catalogue|catalog|video|trang chủ|giới thiệu|tin tức|đối tác|tuyển dụng|nhà phân phối|tiếng việt|tiếng anh|bỏ qua nội dung)$/.test(s);
}

function isProbablyNavLink(text, href = '') {
  const s = cleanName(text).toLowerCase();
  const h = String(href || '').toLowerCase();
  if (isProbablyNavLine(s)) return true;
  if (/^(xem thêm|menu|tìm kiếm|liên hệ|catalogue|catalog|video)$/.test(s)) return true;
  if (h.startsWith('#') || /^mailto:|^tel:|javascript:/i.test(h)) return true;
  return false;
}

function attrValue(attrs, name) {
  const re = new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`, 'i');
  const m = String(attrs || '').match(re);
  return m ? decodeHtmlEntities(m[1]) : '';
}

function stripPriceText(line) {
  return String(line || '')
    .replace(/Khoảng\s*giá\s*:.*/i, ' ')
    .replace(/(?:giá\s*)?(?:từ|den|đến)\s*\d{1,3}(?:[.,]\d{3}){1,5}\s*(?:₫|đ|vnd|vnđ)?/gi, ' ')
    .replace(/(?:₫|đ|vnd|vnđ|usd|\$)?\s*\d{1,3}(?:[.,]\d{3}){1,5}(?:\s*(?:₫|đ|vnd|vnđ|usd|\$))?/gi, ' ')
    .replace(/\s*[–—-]\s*$/g, ' ')
    .replace(/^\s*[–—-]\s*/g, ' ');
}

function removePriceFragments(line) {
  return cleanName(stripPriceText(line));
}

function cleanName(s) {
  let t = decodeHtmlEntities(stripTags(String(s || '')))
    .replace(/\b(mua ngay|thêm vào giỏ hàng|xem nhanh|chi tiết|add to cart|sale|new)\b/gi, ' ');
  if (/khoảng\s*giá|₫|\b(vnd|vnđ)\b|(?:^|\s)\d{1,3}(?:[.,]\d{3}){1,5}\s*(?:đ|₫)/i.test(t)) {
    t = stripPriceText(t);
  }
  return t
    .replace(/\s*[|·]\s*$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
}

function cleanDescription(s) {
  return decodeHtmlEntities(stripTags(String(s || ''))).replace(/\s+/g, ' ').trim().slice(0, 600);
}

function cleanSku(s) {
  return String(s || '').toUpperCase().replace(/[^A-Z0-9._\-/]/g, '').slice(0, 48);
}

function findSku(text) {
  const m = String(text || '').toUpperCase().match(/\b(?:SKU|MÃ|MODEL|Mã sản phẩm|MSP)[:#\s-]*([A-Z0-9][A-Z0-9._\-/]{3,40})\b/i)
    || String(text || '').toUpperCase().match(/\b([A-Z]{2,}[A-Z0-9]*[-_/][A-Z0-9][A-Z0-9._\-/]{1,}|[A-Z]{2,}\d{2,}[A-Z0-9._\-/]*)\b/);
  return cleanSku(m?.[1] || '');
}

function absoluteUrl(raw, base) {
  const s = String(raw || '').trim();
  if (!s) return '';
  if (s.startsWith('data:')) return '';
  try { return new URL(s, base).href; } catch { return s; }
}

function extractBestImage(block, sourceUrl) {
  const html = String(block || '');
  const candidates = [];
  const add = (raw, score = 1) => {
    const url = normalizeImageCandidate(raw, sourceUrl);
    if (!url) return;
    candidates.push({ url, score: score + imageScore(url) });
  };

  const imgRe = /<img\b([^>]*)>/gi;
  let m;
  while ((m = imgRe.exec(html))) {
    const attrs = m[1] || '';
    for (const name of ['data-large_image', 'data-o_src', 'data-lazy-src', 'data-src', 'src']) {
      const v = attrValue(attrs, name);
      if (v) add(v, name === 'src' ? 1 : 3);
    }
    const srcset = attrValue(attrs, 'data-srcset') || attrValue(attrs, 'srcset');
    if (srcset) add(bestFromSrcset(srcset), 4);
  }

  for (const re of [
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/gi,
    /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/gi,
    /background-image\s*:\s*url\(([^)]+)\)/gi,
  ]) {
    let x;
    while ((x = re.exec(html))) add(x[1], 0.5);
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates[0]?.url || '';
}

function nearestAnchorImage(anchors = [], i = 0, html = '', sourceUrl = '') {
  const current = anchors[i] || {};
  if (current.image) return current.image;
  const currentHref = normalizeDedupeUrl(absoluteUrl(current.href || '', sourceUrl));
  for (let j = i - 1; j >= Math.max(0, i - 4); j--) {
    const prev = anchors[j];
    if (!prev?.image) continue;
    const prevHref = normalizeDedupeUrl(absoluteUrl(prev.href || '', sourceUrl));
    if (!currentHref || !prevHref || currentHref === prevHref || prev.imageOnly) return prev.image;
  }
  const before = String(html || '').slice(Math.max(0, (current.index || 0) - 1400), current.index || 0);
  return extractLastImage(before, sourceUrl);
}

function extractLastImage(block, sourceUrl) {
  const html = String(block || '');
  let last = '';
  const imgRe = /<img\b([^>]*)>/gi;
  let m;
  while ((m = imgRe.exec(html))) {
    const attrs = m[1] || '';
    const srcset = attrValue(attrs, 'data-srcset') || attrValue(attrs, 'srcset');
    const raw = bestFromSrcset(srcset)
      || attrValue(attrs, 'data-large_image')
      || attrValue(attrs, 'data-o_src')
      || attrValue(attrs, 'data-lazy-src')
      || attrValue(attrs, 'data-src')
      || attrValue(attrs, 'src');
    const url = normalizeImageCandidate(raw, sourceUrl);
    if (url) last = url;
  }
  return last;
}

function normalizeImageCandidate(raw, sourceUrl) {
  let s = decodeHtmlEntities(String(raw || '').trim().replace(/^['"]|['"]$/g, ''));
  if (!s || s.startsWith('data:') || s.startsWith('blob:')) return '';
  if (/^(about:blank|javascript:)/i.test(s)) return '';
  const url = absoluteUrl(s, sourceUrl);
  if (!url) return '';
  if (/placeholder|blank|loading|spinner|logo|flag|avatar|icon|favicon/i.test(url)) return '';
  if (/\.(svg)(?:\?|#|$)/i.test(url)) return '';
  return url;
}

function bestFromSrcset(srcset = '') {
  const parts = String(srcset || '').split(',').map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return '';
  let best = { url: '', w: 0 };
  for (const part of parts) {
    const [url, size = ''] = part.split(/\s+/);
    const w = Number((size.match(/(\d+)w/) || [])[1] || 0) || 0;
    if (!best.url || w > best.w) best = { url, w };
  }
  return best.url;
}

function imageScore(url = '') {
  let score = 0;
  if (/product|products|uploads|woocommerce|wp-content|media/i.test(url)) score += 3;
  if (/-\d+x\d+\./.test(url)) score += 0.5;
  if (/logo|banner|icon|flag/i.test(url)) score -= 6;
  return score;
}

function extractFirstLink(block, sourceUrl) {
  const m = block.match(/<a[^>]+href=["']([^"']+)["']/i);
  return m ? absoluteUrl(decodeHtmlEntities(m[1]), sourceUrl) : sourceUrl;
}

function extractSiteName(html, fallback) {
  const title = html.match(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i)
    || html.match(/<title[^>]*>([\s\S]{1,120}?)<\/title>/i);
  return cleanName(title?.[1] || fallback || 'Web');
}
