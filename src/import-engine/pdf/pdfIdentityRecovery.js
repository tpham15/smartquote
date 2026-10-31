function compact(value = '') {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function fold(value = '') {
  return compact(value)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .toLowerCase();
}

function escapeRe(value = '') {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function trimNoise(value = '') {
  return compact(value)
    .replace(/^[\-–—:;,]+|[\-–—:;,]+$/g, '')
    .replace(/^(?:cái|chiếc|bộ|set|pcs?)\s+/i, '')
    .trim();
}

function plausibleName(value = '') {
  const s = trimNoise(value);
  if (!s || s.length < 3 || s.length > 100) return '';
  if (!/[A-Za-zÀ-ỹ]/.test(s)) return '';
  if (/^(?:cái|chiếc|bộ|set|pcs?|vnd|vnđ)$/i.test(s)) return '';
  if (/^(?:giá|đơn giá|giá npp|giá lẻ|giá đại lý)\b/i.test(s)) return '';
  return s;
}

/**
 * Recover a product description when a PDF column model collapses name to SKU.
 * Uses only the original row text. It never invents a label.
 *
 * Example:
 *   5 ZTBS Phụ kiện mở cổng bằng điện thoại Cái/chiếc 4,000,000 1,000,000
 * -> Phụ kiện mở cổng bằng điện thoại
 */
export function recoverPdfProductNameFromRawRow(rawText = '', sku = '') {
  const raw = compact(rawText);
  const code = compact(sku);
  if (!raw || !code) return '';

  const body = raw.replace(/^\d{1,3}[.)]?\s+/, '');
  const skuRe = new RegExp(`(?:^|\\s)${escapeRe(code)}(?=\\s|$)`, 'i');
  const hit = skuRe.exec(body);
  if (!hit) return '';

  const before = plausibleName(body.slice(0, hit.index));
  let after = body.slice(hit.index + hit[0].length).trim();

  // Remove the commercial tail. Price/unit/quantity belong to other fields.
  after = after.replace(/\b(?:cái\/?chiếc|cái|chiếc|bộ|set|pcs?)\b.*$/i, '').trim();
  after = after.replace(/\b\d{1,3}(?:[.,]\d{3}){1,4}\b.*$/, '').trim();
  after = after.replace(/\b\d{5,10}\b.*$/, '').trim();
  const afterName = plausibleName(after);

  // In the common code-first row shape, text after the SKU is authoritative.
  if (afterName && fold(afterName) !== fold(code)) return afterName;
  if (before && fold(before) !== fold(code)) return before;
  return '';
}
