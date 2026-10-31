import { supabase } from './client.js';

function asNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toRpcObservation(row = {}) {
  return {
    observation_key: String(row.observationKey || '').trim(),
    quote_revision: Math.max(1, asNumber(row.revision, 1)),
    product_key: String(row.productKey || '').trim(),
    product_id: String(row.product?.id || '').trim() || null,
    product_snapshot: row.product || {},
    customer_category: String(row.customerCategory || '').trim() || null,
    project_name: String(row.project || '').trim() || null,
    industry_profile: String(row.industryId || 'generic').trim() || 'generic',
    section_names: Array.isArray(row.sectionNames) ? row.sectionNames : [],
    total_qty: Math.max(0, asNumber(row.totalQty, 0)),
    sale_price: Math.max(0, asNumber(row.salePrice, 0)),
    cost_price: Math.max(0, asNumber(row.costPrice, 0)),
    margin_pct: row.marginPct == null ? null : asNumber(row.marginPct, null),
    finalized_at: row.finalizedAt || new Date().toISOString(),
  };
}

export async function recordCloudQuoteLearning(dealerId, quoteId, observations = []) {
  if (!supabase || !dealerId || !quoteId || !Array.isArray(observations) || !observations.length) {
    return { inserted: 0 };
  }
  const { data, error } = await supabase.rpc('record_quote_learning_observations', {
    target_dealer_id: dealerId,
    target_quote_id: quoteId,
    observations_input: observations.map(toRpcObservation),
  });
  if (error) throw error;
  return data || { inserted: observations.length };
}

export async function listCloudQuoteLearningObservations(dealerId, { limit = 2000 } = {}) {
  if (!supabase || !dealerId) return [];
  const safeLimit = Math.max(1, Math.min(5000, Number(limit) || 2000));
  const { data, error } = await supabase
    .from('quote_learning_observations')
    .select('id, dealer_id, quote_id, observation_key, quote_revision, product_key, product_snapshot, customer_category, project_name, industry_profile, section_names, total_qty, sale_price, cost_price, margin_pct, finalized_at, created_at')
    .eq('dealer_id', dealerId)
    .order('finalized_at', { ascending: false })
    .limit(safeLimit);
  if (error) throw error;
  return data || [];
}
