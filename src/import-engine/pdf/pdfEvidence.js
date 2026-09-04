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



function moneyOccurrences(v) {
  const raw = String(v || "");
  const re = /(?:\d{1,3}(?:[.,]\d{3}){1,3}|\d{5,10})(?:\s?đ)?/gi;
  const out = [];
  for (const m of raw.matchAll(re)) {
    const digits = String(m[0]).replace(/[^\d]/g, "");
    if (digits.length < 5 || digits.length > 10) continue;
    const value = Number(digits);
    if (!Number.isFinite(value) || value < 1000 || value > 1_000_000_000) continue;
    out.push({ value, index: m.index || 0, raw: m[0] });
  }
  return out;
}

function quantityBeforeMoney(raw, firstMoneyIndex) {
  const prefix = String(raw || "").slice(0, Math.max(0, firstMoneyIndex));
  // Quote tables usually place ĐVT + SL directly before Đơn giá. Prefer that
  // structural signal so STT/spec numbers (4MP, 220V, 24V...) are never used.
  const unitQty = /(?:^|\s)(?:cái|cai|chiếc|chiec|bộ|bo|set|tủ|tu|m|mét|met|cuộn|cuon|hộp|hop|kg|g|lít|lit|pcs?|piece|unit)\s+(\d{1,4})\s*$/i.exec(prefix);
  if (unitQty) {
    const q = Number(unitQty[1]);
    if (q > 0) return q;
  }
  return 0;
}

export function inferPdfQuoteRowEconomics(rawLine = "") {
  const raw = text(rawLine);
  const money = moneyOccurrences(raw);
  if (money.length < 2) return { matched: false, quantity: 0, unitPrice: 0, lineTotal: 0 };

  // In a quotation row, the final two money cells are normally Đơn giá + Thành tiền.
  // Only accept this interpretation when the arithmetic proves it.
  for (let i = money.length - 2; i >= 0; i--) {
    const unit = money[i];
    const total = money[i + 1];
    const quantity = quantityBeforeMoney(raw, unit.index);
    if (!quantity || unit.value <= 0 || total.value <= 0) continue;
    const expected = quantity * unit.value;
    const tolerance = Math.max(1, Math.round(total.value * 0.0001));
    if (Math.abs(expected - total.value) <= tolerance) {
      return {
        matched: true,
        quantity,
        unitPrice: unit.value,
        lineTotal: total.value,
        unitPriceRaw: unit.raw,
        lineTotalRaw: total.raw,
      };
    }
  }
  return { matched: false, quantity: 0, unitPrice: 0, lineTotal: 0 };
}

export function classifyPdfStructuralRow(rawLine = "") {
  const raw = text(rawLine);
  const k = key(raw);
  if (!raw) return { kind: "empty", catalogEligible: false };

  // Company/contact/bank headers are metadata, never catalog products. This is
  // structural rather than an ever-growing business-text denylist.
  const contact = /\b(mst|ma so thue|dien thoai|dt|tel|telephone|hotline|dia chi|email|website|so tk|stk|tai khoan ngan hang|tai khoan)\b/.test(k);
  if (contact && !productKeyword(raw)) return { kind: "header_contact", catalogEligible: false };

  // Old quotation section headers often include their subtotal on the same line,
  // e.g. "II. Tầng 2 86.004.000đ". Keep the section as context, not a product.
  const section = /^\s*(?:[ivxlcdm]+|\d+)\s*[.)]\s*(.+?)\s+(?:\d{1,3}(?:[.,]\d{3}){1,3}|\d{5,10})(?:\s?đ)?\s*$/i.exec(raw);
  if (section) {
    const category = text(section[1]).replace(/\s+/g, " ").trim();
    if (category) return { kind: "section_subtotal", catalogEligible: false, category };
  }

  // Summary/service charges belong to a quotation, not the product catalog.
  if (/^(tong gia tri|tong tien|tong cong|gia tri hop dong|gia tri tren hop dong|nhan cong|lap dat|lap trinh|thi cong|vat|thue|chiet khau|tam tinh)\b/.test(k)) {
    return { kind: "quote_summary_or_service", catalogEligible: false };
  }

  return { kind: "candidate", catalogEligible: true };
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
  const quoteArithmeticMatched = !!supplied.quoteArithmeticMatched;
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
  if (quoteArithmeticMatched) { score += 2; reasons.push("quote_row_arithmetic"); }
  if (usefulCategory) { score += 0.5; reasons.push("section_context"); }
  if (goodName) { score += 1; reasons.push("credible_name"); }
  if (genericFragment(name)) { score -= 1.5; reasons.push("generic_or_fragment_name"); }
  if (suspiciousName(name)) { score -= 1.5; reasons.push("suspicious_name"); }
  if (nonProductText(raw || name)) { score -= 3; reasons.push("non_product_text"); }
  return {
    score: Math.round(score * 100) / 100,
    positive: score >= 3,
    autoApprove: String(engine || meta.engine || "").includes("heuristic") && score >= 6 && validPrice && goodName && (hasSku || hasProductKeyword || (quoteArithmeticMatched && hasExplicitUnit && hasGrounding)),
    reasons,
    signals: { validPrice, clearSku: hasSku, productKeyword: hasProductKeyword, grounding: hasGrounding, explicitUnit: hasExplicitUnit, quoteArithmeticMatched, usefulCategory, goodName },
  };
}

// Phase 14.0E — AI may read a PDF row, but SmartQuote decides whether that
// row is trustworthy. Row correctness and document recall are separate signals.

export function assessPdfVisionTrust(item = {}, engine = "") {
  const meta = item?._meta || {};
  const source = meta.source || {};
  const ev = assessPdfPositiveEvidence(item, engine || meta.engine || "");
  const variants = Array.isArray(item?.variants) ? item.variants : (Array.isArray(meta?.variants) ? meta.variants : []);
  const hasVariantSku = variants.some((v) => clearSku(v?.sku));
  const hasVariantPrice = variants.some((v) => Number(v?.price || 0) >= 1000 && Number(v?.price || 0) <= 1_000_000_000);
  const clearIdentity = !!ev.signals?.clearSku || hasVariantSku;
  const validCommercialPrice = !!ev.signals?.validPrice || hasVariantPrice;

  // Phase 14.2: many catalogs do not print an STT column. A stable table-row
  // ordinal/bbox from Document IR is valid provenance; requiring visible STT made
  // every row in otherwise clean catalogs fall into review.
  const layoutGrounded = !!source.layoutGrounded || !!meta?.productEvidence?.layoutGrounded || !!source.bbox;
  const rowGrounded = Number(source.page || 0) > 0 && (Number(source.row || 0) > 0 || layoutGrounded);

  const fieldEvidence = meta.fieldEvidence || {};
  const nameConfidence = Number(fieldEvidence?.name?.confidence ?? meta?.productEvidence?.fieldConfidence?.name ?? 0) || 0;
  const skuConfidence = Number(fieldEvidence?.sku?.confidence ?? meta?.productEvidence?.fieldConfidence?.sku ?? 0) || 0;
  const priceConfidence = Number(fieldEvidence?.price?.confidence ?? meta?.productEvidence?.fieldConfidence?.price ?? 0) || 0;
  const layoutEngine = String(engine || meta.engine || '').includes('layout-ir');
  // Older PDF engines did not emit field confidence. For v7 layout IR, require
  // explicit confidence so auto-approval is evidence-based, not just AI-shaped.
  const fieldConfidenceStrong = !layoutEngine || (
    nameConfidence >= 0.72
    && (skuConfidence >= 0.72 || hasVariantSku)
    && (priceConfidence >= 0.72 || hasVariantPrice)
  );

  const isPdfVision = (meta.source?.type === "pdf" || String(engine || meta.engine || "").startsWith("pdf"))
    && !String(engine || meta.engine || "").includes("heuristic");
  const trusted = isPdfVision
    && rowGrounded
    && clearIdentity
    && validCommercialPrice
    && !!ev.signals?.goodName
    && fieldConfidenceStrong
    && Number(ev.score || 0) >= 6;
  return {
    trusted,
    score: ev.score,
    reasons: ev.reasons,
    signals: {
      ...ev.signals,
      rowGrounded,
      layoutGrounded,
      clearIdentity,
      validCommercialPrice,
      hasVariantSku,
      hasVariantPrice,
      fieldConfidenceStrong,
      fieldConfidence: { name: nameConfidence, sku: skuConfidence, price: priceConfidence },
    },
  };
}

