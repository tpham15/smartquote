// ============================================================
// corrections — học từ sửa tay của người dùng
// rawText (chuẩn hoá) -> productId. Lần sau gặp dòng giống → tự match.
// ============================================================

const CORR_KEY = "sq_import_corrections";

function norm(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9]/g, "");
}

export function loadCorrections() {
  try { return JSON.parse(localStorage.getItem(CORR_KEY) || "{}"); }
  catch { return {}; }
}

/**
 * Ghi nhận 1 correction: dòng rawText này → ứng với productId này.
 * @param {string} rawText
 * @param {string} productId
 */
export function saveCorrection(rawText, productId) {
  if (!rawText || !productId) return;
  try {
    const all = loadCorrections();
    all[norm(rawText)] = productId;
    // giới hạn 2000 correction
    const keys = Object.keys(all);
    if (keys.length > 2000) delete all[keys[0]];
    localStorage.setItem(CORR_KEY, JSON.stringify(all));
  } catch {}
}

/** Ghi nhiều correction cùng lúc (sau khi user duyệt review) */
export function saveCorrections(pairs) {
  try {
    const all = loadCorrections();
    for (const { rawText, productId } of pairs) {
      if (rawText && productId) all[norm(rawText)] = productId;
    }
    localStorage.setItem(CORR_KEY, JSON.stringify(all));
  } catch {}
}

export { norm as normCorrectionKey };
