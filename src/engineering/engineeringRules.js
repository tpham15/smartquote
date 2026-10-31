// SmartQuote P2.3 — deterministic Engineering Rules foundation.
// Important: these checks use explicit technical attributes. Text/category hints may
// help identify a role, but numeric PASS/FAIL decisions never rely on LLM guesses.

const num = (value, fallback = NaN) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};
const txt = (value) => value == null ? "" : String(value).trim();
const norm = (value) => txt(value).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const bool = (value, fallback = false) => {
  if (typeof value === "boolean") return value;
  const t = norm(value);
  if (["true", "1", "yes", "y", "co", "có"].includes(t)) return true;
  if (["false", "0", "no", "n", "khong", "không"].includes(t)) return false;
  return fallback;
};
const list = (value) => {
  if (Array.isArray(value)) return value.map(txt).filter(Boolean);
  return txt(value).split(/[,;|\n]+/).map((x) => x.trim()).filter(Boolean);
};

export const ENGINEERING_RULES_VERSION = "p2.3-v1";

export const ENGINEERING_ROLE_OPTIONS = [
  { value: "", label: "— Không khai báo —" },
  { value: "ip_camera", label: "Camera IP" },
  { value: "nvr", label: "NVR / đầu ghi" },
  { value: "poe_switch", label: "PoE switch" },
  { value: "storage_hdd", label: "HDD / storage" },
  { value: "gateway", label: "Gateway" },
  { value: "controller", label: "Controller" },
  { value: "device", label: "Thiết bị đầu cuối" },
  { value: "power_supply", label: "Nguồn / PSU" },
  { value: "ups", label: "UPS" },
];

const ROLE_ALIASES = new Map([
  ["camera", "ip_camera"], ["ip camera", "ip_camera"], ["ip_camera", "ip_camera"],
  ["nvr", "nvr"], ["recorder", "nvr"], ["dau ghi", "nvr"], ["đầu ghi", "nvr"],
  ["poe switch", "poe_switch"], ["poe_switch", "poe_switch"], ["switch poe", "poe_switch"],
  ["hdd", "storage_hdd"], ["storage", "storage_hdd"], ["storage_hdd", "storage_hdd"], ["hard drive", "storage_hdd"],
  ["gateway", "gateway"], ["hub", "gateway"],
  ["controller", "controller"], ["bo dieu khien", "controller"], ["bộ điều khiển", "controller"],
  ["device", "device"], ["endpoint", "device"],
  ["power supply", "power_supply"], ["psu", "power_supply"], ["power_supply", "power_supply"],
  ["ups", "ups"],
]);

export function normalizeEngineeringRole(value = "") {
  const t = norm(value).replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
  return ROLE_ALIASES.get(t) || t.replace(/\s+/g, "_");
}

function inferRoleFromText(product = {}) {
  const t = norm(`${product.category || ""} ${product.name || ""} ${product.sku || ""}`);
  if (!t) return "";
  if (/\b(nvr|network video recorder|dau ghi|đầu ghi)\b/.test(t)) return "nvr";
  if (/\b(poe)\b/.test(t) && /\b(switch|chuyen mach|chuyển mạch)\b/.test(t)) return "poe_switch";
  if (/\b(camera|ip cam|ipc)\b/.test(t)) return "ip_camera";
  if (/\b(hdd|hard drive|o cung|ổ cứng|storage)\b/.test(t)) return "storage_hdd";
  if (/\b(gateway|hub)\b/.test(t)) return "gateway";
  if (/\b(controller|bo dieu khien|bộ điều khiển)\b/.test(t)) return "controller";
  if (/\b(ups|bo luu dien|bộ lưu điện)\b/.test(t)) return "ups";
  if (/\b(power supply|psu|nguon|nguồn)\b/.test(t)) return "power_supply";
  return "";
}

export function getEngineeringAttributes(product = {}) {
  const root = product.attributes && typeof product.attributes === "object" && !Array.isArray(product.attributes) ? product.attributes : {};
  const e = root.engineering && typeof root.engineering === "object" && !Array.isArray(root.engineering) ? root.engineering : {};
  const pick = (...keys) => {
    for (const key of keys) {
      if (e[key] !== undefined && e[key] !== "") return e[key];
      if (root[key] !== undefined && root[key] !== "") return root[key];
      if (product[key] !== undefined && product[key] !== "") return product[key];
    }
    return undefined;
  };
  const explicitRole = normalizeEngineeringRole(pick("role", "engineeringRole") || "");
  const inferredRole = explicitRole ? "" : inferRoleFromText(product);
  return {
    role: explicitRole || inferredRole,
    roleSource: explicitRole ? "explicit" : inferredRole ? "category_hint" : "none",
    poeRequired: bool(pick("poeRequired", "requiresPoe"), false),
    networkPortsRequired: Math.max(0, num(pick("networkPortsRequired", "portsRequired"), 1)),
    powerW: Math.max(0, num(pick("powerW", "powerWatts"), NaN)),
    bitrateMbps: Math.max(0, num(pick("bitrateMbps", "avgBitrateMbps"), NaN)),
    maxChannels: Math.max(0, num(pick("maxChannels", "channels"), NaN)),
    maxIncomingBandwidthMbps: Math.max(0, num(pick("maxIncomingBandwidthMbps", "incomingBandwidthMbps"), NaN)),
    poePorts: Math.max(0, num(pick("poePorts"), NaN)),
    reservedPorts: Math.max(0, num(pick("reservedPorts"), 0)),
    poeBudgetW: Math.max(0, num(pick("poeBudgetW", "poePowerBudgetW"), NaN)),
    capacityTb: Math.max(0, num(pick("capacityTb", "storageTb"), NaN)),
    installedStorageTb: Math.max(0, num(pick("installedStorageTb"), NaN)),
    maxStorageTb: Math.max(0, num(pick("maxStorageTb"), NaN)),
    maxDevices: Math.max(0, num(pick("maxDevices"), NaN)),
    capacityGroup: txt(pick("capacityGroup")),
    demandGroup: txt(pick("demandGroup")),
    demandUnits: Math.max(0, num(pick("demandUnits"), 1)),
    requiresRoles: list(pick("requiresRoles", "requiresRole")).map(normalizeEngineeringRole).filter(Boolean),
    unitsPerRequiredRole: Math.max(0, num(pick("unitsPerRequiredRole", "oneRequiredRolePer"), NaN)),
    protocols: list(pick("protocols")).map((x) => norm(x)).filter(Boolean),
    protocolProvider: bool(pick("protocolProvider"), false),
    requiresProtocols: list(pick("requiresProtocols", "requiresProtocol")).map((x) => norm(x)).filter(Boolean),
  };
}

function flattenQuote(rooms = [], productById = {}) {
  const lines = [];
  for (const room of Array.isArray(rooms) ? rooms : []) {
    for (const line of Array.isArray(room?.lines) ? room.lines : []) {
      const qty = Math.max(0, num(line?.qty, 0));
      if (!qty) continue;
      const product = productById?.[line.productId] || line.productSnapshot || null;
      if (!product) continue;
      lines.push({
        lineId: line.id || "",
        roomId: room.id || "",
        roomName: room.name || "",
        qty,
        product,
        productId: product.id || line.productId || "",
        name: product.name || product.sku || "Sản phẩm",
        engineering: getEngineeringAttributes(product),
      });
    }
  }
  return lines;
}

function sumQty(lines = []) { return lines.reduce((sum, row) => sum + row.qty, 0); }
function byRole(lines, role) { return lines.filter((row) => row.engineering.role === role); }
function productRefs(lines = []) { return lines.map((row) => ({ productId: row.productId, lineId: row.lineId, name: row.name, qty: row.qty })); }
function check({ ruleCode, family, status, severity, title, detail = "", evidence = {}, affectedLines = [], resolution = "", source = "system" }) {
  return { ruleCode, family, status, severity, title, detail, evidence, affectedLines: productRefs(affectedLines), resolution, source, version: 1 };
}

function storageTbFromBitrate(totalMbps, days, safetyPercent) {
  // Decimal TB: 1 Mbps * 1 day = 10.8 GB = 0.0108 TB.
  return totalMbps * 0.0108 * days * (1 + safetyPercent / 100);
}

function roleCapacityCheck(lines, sourceRole, targetRole, sourceLabel, targetLabel) {
  const demand = byRole(lines, sourceRole);
  const providers = byRole(lines, targetRole);
  if (!demand.length || !providers.length) return null;
  const required = sumQty(demand);
  const knownProviders = providers.filter((row) => Number.isFinite(row.engineering.maxDevices) && row.engineering.maxDevices > 0);
  const availableKnown = knownProviders.reduce((sum, row) => sum + row.qty * row.engineering.maxDevices, 0);
  if (availableKnown >= required) {
    return check({
      ruleCode: `GENERIC_${sourceRole.toUpperCase()}_${targetRole.toUpperCase()}_CAPACITY`, family: "capacity", status: "PASS", severity: "INFO",
      title: `${targetLabel} đủ sức chứa`, detail: `${required} ${sourceLabel} · ${availableKnown} capacity`, evidence: { required, available: availableKnown, unit: "devices" }, affectedLines: [...demand, ...providers],
    });
  }
  if (knownProviders.length !== providers.length) {
    return check({
      ruleCode: `GENERIC_${sourceRole.toUpperCase()}_${targetRole.toUpperCase()}_CAPACITY`, family: "capacity", status: "UNKNOWN", severity: "WARNING",
      title: `Chưa đủ dữ liệu capacity của ${targetLabel}`, detail: `${availableKnown}/${required} capacity đã xác minh; còn sản phẩm chưa khai báo maxDevices.`, evidence: { required, availableKnown, unknownProviderCount: providers.length - knownProviders.length, unit: "devices" }, affectedLines: [...demand, ...providers], resolution: "Bổ sung maxDevices cho sản phẩm cung cấp capacity.",
    });
  }
  return check({
    ruleCode: `GENERIC_${sourceRole.toUpperCase()}_${targetRole.toUpperCase()}_CAPACITY`, family: "capacity", status: "FAIL", severity: "ERROR",
    title: `${targetLabel} không đủ sức chứa`, detail: `${required} ${sourceLabel} yêu cầu · ${availableKnown} capacity hiện có.`, evidence: { required, available: availableKnown, shortfall: Math.max(0, required - availableKnown), unit: "devices" }, affectedLines: [...demand, ...providers], resolution: `Tăng ${targetLabel} hoặc chọn model có capacity lớn hơn.`,
  });
}

export function buildEngineeringAssessment({
  rooms = [],
  productById = {},
  requirements = {},
} = {}) {
  const lines = flattenQuote(rooms, productById);
  const checks = [];
  const cameras = byRole(lines, "ip_camera");
  const nvrs = byRole(lines, "nvr");
  const poeSwitches = byRole(lines, "poe_switch");
  const storage = byRole(lines, "storage_hdd");

  // 1) Recording channel capacity.
  if (cameras.length && nvrs.length) {
    const required = sumQty(cameras);
    const knownNvrs = nvrs.filter((row) => Number.isFinite(row.engineering.maxChannels) && row.engineering.maxChannels > 0);
    const availableKnown = knownNvrs.reduce((sum, row) => sum + row.qty * row.engineering.maxChannels, 0);
    if (availableKnown >= required) {
      checks.push(check({ ruleCode: "CCTV_NVR_CHANNEL_CAPACITY", family: "capacity", status: "PASS", severity: "INFO", title: "Recording capacity đủ", detail: `${required} camera channel · ${availableKnown} channel khả dụng.`, evidence: { required, available: availableKnown, unit: "channels" }, affectedLines: [...cameras, ...nvrs] }));
    } else if (knownNvrs.length !== nvrs.length) {
      checks.push(check({ ruleCode: "CCTV_NVR_CHANNEL_CAPACITY", family: "capacity", status: "UNKNOWN", severity: "WARNING", title: "Chưa xác minh đủ channel của NVR", detail: `${availableKnown}/${required} channel đã xác minh; còn NVR chưa có maxChannels.`, evidence: { required, availableKnown, unknownProviderCount: nvrs.length - knownNvrs.length, unit: "channels" }, affectedLines: [...cameras, ...nvrs], resolution: "Bổ sung maxChannels cho NVR trước khi chốt cấu hình." }));
    } else {
      checks.push(check({ ruleCode: "CCTV_NVR_CHANNEL_CAPACITY", family: "capacity", status: "FAIL", severity: "ERROR", title: "Recording capacity không đủ", detail: `${required} camera channel yêu cầu · ${availableKnown} channel khả dụng.`, evidence: { required, available: availableKnown, shortfall: required - availableKnown, unit: "channels" }, affectedLines: [...cameras, ...nvrs], resolution: "Tăng số NVR hoặc chọn NVR có nhiều channel hơn." }));
    }

    // Incoming bandwidth is independently constrained from channel count.
    const defaultBitrate = Math.max(0, num(requirements.defaultCameraBitrateMbps, 0));
    const bitrateRows = cameras.map((row) => ({ ...row, effectiveBitrate: Number.isFinite(row.engineering.bitrateMbps) && row.engineering.bitrateMbps > 0 ? row.engineering.bitrateMbps : defaultBitrate }));
    const missingBitrate = bitrateRows.filter((row) => !(row.effectiveBitrate > 0));
    const knownBandwidthNvrs = nvrs.filter((row) => Number.isFinite(row.engineering.maxIncomingBandwidthMbps) && row.engineering.maxIncomingBandwidthMbps > 0);
    if (knownBandwidthNvrs.length || missingBitrate.length === 0) {
      if (missingBitrate.length) {
        checks.push(check({ ruleCode: "CCTV_NVR_INCOMING_BANDWIDTH", family: "capacity", status: "UNKNOWN", severity: "WARNING", title: "Chưa tính được incoming bandwidth", detail: `${missingBitrate.length} camera/model chưa có bitrate và chưa đặt bitrate mặc định.`, evidence: { missingBitrateProductCount: missingBitrate.length }, affectedLines: [...cameras, ...nvrs], resolution: "Bổ sung bitrateMbps cho camera hoặc nhập bitrate mặc định của dự án." }));
      } else if (knownBandwidthNvrs.length !== nvrs.length) {
        checks.push(check({ ruleCode: "CCTV_NVR_INCOMING_BANDWIDTH", family: "capacity", status: "UNKNOWN", severity: "WARNING", title: "Chưa đủ dữ liệu bandwidth của NVR", detail: "Có NVR chưa khai báo maxIncomingBandwidthMbps.", evidence: { unknownProviderCount: nvrs.length - knownBandwidthNvrs.length }, affectedLines: [...cameras, ...nvrs], resolution: "Bổ sung maxIncomingBandwidthMbps cho NVR." }));
      } else {
        const requiredMbps = bitrateRows.reduce((sum, row) => sum + row.qty * row.effectiveBitrate, 0);
        const availableMbps = knownBandwidthNvrs.reduce((sum, row) => sum + row.qty * row.engineering.maxIncomingBandwidthMbps, 0);
        checks.push(check({ ruleCode: "CCTV_NVR_INCOMING_BANDWIDTH", family: "capacity", status: availableMbps >= requiredMbps ? "PASS" : "FAIL", severity: availableMbps >= requiredMbps ? "INFO" : "ERROR", title: availableMbps >= requiredMbps ? "Incoming bandwidth đủ" : "Incoming bandwidth không đủ", detail: `${Math.round(requiredMbps * 10) / 10} Mbps yêu cầu · ${Math.round(availableMbps * 10) / 10} Mbps khả dụng.`, evidence: { required: requiredMbps, available: availableMbps, shortfall: Math.max(0, requiredMbps - availableMbps), unit: "Mbps" }, affectedLines: [...cameras, ...nvrs], resolution: availableMbps >= requiredMbps ? "" : "Tăng recording bandwidth hoặc giảm/điều chỉnh bitrate theo thiết kế thực tế." }));
      }
    }
  }

  // 2) PoE port and power budgets. Any product explicitly marked poeRequired becomes a consumer.
  const poeConsumers = lines.filter((row) => row.engineering.poeRequired === true);
  const poeProviders = lines.filter((row) => Number.isFinite(row.engineering.poePorts) && row.engineering.poePorts > 0);
  if (poeConsumers.length) {
    const requiredPorts = poeConsumers.reduce((sum, row) => sum + row.qty * Math.max(1, row.engineering.networkPortsRequired || 1), 0);
    if (!poeProviders.length) {
      checks.push(check({ ruleCode: "POE_PORT_CAPACITY", family: "power", status: "UNKNOWN", severity: "WARNING", title: "Chưa xác minh nguồn PoE", detail: `${requiredPorts} cổng PoE được yêu cầu nhưng chưa có sản phẩm khai báo poePorts. Có thể nguồn PoE nằm ngoài báo giá.`, evidence: { required: requiredPorts, availableKnown: 0, unit: "ports" }, affectedLines: poeConsumers, resolution: "Khai báo poePorts cho NVR/switch cấp PoE hoặc xác nhận hạ tầng PoE bên ngoài." }));
    } else {
      const availablePorts = poeProviders.reduce((sum, row) => sum + row.qty * Math.max(0, row.engineering.poePorts - row.engineering.reservedPorts), 0);
      checks.push(check({ ruleCode: "POE_PORT_CAPACITY", family: "power", status: availablePorts >= requiredPorts ? "PASS" : "FAIL", severity: availablePorts >= requiredPorts ? "INFO" : "ERROR", title: availablePorts >= requiredPorts ? "PoE ports đủ" : "PoE ports không đủ", detail: `${requiredPorts} port yêu cầu · ${availablePorts} port usable.`, evidence: { required: requiredPorts, available: availablePorts, shortfall: Math.max(0, requiredPorts - availablePorts), unit: "ports" }, affectedLines: [...poeConsumers, ...poeProviders], resolution: availablePorts >= requiredPorts ? "" : "Tăng số switch/NVR PoE hoặc chọn model có nhiều port usable hơn." }));
    }

    const missingPower = poeConsumers.filter((row) => !(Number.isFinite(row.engineering.powerW) && row.engineering.powerW > 0));
    const budgetProviders = lines.filter((row) => Number.isFinite(row.engineering.poeBudgetW) && row.engineering.poeBudgetW > 0);
    if (missingPower.length || !budgetProviders.length) {
      checks.push(check({ ruleCode: "POE_POWER_BUDGET", family: "power", status: "UNKNOWN", severity: "WARNING", title: "Chưa xác minh PoE power budget", detail: missingPower.length ? `${missingPower.length} thiết bị PoE chưa có powerW.` : "Chưa có sản phẩm khai báo poeBudgetW.", evidence: { missingPowerProductCount: missingPower.length, providerCount: budgetProviders.length }, affectedLines: [...poeConsumers, ...budgetProviders], resolution: "Bổ sung powerW cho tải PoE và poeBudgetW cho nguồn cấp." }));
    } else {
      const requiredW = poeConsumers.reduce((sum, row) => sum + row.qty * row.engineering.powerW, 0);
      const availableW = budgetProviders.reduce((sum, row) => sum + row.qty * row.engineering.poeBudgetW, 0);
      checks.push(check({ ruleCode: "POE_POWER_BUDGET", family: "power", status: availableW >= requiredW ? "PASS" : "FAIL", severity: availableW >= requiredW ? "INFO" : "ERROR", title: availableW >= requiredW ? "PoE power budget đủ" : "PoE power budget không đủ", detail: `${Math.round(requiredW * 10) / 10}W yêu cầu · ${Math.round(availableW * 10) / 10}W khả dụng.`, evidence: { required: requiredW, available: availableW, shortfall: Math.max(0, requiredW - availableW), unit: "W" }, affectedLines: [...poeConsumers, ...budgetProviders], resolution: availableW >= requiredW ? "" : "Tăng PoE budget hoặc phân bổ tải sang nguồn/switch khác." }));
    }
  }

  // 3) Storage retention estimate. Only runs when the operator explicitly enters a retention target.
  const retentionDays = Math.max(0, num(requirements.retentionDays, 0));
  if (retentionDays > 0 && cameras.length) {
    const defaultBitrate = Math.max(0, num(requirements.defaultCameraBitrateMbps, 0));
    const safetyPercent = Math.max(0, Math.min(100, num(requirements.storageSafetyPercent, 10)));
    const cameraBitrates = cameras.map((row) => ({ ...row, effectiveBitrate: Number.isFinite(row.engineering.bitrateMbps) && row.engineering.bitrateMbps > 0 ? row.engineering.bitrateMbps : defaultBitrate }));
    const missing = cameraBitrates.filter((row) => !(row.effectiveBitrate > 0));
    if (missing.length) {
      checks.push(check({ ruleCode: "CCTV_STORAGE_RETENTION", family: "storage", status: "UNKNOWN", severity: "WARNING", title: "Chưa tính được dung lượng lưu trữ", detail: `${missing.length} camera/model chưa có bitrate và chưa có bitrate mặc định.`, evidence: { retentionDays, missingBitrateProductCount: missing.length }, affectedLines: [...cameras, ...storage], resolution: "Bổ sung bitrateMbps hoặc bitrate mặc định cho dự án." }));
    } else {
      const totalMbps = cameraBitrates.reduce((sum, row) => sum + row.qty * row.effectiveBitrate, 0);
      const requiredTb = storageTbFromBitrate(totalMbps, retentionDays, safetyPercent);
      const capacityLines = [...storage, ...nvrs.filter((row) => Number.isFinite(row.engineering.installedStorageTb) && row.engineering.installedStorageTb > 0)];
      const unknownStorage = storage.filter((row) => !(Number.isFinite(row.engineering.capacityTb) && row.engineering.capacityTb > 0));
      const availableTb = storage.reduce((sum, row) => sum + row.qty * (Number.isFinite(row.engineering.capacityTb) ? row.engineering.capacityTb : 0), 0)
        + nvrs.reduce((sum, row) => sum + row.qty * (Number.isFinite(row.engineering.installedStorageTb) ? row.engineering.installedStorageTb : 0), 0);
      if (unknownStorage.length) {
        checks.push(check({ ruleCode: "CCTV_STORAGE_RETENTION", family: "storage", status: "UNKNOWN", severity: "WARNING", title: "Chưa xác minh đủ dung lượng storage", detail: `${Math.round(availableTb * 10) / 10} TB đã biết; ${unknownStorage.length} HDD/storage chưa khai báo capacityTb.`, evidence: { required: requiredTb, availableKnown: availableTb, retentionDays, safetyPercent, unit: "TB" }, affectedLines: [...cameras, ...capacityLines], resolution: "Bổ sung capacityTb cho HDD/storage." }));
      } else {
        const pass = availableTb >= requiredTb;
        checks.push(check({ ruleCode: "CCTV_STORAGE_RETENTION", family: "storage", status: pass ? "PASS" : "FAIL", severity: pass ? "INFO" : "ERROR", title: pass ? "Dung lượng lưu trữ đạt mục tiêu" : "Dung lượng lưu trữ có thể không đủ", detail: `Ước tính ${Math.round(requiredTb * 10) / 10} TB cho ${retentionDays} ngày · hiện có ${Math.round(availableTb * 10) / 10} TB raw.`, evidence: { required: requiredTb, available: availableTb, shortfall: Math.max(0, requiredTb - availableTb), retentionDays, totalBitrateMbps: totalMbps, safetyPercent, unit: "TB" }, affectedLines: [...cameras, ...capacityLines], resolution: pass ? "" : "Tăng dung lượng lưu trữ hoặc kiểm tra lại bitrate/codec/FPS/retention policy." }));
      }
    }
  }

  // 4) Explicit dependency + quantity rules configured per product.
  const roleQty = new Map();
  for (const row of lines) {
    const role = row.engineering.role;
    if (role) roleQty.set(role, (roleQty.get(role) || 0) + row.qty);
  }
  const dependencyGroups = new Map();
  for (const row of lines) {
    for (const requiredRole of row.engineering.requiresRoles) {
      const every = row.engineering.unitsPerRequiredRole;
      const everyKey = Number.isFinite(every) && every > 0 ? every : 0;
      const key = `${requiredRole}|${everyKey}`;
      const group = dependencyGroups.get(key) || { requiredRole, every: everyKey, triggerQty: 0, triggerLines: [] };
      group.triggerQty += row.qty;
      group.triggerLines.push(row);
      dependencyGroups.set(key, group);
    }
  }
  for (const group of dependencyGroups.values()) {
    const available = roleQty.get(group.requiredRole) || 0;
    const requiredQty = group.every > 0 ? Math.ceil(group.triggerQty / group.every) : 1;
    const status = available >= requiredQty ? "PASS" : "FAIL";
    checks.push(check({
      ruleCode: `DEPENDENCY_${group.requiredRole.toUpperCase()}_${group.every > 0 ? `PER_${group.every}` : "PRESENT"}`,
      family: group.every > 0 ? "quantity" : "dependency",
      status,
      severity: status === "PASS" ? "INFO" : "ERROR",
      title: status === "PASS" ? `Dependency ${group.requiredRole} đã đủ` : `Thiếu dependency ${group.requiredRole}`,
      detail: `Tổng ${group.triggerQty} thiết bị yêu cầu tối thiểu ${requiredQty} ${group.requiredRole}; hiện có ${available}.`,
      evidence: { required: requiredQty, available, unit: group.requiredRole, triggerQty: group.triggerQty, unitsPerRequiredRole: group.every || null },
      affectedLines: [...group.triggerLines, ...lines.filter((x) => x.engineering.role === group.requiredRole)],
      resolution: status === "PASS" ? "" : `Bổ sung ${group.requiredRole} hoặc sửa dependency nếu cấu hình này không áp dụng.`,
    }));
  }

  // 5) Explicit protocol compatibility. A product never satisfies its own requirement.
  // Gateway/controller/NVR are protocol providers by role; other products can opt in via protocolProvider.
  const protocolProviderRoles = new Set(["gateway", "controller", "nvr"]);
  for (const row of lines) {
    for (const protocol of row.engineering.requiresProtocols) {
      const providers = lines.filter((candidate) => candidate !== row
        && (protocolProviderRoles.has(candidate.engineering.role) || candidate.engineering.protocolProvider)
        && candidate.engineering.protocols.includes(protocol));
      const pass = providers.length > 0;
      checks.push(check({ ruleCode: `COMPAT_PROTOCOL_${protocol.replace(/[^a-z0-9]+/g, "_").toUpperCase()}`, family: "compatibility", status: pass ? "PASS" : "FAIL", severity: pass ? "INFO" : "ERROR", title: pass ? `Protocol ${protocol} có đường tương thích` : `Thiếu đường tương thích ${protocol}`, detail: pass ? `${row.name} yêu cầu ${protocol}; tìm thấy ${providers.length} gateway/controller/provider tương thích.` : `${row.name} yêu cầu ${protocol} nhưng chưa có gateway/controller/provider nào khai báo hỗ trợ protocol này.`, evidence: { protocol, providerCount: providers.length }, affectedLines: [row, ...providers], resolution: pass ? "" : `Bổ sung gateway/controller/adapter hỗ trợ ${protocol} hoặc xác nhận lại thuộc tính sản phẩm.` }));
    }
  }

  // 6) Generic maxDevices capacity groups for future non-CCTV domains.
  const demandGroups = new Map();
  const providerGroups = new Map();
  for (const row of lines) {
    if (row.engineering.demandGroup) {
      const key = norm(row.engineering.demandGroup);
      demandGroups.set(key, (demandGroups.get(key) || 0) + row.qty * Math.max(1, row.engineering.demandUnits || 1));
    }
    if (row.engineering.capacityGroup && Number.isFinite(row.engineering.maxDevices) && row.engineering.maxDevices > 0) {
      const key = norm(row.engineering.capacityGroup);
      providerGroups.set(key, (providerGroups.get(key) || 0) + row.qty * row.engineering.maxDevices);
    }
  }
  for (const [group, required] of demandGroups.entries()) {
    const available = providerGroups.get(group) || 0;
    checks.push(check({ ruleCode: `CAPACITY_GROUP_${group.replace(/[^a-z0-9]+/g, "_").toUpperCase()}`, family: "capacity", status: available >= required ? "PASS" : "FAIL", severity: available >= required ? "INFO" : "ERROR", title: available >= required ? `Capacity ${group} đủ` : `Capacity ${group} không đủ`, detail: `${required} demand unit · ${available} capacity unit.`, evidence: { group, required, available, shortfall: Math.max(0, required - available), unit: "capacity_units" }, affectedLines: lines.filter((x) => norm(x.engineering.demandGroup) === group || norm(x.engineering.capacityGroup) === group), resolution: available >= required ? "" : `Tăng capacity cho nhóm ${group}.` }));
  }

  const counts = {
    total: checks.length,
    pass: checks.filter((x) => x.status === "PASS").length,
    fail: checks.filter((x) => x.status === "FAIL").length,
    unknown: checks.filter((x) => x.status === "UNKNOWN").length,
    error: checks.filter((x) => x.severity === "ERROR" && x.status === "FAIL").length,
    warning: checks.filter((x) => x.severity === "WARNING" || x.status === "UNKNOWN").length,
  };
  return {
    version: ENGINEERING_RULES_VERSION,
    status: counts.error > 0 ? "FAIL" : counts.warning > 0 ? "REVIEW" : "PASS",
    checks,
    issues: checks.filter((x) => x.status !== "PASS"),
    passed: checks.filter((x) => x.status === "PASS"),
    counts,
    requirements: {
      retentionDays: Math.max(0, num(requirements.retentionDays, 0)),
      defaultCameraBitrateMbps: Math.max(0, num(requirements.defaultCameraBitrateMbps, 0)),
      storageSafetyPercent: Math.max(0, Math.min(100, num(requirements.storageSafetyPercent, 10))),
    },
    lineCount: lines.length,
    evaluatedAt: new Date().toISOString(),
  };
}

export function buildEngineeringValidationSnapshot(assessment = {}, overrideReason = "") {
  const reason = txt(overrideReason);
  return {
    version: assessment.version || ENGINEERING_RULES_VERSION,
    status: assessment.status || "PASS",
    counts: assessment.counts || { total: 0, pass: 0, fail: 0, unknown: 0, error: 0, warning: 0 },
    checks: (assessment.checks || []).map((row) => ({
      ruleCode: row.ruleCode,
      family: row.family,
      status: row.status,
      severity: row.severity,
      title: row.title,
      detail: row.detail,
      evidence: row.evidence || {},
      affectedLines: row.affectedLines || [],
      resolution: row.resolution || "",
      source: row.source || "system",
      version: row.version || 1,
    })),
    requirements: assessment.requirements || {},
    evaluatedAt: assessment.evaluatedAt || new Date().toISOString(),
    override: reason && Number(assessment?.counts?.error || 0) > 0 ? { reason, accepted: true } : null,
  };
}

// Exported for focused smoke tests.
export const __engineeringInternals = { storageTbFromBitrate, inferRoleFromText, roleCapacityCheck };
