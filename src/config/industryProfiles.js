export const INDUSTRY_PROFILE_VERSION = 1;

export const BUSINESS_TYPES = [
  { id: "distributor", label: "Nhà phân phối" },
  { id: "dealer", label: "Đại lý" },
  { id: "system_integrator", label: "System Integrator" },
  { id: "contractor", label: "Nhà thầu" },
  { id: "manufacturer", label: "Nhà sản xuất" },
  { id: "other", label: "Khác" },
];

const GENERIC_LABELS = {
  product: "Sản phẩm",
  products: "Sản phẩm",
  section: "Hạng mục",
  package: "Bộ sản phẩm",
  project: "Công trình",
  catalog: "Danh mục",
};

const attr = (key, label, placeholder = "") => ({ key, label, placeholder });

export const INDUSTRY_PROFILES = {
  generic: {
    id: "generic",
    name: "Ngành khác",
    shortName: "Chung",
    icon: "▦",
    description: "Sử dụng SmartQuote ở chế độ chung",
    labels: GENERIC_LABELS,
    defaultCategories: [],
    productAttributes: [],
    importHints: ["SmartQuote sẽ ưu tiên nhận diện mã sản phẩm, tên, nhà cung cấp và giá."],
    sampleSections: [],
    defaultQuoteTemplatePreset: "minimal_business",
    enableSolutionFamilies: false,
  },
  lighting: {
    id: "lighting",
    name: "Chiếu sáng",
    shortName: "Lighting",
    icon: "💡",
    description: "Đèn, driver, ray và thiết bị chiếu sáng",
    labels: GENERIC_LABELS,
    defaultCategories: ["Downlight", "Spotlight", "Track Light", "Linear Light", "LED Strip", "Driver", "Outdoor Light", "Decorative Light", "Emergency Light", "Accessories"],
    productAttributes: [
      attr("wattage", "Công suất", "VD: 12W"),
      attr("cct", "Nhiệt màu (CCT)", "VD: 3000K"),
      attr("cri", "CRI", "VD: >90"),
      attr("beam_angle", "Góc chiếu", "VD: 24°"),
      attr("ip_rating", "IP", "VD: IP65"),
      attr("voltage", "Điện áp", "VD: 220V"),
      attr("dimming", "Dimming", "VD: DALI / 0-10V"),
      attr("driver_type", "Driver", "VD: DALI 40W"),
      attr("luminous_flux", "Quang thông", "VD: 1200 lm"),
    ],
    importHints: ["SmartQuote sẽ ưu tiên nhận diện SKU, công suất, nhiệt màu, CRI, IP và giá."],
    sampleSections: ["Chiếu sáng tầng 1", "Chiếu sáng cảnh quan"],
    defaultQuoteTemplatePreset: "lighting_project",
    enableSolutionFamilies: false,
  },
  cctv: {
    id: "cctv",
    name: "Camera & An ninh",
    shortName: "CCTV",
    icon: "📷",
    description: "CCTV, NVR, access control và security",
    labels: GENERIC_LABELS,
    defaultCategories: ["IP Camera", "Analog Camera", "NVR", "DVR", "HDD", "PoE Switch", "Access Control", "Alarm", "Intercom", "Rack", "UPS", "Accessories"],
    productAttributes: [
      attr("resolution", "Độ phân giải", "VD: 4MP"),
      attr("lens", "Lens", "VD: 2.8mm"),
      attr("poe", "PoE", "Có / Không"),
      attr("ir_distance", "Tầm xa IR", "VD: 30m"),
      attr("ip_rating", "IP", "VD: IP67"),
      attr("channels", "Số kênh", "VD: 16CH"),
      attr("storage", "Lưu trữ", "VD: 8TB"),
      attr("form_factor", "Kiểu dáng", "VD: Dome / Bullet"),
      attr("protocol", "Chuẩn / Protocol", "VD: ONVIF"),
    ],
    importHints: ["SmartQuote sẽ ưu tiên nhận diện SKU, độ phân giải, lens, PoE, NVR/HDD và giá."],
    sampleSections: ["Camera ngoài trời", "Camera khu vực kho"],
    defaultQuoteTemplatePreset: "camera_security",
    enableSolutionFamilies: false,
  },
  smarthome: {
    id: "smarthome",
    name: "Smart Home",
    shortName: "Smart Home",
    icon: "🏠",
    description: "Công tắc, cảm biến, gateway và automation",
    labels: GENERIC_LABELS,
    defaultCategories: ["Switch", "Sensor", "Gateway", "Curtain", "Lighting Control", "Access Control", "HVAC Control", "Accessories"],
    productAttributes: [
      attr("protocol", "Protocol", "VD: Zigbee"),
      attr("gang", "Số nút / Gang", "VD: 2"),
      attr("gateway_required", "Cần gateway", "Có / Không"),
      attr("power", "Nguồn / Công suất", ""),
      attr("connectivity", "Kết nối", "VD: Wi‑Fi / Zigbee"),
      attr("compatibility", "Tương thích", ""),
    ],
    importHints: ["SmartQuote sẽ ưu tiên SKU, loại sản phẩm, protocol, gateway và giá."],
    sampleSections: ["Phòng khách", "Phòng ngủ Master"],
    defaultQuoteTemplatePreset: "smarthome_pro",
    enableSolutionFamilies: true,
  },
  electrical: {
    id: "electrical",
    name: "Thiết bị điện / MEP",
    shortName: "Electrical / MEP",
    icon: "⚡",
    description: "Thiết bị điện và hệ thống công trình",
    labels: GENERIC_LABELS,
    defaultCategories: ["Breaker", "Contactor", "Relay", "Cable", "Distribution Board", "Sensor", "Meter", "Transformer", "Accessories"],
    productAttributes: [
      attr("voltage", "Điện áp", "VD: 400V"),
      attr("current", "Dòng điện", "VD: 32A"),
      attr("phase", "Số pha", "VD: 3P"),
      attr("breaking_capacity", "Khả năng cắt", "VD: 10kA"),
      attr("pole_count", "Số cực", "VD: 4P"),
      attr("frequency", "Tần số", "VD: 50Hz"),
      attr("mounting", "Kiểu lắp", "VD: DIN rail"),
      attr("ip_rating", "IP", "VD: IP54"),
    ],
    importHints: ["SmartQuote sẽ ưu tiên nhận diện mã, điện áp, dòng điện, số cực và giá."],
    sampleSections: ["Tủ điện tầng 1", "Thiết bị điện tầng 2"],
    defaultQuoteTemplatePreset: "minimal_business",
    enableSolutionFamilies: false,
  },
  hvac: {
    id: "hvac",
    name: "HVAC",
    shortName: "HVAC",
    icon: "❄",
    description: "Điều hòa, thông gió và HVAC",
    labels: GENERIC_LABELS,
    defaultCategories: ["Indoor Unit", "Outdoor Unit", "VRV/VRF", "AHU", "FCU", "Ventilation", "Controller", "Accessory"],
    productAttributes: [
      attr("capacity", "Công suất lạnh", "VD: 18,000 BTU"),
      attr("power", "Công suất điện", "VD: 1.8kW"),
      attr("airflow", "Lưu lượng gió", ""),
      attr("refrigerant", "Môi chất", "VD: R32"),
      attr("cop", "COP", ""),
      attr("eer", "EER", ""),
      attr("voltage", "Điện áp", ""),
      attr("noise_level", "Độ ồn", "VD: 32dB"),
    ],
    importHints: ["SmartQuote sẽ ưu tiên nhận diện model, công suất, airflow, môi chất và giá."],
    sampleSections: ["Điều hòa khu văn phòng", "Thông gió tầng 1"],
    defaultQuoteTemplatePreset: "minimal_business",
    enableSolutionFamilies: false,
  },
};

export const INDUSTRY_PROFILE_LIST = ["lighting", "cctv", "smarthome", "electrical", "hvac", "generic"].map((id) => INDUSTRY_PROFILES[id]);

export function isIndustryProfileId(value) {
  return Boolean(value && INDUSTRY_PROFILES[String(value)]);
}

export function getIndustryProfile(value) {
  return INDUSTRY_PROFILES[String(value || "")] || INDUSTRY_PROFILES.generic;
}

export function normalizeBusinessType(value) {
  const text = String(value || "").trim();
  return BUSINESS_TYPES.some((item) => item.id === text) ? text : null;
}
