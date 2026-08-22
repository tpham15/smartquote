import { PLAN_CAPABILITIES } from './planCatalog.generated.js';
import { normalizeBilling } from './planLimits.js';
export { PLAN_CAPABILITIES };
export const CAPABILITY_LABELS = {
  ai_import: 'Nhập bằng AI / đọc PDF',
  template_memory: 'Nhớ template nhà cung cấp',
  correction_learning: 'Học từ chỉnh sửa',
  branded_pdf: 'Báo giá PDF thương hiệu riêng',
  quote_variants_abc: 'Phương án báo giá A/B/C',
  bom_import: 'Nhập BOM/takeoff từ KTS',
  team_seats: 'Nhiều thành viên trong workspace',
  price_intelligence: 'Dữ liệu giá thị trường',
  api_access: 'Truy cập API',
  priority_support: 'Hỗ trợ ưu tiên',
};
export function canAccessCapability(billing, capabilityKey) {
  const state = normalizeBilling(billing || {});
  if (state.locked) return { ok: false, reason: state.lockReason, state, capability: capabilityKey };
  const enabled = PLAN_CAPABILITIES[state.effectivePlan]?.[capabilityKey] === true;
  const label = CAPABILITY_LABELS[capabilityKey] || capabilityKey;
  return { ok: enabled, state, capability: capabilityKey, reason: enabled ? '' : `Tính năng "${label}" chỉ có ở gói cao hơn gói ${state.label} hiện tại.` };
}
