// ============================================================
// matchCatalog — deterministic catalog matching.
// P1.5.4 P0 identity safety: exact SKU is supplier/brand aware and
// ambiguous identities fail closed instead of taking the last catalog row.
// ============================================================
import { STATUS } from "./types.js";
import {
  normalizeIdentitySku,
  normalizeIdentityParty,
  normalizeIdentityName,
  technicalVariantsCompatible,
  partyEvidenceMatch,
  hasIdentityPartyEvidence,
} from "./productIdentity.js";

/** Chuẩn hoá chuỗi để so khớp: bỏ dấu, ký tự đặc biệt, lowercase */
function norm(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9]/g, "");
}

/** Chuẩn hoá SKU: giữ chữ-số, bỏ phân cách */
function normSku(s) {
  return normalizeIdentitySku(s);
}

/** Độ tương đồng đơn giản (Dice coefficient trên bigram) */
function similarity(a, b) {
  const na = norm(a), nb = norm(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const bigrams = (s) => {
    const set = new Set();
    for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
    return set;
  };
  const A = bigrams(na), B = bigrams(nb);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const g of A) if (B.has(g)) inter++;
  return (2 * inter) / (A.size + B.size);
}

function pushIndex(map, key, product) {
  if (!key) return;
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(product);
}

function uniqueCandidate(candidates = [], item = {}) {
  if (candidates.length === 1) return candidates[0];
  if (candidates.length <= 1) return null;
  const itemName = normalizeIdentityName(item.name);
  if (!itemName) return null;
  const exactName = candidates.filter((p) => normalizeIdentityName(p.name) === itemName);
  return exactName.length === 1 ? exactName[0] : null;
}

function exactSkuCandidate(item, indexes) {
  const sku = normalizeIdentitySku(item.sku);
  if (!sku) return { product: null, ambiguous: false };
  const party = normalizeIdentityParty(item);
  const all = indexes.bySku.get(sku) || [];
  if (!all.length) return { product: null, ambiguous: false };

  if (party) {
    const scoped = all.filter((p) => partyEvidenceMatch(item, p) === true);
    const exact = uniqueCandidate(scoped, item);
    if (exact) return { product: exact, ambiguous: false };
    if (scoped.length > 1) return { product: null, ambiguous: true };

    // A completely unknown-party catalog row may be used only when it is the
    // sole SKU candidate. Known-but-noncomparable or conflicting party evidence
    // never wins automatically.
    if (all.length === 1 && !hasIdentityPartyEvidence(all[0])) {
      return { product: all[0], ambiguous: false };
    }
    return { product: null, ambiguous: all.length > 0 };
  }

  const exact = uniqueCandidate(all, item);
  if (exact) return { product: exact, ambiguous: false };
  return { product: null, ambiguous: all.length > 1 };
}

function exactNameCandidate(item, indexes) {
  const name = normalizeIdentityName(item.name);
  if (!name) return { product: null, ambiguous: false };
  const party = normalizeIdentityParty(item);
  const all = indexes.byName.get(name) || [];
  if (!all.length) return { product: null, ambiguous: false };
  if (party) {
    const scoped = all.filter((p) => partyEvidenceMatch(item, p) === true);
    if (scoped.length === 1) return { product: scoped[0], ambiguous: false };
    if (scoped.length > 1) return { product: null, ambiguous: true };
    if (all.length === 1 && !hasIdentityPartyEvidence(all[0])) return { product: all[0], ambiguous: false };
    return { product: null, ambiguous: all.length > 0 };
  }
  return all.length === 1 ? { product: all[0], ambiguous: false } : { product: null, ambiguous: true };
}

/**
 * Khớp 1 item với catalog.
 * Correction order is intentionally unchanged in P0; learning precedence is P1.
 */
function correctionCandidate(item, indexes, corrections) {
  const rawKey = norm(item.source?.rawText || item.name);
  const targetId = corrections && corrections[rawKey];
  if (!targetId) return { product: null, valid: false };

  const target = indexes.catalog.find((p) => String(p.id) === String(targetId));
  if (!target) return { product: null, valid: false };

  const itemSku = normalizeIdentitySku(item.sku);
  const targetSku = normalizeIdentitySku(target.sku);
  if (itemSku && targetSku && itemSku !== targetSku) return { product: null, valid: false };

  const itemParty = normalizeIdentityParty(item);
  const targetParty = normalizeIdentityParty(target);
  const partyMatch = partyEvidenceMatch(item, target);
  if (partyMatch === false) return { product: null, valid: false };
  if (itemParty && targetParty && partyMatch === null) return { product: null, valid: false };

  if (!technicalVariantsCompatible(item, target)) return { product: null, valid: false };
  return { product: target, valid: true };
}

/**
 * Match precedence:
 * 1) exact supplier/brand-aware SKU
 * 2) validated correction memory
 * 3) exact name
 * 4) variant-safe fuzzy suggestion
 */
function matchOne(item, indexes, corrections) {
  const skuMatch = exactSkuCandidate(item, indexes);
  if (skuMatch.product) {
    return { matchedProductId: skuMatch.product.id, matchType: "sku", score: 1 };
  }

  const correction = correctionCandidate(item, indexes, corrections);
  if (correction.valid) {
    return { matchedProductId: correction.product.id, matchType: "correction", score: 0.98 };
  }

  if (skuMatch.ambiguous) {
    return { matchedProductId: null, matchType: "ambiguous_sku", score: 0 };
  }

  const nameMatch = exactNameCandidate(item, indexes);
  if (nameMatch.product) {
    return { matchedProductId: nameMatch.product.id, matchType: "name", score: 0.95 };
  }
  if (nameMatch.ambiguous) {
    return { matchedProductId: null, matchType: "ambiguous_name", score: 0 };
  }

  const party = normalizeIdentityParty(item);
  const candidates = party
    ? indexes.catalog.filter((p) => partyEvidenceMatch(item, p) === true || !hasIdentityPartyEvidence(p))
    : indexes.catalog;
  let best = null, bestScore = 0.82;
  for (const p of candidates) {
    if (!technicalVariantsCompatible(item, p)) continue;
    const s = similarity(item.name, p.name);
    if (s > bestScore) { bestScore = s; best = p; }
  }
  if (best) return { matchedProductId: best.id, matchType: "fuzzy", score: bestScore };

  return { matchedProductId: null, matchType: "none", score: 0 };
}

export function matchCatalog(items, catalog = [], corrections = {}) {
  const bySku = new Map();
  const byName = new Map();
  for (const p of catalog) {
    if (p.sku) pushIndex(bySku, normalizeIdentitySku(p.sku), p);
    if (p.name) pushIndex(byName, normalizeIdentityName(p.name), p);
  }
  const indexes = { bySku, byName, catalog };

  return items.map((item) => {
    const m = matchOne(item, indexes, corrections);
    return {
      ...item,
      matchedProductId: m.matchedProductId,
      _matchType: m.matchType,
      _matchScore: m.score,
    };
  });
}

export { norm, normSku, similarity };
