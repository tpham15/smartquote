// ============================================================
// Web catalog import — chuyển kết quả cào web thành product shape
// dùng chung preview/sanitize/merge của CatalogImporter.
// ============================================================

let _seq = 0;
const uid = (p = "web") => `${p}_${Date.now().toString(36)}_${(_seq++).toString(36)}`;

const NAMED_ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  ndash: "–", mdash: "—", hellip: "…", laquo: "«", raquo: "»",
  lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", times: "×", reg: "®", copy: "©", trade: "™", deg: "°",
};

function decodeHtmlEntities(v) {
  let out = String(v ?? "");
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

function stripPriceText(line) {
  return String(line || "")
    .replace(/Khoảng\s*giá\s*:.*/i, " ")
    .replace(/(?:giá\s*)?(?:từ|den|đến)\s*\d{1,3}(?:[.,]\d{3}){1,5}\s*(?:₫|đ|vnd|vnđ)?/gi, " ")
    .replace(/(?:₫|đ|vnd|vnđ|usd|\$)?\s*\d{1,3}(?:[.,]\d{3}){1,5}(?:\s*(?:₫|đ|vnd|vnđ|usd|\$))?/gi, " ")
    .replace(/\s*[–—-]\s*$/g, " ")
    .replace(/^\s*[–—-]\s*/g, " ");
}

function text(v) {
  return decodeHtmlEntities(v).replace(/\s+/g, " ").trim();
}

function cleanWebName(v) {
  let s = text(v);
  if (/khoảng\s*giá|₫|\b(vnd|vnđ)\b|(?:^|\s)\d{1,3}(?:[.,]\d{3}){1,5}\s*(?:đ|₫)/i.test(s)) {
    s = stripPriceText(s);
  }
  return text(s);
}

function asNumber(v) {
  if (typeof v === "number" && Number.isFinite(v)) return Math.round(v);
  const raw = String(v ?? "");
  if (!raw) return 0;
  const match = raw.match(/\d{1,3}(?:[.,]\d{3}){1,5}|\d{4,12}(?:[.,]\d+)?/);
  if (!match) return 0;
  const n = Number(match[0].replace(/[^\d]/g, ""));
  return Number.isFinite(n) ? Math.round(n) : 0;
}

function normalizeImage(image) {
  if (Array.isArray(image)) return text(image[0]);
  if (image && typeof image === "object") return text(image.url || image.contentUrl || image.src);
  return text(image);
}

function normalizeSourceUrl(url, sourceUrl = "") {
  const raw = text(url);
  if (!raw || raw.startsWith("data:") || raw.startsWith("blob:")) return "";
  try {
    return new URL(raw, sourceUrl || window.location.href).href;
  } catch {
    return raw;
  }
}

export function webScrapeItemsToProducts(payload = {}, opts = {}) {
  const sourceUrl = payload.sourceUrl || opts.sourceUrl || "";
  const defaultSupplier = text(opts.defaultSupplier || payload.siteName || payload.hostname || "Web");
  return (payload.items || []).map((item, index) => {
    const price = asNumber(item.price || item.listPrice || item.publicPrice || item.costPrice);
    const supplier = text(item.supplier || item.brand || defaultSupplier);
    const sku = text(item.sku || item.model || item.mpn);
    const name = cleanWebName(item.name || item.title || sku || `Sản phẩm web ${index + 1}`);
    const url = normalizeSourceUrl(item.url || item.productUrl || sourceUrl, sourceUrl);
    const image = normalizeSourceUrl(normalizeImage(item.image), sourceUrl);
    const specs = [
      text(item.description || item.specs),
      url ? `Nguồn web: ${url}` : "",
    ].filter(Boolean).join(" | ");

    return {
      id: uid("webp"),
      name,
      sku,
      category: text(item.category) || "Web catalog",
      supplier,
      unit: text(item.unit) || "Cái",
      costPrice: price,
      listPrice: price,
      publicPrice: price,
      minRetailPrice: asNumber(item.minRetailPrice),
      priceMode: price > 0 ? "fixed" : "markup",
      specs,
      image,
      _meta: {
        source: {
          type: "web",
          fileName: sourceUrl,
          page: null,
          row: index + 1,
          rawText: text(item.rawText || `${name} ${sku} ${price}`),
          url,
        },
        engine: payload.engine || "web-scrape",
        confidence: Number(item.confidence || 0.72),
        canonicalStatus: item.status || "auto_approved",
        status: item.status || "new",
        issues: item.issues || [],
      },
    };
  });
}
