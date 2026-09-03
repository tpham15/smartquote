// Phase 14.0 — pure PDF evidence helpers. No network/runtime imports so they can
// be unit-tested independently from the PDF/AI pipeline.
function text(v) { return String(v || "").replace(/\s+/g, " ").trim(); }
function key(v) {
  return text(v).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/[^a-z0-9]+/g, " ").trim();
}
function tokens(v) { return new Set(key(v).split(/\s+/).filter((t) => t.length >= 2)); }
function tokenCount(v) { return text(v).split(/\s+/).filter(Boolean).length; }
function clearSku(v) { const s = text(v); return /[A-Z]/i.test(s) && /\d/.test(s) && s.replace(/[^A-Z0-9]/gi, "").length >= 4; }
function productKeyword(v) { return /(đèn|den|khóa|khoa|camera|công tắc|cong tac|cảm biến|cam bien|ray|động cơ|dong co|led|spotlight|downlight|nguồn|nguon|module|modun|phụ kiện|phu kien|còi|coi|chặn|chan|con lăn|con lan|door|exit|thanh ray)/i.test(text(v)); }
function suspiciousName(v) {
  const n = text(v), k = key(v);
  if (!n) return true;
  if (/^(bo|bộ|md|cai|cái|hinh|hình|phu kien|phụ kiện)\s*\d*$/i.test(n)) return true;
  if (/^(bang gia|bbg|gia dai ly|gia npp|don gia|bao gia)/.test(k)) return true;
  return tokenCount(n) <= 2 && !productKeyword(n);
}
function genericFragment(v) {
  const n = text(v), k = key(v);
  if (!n || n.length < 5) return true;
  if (/^(san pham|sản phẩm|thiet bi|thiết bị|vat tu|vật tư|hang hoa|hàng hóa|phu kien|phụ kiện)$/i.test(n)) return true;
  if (tokenCount(n) <= 2 && !productKeyword(n)) return true;
  if (!productKeyword(n) && tokenCount(n) <= 4 && /^(gia|tong|vat|thue|ghi chu|thanh toan|bao hanh)/.test(k)) return true;
  return false;
}
function nonProductText(v) {
  const k = key(v);
  return /\b(tong cong|tong tien|thanh tien|vat|thue gtgt|chiet khau|ghi chu|luu y|dieu khoan|thanh toan|chuyen khoan|bao hanh|giao hang|van chuyen|hotline|tai khoan ngan hang)\b/.test(k);
}

export function findPdfRowEvidence(page = {}, line = "") {
  const rows = Array.isArray(page.rows) ? page.rows : [];
  if (!rows.length || !line) return null;
  const target = key(line);
  const targetTokens = tokens(line);
  let best = null;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] || {};
    const candidate = key(row.text || "");
    if (!candidate) continue;
    let score = 0;
    if (candidate === target) score = 1;
    else if (candidate.includes(target) || target.includes(candidate)) score = 0.94;
    else {
      const rowTokens = tokens(row.text || "");
      if (targetTokens.size && rowTokens.size) {
        let hit = 0;
        for (const token of targetTokens) if (rowTokens.has(token)) hit += 1;
        score = hit / Math.max(targetTokens.size, rowTokens.size);
      }
    }
    if (!best || score > best.score) best = { score, row, index: i };
  }
  if (!best || best.score < 0.42) return null;
  return {
    row: best.index + 1,
    rawText: text(best.row.text || line).slice(0, 300),
    bbox: best.row.bbox || null,
    parts: Array.isArray(best.row.parts) ? best.row.parts.slice(0, 80) : [],
    pageWidth: Number(page.pageWidth || 0) || null,
    pageHeight: Number(page.pageHeight || 0) || null,
    matchScore: Math.round(best.score * 1000) / 1000,
  };
}

export function assessPdfPositiveEvidence(item = {}, engine = "") {
  const meta = item._meta || {};
  const source = meta.source || {};
  const supplied = meta.productEvidence || item.evidence || {};
  const name = text(item.name);
  const sku = text(item.sku);
  const raw = text(item.rawText || source.rawText || "");
  const category = text(item.category);
  const costPrice = Number(item.costPrice || item.price || 0) || 0;
  const listPrice = Number(item.listPrice || item.publicPrice || 0) || 0;
  const hasSku = supplied.hasSku ?? clearSku(sku);
  const hasProductKeyword = supplied.hasProductKeyword ?? productKeyword([name, raw, category].join(" "));
  const hasGrounding = supplied.hasGrounding ?? !!source.bbox;
  const hasExplicitUnit = !!supplied.hasExplicitUnit;
  const usefulCategory = !!category && !/^(chung|bbg|bang gia|bảng giá)$/i.test(category);
  const goodName = !!name && name.length >= 6 && name.length <= 120 && !suspiciousName(name);
  const validPrice = costPrice >= 1000 && costPrice <= 1000000000 && !(listPrice > 0 && listPrice < costPrice);
  let score = 0;
  const reasons = [];
  if (validPrice) { score += 2; reasons.push("valid_price"); }
  if (hasSku) { score += 2; reasons.push("clear_sku"); }
  if (hasProductKeyword) { score += 1; reasons.push("product_keyword"); }
  if (hasGrounding) { score += 1; reasons.push("source_grounding"); }
  if (hasExplicitUnit) { score += 0.5; reasons.push("explicit_unit"); }
  if (usefulCategory) { score += 0.5; reasons.push("section_context"); }
  if (goodName) { score += 1; reasons.push("credible_name"); }
  if (genericFragment(name)) { score -= 1.5; reasons.push("generic_or_fragment_name"); }
  if (suspiciousName(name)) { score -= 1.5; reasons.push("suspicious_name"); }
  if (nonProductText(raw || name)) { score -= 3; reasons.push("non_product_text"); }
  return {
    score: Math.round(score * 100) / 100,
    positive: score >= 3,
    autoApprove: String(engine || meta.engine || "").includes("heuristic") && score >= 6 && validPrice && goodName,
    reasons,
    signals: { validPrice, clearSku: hasSku, productKeyword: hasProductKeyword, grounding: hasGrounding, explicitUnit: hasExplicitUnit, usefulCategory, goodName },
  };
}
