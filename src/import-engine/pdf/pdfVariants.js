// Phase 14.1A — semantic table / sellable variant handling.
// Pure JS so it can be smoke-tested without browser/AI dependencies.

function text(v) { return String(v ?? "").replace(/\s+/g, " ").trim(); }
function key(v) {
  return text(v).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/[^a-z0-9]+/g, " ").trim();
}
function validPrice(v) {
  const n = Number(v || 0);
  return Number.isFinite(n) && n >= 1000 && n <= 1_000_000_000;
}
function clearSku(v) {
  const s = text(v);
  return /[A-Z]/i.test(s) && /\d/.test(s) && s.replace(/[^A-Z0-9]/gi, "").length >= 4;
}

export const PDF_PRICE_ROLE = Object.freeze({
  VARIANT: "variant_price",
  COMMERCIAL: "commercial_price",
  QUOTE: "quote_value",
  UNKNOWN: "unknown",
});

export const PDF_ROW_MODEL = Object.freeze({
  SINGLE: "single_sku",
  VARIANTS: "product_family_variants",
  MIXED: "mixed",
  UNKNOWN: "unknown",
});

export function inferVariantKey(label = "", sku = "") {
  const k = key(label);
  if (/\b(on off|onoff|on\/off)\b/.test(k) || /(?:-|_)(?:o|onoff)$/i.test(text(sku))) return "on_off";
  if (/\b(smart dimmable|dimmable|dimming|dim)\b/.test(k) || /(?:-|_)(?:d|dim)$/i.test(text(sku))) return "smart_dimmable";
  if (/\b(smart tunable|tunable white|tunable|cct)\b/.test(k) || /(?:-|_)(?:t|tw)$/i.test(text(sku))) return "smart_tunable";
  return k.replace(/\s+/g, "_").slice(0, 48) || "";
}

export function canonicalVariantLabel(variantKey = "", fallback = "") {
  const k = String(variantKey || "").trim();
  if (k === "on_off") return "On/off";
  if (k === "smart_dimmable") return "Smart dimmable";
  if (k === "smart_tunable") return "Smart Tunable";
  return text(fallback);
}

export function normalizePdfTableSemantics(raw = {}) {
  const rowModelRaw = String(raw?.rowModel || raw?.row_model || "unknown").trim().toLowerCase();
  const rowModel = Object.values(PDF_ROW_MODEL).includes(rowModelRaw) ? rowModelRaw : PDF_ROW_MODEL.UNKNOWN;
  const columns = [];
  for (const col of Array.isArray(raw?.priceColumns) ? raw.priceColumns : []) {
    const roleRaw = String(col?.role || "unknown").trim().toLowerCase();
    const role = Object.values(PDF_PRICE_ROLE).includes(roleRaw) ? roleRaw : PDF_PRICE_ROLE.UNKNOWN;
    const label = text(col?.label);
    const variantKey = text(col?.variantKey || col?.variant_key) || inferVariantKey(label, "");
    columns.push({ label, role, variantKey });
  }
  return { rowModel, priceColumns: columns.slice(0, 12) };
}

export function normalizeSellableVariants(values = [], tableSemantics = {}) {
  const semantics = normalizePdfTableSemantics(tableSemantics);
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(values) ? values : []) {
    const sku = text(raw?.sku);
    const price = Number(raw?.price || 0) || 0;
    const rawLabel = text(raw?.label);
    const variantKey = text(raw?.variantKey || raw?.variant_key) || inferVariantKey(rawLabel, sku);
    const label = canonicalVariantLabel(variantKey, rawLabel);
    const roleRaw = String(raw?.priceRole || raw?.price_role || "").trim().toLowerCase();
    const priceRole = Object.values(PDF_PRICE_ROLE).includes(roleRaw)
      ? roleRaw
      : (variantKey ? PDF_PRICE_ROLE.VARIANT : PDF_PRICE_ROLE.UNKNOWN);
    if (!sku && !price) continue;
    const sig = `${sku.toUpperCase()}|${price}|${variantKey}|${key(label)}`;
    if (seen.has(sig)) continue;
    seen.add(sig);
    out.push({ sku, label, variantKey, priceRole, price });
  }

  // If the model returned variant rows but omitted labels, bind by the semantic
  // header order only when counts match exactly. Never guess a many-to-many map.
  const variantCols = semantics.priceColumns.filter((c) => c.role === PDF_PRICE_ROLE.VARIANT);
  if (variantCols.length === out.length && out.length >= 2) {
    return out.map((v, i) => {
      const col = variantCols[i];
      const variantKey = v.variantKey || col.variantKey || inferVariantKey(col.label, v.sku);
      return {
        ...v,
        variantKey,
        label: v.label || canonicalVariantLabel(variantKey, col.label),
        priceRole: PDF_PRICE_ROLE.VARIANT,
      };
    });
  }
  return out.slice(0, 16);
}

export function analyzeSellableVariantFamily(product = {}) {
  const meta = product?._meta || {};
  const semantics = normalizePdfTableSemantics(product?.tableSemantics || meta?.tableSemantics || {});
  const variants = normalizeSellableVariants(product?.variants || meta?.variants || [], semantics)
    .filter((v) => clearSku(v.sku) && validPrice(v.price));

  const skuKeys = variants.map((v) => v.sku.toUpperCase().replace(/[^A-Z0-9]/g, ""));
  const uniqueSkuCount = new Set(skuKeys).size;
  const priceCount = new Set(variants.map((v) => Number(v.price))).size;
  const variantKeyCount = new Set(variants.map((v) => v.variantKey).filter(Boolean)).size;
  const variantRoleColumns = semantics.priceColumns.filter((c) => c.role === PDF_PRICE_ROLE.VARIANT).length;
  const visibleSkuCount = Math.max(0, Number(meta?.variantBinding?.visibleSkuCount ?? product?.visibleSkuCount ?? 0) || 0);
  const visiblePriceCount = Math.max(0, Number(meta?.variantBinding?.visiblePriceCount ?? product?.visiblePriceCount ?? 0) || 0);
  const semanticVariantTable = semantics.rowModel === PDF_ROW_MODEL.VARIANTS || variantRoleColumns >= 2;
  const bindingComplete = visibleSkuCount < 2 || variants.length === visibleSkuCount;
  const strongDistinctVariantEvidence = variants.length >= 2
    && uniqueSkuCount === variants.length
    && priceCount >= 2
    && variantKeyCount >= 2;

  // Critical safety rule: multiple commercial prices for ONE SKU are price tiers,
  // not sellable variants. Distinct SKU identity is mandatory for expansion.
  const expandable = variants.length >= 2
    && uniqueSkuCount === variants.length
    && bindingComplete
    && (semanticVariantTable || strongDistinctVariantEvidence);

  return {
    expandable,
    variants,
    semantics,
    signals: {
      uniqueSkuCount,
      priceCount,
      variantKeyCount,
      variantRoleColumns,
      semanticVariantTable,
      strongDistinctVariantEvidence,
      visibleSkuCount,
      visiblePriceCount,
      bindingComplete,
    },
  };
}

function issueCode(issue) {
  return String(typeof issue === "string" ? issue : (issue?.code || "")).toLowerCase();
}

function familyIdFor(product = {}, index = 0) {
  const source = product?._meta?.source || {};
  const raw = [source.page || "p", source.row || index + 1, product.name || "family"].join("::");
  let h = 0x811c9dc5;
  for (let i = 0; i < raw.length; i++) { h ^= raw.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return `pdf_family_${(h >>> 0).toString(36)}`;
}

function appendVariantToName(baseName, label) {
  const base = text(baseName);
  const lab = text(label);
  if (!lab) return base;
  const bk = key(base);
  const lk = key(lab);
  if (lk && bk.includes(lk)) return base;
  return `${base} · ${lab}`;
}

function appendVariantSpecs(specs, label) {
  const base = text(specs);
  const lab = text(label);
  if (!lab) return base;
  const marker = `Cấu hình: ${lab}`;
  if (key(base).includes(key(marker))) return base;
  return [marker, base].filter(Boolean).join(" · ").slice(0, 1200);
}

/**
 * Convert source-row families into sellable catalog SKUs.
 * A family is expanded only when there are >=2 distinct SKU identities with
 * explicit prices and semantic evidence says the columns are variant prices.
 */
export function expandPdfSellableVariants(products = []) {
  const expanded = [];
  let sourceRows = 0;
  let variantFamilies = 0;
  let expandedVariants = 0;

  (products || []).forEach((product, index) => {
    if (!product) return;
    sourceRows += 1;
    const analysis = analyzeSellableVariantFamily(product);
    if (!analysis.expandable) {
      expanded.push(product);
      return;
    }

    variantFamilies += 1;
    const familyId = familyIdFor(product, index);
    const parentMeta = product._meta || {};
    const parentIssues = Array.isArray(parentMeta.issues) ? parentMeta.issues : [];
    const cleanIssues = parentIssues.filter((it) => !["pdf_row_variants_collapsed", "pdf_variant_price_family"].includes(issueCode(it)));

    for (let i = 0; i < analysis.variants.length; i++) {
      const variant = analysis.variants[i];
      const variantKey = variant.variantKey || inferVariantKey(variant.label, variant.sku);
      const label = canonicalVariantLabel(variantKey, variant.label) || `Biến thể ${i + 1}`;
      const variantIssue = {
        code: "pdf_variant_expanded",
        level: "info",
        message: `Tách SKU ${variant.sku} từ dòng nguồn có nhiều cấu hình (${label})`,
        field: "sku",
      };
      const family = {
        id: familyId,
        name: text(product.name),
        sourceRow: Number(parentMeta?.source?.row || 0) || null,
        sourcePage: Number(parentMeta?.source?.page || 0) || null,
        variantCount: analysis.variants.length,
      };
      expanded.push({
        ...product,
        id: `${product.id || familyId}_${i + 1}`,
        name: appendVariantToName(product.name, label),
        sku: variant.sku,
        costPrice: Number(variant.price),
        // A variant-price column is NOT a commercial tier. Keep list/min-retail
        // empty unless a later commercial-price parser provides them explicitly.
        listPrice: 0,
        publicPrice: 0,
        minRetailPrice: 0,
        priceMode: product.priceMode || "markup",
        specs: appendVariantSpecs(product.specs, label),
        variants: [variant],
        _meta: {
          ...parentMeta,
          source: { ...(parentMeta.source || {}) },
          family,
          variant: { ...variant, label, variantKey, priceRole: PDF_PRICE_ROLE.VARIANT },
          variants: [variant],
          tableSemantics: analysis.semantics,
          priceSemantics: PDF_PRICE_ROLE.VARIANT,
          issues: [...cleanIssues, variantIssue].slice(0, 8),
          canonicalStatus: parentMeta.canonicalStatus || "auto_approved",
          status: parentMeta.status === "review" ? "review" : "new",
          confidence: Math.max(Number(parentMeta.confidence || 0.78), 0.9),
        },
      });
      expandedVariants += 1;
    }
  });

  return {
    products: expanded,
    stats: {
      sourceRows,
      sellableSkus: expanded.length,
      variantFamilies,
      expandedVariants,
    },
  };
}
