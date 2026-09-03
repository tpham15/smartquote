import { supabase } from './client.js';

const PAGE_SIZE = 1000;
const MAX_CATALOG_ROWS = 50000;

function asNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function asText(value) {
  return value == null ? '' : String(value);
}

function pickImage(product = {}) {
  return product.image || product.imageUrl || product.image_url || '';
}

function pickSourceUrl(product = {}) {
  return product.sourceUrl || product.source_url || product.url || '';
}

export function normalizeCatalogProduct(product = {}) {
  const id = asText(product.id).trim();
  const name = asText(product.name || product.title).trim();
  return {
    ...product,
    id,
    name,
    sku: asText(product.sku || product.model || product.code).trim(),
    supplier: asText(product.supplier || product.vendor).trim(),
    brand: asText(product.brand).trim(),
    category: asText(product.category).trim(),
    unit: asText(product.unit || 'Cái').trim() || 'Cái',
    costPrice: asNumber(product.costPrice ?? product.cost_price, 0),
    listPrice: asNumber(product.listPrice ?? product.list_price, 0),
    publicPrice: asNumber(product.publicPrice ?? product.public_price, 0),
    minRetailPrice: asNumber(product.minRetailPrice ?? product.min_retail_price, 0),
    priceMode: asText(product.priceMode || product.price_mode || 'markup') || 'markup',
    specs: product.specs && typeof product.specs === 'object' ? product.specs : {},
    image: pickImage(product),
    sourceUrl: pickSourceUrl(product),
  };
}

export function normalizeCatalogProducts(products = []) {
  const seen = new Set();
  const out = [];
  (Array.isArray(products) ? products : []).forEach((item) => {
    const product = normalizeCatalogProduct(item);
    if (!product.id || !product.name) return;
    const key = product.id;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(product);
  });
  return out;
}

export function serializeProductsForCatalog(products = []) {
  return JSON.stringify(normalizeCatalogProducts(products).map((p) => ({
    id: p.id,
    name: p.name,
    sku: p.sku || '',
    supplier: p.supplier || '',
    brand: p.brand || '',
    category: p.category || '',
    unit: p.unit || 'Cái',
    costPrice: asNumber(p.costPrice, 0),
    listPrice: asNumber(p.listPrice, 0),
    publicPrice: asNumber(p.publicPrice, 0),
    minRetailPrice: asNumber(p.minRetailPrice, 0),
    priceMode: p.priceMode || 'markup',
    image: p.image || '',
    sourceUrl: p.sourceUrl || '',
    specs: p.specs || {},
  })));
}

export function productToCatalogRpcItem(product = {}) {
  const p = normalizeCatalogProduct(product);
  return {
    id: p.id,
    name: p.name,
    sku: p.sku || null,
    supplier: p.supplier || null,
    brand: p.brand || null,
    category: p.category || null,
    unit: p.unit || 'Cái',
    cost_price: asNumber(p.costPrice, 0),
    list_price: asNumber(p.listPrice, 0),
    public_price: asNumber(p.publicPrice, 0),
    min_retail_price: asNumber(p.minRetailPrice, 0),
    price_mode: p.priceMode || 'markup',
    image_url: p.image || null,
    source_url: p.sourceUrl || null,
    specs: p.specs || {},
    raw_product: p,
  };
}

export function catalogRowToProduct(row = {}) {
  const raw = row.raw_product && typeof row.raw_product === 'object' ? row.raw_product : {};
  return normalizeCatalogProduct({
    ...raw,
    id: row.id || raw.id,
    name: row.name || raw.name,
    sku: row.sku || raw.sku || '',
    supplier: row.supplier || raw.supplier || '',
    brand: row.brand || raw.brand || '',
    category: row.category || raw.category || '',
    unit: row.unit || raw.unit || 'Cái',
    costPrice: row.cost_price ?? raw.costPrice ?? 0,
    listPrice: row.list_price ?? raw.listPrice ?? 0,
    publicPrice: row.public_price ?? raw.publicPrice ?? 0,
    minRetailPrice: row.min_retail_price ?? raw.minRetailPrice ?? 0,
    priceMode: row.price_mode || raw.priceMode || 'markup',
    image: row.image_url || raw.image || '',
    sourceUrl: row.source_url || raw.sourceUrl || '',
    specs: row.specs || raw.specs || {},
  });
}

export async function listCloudCatalog(dealerId, { maxRows = MAX_CATALOG_ROWS } = {}) {
  if (!supabase || !dealerId) return [];
  const rows = [];
  for (let from = 0; from < maxRows; from += PAGE_SIZE) {
    const to = Math.min(from + PAGE_SIZE - 1, maxRows - 1);
    const { data, error } = await supabase
      .from('catalog_items')
      .select('id, dealer_id, name, sku, supplier, brand, category, unit, cost_price, list_price, public_price, min_retail_price, price_mode, image_url, source_url, specs, raw_product, updated_at')
      .eq('dealer_id', dealerId)
      .order('updated_at', { ascending: false })
      .range(from, to);
    if (error) {
      if (error.code === '42P01' || /catalog_items/i.test(error.message || '')) {
        console.warn('Bảng catalog_items chưa tồn tại. Hãy chạy supabase/phase5_catalog_items.sql.');
        return [];
      }
      throw error;
    }
    const batch = data || [];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }
  return rows.map(catalogRowToProduct);
}

export async function syncCloudCatalogSnapshot(dealerId, products, { mode = 'snapshot', importMeta = null } = {}) {
  if (!supabase || !dealerId) return { count: 0 };
  const catalogItems = normalizeCatalogProducts(products).map(productToCatalogRpcItem);
  const { data, error } = await supabase.rpc('sync_catalog_items', {
    target_dealer_id: dealerId,
    catalog_items_input: catalogItems,
    sync_mode: mode,
    import_input: importMeta || null,
  });
  if (error) throw error;
  return data || { count: catalogItems.length };
}

export async function logCloudCatalogImport(dealerId, { sourceType = 'manual', sourceName = '', mergeMode = 'merge', products = [], status = 'applied', reviewRows = 0 } = {}) {
  if (!supabase || !dealerId) return null;
  const rows = normalizeCatalogProducts(products).map(productToCatalogRpcItem);
  const { data, error } = await supabase.rpc('log_catalog_import', {
    target_dealer_id: dealerId,
    import_input: {
      source_type: sourceType,
      source_name: sourceName,
      merge_mode: mergeMode,
      status,
      total_rows: rows.length,
      clean_rows: rows.length,
      review_rows: reviewRows,
      rows,
    },
  });
  if (error) throw error;
  return data;
}

export async function deleteCloudCatalogItems(dealerId, productIds = []) {
  if (!supabase || !dealerId) return { count: 0 };
  const ids = Array.from(new Set((productIds || []).map((id) => String(id || '').trim()).filter(Boolean)));
  if (!ids.length) return { count: 0 };
  const { error } = await supabase
    .from('catalog_items')
    .delete()
    .eq('dealer_id', dealerId)
    .in('id', ids);
  if (error) throw error;
  return { count: ids.length };
}

export async function replaceCloudCatalog(dealerId, products = [], importMeta = null) {
  return syncCloudCatalogSnapshot(dealerId, products, { mode: 'replace', importMeta });
}
