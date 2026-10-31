// SmartQuote Pilot P0 — commercial correctness + immutable quote snapshots.
// Pure helpers: no React/Supabase dependency so business-critical behavior is smoke-testable.

const finiteNumber = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

export function chooseDefaultMarkupFactor(markups = []) {
  const values = (Array.isArray(markups) ? markups : [])
    .map((m) => finiteNumber(m?.value, NaN))
    .filter((v) => Number.isFinite(v) && v > 0);
  return values.find((v) => v > 1) || values[0] || 1.2;
}

export function productCostPrice(product = {}, line = {}) {
  if (Number.isFinite(Number(line?.costPriceSnapshot))) return Math.max(0, Number(line.costPriceSnapshot));
  const cost = finiteNumber(product?.costPrice, NaN);
  return Number.isFinite(cost) && cost >= 0 ? cost : null;
}

export function productDisplayBasePrice(product = {}) {
  if (!product) return 0;
  if (product.priceMode === "fixed") {
    return finiteNumber(product.listPrice || product.publicPrice || product.salePrice || product.price || product.costPrice || 0);
  }
  return finiteNumber(product.costPrice || product.listPrice || product.publicPrice || product.salePrice || product.price || 0);
}

export function quoteLineSalePrice(product = {}, line = {}) {
  if (Number.isFinite(Number(line?.salePriceSnapshot))) return Math.max(0, Number(line.salePriceSnapshot));
  if (!product) return 0;
  const base = productDisplayBasePrice(product);
  if (product.priceMode === "fixed") return base;
  const factor = finiteNumber(line?.factor, 1) > 0 ? finiteNumber(line.factor, 1) : 1;
  return Math.round((base * factor) / 1000) * 1000;
}

export function snapshotQuoteProduct(product = {}) {
  const allowed = [
    "id", "name", "sku", "category", "supplier", "brand", "origin", "attributes", "unit",
    "costPrice", "listPrice", "publicPrice", "salePrice", "price", "priceMode",
    "specs", "description", "image", "imageUrl", "sourceUrl",
  ];
  const snapshot = {};
  for (const key of allowed) {
    if (product[key] !== undefined) snapshot[key] = product[key];
  }
  return snapshot;
}

export function buildQuoteSnapshotRooms(rooms = [], productById = {}) {
  return (Array.isArray(rooms) ? rooms : []).map((room) => ({
    ...room,
    lines: (Array.isArray(room?.lines) ? room.lines : []).map((line) => {
      const product = productById?.[line.productId] || line.productSnapshot || null;
      if (!product) return { ...line };
      const cost = productCostPrice(product, line);
      return {
        ...line,
        snapshotVersion: 1,
        productSnapshot: snapshotQuoteProduct(product),
        salePriceSnapshot: quoteLineSalePrice(product, line),
        costPriceSnapshot: cost == null ? null : cost,
      };
    }),
  }));
}

export function buildQuoteProductMap(catalogProductById = {}, rooms = []) {
  const out = { ...(catalogProductById || {}) };
  for (const room of Array.isArray(rooms) ? rooms : []) {
    for (const line of Array.isArray(room?.lines) ? room.lines : []) {
      const snap = line?.productSnapshot;
      if (line?.productId && snap && typeof snap === "object") {
        out[line.productId] = { ...snap, id: snap.id || line.productId };
      }
    }
  }
  return out;
}

export function assessQuoteCommercialSafety({ rooms = [], productById = {} } = {}) {
  let lineCount = 0;
  let missingProductCount = 0;
  let missingSalePriceCount = 0;
  let unknownCostCount = 0;
  let atOrBelowCostCount = 0;
  let negativeMarginCount = 0;
  let saleTotal = 0;
  let knownCostTotal = 0;
  let knownCostSaleTotal = 0;

  for (const room of Array.isArray(rooms) ? rooms : []) {
    for (const line of Array.isArray(room?.lines) ? room.lines : []) {
      const qty = Math.max(0, finiteNumber(line?.qty, 0));
      if (qty <= 0) continue;
      lineCount += 1;
      const product = productById?.[line.productId] || line.productSnapshot || null;
      if (!product) {
        missingProductCount += 1;
        continue;
      }
      const sale = quoteLineSalePrice(product, line);
      if (!(sale > 0)) missingSalePriceCount += 1;
      saleTotal += sale * qty;

      const cost = productCostPrice(product, line);
      if (cost == null || !(cost > 0)) {
        unknownCostCount += 1;
        continue;
      }
      knownCostTotal += cost * qty;
      knownCostSaleTotal += sale * qty;
      if (sale <= cost) atOrBelowCostCount += 1;
      if (sale < cost) negativeMarginCount += 1;
    }
  }

  const allCostsKnown = lineCount > 0 && unknownCostCount === 0 && missingProductCount === 0;
  const grossMarginPct = allCostsKnown && saleTotal > 0
    ? ((saleTotal - knownCostTotal) / saleTotal) * 100
    : null;
  const knownCostMarginPct = knownCostSaleTotal > 0
    ? ((knownCostSaleTotal - knownCostTotal) / knownCostSaleTotal) * 100
    : null;

  return {
    lineCount,
    missingProductCount,
    missingSalePriceCount,
    unknownCostCount,
    atOrBelowCostCount,
    negativeMarginCount,
    saleTotal,
    knownCostTotal,
    grossMarginPct,
    knownCostMarginPct,
    hardErrorCount: missingProductCount + missingSalePriceCount,
    warningCount: unknownCostCount + atOrBelowCostCount,
    canFinalize: missingProductCount === 0 && missingSalePriceCount === 0,
  };
}

export function isMarkupPricingUnreviewed(product = {}, factor = 1) {
  if (!product || product.priceMode === "fixed") return false;
  const cost = finiteNumber(product.costPrice || 0);
  if (!(cost > 0)) return true;
  return !(finiteNumber(factor, 1) > 1);
}
