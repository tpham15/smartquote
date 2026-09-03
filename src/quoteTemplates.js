export const QUOTE_TEMPLATE_PRESETS = {
  smarthome_pro: {
    id: "smarthome_pro",
    name: "SmartHome Pro",
    industry: "smarthome",
    description: "Mẫu kỹ thuật nhiều cột cho smarthome, thiết bị điện, BOM.",
    config: {
      layoutType: "technical",
      brand: { primaryColor: "#1A7A4A", accentColor: "#D1FAE5", fontFamily: "Arial", logoUrl: "", logoText: "SMARTQUOTE" },
      page: { size: "A4", margin: "12mm" },
      sections: { showHeader: true, showCustomer: true, showProject: true, showRoomGroups: true, showSummary: true, showLabor: true, showTerms: true, showSignature: true },
      columns: { stt: true, note: true, image: true, sku: true, name: true, spec: true, supplier: true, unit: true, qty: true, unitPrice: true, total: true },
      labels: { title: "BẢNG BÁO GIÁ TỔNG HỢP", itemName: "Tên hàng hoá / Mô tả", note: "Khu vực lắp đặt", spec: "Thông số kỹ thuật", sku: "Mã thiết bị", supplier: "Xuất xứ", summaryTitle: "TỔNG HỢP CÁC GIẢI PHÁP" },
      terms: { intro: "Xin trân trọng gửi tới Quý Khách hàng Bảng báo giá với những chi tiết như sau:", validity: "Báo giá có giá trị trong vòng 14 ngày kể từ ngày báo giá.", payment: "Thanh toán theo thỏa thuận hai bên.", warranty: "Bảo hành theo chính sách của nhà sản xuất và đơn vị thi công." },
    },
  },
  lighting_project: {
    id: "lighting_project",
    name: "Lighting Project",
    industry: "lighting",
    description: "Mẫu dự án chiếu sáng, có ảnh, khu vực, công suất/thông số.",
    config: {
      layoutType: "project",
      brand: { primaryColor: "#B7791F", accentColor: "#FEF3C7", fontFamily: "Arial", logoUrl: "", logoText: "LIGHTING" },
      page: { size: "A4", margin: "12mm" },
      sections: { showHeader: true, showCustomer: true, showProject: true, showRoomGroups: true, showSummary: true, showLabor: true, showTerms: true, showSignature: true },
      columns: { stt: true, note: true, image: true, sku: true, name: true, spec: true, supplier: false, unit: true, qty: true, unitPrice: true, total: true },
      labels: { title: "BẢNG BÁO GIÁ CHIẾU SÁNG", itemName: "Sản phẩm / Mô tả", note: "Khu vực", spec: "Thông số / Công suất", sku: "Mã đèn", supplier: "Hãng", summaryTitle: "TỔNG HỢP HẠNG MỤC" },
      terms: { intro: "Xin gửi Quý Khách bảng báo giá thiết bị chiếu sáng theo từng khu vực như sau:", validity: "Báo giá có hiệu lực trong 15 ngày.", payment: "Thanh toán theo tiến độ giao hàng/lắp đặt.", warranty: "Bảo hành theo tiêu chuẩn nhà sản xuất." },
    },
  },
  interior_visual: {
    id: "interior_visual",
    name: "Interior Visual",
    industry: "interior",
    description: "Mẫu nội thất nhiều hình ảnh, mô tả đẹp, ít cột kỹ thuật hơn.",
    config: {
      layoutType: "visual",
      brand: { primaryColor: "#7C3AED", accentColor: "#F3E8FF", fontFamily: "Arial", logoUrl: "", logoText: "INTERIOR" },
      page: { size: "A4", margin: "12mm" },
      sections: { showHeader: true, showCustomer: true, showProject: true, showRoomGroups: true, showSummary: true, showLabor: true, showTerms: true, showSignature: true },
      columns: { stt: true, note: true, image: true, sku: false, name: true, spec: true, supplier: false, unit: true, qty: true, unitPrice: true, total: true },
      labels: { title: "BÁO GIÁ NỘI THẤT", itemName: "Hạng mục / Sản phẩm", note: "Không gian", spec: "Vật liệu / Kích thước / Ghi chú", sku: "Mã", supplier: "Nguồn", summaryTitle: "TỔNG HỢP CHI PHÍ" },
      terms: { intro: "Xin gửi Quý Khách bảng báo giá nội thất theo hạng mục và không gian như sau:", validity: "Báo giá có hiệu lực trong 10 ngày và có thể thay đổi theo vật liệu thực tế.", payment: "Thanh toán 50% khi xác nhận đơn hàng, phần còn lại theo tiến độ nghiệm thu.", warranty: "Bảo hành theo từng hạng mục và vật liệu sử dụng." },
    },
  },
  camera_security: {
    id: "camera_security",
    name: "Camera / Security",
    industry: "camera",
    description: "Mẫu camera, an ninh, mạng, nhấn mạnh model, phụ kiện, bảo hành.",
    config: {
      layoutType: "technical",
      brand: { primaryColor: "#0F766E", accentColor: "#CCFBF1", fontFamily: "Arial", logoUrl: "", logoText: "SECURITY" },
      page: { size: "A4", margin: "12mm" },
      sections: { showHeader: true, showCustomer: true, showProject: true, showRoomGroups: true, showSummary: true, showLabor: true, showTerms: true, showSignature: true },
      columns: { stt: true, note: true, image: true, sku: true, name: true, spec: true, supplier: true, unit: true, qty: true, unitPrice: true, total: true },
      labels: { title: "BÁO GIÁ CAMERA / AN NINH", itemName: "Thiết bị / Phụ kiện", note: "Vị trí", spec: "Thông số", sku: "Model", supplier: "Hãng", summaryTitle: "TỔNG HỢP HỆ THỐNG" },
      terms: { intro: "Xin gửi Quý Khách bảng báo giá hệ thống camera/an ninh như sau:", validity: "Báo giá có hiệu lực trong 14 ngày.", payment: "Thanh toán theo tiến độ giao hàng và lắp đặt.", warranty: "Bảo hành thiết bị theo chính sách hãng, hỗ trợ kỹ thuật theo thỏa thuận." },
    },
  },
  minimal_business: {
    id: "minimal_business",
    name: "Minimal Business",
    industry: "generic",
    description: "Mẫu tối giản, giống báo giá doanh nghiệp truyền thống, ít cột.",
    config: {
      layoutType: "minimal",
      brand: { primaryColor: "#111827", accentColor: "#F3F4F6", fontFamily: "Arial", logoUrl: "", logoText: "LOGO" },
      page: { size: "A4", margin: "12mm" },
      sections: { showHeader: true, showCustomer: true, showProject: true, showRoomGroups: true, showSummary: true, showLabor: true, showTerms: true, showSignature: true },
      columns: { stt: true, note: false, image: false, sku: true, name: true, spec: false, supplier: false, unit: true, qty: true, unitPrice: true, total: true },
      labels: { title: "BẢNG BÁO GIÁ", itemName: "Nội dung", note: "Ghi chú", spec: "Mô tả", sku: "Mã", supplier: "Nguồn", summaryTitle: "TỔNG HỢP" },
      terms: { intro: "Xin trân trọng gửi Quý Khách bảng báo giá như sau:", validity: "Báo giá có hiệu lực trong 14 ngày.", payment: "Thanh toán theo thỏa thuận.", warranty: "Bảo hành theo điều kiện đi kèm từng hạng mục." },
    },
  },
};

export const QUOTE_TEMPLATE_PRESET_LIST = Object.values(QUOTE_TEMPLATE_PRESETS);

const deepClone = (value) => JSON.parse(JSON.stringify(value));
const isObj = (value) => value && typeof value === "object" && !Array.isArray(value);

function mergeDeep(base, override) {
  const out = deepClone(base);
  if (!isObj(override)) return out;
  Object.entries(override).forEach(([key, value]) => {
    if (isObj(value) && isObj(out[key])) out[key] = mergeDeep(out[key], value);
    else if (value !== undefined) out[key] = value;
  });
  return out;
}

export function buildDefaultQuoteTemplateConfig(presetId = "smarthome_pro") {
  const preset = QUOTE_TEMPLATE_PRESETS[presetId] || QUOTE_TEMPLATE_PRESETS.smarthome_pro;
  return {
    presetId: preset.id,
    name: preset.name,
    ...deepClone(preset.config),
  };
}

export function normalizeQuoteTemplateConfig(config = {}) {
  const presetId = config?.presetId || "smarthome_pro";
  const base = buildDefaultQuoteTemplateConfig(presetId);
  return mergeDeep(base, config || {});
}

export function applyQuoteTemplatePreset(current = {}, presetId = "smarthome_pro") {
  const presetConfig = buildDefaultQuoteTemplateConfig(presetId);
  const normalized = normalizeQuoteTemplateConfig(current);
  return {
    ...presetConfig,
    brand: {
      ...presetConfig.brand,
      logoUrl: normalized.brand?.logoUrl || presetConfig.brand.logoUrl,
      logoText: normalized.brand?.logoText || presetConfig.brand.logoText,
      primaryColor: normalized.brand?.primaryColor || presetConfig.brand.primaryColor,
    },
  };
}

export function getQuoteTemplateLabel(presetId) {
  return QUOTE_TEMPLATE_PRESETS[presetId]?.name || "SmartHome Pro";
}

export function enabledQuoteColumns(config = {}) {
  const normalized = normalizeQuoteTemplateConfig(config);
  return Object.entries(normalized.columns || {})
    .filter(([, enabled]) => Boolean(enabled))
    .map(([key]) => key);
}
