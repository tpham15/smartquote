import { supabase } from './client.js';
import { PLAN_PRICE_VND } from '../billing/planCatalog.generated.js';

export { PLAN_PRICE_VND };

export const BILLING_CYCLES = {
  monthly: { label: 'Theo tháng', months: 1 },
  annual: { label: 'Theo năm', months: 12 },
};

export function formatVnd(amount) {
  return `${Number(amount || 0).toLocaleString('vi-VN')}đ`;
}

export function getPlanPriceVnd(plan, billingCycle = 'monthly') {
  return PLAN_PRICE_VND[String(plan || '').toLowerCase()]?.[billingCycle] || 0;
}

export async function requestManualUpgrade(dealerId, { plan, billingCycle = 'monthly', customerNote = '', customerContact = '' } = {}) {
  if (!supabase || !dealerId) throw new Error('Supabase chưa được cấu hình hoặc thiếu workspace.');
  const { data, error } = await supabase.rpc('create_manual_billing_request', {
    target_dealer_id: dealerId,
    requested_plan: plan,
    billing_cycle_input: billingCycle,
    customer_note_input: customerNote || '',
    customer_contact_input: customerContact || '',
  });
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}

export async function listBillingEvents(dealerId, { limit = 20 } = {}) {
  if (!supabase || !dealerId) return [];
  const { data, error } = await supabase
    .from('billing_events')
    .select('id, dealer_id, plan, billing_cycle, months, amount_vnd, status, transfer_content, customer_note, customer_contact, admin_note, payment_reference, activated_at, expires_at, created_at, updated_at')
    .eq('dealer_id', dealerId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}
