import { attachPackTemplatesToRecommendations } from "./packTemplates.js";

const strip = (v) => String(v ?? "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
const normalize = (v) => strip(v)
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .replace(/đ/g, "d")
  .replace(/Đ/g, "d")
  .toLowerCase();

const uniq = (arr = []) => Array.from(new Set(arr.filter(Boolean)));

export const SOLUTION_PACK_PROFILES = {
  audio_multiroom: {
    scopeLabel: "Âm thanh đa vùng",
    options: [
      { key: "lumi_audio", label: "Lumi Audio", vendor: "Lumi", tier: "Đồng bộ smarthome", keywords: ["lumi", "loa", "am thanh", "audio", "sound"] },
      { key: "arylic_multiroom", label: "Arylic Multiroom", vendor: "Arylic", tier: "Âm thanh chuyên dụng", keywords: ["arylic", "loa", "ampli", "amply", "audio"] },
    ],
  },
  door_phone: {
    scopeLabel: "Chuông cửa màn hình",
    options: [
      { key: "lumi_basic_doorphone", label: "Lumi / Basic Door Phone", vendor: "Lumi", tier: "Phổ thông", keywords: ["lumi", "basic", "chuong", "man hinh", "door", "intercom"] },
      { key: "basip_villa", label: "Bas-IP Villa", vendor: "Bas-IP", tier: "Cao cấp IP", keywords: ["bas", "bas-ip", "basip", "chuong", "intercom", "ip"] },
      { key: "akuvox_access", label: "Akuvox IP Intercom", vendor: "Akuvox", tier: "Access/IP", keywords: ["akuvox", "chuong", "intercom", "access"] },
    ],
  },
  smart_switch_control: {
    scopeLabel: "Công tắc / điều khiển thông minh",
    options: [
      { key: "lumi_switch", label: "Lumi Smart Switch", vendor: "Lumi", tier: "Smarthome đồng bộ", keywords: ["lumi", "cong tac", "phim", "input", "dieu khien", "relay", "module"] },
      { key: "erfinden_switch", label: "Erfinden Smart Control", vendor: "Erfinden", tier: "Linh hoạt", keywords: ["erfinden", "cong tac", "cam bien", "dieu khien"] },
      { key: "schneider_switch", label: "Schneider Control", vendor: "Schneider", tier: "Thương hiệu mạnh", keywords: ["schneider", "cong tac", "o cam", "dieu khien"] },
    ],
  },
  smart_lighting: {
    scopeLabel: "Chiếu sáng / lighting",
    options: [
      { key: "lumi_lighting", label: "Lumi Lighting", vendor: "Lumi", tier: "Đồng bộ điều khiển", keywords: ["lumi", "den", "lighting", "downlight", "spotlight", "ray", "led", "driver"] },
      { key: "philips_lighting", label: "Philips Lighting", vendor: "Philips", tier: "Thương hiệu mạnh", keywords: ["philips", "den", "lighting", "led"] },
      { key: "kingled_lighting", label: "KingLed Lighting", vendor: "KingLed", tier: "Phổ thông", keywords: ["kingled", "king led", "den", "led", "downlight"] },
    ],
  },
  sensors: {
    scopeLabel: "Cảm biến",
    options: [
      { key: "lumi_sensor", label: "Lumi Sensors", vendor: "Lumi", tier: "Smarthome đồng bộ", keywords: ["lumi", "cam bien", "sensor", "hien dien", "chuyen dong"] },
      { key: "erfinden_sensor", label: "Erfinden Sensors", vendor: "Erfinden", tier: "Linh hoạt", keywords: ["erfinden", "cam bien", "sensor", "hien dien"] },
    ],
  },
  curtain_gate_motor: {
    scopeLabel: "Motor rèm / cổng tự động",
    options: [
      { key: "lumi_curtain", label: "Lumi Curtain Motor", vendor: "Lumi", tier: "Rèm thông minh", keywords: ["lumi", "rem", "motor", "dong co", "ray rem"] },
      { key: "roger_gate", label: "Roger Gate Motor", vendor: "Roger", tier: "Cổng tự động", keywords: ["roger", "cong", "motor", "vulcan", "am san"] },
      { key: "vulcan_gate", label: "Vulcan Gate Motor", vendor: "Vulcan", tier: "Cổng tự động", keywords: ["vulcan", "cong", "motor", "am san"] },
    ],
  },
  smart_lock_access: {
    scopeLabel: "Khóa / kiểm soát ra vào",
    options: [
      { key: "philips_lock", label: "Philips Smart Lock", vendor: "Philips", tier: "Cao cấp", keywords: ["philips", "khoa", "ddl", "sbx", "van tay", "access", "door"] },
      { key: "kaadas_lock", label: "Kaadas Smart Lock", vendor: "Kaadas", tier: "Cao cấp", keywords: ["kaadas", "khoa", "k20", "s500", "van tay"] },
      { key: "osuno_lock", label: "Osuno Smart Lock", vendor: "Osuno", tier: "Phổ thông", keywords: ["osuno", "osn", "khoa", "van tay", "the"] },
      { key: "lumi_access", label: "Lumi Access Control", vendor: "Lumi", tier: "Access control", keywords: ["lumi", "doc the", "the vao ra", "nhan dien", "access"] },
    ],
  },
  camera_security: {
    scopeLabel: "Camera an ninh",
    options: [
      { key: "hikvision_ai", label: "Hikvision AI Camera", vendor: "Hikvision", tier: "Cao cấp", keywords: ["hik", "hikvision", "camera", "nvr", "dau ghi", "ai"] },
      { key: "imou_camera", label: "Imou Camera", vendor: "Imou", tier: "Phổ thông", keywords: ["imou", "camera", "wifi", "dau ghi"] },
      { key: "dahua_camera", label: "Dahua Camera", vendor: "Dahua", tier: "Chuyên dụng", keywords: ["dahua", "camera", "nvr", "dau ghi"] },
    ],
  },
  network_wifi: {
    scopeLabel: "Wifi / mạng nội bộ",
    options: [
      { key: "ruijie_mesh", label: "Ruijie WiFi Mesh", vendor: "Ruijie", tier: "Dự án", keywords: ["ruijie", "wifi", "mesh", "router", "switch", "ap"] },
      { key: "unifi_network", label: "UniFi Network", vendor: "UniFi", tier: "Cao cấp", keywords: ["unifi", "ubiquiti", "wifi", "ap", "switch", "router"] },
      { key: "tplink_network", label: "TP-Link Network", vendor: "TP-Link", tier: "Phổ thông", keywords: ["tp-link", "tplink", "wifi", "mesh", "switch", "router"] },
    ],
  },
};

function productSearchText(product = {}) {
  return normalize(`${product.name || ""} ${product.sku || ""} ${product.category || ""} ${product.supplier || ""} ${product.specs || ""}`);
}

function lineSearchText(line = {}) {
  return normalize(`${line.name || ""} ${line.model || ""} ${line.category || ""} ${line.solutionLabel || ""} ${line.note || ""} ${line.area || ""}`);
}

function scoreProductForOption(product = {}, option = {}) {
  const text = productSearchText(product);
  const supplier = normalize(product.supplier || "");
  const vendor = normalize(option.vendor || "");
  let score = 0;
  let keywordHits = 0;
  const reasons = [];
  if (vendor && (supplier.includes(vendor) || text.includes(vendor))) {
    score += 0.18;
    reasons.push(`NCC/brand khớp ${option.vendor}`);
  }
  for (const kw of option.keywords || []) {
    const n = normalize(kw);
    if (!n || n === vendor) continue;
    if (text.includes(n)) {
      keywordHits += 1;
      score += n.length >= 6 ? 0.14 : 0.08;
    }
  }
  // Chỉ brand trùng thôi chưa đủ: Lumi switch không được tính là Lumi Audio nếu không có từ khóa âm thanh.
  if (!keywordHits) score = 0;
  score = Math.min(0.98, score);
  return { score, reasons, keywordHits };
}

function scoreLineFitForOption(line = {}, option = {}) {
  const text = lineSearchText(line);
  let score = 0;
  for (const kw of option.keywords || []) {
    const n = normalize(kw);
    if (n && text.includes(n)) score += n.length >= 6 ? 0.16 : 0.09;
  }
  return Math.min(0.95, score);
}

function buildOptionSuggestion(scope = {}, option = {}, lines = [], products = []) {
  const scopeLines = lines.filter((line) => line.scopeId === scope.id || line.solutionFamily?.key === scope.key);
  const productScores = products
    .map((product) => ({ product, ...scoreProductForOption(product, option) }))
    .filter((row) => row.keywordHits >= 1 && row.score >= 0.18)
    .sort((a, b) => b.score - a.score)
    .slice(0, 12);

  const lineFit = scopeLines.reduce((sum, line) => sum + scoreLineFitForOption(line, option), 0);
  const lineFitAvg = scopeLines.length ? lineFit / scopeLines.length : 0;
  const catalogCoverage = Math.min(1, productScores.length / Math.max(2, Math.min(8, scope.lineCount || scopeLines.length || 1)));
  const scopeConfidence = Math.min(1, (Number(scope.confidence) || 65) / 100);
  const score = Math.min(0.99, 0.34 * lineFitAvg + 0.34 * catalogCoverage + 0.2 * scopeConfidence + (productScores.length ? 0.12 : 0));
  const confidence = score >= 0.72 ? "high" : score >= 0.48 ? "medium" : "low";
  const sampleProducts = productScores.slice(0, 4).map((row) => row.product.name || row.product.sku).filter(Boolean);
  const productIds = productScores.slice(0, 8).map((row) => row.product.id).filter(Boolean);
  const estimatedCost = productScores.slice(0, 4).reduce((sum, row) => sum + (Number(row.product.costPrice) || 0), 0);
  const estimatedRevenue = productScores.slice(0, 4).reduce((sum, row) => sum + (Number(row.product.listPrice || row.product.salePrice || row.product.price || row.product.costPrice) || 0), 0);
  const rationale = [];
  if (productScores.length) rationale.push(`${productScores.length} sản phẩm catalog khớp ${option.vendor}`);
  if (lineFitAvg >= 0.25) rationale.push("từ khóa BOM khớp phương án");
  if (!productScores.length) rationale.push("chưa có đủ sản phẩm catalog, dùng như gợi ý NCC/phương án");

  return {
    id: `${scope.id || scope.key}_${option.key}`,
    key: option.key,
    title: option.label,
    vendor: option.vendor,
    tier: option.tier || "Phương án",
    confidence,
    score: Math.round(score * 100),
    catalogProductCount: productScores.length,
    lineFit: Math.round(lineFitAvg * 100),
    productIds,
    sampleProducts,
    estimatedCost,
    estimatedRevenue,
    rationale: rationale.join(" · "),
  };
}

function fallbackVendorOptions(scope = {}) {
  return (scope.vendors || []).slice(0, 3).map((vendor) => ({
    key: `vendor_${normalize(vendor).replace(/[^a-z0-9]+/g, "_")}`,
    label: `${vendor} ${scope.label || "solution"}`,
    vendor,
    tier: "Theo NCC phát hiện",
    keywords: [vendor, scope.label || ""],
  }));
}

export function buildSolutionPackSuggestions(scopes = [], lines = [], products = []) {
  return (scopes || [])
    .filter((scope) => !scope.supporting)
    .map((scope) => {
      const profile = SOLUTION_PACK_PROFILES[scope.key] || null;
      const options = profile?.options?.length ? profile.options : fallbackVendorOptions(scope);
      const baseRecommendations = options
        .map((option) => buildOptionSuggestion(scope, option, lines, products))
        .sort((a, b) => b.score - a.score)
        .slice(0, 3);
      const recommendations = attachPackTemplatesToRecommendations({
        familyKey: scope.key,
        recommendations: baseRecommendations,
        products,
      });
      return {
        scopeId: scope.id,
        familyKey: scope.key,
        scopeLabel: scope.label,
        lineCount: scope.lineCount,
        matched: scope.matched,
        unresolved: scope.unresolved,
        supporting: !!scope.supporting,
        recommendations,
        selectedRecommendationId: recommendations[0]?.id || "",
      };
    })
    .filter((pack) => pack.recommendations.length)
    .sort((a, b) => b.lineCount - a.lineCount);
}

export function getPackRecommendationById(solutionPacks = [], recommendationId = "") {
  for (const pack of solutionPacks || []) {
    const found = (pack.recommendations || []).find((rec) => rec.id === recommendationId);
    if (found) return { pack, recommendation: found };
  }
  return null;
}
