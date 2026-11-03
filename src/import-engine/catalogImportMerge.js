import { canonicalizeLegacyProductForMatching } from './productSemantics.js';
import { buildCatalogMatchIndex, resolveCatalogMatch, isWeakSupplierEvidence, isWeakBrandEvidence, effectiveSupplierSource, effectiveBrandSource } from './productIdentity.js';
import { mergeImportedCatalogProduct } from './priceRoleMerge.js';

/**
 * RC16 S1: persist where supplier/brand came from. attributes survive the cloud
 * catalog round-trip (serializeProductsForCatalog / raw_product); _meta does not.
 */
function provenanceFor(product = {}) {
  const out = {};
  const supplierSource = effectiveSupplierSource(product);
  const brandSource = effectiveBrandSource(product);
  if (supplierSource && product.supplier) out.supplierSource = supplierSource;
  if (brandSource && product.brand) out.brandSource = brandSource;
  return out;
}

function withProvenance(product = {}, provenance = {}) {
  const attributes = { ...(product.attributes || {}) };
  const merged = { ...provenance };
  if (!merged.supplierSource || !product.supplier) delete merged.supplierSource;
  if (!merged.brandSource || !product.brand) delete merged.brandSource;
  // Bind a weak label to the exact guessed value: if someone later edits the
  // supplier/brand, the label stops applying (customer quotes then show it).
  if (merged.supplierSource === 'file_name') merged.supplierValue = product.supplier;
  if (merged.brandSource === 'file_name') merged.brandValue = product.brand;
  if (Object.keys(merged).length) attributes.provenance = merged;
  else delete attributes.provenance;
  const label = (src) => (src && typeof src === 'object'
    ? { ...src, supplierSource: merged.supplierSource || '', brandSource: merged.brandSource || '' }
    : src);
  const meta = { ...(product._meta || {}) };
  meta.supplierSource = merged.supplierSource || '';
  meta.brandSource = merged.brandSource || '';
  if (merged.supplierSource === 'file_name') meta.supplierGuess = product.supplier; else delete meta.supplierGuess;
  if (merged.brandSource === 'file_name') meta.brandGuess = product.brand; else delete meta.brandGuess;
  if (meta.source) meta.source = label(meta.source);
  const out = { ...product, attributes, _meta: meta };
  // RC16 storage: product.source is a preview-time copy of _meta.source
  // (S1-5). Do not persist it twice in the catalog — provenance lives in
  // attributes.provenance + _meta.
  delete out.source;
  return out;
}

function mergePayload(existing = {}, incoming = {}) {
  // Weak (filename-guessed) evidence never overwrites what the catalog already
  // has — including an intentionally EMPTY supplier/brand.
  const weakSupplier = isWeakSupplierEvidence(incoming);
  const weakBrand = isWeakBrandEvidence(incoming);
  const supplier = weakSupplier
    ? (existing.supplier || '')
    : (incoming.supplier || existing.supplier || '');
  const brand = weakBrand
    ? (existing.brand || '')
    : (incoming.brand || existing.brand || '');
  const provenance = {
    supplierSource: weakSupplier || !incoming.supplier ? effectiveSupplierSource(existing) : effectiveSupplierSource(incoming),
    brandSource: weakBrand || !incoming.brand ? effectiveBrandSource(existing) : effectiveBrandSource(incoming),
  };
  return withProvenance({
    ...incoming,
    name: incoming.name || existing.name,
    specs: incoming.specs || existing.specs,
    category: incoming.category || existing.category,
    productType: incoming.productType || existing.productType || '',
    subtype: incoming.subtype || existing.subtype || '',
    model: incoming.model || existing.model || '',
    attributes: {
      ...(existing.attributes || {}),
      ...(incoming.attributes || {}),
      identity: {
        ...(existing.attributes?.identity || {}),
        ...(incoming.attributes?.identity || {}),
      },
    },
    supplier,
    brand,
    unit: incoming.unit || existing.unit,
  }, provenance);
}

/** RC15 F3: production save-path merge used by UI and smoke tests. */
export function mergeCatalogImport(existingCatalog = [], incomingItems = [], { idFactory } = {}) {
  const updated = (existingCatalog || []).map((p) => canonicalizeLegacyProductForMatching(p));
  // RC15 F3: preview/validation/count/save must resolve against the SAME catalog
  // snapshot. Do not let row N see rows newly added earlier in the same import;
  // otherwise an empty-catalog Roger import would turn the 2nd reused FU code
  // into an ambiguity even though preview correctly classified every row as new.
  // True duplicates inside the source file are rejected by business validation
  // before this save helper receives safeItems.
  const baselineIndex = buildCatalogMatchIndex([...updated]);
  let added = 0;
  let changed = 0;
  let ambiguous = 0;

  (incomingItems || []).forEach((incoming, ordinal) => {
    const match = resolveCatalogMatch(incoming, baselineIndex);
    if (match.kind === 'update' && match.index >= 0) {
      const existing = updated[match.index];
      updated[match.index] = mergeImportedCatalogProduct(existing, mergePayload(existing, incoming));
      changed += 1;
      return;
    }
    if (match.kind === 'new') {
      const id = incoming.id || (typeof idFactory === 'function' ? idFactory(incoming, ordinal) : `import-${Date.now()}-${ordinal}`);
      updated.push(withProvenance({ ...incoming, id, priceMode: (incoming.listPrice || incoming.publicPrice) ? 'fixed' : (incoming.priceMode || 'markup') }, provenanceFor(incoming)));
      added += 1;
      return;
    }
    ambiguous += 1;
  });

  return { products: updated, added, updated: changed, ambiguous };
}

export function projectedCatalogCount(existingCatalog = [], incomingItems = []) {
  return mergeCatalogImport(existingCatalog, incomingItems, { idFactory: (_p, i) => `projection-${i}` }).products.length;
}
