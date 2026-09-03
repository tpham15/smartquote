import { supabase } from './client.js';

export function isCloudQuoteEnabled(cloud) {
  return Boolean(cloud?.enabled && cloud?.dealerId && supabase);
}

export function normalizeQuoteRecord(row = {}) {
  const customer = row.customer && typeof row.customer === 'object'
    ? row.customer
    : {
        name: row.customer_name || '',
        phone: row.customer_phone || '',
        address: row.customer_address || '',
        project: row.project_name || '',
        quoteNumber: row.quote_number || '',
        category: row.category || '',
      };
  return {
    ...row,
    customer: {
      name: customer.name || row.customer_name || '',
      phone: customer.phone || row.customer_phone || '',
      address: customer.address || row.customer_address || '',
      project: customer.project || row.project_name || '',
      quoteNumber: customer.quoteNumber || row.quote_number || '',
      category: customer.category || row.category || '',
      customerId: customer.customerId || row.customer_id || null,
    },
    rooms: Array.isArray(row.rooms) ? row.rooms : [],
    calc: row.calc && typeof row.calc === 'object' ? row.calc : {},
  };
}

function buildQuotePayload(dealerId, quote = {}) {
  const customer = quote.customer || {};
  const calc = quote.calc || {};
  const rooms = Array.isArray(quote.rooms) ? quote.rooms : [];
  return {
    id: quote.id || null,
    dealer_id: dealerId,
    customer_id: customer.customerId || quote.customerId || null,
    customer_name: customer.name || '',
    customer_phone: customer.phone || '',
    customer_address: customer.address || '',
    project_name: customer.project || '',
    quote_number: customer.quoteNumber || '',
    category: customer.category || '',
    status: quote.status || 'draft',
    subtotal: Number(calc.deviceTotal || calc.subtotal || quote.subtotal || 0),
    labor_total: Number(calc.laborTotal || quote.laborTotal || 0),
    total: Number(calc.grand || calc.total || quote.total || 0),
    point_count: Number(calc.pointCount || quote.pointCount || 0),
    rooms,
    customer,
    calc,
  };
}

export async function listCloudQuotes(dealerId, { limit = 50, status } = {}) {
  if (!supabase || !dealerId) return [];
  let query = supabase
    .from('quotes')
    .select('id, dealer_id, customer_id, quote_number, customer_name, customer_phone, customer_address, project_name, category, status, subtotal, labor_total, total, point_count, rooms, customer, calc, created_at, updated_at, created_by')
    .eq('dealer_id', dealerId)
    .order('updated_at', { ascending: false })
    .limit(limit);
  if (status) query = query.eq('status', status);
  const { data, error } = await query;
  if (error) throw error;
  return (data || []).map(normalizeQuoteRecord);
}

export async function saveCloudQuote(dealerId, quote) {
  if (!supabase || !dealerId) throw new Error('Supabase chưa được cấu hình hoặc chưa có workspace.');
  const quoteInput = buildQuotePayload(dealerId, quote);
  const { data, error } = await supabase.rpc('save_quote', { quote_input: quoteInput });
  if (error) throw error;
  return data;
}

export async function loadCloudQuote(dealerId, quoteId) {
  if (!supabase || !dealerId || !quoteId) return null;
  const { data, error } = await supabase
    .from('quotes')
    .select('id, dealer_id, customer_id, quote_number, customer_name, customer_phone, customer_address, project_name, category, status, subtotal, labor_total, total, point_count, rooms, customer, calc, created_at, updated_at, created_by')
    .eq('dealer_id', dealerId)
    .eq('id', quoteId)
    .maybeSingle();
  if (error) throw error;
  return data ? normalizeQuoteRecord(data) : null;
}

export async function deleteCloudQuote(dealerId, quoteId) {
  if (!supabase || !dealerId || !quoteId) return;
  const { error } = await supabase
    .from('quotes')
    .delete()
    .eq('dealer_id', dealerId)
    .eq('id', quoteId);
  if (error) throw error;
}
