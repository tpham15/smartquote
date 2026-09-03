// ============================================================
// detectDomain — đoán ngành hàng từ tập items
// KHÔNG hard-code 1 ngành. Trả về domain + độ tin cậy.
// Domain chỉ dùng để gợi ý, không ảnh hưởng việc parse.
// ============================================================

// Mỗi domain có tập từ khoá đặc trưng (mở rộng được).
const DOMAIN_SIGNALS = {
  smarthome:  ["công tắc", "cảm biến", "zigbee", "smart", "lumi", "wifi", "ổ cắm", "dimmer", "điều khiển", "bộ điều khiển", "module"],
  lighting:   ["đèn", "downlight", "spotlight", "led", "lighting", "rọi", "panel", "âm trần", "luminaire", "chiếu sáng"],
  lock:       ["khóa", "khoá", "vân tay", "mật mã", "door lock", "ddl", "smart lock", "thẻ từ", "khóa cửa"],
  gate:       ["cổng", "motor", "barrier", "gate", "tay đòn", "cổng trượt", "âm sàn", "vulcan", "ayros"],
  curtain:    ["rèm", "thanh ray", "kéo tay", "màn", "curtain", "track", "động cơ rèm", "âm trần"],
  hvac:       ["điều hòa", "máy lạnh", "hvac", "fcu", "ahu", "quạt", "thông gió", "ống gió"],
  electrical: ["dây", "cáp", "cb", "aptomat", "mccb", "tủ điện", "ổ cắm", "công tắc điện", "đèn"],
  furniture:  ["tủ", "bàn", "ghế", "giường", "kệ", "sofa", "nội thất", "cabinet"],
  plumbing:   ["vòi", "sen", "bồn", "lavabo", "chậu rửa", "thiết bị vệ sinh", "bồn cầu", "sen tắm"],
  camera:     ["camera", "hikvision", "dahua", "đầu ghi", "nvr", "dvr", "ip camera", "ptz"],
};

/**
 * @param {Object[]} items
 * @returns {{domain: string, confidence: number, scores: Object}}
 */
export function detectDomain(items) {
  const scores = {};
  for (const d of Object.keys(DOMAIN_SIGNALS)) scores[d] = 0;

  const sample = items.slice(0, 50);
  for (const it of sample) {
    const text = `${it.name} ${it.category} ${it.specs} ${it.sku}`.toLowerCase();
    for (const [domain, signals] of Object.entries(DOMAIN_SIGNALS)) {
      for (const sig of signals) {
        if (text.includes(sig)) { scores[domain]++; break; } // mỗi item +1 tối đa/domain
      }
    }
  }

  let bestDomain = "general";
  let bestScore = 0;
  for (const [d, s] of Object.entries(scores)) {
    if (s > bestScore) { bestScore = s; bestDomain = d; }
  }

  const confidence = sample.length ? Math.min(1, bestScore / sample.length) : 0;
  return { domain: bestScore > 0 ? bestDomain : "general", confidence, scores };
}

export { DOMAIN_SIGNALS };
