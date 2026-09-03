// ============================================================
// categoryInference — suy luận nhóm sản phẩm từ tên/SKU/specs/section.
// Không dùng AI. Dùng rule ngành phổ biến để tránh category kiểu
// "BẢNG BÁO GIÁ", "Tổng hợp..." lọt vào catalog.
// ============================================================

function compactText(v) {
  return String(v ?? "").replace(/\s+/g, " ").trim();
}

function normalizeAscii(v) {
  return compactText(v)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase();
}

const JUNK_CATEGORY_RE = /^(chung|khac|khác|sản phẩm|san pham|product)$/i;
const BAD_CATEGORY_RE = /(bang\s*bao\s*gia|bảng\s*báo\s*giá|bao\s*gia|báo\s*giá|tong\s*hop|tổng\s*hợp|tai\s*khoan|tài\s*khoản|ngan\s*hang|ngân\s*hàng|dieu\s*khoan|điều\s*khoản|ghi\s*chu|ghi\s*chú|bao\s*hanh|bảo\s*hành|hotline|lien\s*he|liên\s*hệ)/i;

const CATEGORY_RULES = [
  { category: "Két an toàn", patterns: [/\b(sbx|valis|safe)/i, /két\s*an\s*toàn/i, /ket\s*an\s*toan/i] },
  { category: "Khóa thông minh", patterns: [/\b(ddl|k20|k9|r7|q9|p100|kbt|osn|kaadas|hexa)\b/i, /khóa\s*(thông\s*minh|cửa)?|khoa\s*(thong\s*minh|cua)?|door\s*lock|smart\s*lock|fingerprint\s*lock/i] },
  { category: "Công tắc thông minh", patterns: [/công\s*tắc|cong\s*tac|switch|\bct\b|lumi.*s\d|aqara.*switch/i] },
  { category: "Cảm biến", patterns: [/cảm\s*biến|cam\s*bien|sensor|motion|door\s*sensor|nhiệt\s*độ|nhiet\s*do|khói|khoi|gas|pir/i] },
  { category: "Bộ điều khiển trung tâm", patterns: [/hub|gateway|bộ\s*điều\s*khiển\s*trung\s*tâm|bo\s*dieu\s*khien\s*trung\s*tam|home\s*center/i] },
  { category: "Rèm thông minh", patterns: [/rèm|rem|curtain|motor\s*rèm|dong\s*co\s*rem|động\s*cơ\s*rèm/i] },
  { category: "Đèn", patterns: [/đèn|den|downlight|spotlight|tracklight|led\s*dây|led\s*day|driver|dimmer|lighting/i] },
  { category: "Lưu trữ camera", patterns: [/ổ\s*cứng|o\s*cung|hdd|hard\s*drive|wd20|wd40|purple/i] },
  { category: "Chuông cửa", patterns: [/chuông\s*cửa|chuong\s*cua|intercom|\bds-kv|\bkh6320|màn\s*hình\s*chuông|man\s*hinh\s*chuong/i] },
  { category: "Cổng tự động", patterns: [/moto\s*cổng|motor\s*cổng|cong\s*tu\s*dong|cổng\s*tự\s*động|vulcan|tay\s*đòn|tay\s*don|âm\s*sàn|am\s*san/i] },
  { category: "Camera", patterns: [/camera|nvr|dvr|poe|ipcam|ipc|đầu\s*ghi|dau\s*ghi/i] },
  { category: "Điều hòa", patterns: [/điều\s*hòa|dieu\s*hoa|air\s*conditioner|vrv|vrf|cassette|btu/i] },
  { category: "Thiết bị vệ sinh", patterns: [/bồn\s*cầu|bon\s*cau|vòi|voi|sen|lavabo|toto|inax|kohler|thiết\s*bị\s*vệ\s*sinh/i] },
  { category: "Nội thất", patterns: [/mdf|hdf|laminate|acrylic|an\s*cường|an\s*cuong|tủ\s*bếp|tu\s*bep|bàn\s*ghế|ban\s*ghe/i] },
  { category: "Phụ kiện", patterns: [/phụ\s*kiện|phu\s*kien|adapter|nguồn|nguon|pin|battery|ray|đế|de|mặt\s*dưỡng|mat\s*duong/i] },
];

export function isBadCategory(category) {
  const raw = compactText(category);
  if (!raw) return true;
  const norm = normalizeAscii(raw);
  if (raw.length > 60) return true;
  if (BAD_CATEGORY_RE.test(raw) || BAD_CATEGORY_RE.test(norm)) return true;
  return false;
}

export function inferCategory(input = {}, fallback = "Chung") {
  const rawCategory = compactText(input.category);
  if (rawCategory && !JUNK_CATEGORY_RE.test(rawCategory) && !isBadCategory(rawCategory)) return rawCategory;

  const primaryHaystack = [input.name, input.sku, input.sectionName, input.sheetName, input.supplier].filter(Boolean).join(" ");
  const primaryNorm = normalizeAscii(primaryHaystack);
  for (const rule of CATEGORY_RULES) {
    if (rule.patterns.some((p) => p.test(primaryHaystack) || p.test(primaryNorm))) return rule.category;
  }

  const haystack = [
    input.name,
    input.sku,
    input.specs,
    input.sectionName,
    input.sheetName,
    input.supplier,
    input.rawText,
  ].filter(Boolean).join(" ");

  const norm = normalizeAscii(haystack);
  for (const rule of CATEGORY_RULES) {
    if (rule.patterns.some((p) => p.test(haystack) || p.test(norm))) return rule.category;
  }

  const fb = compactText(fallback);
  return fb && !isBadCategory(fb) ? fb : "Chung";
}

export function inferCategoryForProduct(product = {}, fallback = "Chung") {
  return inferCategory({
    category: product.category,
    name: product.name,
    sku: product.sku,
    specs: product.specs,
    supplier: product.supplier,
    rawText: product.rawText || product.source?.rawText || product._meta?.source?.rawText,
    sheetName: product.source?.sheet || product._meta?.source?.sheet,
  }, fallback);
}
