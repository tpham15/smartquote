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

export function supplierEvidenceSource(product = {}) {
  // RC16 S1: also read the persisted provenance (attributes survive the cloud
  // catalog round-trip; _meta does not).
  return String(
    product?._meta?.supplierSource
    || product?._meta?.source?.supplierSource
    || product?.source?.supplierSource
    || product?.attributes?.provenance?.supplierSource
    || ""
  ).trim().toLowerCase();
}

/**
 * The value that was GUESSED from the file name, when recorded. The weak label
 * is bound to that value: once a person types a different supplier/brand
 * (preview "Sửa", catalog editor, bulk edit), the label no longer applies.
 */
export function guessedSupplierValue(product = {}) {
  const v = product?._meta?.supplierGuess ?? product?.attributes?.provenance?.supplierValue;
  return v == null ? null : String(v);
}

export function guessedBrandValue(product = {}) {
  const v = product?._meta?.brandGuess ?? product?.attributes?.provenance?.brandValue;
  return v == null ? null : String(v);
}

function sameGuessedValue(guess, current) {
  if (guess == null) return true; // label without a recorded value (engine rows, RC16-first data)
  return foldIdentityText(guess) === foldIdentityText(current || "");
}

export function isWeakSupplierEvidence(product = {}) {
  return supplierEvidenceSource(product) === "file_name" && sameGuessedValue(guessedSupplierValue(product), product?.supplier);
}

export function brandEvidenceSource(product = {}) {
  return String(
    product?._meta?.brandSource
    || product?._meta?.source?.brandSource
    || product?.source?.brandSource
    || product?.attributes?.provenance?.brandSource
    || ""
  ).trim().toLowerCase();
}

/** RC16 S1: a brand inferred only from the file name is weak context, like a filename supplier. */
export function isWeakBrandEvidence(product = {}) {
  return brandEvidenceSource(product) === "file_name" && sameGuessedValue(guessedBrandValue(product), product?.brand);
}

/** Source label that is true for the CURRENT value: "user" when a person replaced a guess. */
export function effectiveSupplierSource(product = {}) {
  const src = supplierEvidenceSource(product);
  if (src !== "file_name") return src;
  return isWeakSupplierEvidence(product) ? "file_name" : "user";
}

export function effectiveBrandSource(product = {}) {
  const src = brandEvidenceSource(product);
  if (src !== "file_name") return src;
  return isWeakBrandEvidence(product) ? "file_name" : "user";
}

/**
 * RC16: supplier/brand/origin as they may appear on a CUSTOMER-FACING quote.
 * A supplier or brand that SmartQuote only guessed from an import file name
 * ("den", "thang 10", "Book1") is never printed under Xuất xứ / Hãng / NCC.
 */
export function customerFacingParty(product = {}) {
  const supplier = String(product?.supplier || "").trim();
  const brand = String(product?.brand || "").trim();
  return {
    supplier: supplier && !isWeakSupplierEvidence(product) ? supplier : "",
    brand: brand && !isWeakBrandEvidence(product) ? brand : "",
    origin: String(product?.origin || product?.attributes?.origin || "").trim(),
  };
}

export function normalizeIdentitySupplier(product = {}) {
  // RC15 F3: a supplier guessed only from the filename is weak context, not
  // catalog identity evidence. It must not split an otherwise identical SKU.
  if (isWeakSupplierEvidence(product)) return "";
  return foldIdentityText(product.supplier || "").replace(/\s+/g, "");
}

export function normalizeIdentityBrand(product = {}) {
  if (isWeakBrandEvidence(product)) return "";
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
 * A "clear model code": at least 6 normalized characters with both letters and
 * digits (LM-ST12-75-55-40CrBTC-O1, DS-2CD1023G0E). Short/generic codes such as
 * "FU", "DEN", "12W" are not clear and keep the strict variant rule.
 */
export function isClearModelSku(value = "") {
  const sku = normalizeIdentitySku(value);
  return sku.length >= 6 && /[a-z]/.test(sku) && /\d/.test(sku);
}

/** RC16 S2: dimension of a variant token, so 3000K vs 4000K conflict but 12W vs (missing) does not. */
export function variantTokenDimension(token = "") {
  const t = String(token || "").toLowerCase().replace(/\s+/g, "");
  if (/^ip\d{2}$/.test(t)) return "ip";
  if (/^\d+(?:\.\d+)?[x×]\d+/.test(t)) return "size";
  if (/^\d+(?:\.\d+)?(?:deg|°)$/.test(t)) return "angle";
  const m = t.match(/^\d+(?:\.\d+)?(kw|w|v|ma|a|hz|khz|mhz|ghz|k|mm|cm|mp|ch|tb|gb|mb|lm|lumen|gang|nut)$/);
  if (!m) return `other:${t}`;
  const unit = m[1];
  if (unit === "kw" || unit === "w") return "power";
  if (unit === "k") return "cct";
  if (unit === "mm" || unit === "cm") return "lens_or_length";
  if (unit === "mp") return "resolution";
  if (unit === "ch") return "channels";
  if (unit === "gang" || unit === "nut") return "gang";
  if (unit === "ma" || unit === "a") return "current";
  if (unit === "v") return "voltage";
  if (unit === "lm" || unit === "lumen") return "lumen";
  if (["hz", "khz", "mhz", "ghz"].includes(unit)) return "frequency";
  if (["tb", "gb", "mb"].includes(unit)) return "storage";
  return `other:${t}`;
}

function relaxedVariantTokens(product = {}) {
  const tokens = new Set(technicalVariantTokens(product));
  const raw = foldIdentityText([product.name, product.specs, product.description].filter(Boolean).join(" "));
  for (const m of raw.matchAll(/\b(\d+)\s*(gang|nut)\b/g)) tokens.add(`${m[1]}${m[2]}`);
  return [...tokens];
}

function groupByDimension(tokens = []) {
  const map = new Map();
  for (const token of tokens) {
    const dim = variantTokenDimension(token);
    if (!map.has(dim)) map.set(dim, new Set());
    map.get(dim).add(token);
  }
  return map;
}

/**
 * Fuzzy identity is allowed only when technical variant evidence is compatible.
 *
 * Strict rule (default): if either side exposes variant-defining tokens, both
 * sides must expose the exact same normalized token set. False negatives are
 * safer than 3000K→4000K or 2.8mm→3.6mm false positives.
 *
 * RC16 S2 relaxed rule — ONLY when both SKUs are the same clear model code:
 * a token missing on one side is compatible (12w vs 12w|4000k, the same light
 * written once with and once without its CCT), but two different values in the
 * same dimension (W, K, mm, MP, CH, gang/nút, …) still conflict.
 */
export function technicalVariantsCompatible(a = {}, b = {}) {
  const as = normalizeIdentitySku(a.sku);
  const bs = normalizeIdentitySku(b.sku);
  if (as && as === bs && isClearModelSku(as)) {
    const ad = groupByDimension(relaxedVariantTokens(a));
    const bd = groupByDimension(relaxedVariantTokens(b));
    for (const [dim, aset] of ad) {
      const bset = bd.get(dim);
      if (!bset) continue;
      if (dim.startsWith("other:")) continue;
      if (aset.size !== bset.size || [...aset].some((t) => !bset.has(t))) return false;
    }
    return true;
  }
  const av = technicalVariantTokens(a);
  const bv = technicalVariantTokens(b);
  if (!av.length && !bv.length) return true;
  if (!av.length || !bv.length) return false;
  return av.length === bv.length && av.every((token, idx) => token === bv[idx]);
}

export function learningPartyKey(product = {}) {
  const party = normalizeIdentityParty(product);
  if (party) return party;
  // RC16: a file-name supplier/brand is too weak to MERGE catalog identities,
  // but it is still the right SCOPE for remembering the dealer's own corrections
  // ("this supplier's file writes DL-12W-30 as …"). Same key format RC12–RC15
  // used, so corrections learned before RC16 keep applying.
  const weakSupplier = isWeakSupplierEvidence(product) ? foldIdentityText(product.supplier || "").replace(/\s+/g, "") : "";
  const weakBrand = isWeakBrandEvidence(product) ? foldIdentityText(product.brand || "").replace(/\s+/g, "") : "";
  if (weakSupplier && weakBrand) return `supplier:${weakSupplier}|brand:${weakBrand}`;
  if (weakSupplier) return `supplier:${weakSupplier}`;
  if (weakBrand) return `brand:${weakBrand}`;
  return "unknown";
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


export function buildCatalogMatchIndex(catalog = []) {
  const items = Array.isArray(catalog) ? catalog : [];
  const bySku = new Map();
  const byIdentity = new Map();
  const byName = new Map();
  items.forEach((item, index) => {
    const sku = normalizeIdentitySku(item?.sku);
    if (sku) {
      if (!bySku.has(sku)) bySku.set(sku, []);
      bySku.get(sku).push(index);
    }
    const identity = productIdentityKey(item);
    if (identity) {
      if (!byIdentity.has(identity)) byIdentity.set(identity, []);
      byIdentity.get(identity).push(index);
    }
    const name = normalizeIdentityName(item?.name);
    if (name) {
      if (!byName.has(name)) byName.set(name, []);
      byName.get(name).push(index);
    }
  });
  return { items, bySku, byIdentity, byName };
}

function chosenCatalogDecision(incoming = {}, index = {}) {
  const decision = incoming?._meta?.catalogMatchDecision;
  if (!decision || !decision.kind) return null;
  if (decision.kind === "new") return { kind: "new", index: -1, candidates: [], reason: "user_add_new" };
  if (decision.kind === "update" && decision.targetId) {
    const idx = (index.items || []).findIndex((p) => String(p?.id || "") === String(decision.targetId));
    if (idx >= 0) return { kind: "update", index: idx, candidates: [idx], reason: "user_selected_target" };
  }
  return null;
}

/**
 * RC15 F3 — one catalog matcher for preview, validation, import counts and save.
 * It deliberately fails closed on unresolved same-SKU ambiguity.
 */
export function resolveCatalogMatch(incoming = {}, catalogIndex = buildCatalogMatchIndex([])) {
  const forced = chosenCatalogDecision(incoming, catalogIndex);
  if (forced) return forced;

  const items = catalogIndex.items || [];
  const sku = normalizeIdentitySku(incoming?.sku);
  if (sku) {
    const skuCandidates = [...(catalogIndex.bySku?.get(sku) || [])];
    if (!skuCandidates.length) return { kind: "new", index: -1, candidates: [], reason: "sku_not_found" };

    const compatible = skuCandidates.filter((idx) => canAutoMergeIdentity(items[idx], incoming));
    if (compatible.length === 1) return { kind: "update", index: compatible[0], candidates: compatible, reason: "single_compatible_sku" };

    const incomingName = normalizeIdentityName(incoming?.name);
    const incomingVariant = technicalVariantSignature(incoming);
    const exactVisible = skuCandidates.filter((idx) => {
      const candidate = items[idx];
      const sameName = !!incomingName && normalizeIdentityName(candidate?.name) === incomingName;
      const sameVariant = technicalVariantSignature(candidate) === incomingVariant;
      const partyMatch = partyEvidenceMatch(candidate, incoming);
      return sameName && sameVariant && partyMatch !== false;
    });
    if (exactVisible.length === 1) return { kind: "update", index: exactVisible[0], candidates: exactVisible, reason: "name_variant_disambiguated" };

    return { kind: "ambiguous", index: -1, candidates: skuCandidates, reason: compatible.length > 1 ? "multiple_compatible_sku" : "sku_conflict" };
  }

  const identity = productIdentityKey(incoming);
  if (identity) {
    const candidates = [...(catalogIndex.byIdentity?.get(identity) || [])];
    if (candidates.length === 1) return { kind: "update", index: candidates[0], candidates, reason: "single_identity_key" };
    if (candidates.length > 1) return { kind: "ambiguous", index: -1, candidates, reason: "multiple_identity_key" };
  }

  const incomingName = normalizeIdentityName(incoming?.name);
  if (incomingName) {
    const nameCandidates = [...(catalogIndex.byName?.get(incomingName) || [])];
    const variant = technicalVariantSignature(incoming);
    const compatible = nameCandidates.filter((idx) => {
      const candidate = items[idx];
      const sameVariant = technicalVariantSignature(candidate) === variant;
      const partyMatch = partyEvidenceMatch(candidate, incoming);
      return sameVariant && partyMatch !== false;
    });
    if (compatible.length === 1) return { kind: "update", index: compatible[0], candidates: compatible, reason: "name_variant_match" };
    if (nameCandidates.length > 0) return { kind: "ambiguous", index: -1, candidates: nameCandidates, reason: "name_match_ambiguous" };
  }
  return { kind: "new", index: -1, candidates: [], reason: "no_catalog_identity_match" };
}

export function findDuplicateSkuGroups(catalog = []) {
  const groups = new Map();
  (catalog || []).forEach((item, index) => {
    const sku = normalizeIdentitySku(item?.sku);
    if (!sku) return;
    if (!groups.has(sku)) groups.set(sku, []);
    groups.get(sku).push({ index, item });
  });
  return [...groups.entries()].map(([sku, entries]) => {
    const sameNameGroups = new Map();
    entries.forEach((entry) => {
      const nk = normalizeIdentityName(entry.item?.name) || "(no-name)";
      if (!sameNameGroups.has(nk)) sameNameGroups.set(nk, []);
      sameNameGroups.get(nk).push(entry);
    });
    return { sku, entries, sameNameGroups };
  }).filter((group) => [...group.sameNameGroups.values()].some((entries) => entries.length > 1));
}


export function annotateCatalogMatches(items = [], catalog = []) {
  const index = buildCatalogMatchIndex(catalog);
  return (items || []).map((product) => {
    const match = resolveCatalogMatch(product, index);
    const meta = { ...(product?._meta || {}) };
    const existingIssues = Array.isArray(meta.issues) ? meta.issues : Array.isArray(product?.issues) ? product.issues : [];
    const keepIssues = existingIssues.filter((it) => String(it?.code || '').toLowerCase() !== 'catalog_match_ambiguous');
    const candidates = (match.candidates || []).map((idx) => {
      const item = index.items[idx] || {};
      return { index: idx, id: item.id || null, name: item.name || '', sku: item.sku || '', supplier: item.supplier || '' };
    });
    const target = match.kind === 'update' ? (index.items[match.index] || null) : null;
    const catalogMatch = {
      kind: match.kind,
      targetId: target ? (target.id || null) : null,
      // RC16: what the catalog already holds, so the preview can show the
      // supplier/brand that will actually be SAVED (weak file-name evidence
      // never overwrites it — see catalogImportMerge.mergePayload).
      targetSupplier: target ? (target.supplier || '') : '',
      targetBrand: target ? (target.brand || '') : '',
      index: match.index,
      candidates,
      reason: match.reason,
    };
    if (match.kind !== 'ambiguous') {
      const hasActionable = keepIssues.some((it) => ['warning','error'].includes(String(it?.level || 'warning').toLowerCase()));
      return {
        ...product,
        _meta: {
          ...meta,
          issues: keepIssues,
          catalogMatch,
          status: hasActionable ? (meta.status || 'review') : 'new',
          canonicalStatus: hasActionable ? (meta.canonicalStatus || 'need_review') : 'auto_approved',
        },
      };
    }
    const names = candidates.slice(0, 3).map((c) => c.name || c.sku || c.id).filter(Boolean);
    const warning = {
      code: 'catalog_match_ambiguous',
      level: 'warning',
      message: `SKU/tên có thể khớp nhiều cách với catalog${names.length ? `: ${names.join(' · ')}` : ''}. Chọn Cập nhật hoặc Thêm mới trước khi nhập.`,
      field: 'sku',
      suggestedFix: 'Chọn sản phẩm catalog cần cập nhật hoặc xác nhận thêm thành sản phẩm mới',
      evidence: { candidates },
    };
    return {
      ...product,
      _meta: {
        ...meta,
        issues: [...keepIssues, warning],
        status: 'review',
        canonicalStatus: 'need_review',
        catalogMatch,
      },
    };
  });
}
