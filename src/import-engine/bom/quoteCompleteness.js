import { loadQuoteCompletenessLearning } from "./quoteCompletenessLearning.js";

// ============================================================
// Phase 15 — Quote Completeness / Accessory Recommendation Engine
// ============================================================
// Purpose:
//   Detect "missing but normally needed" system components after BOM matching,
//   without letting an LLM silently invent quote lines.
//
// Design:
//   1) deterministic system/role detection
//   2) explicit required/recommended/optional levels
//   3) catalog-backed candidates only
//   4) user must Add/Always add before a suggestion becomes a quote line
//   5) company/dealer learning is scoped via tenantStorage
// ============================================================

const strip = (v) => String(v ?? "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
export const normalizeCompletenessText = (v) => strip(v)
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .replace(/đ/g, "d")
  .replace(/Đ/g, "d")
  .toLowerCase()
  .replace(/[^a-z0-9/+.-]+/g, " ")
  .replace(/\s+/g, " ")
  .trim();

const uniq = (arr = []) => Array.from(new Set((arr || []).filter(Boolean)));
const priceOf = (p = {}) => Number(p.listPrice || p.publicPrice || p.salePrice || p.price || p.costPrice || 0) || 0;

const FAMILY_LABELS = {
  camera_security: "Camera an ninh",
  network_wifi: "Mạng / WiFi",
  door_phone: "Chuông cửa màn hình",
  smart_switch_control: "Công tắc / điều khiển thông minh",
  smart_lighting: "Chiếu sáng / lighting",
  audio_multiroom: "Âm thanh đa vùng",
  smart_lock_access: "Khóa / kiểm soát ra vào",
  curtain_gate_motor: "Rèm / cổng tự động",
  sensors: "Cảm biến",
};

const FAMILY_HINTS = {
  camera_security: ["camera", "nvr", "dau ghi", "recorder", "hikvision", "dahua", "imou"],
  network_wifi: ["wifi", "access point", "router", "switch", "mesh", "unifi", "ruijie", "tp link", "tplink"],
  door_phone: ["chuong cua", "chuong hinh", "door phone", "intercom", "indoor monitor", "door station"],
  smart_switch_control: ["cong tac", "switch", "keypad", "relay", "input module", "smart control"],
  smart_lighting: ["downlight", "spotlight", "lighting", "den led", "led day", "dimmer", "tunable"],
  audio_multiroom: ["loa", "speaker", "audio", "ampli", "amplifier", "amply"],
  smart_lock_access: ["khoa", "smart lock", "access control", "doc the", "reader", "van tay"],
  curtain_gate_motor: ["rem", "curtain", "motor cong", "motor rem", "dong co rem", "gate motor"],
  sensors: ["cam bien", "sensor", "motion", "hien dien", "pir"],
};

// Role matchers are intentionally narrower than generic category keywords.
// Exclusions prevent a recorder line containing "camera" from being counted as a camera.
const ROLE_MATCHERS = {
  camera_security: {
    camera: { any: ["camera", "cam ip", "ip cam"], none: ["camera hub", "ai camera hub", "nvr", "dau ghi", "recorder"] },
    recorder: { any: ["nvr", "dau ghi", "recorder", "network video recorder"] },
    storage: { any: ["hdd", "o cung", "hard disk", "storage", "purple", "surveillance hdd"] },
    poe_switch: { any: ["poe switch", "switch poe", "switch cấp nguồn", "switch cap nguon"] },
    rack: { any: ["tu dau ghi", "tu rack", "rack 6u", "rack 9u", "rack 12u", "tu mang", "network cabinet", "cabinet rack"] },
    ups: { any: ["ups", "bo luu dien", "luu dien"] },
  },
  network_wifi: {
    access_point: { any: ["access point", "wifi ap", "ap wifi", "mesh node", "node mesh"] },
    router_controller: { any: ["router", "gateway", "controller", "cloudkey", "cloud key"] },
    switch: { any: ["switch", "poe switch", "switch poe"], none: ["cong tac", "smart switch"] },
    cable: { any: ["cat6", "cat 6", "cap mang", "day mang", "network cable"] },
    rack: { any: ["tu rack", "rack 6u", "rack 9u", "rack 12u", "tu mang", "network cabinet"] },
    ups: { any: ["ups", "bo luu dien", "luu dien"] },
  },
  door_phone: {
    door_station: { any: ["door station", "nut chuong", "camera chuong", "chuong ngoai cong", "chuong cua"] },
    indoor_monitor: { any: ["indoor monitor", "man hinh chuong", "man hinh trong nha", "monitor chuong"] },
    power_network: { any: ["poe", "nguon", "adapter", "power supply", "switch"] },
    cable: { any: ["cat6", "cap mang", "day mang", "network cable"] },
  },
  smart_switch_control: {
    switch_keypad: { any: ["cong tac", "keypad", "phim dieu khien", "smart switch"] },
    controller: { any: ["bo dieu khien trung tam", "home controller", "gateway", "hub", "controller"] },
    input_module: { any: ["input module", "module input", "relay module", "module relay", "module 2in", "module 5in"] },
    power_accessory: { any: ["de am", "nguon", "adapter", "power supply"] },
  },
  smart_lighting: {
    fixture: { any: ["downlight", "spotlight", "den led", "lighting", "led day", "den ray"] },
    smart_fixture: { any: ["tunable", "smart dimmable", "dimmable", "smart lighting"] },
    driver: { any: ["driver", "nguon 24v", "nguon 48v", "power supply", "meanwell"] },
    dimmer_controller: { any: ["dimmer", "lighting controller", "bo dieu khien den", "controller lighting"] },
    rail_accessory: { any: ["ray", "khop noi", "module dan dien", "modun dan dien"] },
  },
  audio_multiroom: {
    speaker: { any: ["loa", "speaker"], none: ["day loa", "cap loa"] },
    audio_controller: { any: ["ampli", "amply", "amplifier", "audio controller", "am thanh da vung"] },
    power_cable: { any: ["day loa", "cap loa", "speaker cable", "nguon audio"] },
  },
  smart_lock_access: {
    main_lock: { any: ["khoa", "smart lock", "van tay"] },
    reader: { any: ["doc the", "reader", "access control", "nhan dien"] },
    power_accessory: { any: ["nguon access", "power supply", "adapter", "ups"] },
    card_key: { any: ["the tu", "rfid card", "key fob", "chia khoa"] },
  },
  curtain_gate_motor: {
    motor: { any: ["motor", "dong co"], none: ["module"] },
    controller: { any: ["remote", "bo dieu khien", "controller", "receiver"] },
    rail_accessory: { any: ["ray rem", "ray cua", "khop noi", "con lan", "phu kien rem", "phu kien cong"] },
  },
  sensors: {
    sensor: { any: ["cam bien", "sensor", "pir", "motion"] },
    gateway: { any: ["gateway", "hub", "bo dieu khien trung tam", "controller"] },
    accessory: { any: ["pin", "de cam bien", "nguon cam bien", "adapter"] },
  },
};

// A conservative starter knowledge graph. Nothing below is silently added.
// "required" = likely functional dependency; "recommended" = common professional
// completion; "optional" = resilience/upsell. Company learning may turn a rule
// into default-add only after the user explicitly presses "Luôn thêm".
export const QUOTE_COMPLETENESS_RULES = [
  {
    id: "camera.recorder",
    familyKey: "camera_security",
    triggerRole: "camera",
    satisfyRole: "recorder",
    level: "required",
    label: "Đầu ghi / NVR",
    rationale: ({ triggerQty }) => `Có ${triggerQty} camera nhưng chưa thấy đầu ghi/NVR trong cấu hình.`,
    qty: ({ triggerQty }) => Math.max(1, Math.ceil(triggerQty / 16)),
    qtyNote: "Ước tính 1 đầu/16 camera; cần kiểm tra số kênh thực tế.",
    candidateRole: "recorder",
    capacityKind: "channels",
  },
  {
    id: "camera.storage",
    familyKey: "camera_security",
    triggerRole: "camera",
    satisfyRole: "storage",
    level: "recommended",
    label: "Ổ cứng lưu trữ cho đầu ghi",
    rationale: ({ triggerQty }) => `Hệ ${triggerQty} camera chưa thấy HDD lưu trữ. Dung lượng phải chốt theo độ phân giải và số ngày lưu.`,
    qty: () => 1,
    qtyNote: "Chưa tự tính TB vì cần retention days / bitrate.",
    candidateRole: "storage",
  },
  {
    id: "camera.poe_switch",
    familyKey: "camera_security",
    triggerRole: "camera",
    satisfyRole: "poe_switch",
    level: "recommended",
    label: "Switch PoE / nguồn mạng camera",
    rationale: ({ triggerQty }) => `Có ${triggerQty} camera; chưa thấy switch PoE riêng. Có thể bỏ qua nếu NVR tích hợp đủ cổng PoE.`,
    qty: ({ triggerQty }) => Math.max(1, Math.ceil(triggerQty / 16)),
    qtyNote: "Ước tính; cần kiểm tra NVR có PoE và công suất PoE budget.",
    candidateRole: "poe_switch",
    capacityKind: "ports",
  },
  {
    id: "camera.rack",
    familyKey: "camera_security",
    triggerRole: "camera",
    satisfyRole: "rack",
    level: "recommended",
    label: "Tủ đầu ghi / tủ rack",
    rationale: ({ triggerQty }) => `Hệ camera (${triggerQty} camera) chưa thấy tủ/rack chứa NVR, switch và phụ kiện mạng.`,
    qty: () => 1,
    candidateRole: "rack",
  },
  {
    id: "camera.ups",
    familyKey: "camera_security",
    triggerRole: "camera",
    satisfyRole: "ups",
    level: "optional",
    label: "UPS / bộ lưu điện",
    rationale: () => "Có thể bổ sung UPS để NVR/switch tiếp tục hoạt động khi mất điện ngắn hạn.",
    qty: () => 1,
    candidateRole: "ups",
  },
  {
    id: "network.router",
    familyKey: "network_wifi",
    triggerRole: "access_point",
    satisfyRole: "router_controller",
    level: "required",
    label: "Router / gateway / controller",
    rationale: ({ triggerQty }) => `Có ${triggerQty} AP/node WiFi nhưng chưa thấy router/gateway/controller.`,
    qty: () => 1,
    candidateRole: "router_controller",
  },
  {
    id: "network.switch",
    familyKey: "network_wifi",
    triggerRole: "access_point",
    satisfyRole: "switch",
    level: "recommended",
    minTriggerQty: 2,
    label: "Switch mạng / PoE switch",
    rationale: ({ triggerQty }) => `Có ${triggerQty} AP/node; nên kiểm tra switch đủ port và PoE budget.`,
    qty: ({ triggerQty }) => Math.max(1, Math.ceil(triggerQty / 16)),
    candidateRole: "switch",
    capacityKind: "ports",
  },
  {
    id: "network.cable",
    familyKey: "network_wifi",
    triggerRole: "access_point",
    satisfyRole: "cable",
    level: "recommended",
    label: "Cáp mạng / phụ kiện đầu cuối",
    rationale: () => "Chưa thấy cáp mạng/phụ kiện đầu cuối trong BOM mạng.",
    qty: () => 1,
    qtyNote: "Số lượng/chiều dài cần bóc theo mặt bằng.",
    candidateRole: "cable",
  },
  {
    id: "doorphone.monitor",
    familyKey: "door_phone",
    triggerRole: "door_station",
    satisfyRole: "indoor_monitor",
    level: "required",
    label: "Màn hình trong nhà",
    rationale: () => "Có nút chuông/camera ngoài cổng nhưng chưa thấy màn hình trong nhà.",
    qty: () => 1,
    candidateRole: "indoor_monitor",
  },
  {
    id: "doorphone.station",
    familyKey: "door_phone",
    triggerRole: "indoor_monitor",
    satisfyRole: "door_station",
    level: "required",
    label: "Nút chuông / camera ngoài cổng",
    rationale: () => "Có màn hình chuông cửa nhưng chưa thấy door station/nút chuông ngoài cổng.",
    qty: () => 1,
    candidateRole: "door_station",
  },
  {
    id: "doorphone.power",
    familyKey: "door_phone",
    triggerRole: "door_station",
    satisfyRole: "power_network",
    level: "recommended",
    label: "Nguồn / PoE / switch cho chuông cửa",
    rationale: () => "Chưa thấy nguồn/PoE/switch cho hệ chuông cửa. Kiểm tra theo model thực tế.",
    qty: () => 1,
    candidateRole: "power_network",
  },
  {
    id: "switch.controller",
    familyKey: "smart_switch_control",
    triggerRole: "switch_keypad",
    satisfyRole: "controller",
    level: "recommended",
    minTriggerQty: 2,
    label: "Bộ điều khiển trung tâm / gateway",
    rationale: ({ triggerQty }) => `Có ${triggerQty} công tắc/phím thông minh; chưa thấy controller/gateway trung tâm.`,
    qty: () => 1,
    candidateRole: "controller",
  },
  {
    id: "lighting.controller",
    familyKey: "smart_lighting",
    triggerRole: "smart_fixture",
    satisfyRole: "dimmer_controller",
    level: "recommended",
    label: "Dimmer / controller lighting",
    rationale: () => "Có đèn dimmable/tunable nhưng chưa thấy controller/dimmer tương ứng.",
    qty: () => 1,
    candidateRole: "dimmer_controller",
  },
  {
    id: "audio.controller",
    familyKey: "audio_multiroom",
    triggerRole: "speaker",
    satisfyRole: "audio_controller",
    level: "required",
    label: "Amplifier / bộ điều khiển âm thanh",
    rationale: ({ triggerQty }) => `Có ${triggerQty} loa nhưng chưa thấy amplifier/controller âm thanh.`,
    qty: () => 1,
    candidateRole: "audio_controller",
  },
  {
    id: "audio.cable",
    familyKey: "audio_multiroom",
    triggerRole: "speaker",
    satisfyRole: "power_cable",
    level: "recommended",
    label: "Dây loa / phụ kiện âm thanh",
    rationale: () => "Chưa thấy dây loa/phụ kiện kết nối trong BOM âm thanh.",
    qty: () => 1,
    qtyNote: "Chiều dài cần bóc theo mặt bằng.",
    candidateRole: "power_cable",
  },
  {
    id: "curtain.controller",
    familyKey: "curtain_gate_motor",
    triggerRole: "motor",
    satisfyRole: "controller",
    level: "recommended",
    label: "Bộ điều khiển / remote motor",
    rationale: () => "Có motor nhưng chưa thấy controller/receiver/remote điều khiển.",
    qty: () => 1,
    candidateRole: "controller",
  },
  {
    id: "curtain.rail",
    familyKey: "curtain_gate_motor",
    triggerRole: "motor",
    satisfyRole: "rail_accessory",
    level: "recommended",
    label: "Ray / phụ kiện cơ khí",
    rationale: () => "Có motor rèm/cổng nhưng chưa thấy ray/phụ kiện cơ khí đi kèm.",
    qty: () => 1,
    qtyNote: "Chiều dài/phụ kiện cần chốt theo kích thước thực tế.",
    candidateRole: "rail_accessory",
  },
  {
    id: "sensor.gateway",
    familyKey: "sensors",
    triggerRole: "sensor",
    satisfyRole: "gateway",
    level: "recommended",
    label: "Gateway / bộ điều khiển cảm biến",
    rationale: ({ triggerQty }) => `Có ${triggerQty} cảm biến; chưa thấy gateway/controller. Có thể bỏ qua nếu cảm biến hoạt động độc lập.`,
    qty: () => 1,
    candidateRole: "gateway",
  },
];

function matcherFor(familyKey, role) {
  return ROLE_MATCHERS[familyKey]?.[role] || null;
}

function matchesMatcher(text, matcher) {
  if (!matcher) return false;
  const t = normalizeCompletenessText(text);
  if (!t) return false;
  if ((matcher.none || []).some((kw) => t.includes(normalizeCompletenessText(kw)))) return false;
  return (matcher.any || []).some((kw) => t.includes(normalizeCompletenessText(kw)));
}

function inferFamily(text = "") {
  const t = normalizeCompletenessText(text);
  let best = "";
  let bestScore = 0;
  for (const [familyKey, hints] of Object.entries(FAMILY_HINTS)) {
    let score = 0;
    for (const hint of hints) if (t.includes(normalizeCompletenessText(hint))) score += normalizeCompletenessText(hint).length >= 7 ? 2 : 1;
    if (score > bestScore) { best = familyKey; bestScore = score; }
  }
  return best;
}

function productText(product = {}) {
  return `${product.name || ""} ${product.sku || ""} ${product.category || ""} ${product.supplier || ""} ${product.specs || ""}`;
}

function lineText(line = {}, selectedProduct = null) {
  return `${line.name || ""} ${line.model || ""} ${line.category || ""} ${line.solutionLabel || ""} ${line.note || ""} ${selectedProduct ? productText(selectedProduct) : ""}`;
}

function getScopeId(line = {}) {
  return line.scopeId || `scope_${String(line.solutionKey || inferFamily(lineText(line)) || "other").replace(/[^a-z0-9_-]/gi, "_")}`;
}

function getSelectedProductForLine(line, productsById, resolutionMap) {
  if (Object.prototype.hasOwnProperty.call(resolutionMap || {}, line.id)) {
    const id = resolutionMap[line.id];
    return id && id !== "__none__" ? productsById.get(id) || null : null;
  }
  const id = line.resolvedProductId || line.suggestedMatch?.productId || "";
  return id ? productsById.get(id) || null : null;
}

function selectedPackRecommendation(pack = {}, packSelections = {}) {
  const selectedId = packSelections?.[pack.scopeId] || pack.selectedRecommendationId || pack.recommendations?.[0]?.id;
  return (pack.recommendations || []).find((r) => r.id === selectedId) || pack.recommendations?.[0] || null;
}

function buildContexts({ bomPreview, productsById, resolutionMap, ignoredMap, packSelections }) {
  const contexts = new Map();
  const lines = (bomPreview?.lines || []).filter((line) => !ignoredMap?.[line.id] && resolutionMap?.[line.id] !== "__none__");
  const scopeById = new Map((bomPreview?.scopes || []).map((scope) => [scope.id, scope]));

  for (const line of lines) {
    const selectedProduct = getSelectedProductForLine(line, productsById, resolutionMap);
    const scopeId = getScopeId(line);
    const scope = scopeById.get(scopeId) || null;
    const familyKey = scope?.key || line.solutionFamily?.key || line.solutionKey || inferFamily(lineText(line, selectedProduct));
    if (!FAMILY_LABELS[familyKey]) continue;
    if (!contexts.has(scopeId)) {
      contexts.set(scopeId, {
        scopeId,
        familyKey,
        scopeLabel: scope?.label || line.solutionLabel || FAMILY_LABELS[familyKey],
        items: [],
        plannedItems: [],
        vendors: new Set(),
      });
    }
    const ctx = contexts.get(scopeId);
    const qty = Math.max(1, Number(line.qty) || 1);
    const text = lineText(line, selectedProduct);
    ctx.items.push({ line, product: selectedProduct, qty, text });
    if (selectedProduct?.supplier) ctx.vendors.add(selectedProduct.supplier);
  }

  // Components already guaranteed to be auto-added by the selected pack template
  // count as planned evidence so Phase 15 does not recommend a duplicate NVR/gateway.
  for (const pack of bomPreview?.solutionPacks || []) {
    const ctx = contexts.get(pack.scopeId);
    if (!ctx) continue;
    const rec = selectedPackRecommendation(pack, packSelections);
    if (rec?.vendor) ctx.vendors.add(rec.vendor);
    for (const component of rec?.template?.components || []) {
      if (!component?.autoAdd || !component?.selectedProductId) continue;
      const product = productsById.get(component.selectedProductId);
      if (!product) continue;
      ctx.plannedItems.push({
        product,
        qty: Math.max(1, Number(component.qty) || 1),
        text: `${component.label || ""} ${component.role || ""} ${productText(product)}`,
        component,
      });
    }
  }

  return Array.from(contexts.values()).map((ctx) => ({ ...ctx, vendors: Array.from(ctx.vendors) }));
}

function roleQty(context, role) {
  const matcher = matcherFor(context.familyKey, role);
  if (!matcher) return 0;
  let total = 0;
  for (const item of [...context.items, ...context.plannedItems]) {
    if (matchesMatcher(item.text, matcher)) total += Math.max(1, Number(item.qty) || 1);
  }
  return total;
}

function parseCapacity(text = "", kind = "") {
  const t = normalizeCompletenessText(text);
  const patterns = kind === "ports"
    ? [/(\d{1,2})\s*(?:port|ports|cong poe|cong mang)/, /(?:poe|switch)[^0-9]{0,8}(\d{1,2})/]
    : [/(\d{1,2})\s*(?:kenh|channel|channels|ch)/, /(?:nvr|dau ghi)[^0-9]{0,8}(\d{1,2})/];
  for (const re of patterns) {
    const m = t.match(re);
    if (m) return Number(m[1]) || 0;
  }
  return 0;
}

function scoreCandidate(product, context, rule, targetCapacity = 0) {
  const matcher = matcherFor(context.familyKey, rule.candidateRole || rule.satisfyRole);
  const text = productText(product);
  if (!matchesMatcher(text, matcher)) return null;
  const t = normalizeCompletenessText(text);
  let score = 0.52;
  const reasons = ["đúng loại phụ kiện"];
  const roleWords = matcher?.any || [];
  const hits = roleWords.filter((kw) => t.includes(normalizeCompletenessText(kw))).length;
  score += Math.min(0.22, hits * 0.07);
  const supplier = normalizeCompletenessText(product.supplier || "");
  const vendorHit = (context.vendors || []).find((v) => supplier && supplier.includes(normalizeCompletenessText(v)));
  if (vendorHit) { score += 0.12; reasons.push(`cùng hệ/brand ${vendorHit}`); }
  if (priceOf(product) > 0) score += 0.04;

  let capacity = 0;
  if (rule.capacityKind) {
    capacity = parseCapacity(text, rule.capacityKind);
    if (capacity && targetCapacity) {
      if (capacity >= targetCapacity) {
        score += Math.min(0.1, 0.04 + (capacity === targetCapacity ? 0.06 : 0.02));
        reasons.push(`${capacity} ${rule.capacityKind === "ports" ? "port" : "kênh"}`);
      } else {
        score -= 0.18;
        reasons.push(`chỉ ${capacity}, thấp hơn nhu cầu ${targetCapacity}`);
      }
    }
  }
  return {
    productId: product.id,
    productName: product.name || product.sku || "Sản phẩm catalog",
    sku: product.sku || "",
    supplier: product.supplier || "",
    price: priceOf(product),
    score: Math.max(0, Math.min(0.99, score)),
    capacity,
    reason: reasons.join(" · "),
  };
}

function candidateList(products, context, rule, triggerQty) {
  const targetCapacity = rule.capacityKind ? Math.max(1, Number(triggerQty) || 1) : 0;
  return (products || [])
    .map((product) => scoreCandidate(product, context, rule, targetCapacity))
    .filter(Boolean)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (rule.capacityKind && targetCapacity) {
        const aFit = a.capacity >= targetCapacity ? a.capacity - targetCapacity : 999;
        const bFit = b.capacity >= targetCapacity ? b.capacity - targetCapacity : 999;
        if (aFit !== bFit) return aFit - bFit;
      }
      return a.price - b.price;
    })
    .slice(0, 6);
}

function decisionFor(recId, ruleId, decisions = {}, learning = {}) {
  const explicit = decisions?.[recId] || {};
  const learned = learning?.[ruleId] || null;
  const action = explicit.action || (learned?.action === "always_add" ? "add" : learned?.action === "never_add" ? "skip" : "");
  return {
    action,
    productId: explicit.productId || learned?.preferredProductId || "",
    explicitProductId: explicit.productId || "",
    learned: !!learned,
    learnedAction: learned?.action || "",
  };
}

export function buildQuoteCompletenessAssessment({
  bomPreview,
  products = [],
  resolutionMap = {},
  ignoredMap = {},
  packSelections = {},
  decisions = {},
} = {}) {
  const productsById = new Map((products || []).map((p) => [p.id, p]));
  const learning = loadQuoteCompletenessLearning();
  const contexts = buildContexts({ bomPreview, productsById, resolutionMap, ignoredMap, packSelections });
  const recommendations = [];
  let satisfiedRuleCount = 0;

  for (const context of contexts) {
    const rules = QUOTE_COMPLETENESS_RULES.filter((rule) => rule.familyKey === context.familyKey);
    for (const rule of rules) {
      const triggerQty = roleQty(context, rule.triggerRole);
      if (!triggerQty || triggerQty < Math.max(1, Number(rule.minTriggerQty) || 1)) continue;
      const satisfyQty = roleQty(context, rule.satisfyRole);
      if (satisfyQty > 0) {
        satisfiedRuleCount += 1;
        continue;
      }
      const recId = `${context.scopeId}:${rule.id}`;
      const candidates = candidateList(products, context, rule, triggerQty);
      const decision = decisionFor(recId, rule.id, decisions, learning);
      const preferred = decision.explicitProductId
        ? decision.explicitProductId
        : decision.productId && candidates.some((c) => c.productId === decision.productId)
          ? decision.productId
          : candidates[0]?.productId || "";
      const effectiveAction = decision.action === "add" && !preferred ? "" : decision.action;
      const qty = Math.max(1, Number(typeof rule.qty === "function" ? rule.qty({ triggerQty, context }) : rule.qty) || 1);
      const rationale = typeof rule.rationale === "function" ? rule.rationale({ triggerQty, context }) : String(rule.rationale || "");
      recommendations.push({
        id: recId,
        ruleId: rule.id,
        familyKey: context.familyKey,
        scopeId: context.scopeId,
        scopeLabel: context.scopeLabel || FAMILY_LABELS[context.familyKey],
        level: rule.level || "recommended",
        label: rule.label,
        rationale,
        qty,
        qtyNote: rule.qtyNote || "",
        triggerQty,
        satisfyQty,
        candidates,
        preferredProductId: preferred,
        selectedProductId: preferred,
        action: effectiveAction,
        learned: decision.learned,
        learnedAction: decision.learnedAction,
        source: decision.learned ? "company_memory" : "builtin_rule",
        canAdd: Boolean(decision.productId || preferred),
      });
    }
  }

  const unresolved = recommendations.filter((r) => !r.action);
  const accepted = recommendations.filter((r) => r.action === "add");
  const skipped = recommendations.filter((r) => r.action === "skip");
  const counts = {
    total: recommendations.length,
    unresolved: unresolved.length,
    accepted: accepted.length,
    skipped: skipped.length,
    required: unresolved.filter((r) => r.level === "required").length,
    recommended: unresolved.filter((r) => r.level === "recommended").length,
    optional: unresolved.filter((r) => r.level === "optional").length,
    learned: recommendations.filter((r) => r.learned).length,
    noCatalogCandidate: unresolved.filter((r) => !r.canAdd).length,
    satisfiedRuleCount,
  };

  return {
    version: "quote-completeness-v1",
    contexts,
    recommendations,
    unresolved,
    accepted,
    skipped,
    counts,
    ready: counts.required === 0,
  };
}

export function getCompletenessRecommendationProductId(recommendation = {}, decisions = {}) {
  const explicit = decisions?.[recommendation.id] || {};
  return explicit.productId || recommendation.selectedProductId || recommendation.preferredProductId || recommendation.candidates?.[0]?.productId || "";
}

export function getAcceptedCompletenessRecommendations(assessment = {}, decisions = {}) {
  return (assessment?.recommendations || [])
    .map((rec) => {
      const explicit = decisions?.[rec.id] || {};
      const action = explicit.action || rec.action || "";
      const productId = explicit.productId || rec.selectedProductId || rec.preferredProductId || rec.candidates?.[0]?.productId || "";
      return { ...rec, action, productId };
    })
    .filter((rec) => rec.action === "add" && rec.productId);
}
