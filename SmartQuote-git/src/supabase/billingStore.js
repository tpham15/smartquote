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

const VIETQR_TEMPLATES = new Set(['compact2', 'compact', 'qr_only', 'print']);

export function buildVietQrUrl({ bankId = '', accountNo = '', amount = 0, addInfo = '', accountName = '', template = 'compact2' } = {}) {
  const safeBankId = String(bankId || '').trim();
  const safeAccountNo = String(accountNo || '').trim();
  if (!/^[a-zA-Z0-9]+$/.test(safeBankId)) return '';
  if (!/^[a-zA-Z0-9]{6,19}$/.test(safeAccountNo)) return '';

  const safeTemplate = VIETQR_TEMPLATES.has(String(template || '').trim()) ? String(template).trim() : 'compact2';
  const params = new URLSearchParams();
  const numericAmount = Math.max(0, Math.round(Number(amount) || 0));
  if (numericAmount > 0) params.set('amount', String(numericAmount));
  if (String(addInfo || '').trim()) params.set('addInfo', String(addInfo).trim().slice(0, 50));
  if (String(accountName || '').trim()) params.set('accountName', String(accountName).trim().slice(0, 50));

  const query = params.toString();
  return `https://img.vietqr.io/image/${safeBankId}-${safeAccountNo}-${safeTemplate}.png${query ? `?${query}` : ''}`;
}

export async function markManualBillingPaid(dealerId, billingEventId) {
  if (!supabase || !dealerId || !billingEventId) throw new Error('Thiếu workspace hoặc yêu cầu thanh toán.');
  const { data, error } = await supabase.rpc('mark_manual_billing_event_paid', {
    target_dealer_id: dealerId,
    target_billing_event_id: billingEventId,
  });
  if (error) throw error;
  return data;
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
