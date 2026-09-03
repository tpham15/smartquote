// BOM Phase 6 — Pack Template Builder
// Defines real solution pack templates (roles/components) and matches each role
// against the user's catalog. Deterministic-first, no AI dependency.

const strip = (v) => String(v ?? "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
const normalize = (v) => strip(v)
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .replace(/đ/g, "d")
  .replace(/Đ/g, "d")
  .toLowerCase();

const productText = (product = {}) => normalize(`${product.name || ""} ${product.sku || ""} ${product.category || ""} ${product.supplier || ""} ${product.specs || ""}`);
const priceOf = (product = {}) => Number(product.listPrice || product.publicPrice || product.salePrice || product.price || product.costPrice || 0) || 0;

export const PACK_TEMPLATE_LIBRARY = {
  door_phone: {
    label: "Bộ chuông cửa màn hình",
    components: [
      { role: "door_station", label: "Nút chuông/camera ngoài cổng", required: true, autoAdd: true, qty: 1, keywords: ["chuong", "door", "station", "camera chuong", "nút chuông", "nut chuong", "intercom"] },
      { role: "indoor_monitor", label: "Màn hình trong nhà", required: true, autoAdd: true, qty: 1, keywords: ["man hinh", "monitor", "indoor", "chuong hinh", "intercom"] },
      { role: "power_network", label: "Nguồn / PoE / switch nếu cần", required: false, autoAdd: false, qty: 1, keywords: ["poe", "switch", "nguon", "adapter", "power"] },
      { role: "cable_accessory", label: "Dây mạng / phụ kiện lắp đặt", required: false, autoAdd: false, qty: 1, keywords: ["cat6", "cap", "phu kien", "day mang"] },
    ],
  },
  smart_switch_control: {
    label: "Bộ điều khiển/công tắc thông minh",
    components: [
      { role: "controller", label: "Bộ điều khiển trung tâm / gateway", required: true, autoAdd: true, qty: 1, keywords: ["bo dieu khien trung tam", "gateway", "hub", "hc", "home controller", "bo dieu khien"] },
      { role: "switch_keypad", label: "Công tắc/phím điều khiển", required: true, autoAdd: false, qty: 1, keywords: ["cong tac", "phim", "switch", "keypad", "nut"] },
      { role: "input_module", label: "Input/relay/module mở rộng", required: false, autoAdd: false, qty: 1, keywords: ["input", "relay", "module", "kenh", "dieu khien"] },
      { role: "power_accessory", label: "Nguồn / đế âm / phụ kiện", required: false, autoAdd: false, qty: 1, keywords: ["nguon", "de am", "phu kien", "adapter"] },
    ],
  },
  smart_lighting: {
    label: "Bộ chiếu sáng / lighting",
    components: [
      { role: "fixture", label: "Đèn chính", required: true, autoAdd: false, qty: 1, keywords: ["den", "downlight", "spotlight", "led", "lighting", "ray"] },
      { role: "driver", label: "Driver / nguồn đèn", required: false, autoAdd: false, qty: 1, keywords: ["driver", "nguon", "adapter", "24v", "48v"] },
      { role: "dimmer_controller", label: "Dimmer / controller lighting", required: false, autoAdd: true, qty: 1, keywords: ["dimmer", "controller", "tun", "tunable", "dieu khien", "lighting"] },
      { role: "rail_accessory", label: "Ray / phụ kiện lắp đặt", required: false, autoAdd: false, qty: 1, keywords: ["ray", "phu kien", "khop noi", "modun", "module"] },
    ],
  },
  audio_multiroom: {
    label: "Bộ âm thanh đa vùng",
    components: [
      { role: "audio_controller", label: "Bộ điều khiển/amplifier", required: true, autoAdd: true, qty: 1, keywords: ["ampli", "amply", "amplifier", "bo dieu khien am thanh", "arylic", "audio"] },
      { role: "speaker", label: "Loa", required: true, autoAdd: false, qty: 1, keywords: ["loa", "speaker", "gan tran", "ngoai troi"] },
      { role: "power_cable", label: "Nguồn / dây loa", required: false, autoAdd: false, qty: 1, keywords: ["nguon", "day loa", "cap am thanh", "2x1.5"] },
    ],
  },
  smart_lock_access: {
    label: "Bộ khóa / kiểm soát ra vào",
    components: [
      { role: "main_lock", label: "Khóa cửa chính / thiết bị access", required: true, autoAdd: false, qty: 1, keywords: ["khoa", "smart lock", "van tay", "ddl", "kaadas", "osn", "access"] },
      { role: "reader", label: "Đầu đọc thẻ / nhận diện", required: false, autoAdd: true, qty: 1, keywords: ["doc the", "reader", "nhan dien", "face", "access"] },
      { role: "card_key", label: "Thẻ / chìa / phụ kiện", required: false, autoAdd: false, qty: 1, keywords: ["the", "card", "chia", "phu kien"] },
    ],
  },
  camera_security: {
    label: "Bộ camera an ninh",
    components: [
      { role: "camera", label: "Camera", required: true, autoAdd: false, qty: 1, keywords: ["camera", "cam", "ip", "ai"] },
      { role: "recorder", label: "Đầu ghi / NVR", required: false, autoAdd: true, qty: 1, keywords: ["nvr", "dau ghi", "recorder"] },
      { role: "storage", label: "Ổ cứng lưu trữ", required: false, autoAdd: false, qty: 1, keywords: ["hdd", "o cung", "storage", "surveillance"] },
      { role: "poe_switch", label: "Switch PoE / nguồn", required: false, autoAdd: false, qty: 1, keywords: ["poe", "switch", "nguon"] },
    ],
  },
  network_wifi: {
    label: "Bộ mạng / WiFi mesh",
    components: [
      { role: "router_controller", label: "Router/controller", required: true, autoAdd: true, qty: 1, keywords: ["router", "controller", "gateway"] },
      { role: "access_point", label: "Access point / node mesh", required: true, autoAdd: false, qty: 1, keywords: ["access point", "ap", "wifi", "mesh"] },
      { role: "switch", label: "Switch / PoE switch", required: false, autoAdd: false, qty: 1, keywords: ["switch", "poe"] },
      { role: "cable", label: "Cáp mạng / phụ kiện", required: false, autoAdd: false, qty: 1, keywords: ["cat6", "cap mang", "phu kien"] },
    ],
  },
  curtain_gate_motor: {
    label: "Bộ rèm / cổng tự động",
    components: [
      { role: "motor", label: "Motor chính", required: true, autoAdd: false, qty: 1, keywords: ["motor", "dong co", "roger", "vulcan", "rem"] },
      { role: "controller", label: "Bộ điều khiển / remote", required: false, autoAdd: true, qty: 1, keywords: ["remote", "dieu khien", "controller", "receiver"] },
      { role: "rail_accessory", label: "Ray / phụ kiện cơ khí", required: false, autoAdd: false, qty: 1, keywords: ["ray", "phu kien", "con lan", "khop noi"] },
    ],
  },
  sensors: {
    label: "Bộ cảm biến",
    components: [
      { role: "sensor", label: "Cảm biến", required: true, autoAdd: false, qty: 1, keywords: ["cam bien", "sensor", "hien dien", "chuyen dong", "motion"] },
      { role: "gateway", label: "Gateway / bộ điều khiển nếu cần", required: false, autoAdd: true, qty: 1, keywords: ["gateway", "hub", "bo dieu khien", "controller"] },
      { role: "accessory", label: "Phụ kiện lắp đặt", required: false, autoAdd: false, qty: 1, keywords: ["de", "phu kien", "pin", "nguon"] },
    ],
  },
};

const RECOMMENDATION_TO_FAMILY = {
  lumi_audio: "audio_multiroom",
  arylic_multiroom: "audio_multiroom",
  lumi_basic_doorphone: "door_phone",
  basip_villa: "door_phone",
  akuvox_access: "door_phone",
  lumi_switch: "smart_switch_control",
  erfinden_switch: "smart_switch_control",
  schneider_switch: "smart_switch_control",
  lumi_lighting: "smart_lighting",
  philips_lighting: "smart_lighting",
  kingled_lighting: "smart_lighting",
  lumi_sensor: "sensors",
  erfinden_sensor: "sensors",
  lumi_curtain: "curtain_gate_motor",
  roger_gate: "curtain_gate_motor",
  vulcan_gate: "curtain_gate_motor",
  philips_lock: "smart_lock_access",
  kaadas_lock: "smart_lock_access",
  osuno_lock: "smart_lock_access",
  lumi_access: "smart_lock_access",
  hikvision_ai: "camera_security",
  imou_camera: "camera_security",
  dahua_camera: "camera_security",
  ruijie_mesh: "network_wifi",
  unifi_network: "network_wifi",
  tplink_network: "network_wifi",
};

export function resolvePackTemplateFamily(familyKey = "", recommendationKey = "") {
  return RECOMMENDATION_TO_FAMILY[recommendationKey] || familyKey || "";
}

function scoreProductForComponent(product = {}, component = {}, recommendation = {}) {
  const text = productText(product);
  const vendor = normalize(recommendation.vendor || "");
  const supplier = normalize(product.supplier || "");
  let score = 0;
  let hits = 0;
  const reasons = [];
  for (const kw of component.keywords || []) {
    const n = normalize(kw);
    if (n && text.includes(n)) {
      hits += 1;
      score += n.length >= 6 ? 0.22 : 0.14;
    }
  }
  if (vendor && (supplier.includes(vendor) || text.includes(vendor))) {
    score += 0.18;
    reasons.push(`brand ${recommendation.vendor}`);
  }
  // Vendor alone is not enough: Bas-IP monitor should not match every Bas-IP item unless role keywords also hit.
  if (!hits) score = 0;
  return { score: Math.min(0.99, score), hits, reasons };
}

export function buildPackTemplateForRecommendation({ familyKey = "", recommendation = {}, products = [] } = {}) {
  const templateKey = resolvePackTemplateFamily(familyKey, recommendation.key);
  const base = PACK_TEMPLATE_LIBRARY[templateKey];
  if (!base) return null;
  const components = (base.components || []).map((component) => {
    const candidates = (products || [])
      .map((product) => ({ product, ...scoreProductForComponent(product, component, recommendation) }))
      .filter((row) => row.hits >= 1 && row.score >= 0.22)
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return priceOf(a.product) - priceOf(b.product);
      })
      .slice(0, 5)
      .map((row) => ({
        productId: row.product.id,
        productName: row.product.name || row.product.sku || "Sản phẩm catalog",
        sku: row.product.sku || "",
        supplier: row.product.supplier || "",
        costPrice: Number(row.product.costPrice) || 0,
        listPrice: priceOf(row.product),
        score: Math.round(row.score * 100),
      }));
    return {
      ...component,
      qty: Number(component.qty) || 1,
      matched: candidates.length > 0,
      selectedProductId: candidates[0]?.productId || "",
      candidates,
    };
  });
  const required = components.filter((c) => c.required);
  const requiredMatched = required.filter((c) => c.matched).length;
  const autoAddReady = components.filter((c) => c.autoAdd && c.matched).length;
  const coverage = required.length ? Math.round((requiredMatched / required.length) * 100) : 100;
  return {
    key: templateKey,
    label: base.label,
    componentCount: components.length,
    requiredCount: required.length,
    requiredMatched,
    autoAddReady,
    coverage,
    status: coverage >= 100 ? "ready" : coverage >= 50 ? "partial" : "weak",
    components,
  };
}

export function attachPackTemplatesToRecommendations({ familyKey = "", recommendations = [], products = [] } = {}) {
  return (recommendations || []).map((recommendation) => ({
    ...recommendation,
    template: buildPackTemplateForRecommendation({ familyKey, recommendation, products }),
  }));
}

export function chooseComponentCandidate(component = {}, variant = { id: "standard" }, productsById = new Map()) {
  const candidates = (component.candidates || [])
    .map((candidate) => ({ ...candidate, product: productsById.get(candidate.productId) }))
    .filter((candidate) => candidate.product);
  if (!candidates.length) return null;
  if (variant.id === "budget") return candidates.slice().sort((a, b) => (a.listPrice || 0) - (b.listPrice || 0))[0];
  if (variant.id === "premium") return candidates.slice().sort((a, b) => (b.listPrice || 0) - (a.listPrice || 0))[0];
  return candidates[0];
}

export function shouldAutoAddComponent(component = {}, variant = { id: "standard" }) {
  if (!component.autoAdd) return false;
  if (component.required) return true;
  return variant.id === "premium";
}
