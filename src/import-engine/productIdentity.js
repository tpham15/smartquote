// ============================================================
// Product identity safety helpers.
// P1.5.4 P0: identity evidence must beat category/position guesses.
// ============================================================

export function foldIdentityText(value = "") {
  return String(value ?? "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d").replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function normalizeIdentitySku(value = "") {
  return foldIdentityText(value).replace(/\s+/g, "");
}

export function normalizeIdentitySupplier(product = {}) {
  return foldIdentityText(product.supplier || "").replace(/\s+/g, "");
}

export function normalizeIdentityBrand(product = {}) {
  return foldIdentityText(product.brand || "").replace(/\s+/g, "");
}

export function normalizeIdentityParty(product = {}) {
  const supplier = normalizeIdentitySupplier(product);
  const brand = normalizeIdentityBrand(product);
  if (supplier && brand) return `supplier:${supplier}|brand:${brand}`;
  if (supplier) return `supplier:${supplier}`;
  if (brand) return `brand:${brand}`;
  return "";
}

export function hasIdentityPartyEvidence(product = {}) {
  return !!(normalizeIdentitySupplier(product) || normalizeIdentityBrand(product));
}

/**
 * Compare only evidence that exists on BOTH sides. Any explicit supplier/brand
 * conflict is fatal. At least one equal comparable field is required for true;
 * no comparable field returns null (unknown), never an automatic match.
 */
export function partyEvidenceMatch(a = {}, b = {}) {
  const as = normalizeIdentitySupplier(a), bs = normalizeIdentitySupplier(b);
  const ab = normalizeIdentityBrand(a), bb = normalizeIdentityBrand(b);
  let compared = false;
  if (as && bs) {
    compared = true;
    if (as !== bs) return false;
  }
  if (ab && bb) {
    compared = true;
    if (ab !== bb) return false;
  }
  return compared ? true : null;
}

export function normalizeIdentityName(value = "") {
  return foldIdentityText(value).replace(/\s+/g, " ");
}

/**
 * Technical tokens that often define a sellable variant. Keep deliberately
 * conservative: missing a merge is safer than merging 12W with 18W.
 */
export function technicalVariantSignature(product = {}) {
  const raw = [product.name, product.specs, product.description]
    .filter(Boolean).join(" ").toUpperCase().replace(/,/g, ".");
  if (!raw) return "";
  const hits = new Set();
  const patterns = [
    /\bIP\s*\d{2}\b/g,
    /\b\d+(?:\.\d+)?\s*(?:KW|W|V|MA|A|HZ|KHZ|MHZ|GHZ|K|MM|CM|MP|CH|TB|GB|MB|LM|LUMEN)\b/g,
    /\b\d+(?:\.\d+)?\s*(?:DEG|°)\b/g,
    /\b\d+(?:\.\d+)?\s*[X×]\s*\d+(?:\.\d+)?(?:\s*[X×]\s*\d+(?:\.\d+)?)?\s*(?:MM|CM|M)?\b/g,
  ];
  for (const re of patterns) {
    for (const m of raw.matchAll(re)) {
      const token = String(m[0] || "").replace(/\s+/g, "").toLowerCase();
      if (token) hits.add(token);
    }
  }
  return [...hits].sort().join("|");
}

export function productIdentityKey(product = {}) {
  const sku = normalizeIdentitySku(product.sku);
  const party = normalizeIdentityParty(product);
  const name = normalizeIdentityName(product.name);
  const variant = technicalVariantSignature(product);

  if (sku && party) return `sku:${party}:${sku}`;
  // Unknown supplier/brand: include name/variant so same short SKU from two files
  // is not silently collapsed unless the visible identity is also the same.
  if (sku) return `sku-unknown:${sku}:${name || "noname"}:${variant || "novariant"}`;
  if (name) return `name:${party || "unknown"}:${name}:${variant || "novariant"}`;
  return "";
}

export function sameKnownParty(a = {}, b = {}) {
  return partyEvidenceMatch(a, b);
}

export function namesConflict(a = {}, b = {}) {
  const an = normalizeIdentityName(a.name);
  const bn = normalizeIdentityName(b.name);
  return !!(an && bn && an !== bn);
}

/**
 * Safe auto-merge gate. Exact SKU is not sufficient when known suppliers differ.
 * If SKU+party are the same but visible names disagree, preserve both for review.
 */
export function canAutoMergeIdentity(a = {}, b = {}) {
  const as = normalizeIdentitySku(a.sku);
  const bs = normalizeIdentitySku(b.sku);
  if (as && bs) {
    if (as !== bs) return false;
    const sameParty = sameKnownParty(a, b);
    if (sameParty === false) return false;
    if (sameParty === null && hasIdentityPartyEvidence(a) && hasIdentityPartyEvidence(b)) return false;
    if (namesConflict(a, b)) return false;
    return true;
  }
  return productIdentityKey(a) !== "" && productIdentityKey(a) === productIdentityKey(b);
}


export function technicalVariantTokens(product = {}) {
  const sig = technicalVariantSignature(product);
  return sig ? sig.split("|").filter(Boolean) : [];
}

/**
 * Fuzzy identity is allowed only when technical variant evidence is compatible.
 * If either side exposes variant-defining tokens, both sides must expose the
 * exact same normalized token set. False negatives are safer than 3000K→4000K
 * or 2.8mm→3.6mm false positives.
 */
export function technicalVariantsCompatible(a = {}, b = {}) {
  const av = technicalVariantTokens(a);
  const bv = technicalVariantTokens(b);
  if (!av.length && !bv.length) return true;
  if (!av.length || !bv.length) return false;
  return av.length === bv.length && av.every((token, idx) => token === bv[idx]);
}

export function learningPartyKey(product = {}) {
  return normalizeIdentityParty(product) || "unknown";
}

export function compositeLearningSkuKey(product = {}) {
  const sku = normalizeIdentitySku(product.sku);
  if (!sku) return "";
  return `${learningPartyKey(product)}:${sku}`;
}

export function appendIdentityReviewIssue(product = {}, message = "Trùng mã nhưng khác bằng chứng nhận diện; SmartQuote giữ riêng để kiểm tra") {
  const issue = {
    code: "identity_collision_review",
    level: "warning",
    message,
    field: "sku",
    suggestedFix: "Xác nhận hãng/nhà cung cấp và tên sản phẩm trước khi gộp",
  };
  const issues = Array.isArray(product.issues) ? product.issues : [];
  if (issues.some((x) => x?.code === issue.code && x?.message === issue.message)) return product;
  return {
    ...product,
    status: product.status === "failed" ? product.status : "review",
    issues: [...issues, issue],
    _meta: product._meta ? {
      ...product._meta,
      status: product._meta.status === "failed" ? product._meta.status : "review",
      canonicalStatus: product._meta.canonicalStatus === "failed" ? product._meta.canonicalStatus : "need_review",
      issues: [...(Array.isArray(product._meta.issues) ? product._meta.issues : []), issue],
    } : product._meta,
  };
}
