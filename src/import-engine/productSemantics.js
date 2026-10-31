// ============================================================
// P2.3.3 Source taxonomy + product semantics
// Keep Category, Product Type, Subtype, Commercial Model, SKU and
// Canonical Name as separate concepts. Rules are conservative: a rule may
// rewrite a display name only when there is strong evidence for the actual
// sellable product type.
// ============================================================

function compact(value = "") {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function fold(value = "") {
  return compact(value)
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d").replace(/Đ/g, "D")
    .toLowerCase();
}

function normalizeModelText(value = "") {
  return compact(value)
    .replace(/[()]/g, " ")
    .replace(/\s*[-–—]\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripCanonicalCodeFromAlias(alias = "", sku = "") {
  let out = compact(alias);
  if (!out) return "";
  // Remove bracketed/internal code first. Historical quotation columns often
  // look like "Vulcan - 24V (29G020)".
  out = out.replace(/\([^)]*\)/g, " ");
  const skuFold = fold(sku).replace(/[^a-z0-9]/g, "");
  if (skuFold) {
    const tokens = out.split(/\s+/).filter((token) => fold(token).replace(/[^a-z0-9]/g, "") !== skuFold);
    out = tokens.join(" ");
  }
  return normalizeModelText(out);
}

function normalizeGateModelCase(value = "") {
  const raw = normalizeModelText(value);
  if (!raw) return "";
  const upper = raw.toUpperCase();
  const known = [
    /\bVULCAN(?:\s+(?:24V|230V))?\b/,
    /\bTORQ\s+500D\b/,
    /\bAYROS\s+(?:1000D|650)(?:\s+V2)?\b/,
    /\bNYK(?:\s+24V)?\b/,
    /\bSTAR\s+K3(?:\s+24V)?\b/,
    /\bSTARK\s+600(?:\s+V2)?\b/,
  ];
  for (const re of known) {
    const m = upper.match(re);
    if (m) return m[0].replace(/\s+/g, " ").trim();
  }
  // Conservative fallback: only accept short alias-like values, not prose.
  if (raw.length <= 36 && /[A-Za-z]/.test(raw) && !/[,:;]/.test(raw)) return upper;
  return "";
}

function extractGateCommercialModel(product = {}, context = {}) {
  const sourceAlias = compact(
    product?.source?.rawSku ||
    product?._meta?.source?.rawSku ||
    product?.attributes?.identity?.sourceAlias ||
    context.rawSku ||
    ""
  );
  const sku = compact(product.sku || "");
  const aliasModel = normalizeGateModelCase(stripCanonicalCodeFromAlias(sourceAlias, sku));
  if (aliasModel && fold(aliasModel).replace(/[^a-z0-9]/g, "") !== fold(sku).replace(/[^a-z0-9]/g, "")) {
    return { model: aliasModel, evidence: "source_alias" };
  }

  const haystack = [product.name, product.specs, context.sheetName, context.sectionName, product?.source?.sheet, product?._meta?.source?.sheet]
    .filter(Boolean).join(" ").toUpperCase().replace(/[-–—]+/g, " ");
  const known = [
    /\bVULCAN\s+(?:24V|230V)\b/,
    /\bTORQ\s+500D\b/,
    /\bAYROS\s+(?:1000D|650)(?:\s+V2)?\b/,
    /\bNYK(?:\s+24V)?\b/,
    /\bSTAR\s+K3(?:\s+24V)?\b/,
    /\bSTARK\s+600(?:\s+V2)?\b/,
  ];
  for (const re of known) {
    const m = haystack.match(re);
    if (m) return { model: m[0].replace(/\s+/g, " ").trim(), evidence: "commercial_name" };
  }
  return { model: "", evidence: "none" };
}

function detectGateSubtype(text = "") {
  const n = fold(text);
  if (/am\s*san|underground|floor\s*gate/.test(n)) return { key: "underground", label: "Âm sàn" };
  if (/cong\s*truot|gate\s*slid|sliding|\bayros\b|\btorq\b/.test(n)) return { key: "sliding", label: "Trượt" };
  if (/tay\s*don|mo\s*xoay|swing|\bnyk\b|\bstar\s*k3\b|\bstark\s*600\b/.test(n)) return { key: "swing_arm", label: "Tay đòn / mở xoay" };
  return { key: "", label: "" };
}

function normalizeGateDocumentCategory(value = "", subtypeKey = "") {
  const n = fold(value);
  if (/cong\s*(?:xoay\s*)?am\s*san/.test(n)) return "Cổng âm sàn tự động";
  if (/cong\s*truot/.test(n)) return "Cổng trượt tự động";
  if (/cong\s*tay\s*don/.test(n)) return "Cổng tay đòn tự động";
  if (/cong\s*(?:mo\s*)?xoay/.test(n)) return "Cổng mở xoay tự động";
  if (subtypeKey === "underground") return "Cổng âm sàn tự động";
  if (subtypeKey === "sliding") return "Cổng trượt tự động";
  if (subtypeKey === "swing_arm") return "Cổng mở xoay tự động";
  return "Cổng tự động";
}

function gateProductTypeFromSource(sourceName = "", subtypeKey = "") {
  const n = fold(sourceName);
  if (/cong\s*xoay\s*tu\s*dong\s*am\s*san/.test(n)) return "Cổng xoay tự động âm sàn";
  if (/mo\s*to\s*cong\s*truot|moto\s*cong\s*truot|motor\s*cong\s*truot/.test(n)) return "Mô tơ cổng trượt";
  if (/dong\s*co\s*cong\s*truot/.test(n)) return "Động cơ cổng trượt";
  if (/mo\s*to\s*cong.*mo\s*xoay|moto\s*cong.*mo\s*xoay|motor\s*cong.*mo\s*xoay/.test(n)) return "Mô tơ cổng mở xoay tự động";
  if (/dong\s*co\s*cong.*mo\s*xoay/.test(n)) return "Động cơ cổng mở xoay tự động";
  if (subtypeKey === "underground") return "Cổng xoay tự động âm sàn";
  if (subtypeKey === "sliding") return "Mô tơ cổng trượt";
  if (subtypeKey === "swing_arm") return "Mô tơ cổng mở xoay tự động";
  return "Thiết bị cổng tự động";
}

function canonicalGateName(sourceName = "", productType = "", model = "", subtypeKey = "", sourceEvidence = "") {
  const commercialEvidence = compact(sourceEvidence).split(/\b(?:model|thông\s*số|thong\s*so)\b/i)[0] || "";
  const n = fold([sourceName, commercialEvidence].filter(Boolean).join(" "));
  const hasSourceV2 = /\bv2\b/.test(n);
  if (subtypeKey === "underground") {
    return [productType, hasSourceV2 ? "V2" : "", model ? `- ${model}` : ""].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  }
  if (subtypeKey === "sliding") {
    return [productType, hasSourceV2 ? "V2" : "", model ? `${hasSourceV2 ? "- " : ""}${model}` : ""].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  }
  if (subtypeKey === "swing_arm") {
    return [productType, model].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  }
  return compact(sourceName) || [productType, model].filter(Boolean).join(" ").trim();
}

function gateMotorRule(product = {}, context = {}) {
  const incomingCategory = compact(product.category || context.category || "");
  const documentCategory = compact(
    context.documentCategory ||
    product?.source?.documentCategory ||
    product?._meta?.source?.documentCategory ||
    ""
  );
  // RC4: when the source description still carries an explicit commercial
  // first line, it outranks any display name synthesized earlier in the
  // pipeline. Version/model evidence must not leak into Product Name unless
  // the source commercial line itself contains it.
  const sourceName = compact(
    context.sourceCommercialName ||
    product?.attributes?.identity?.sourceName ||
    product.name ||
    ""
  );
  const sourceText = [
    sourceName,
    product.specs,
    incomingCategory,
    documentCategory,
    context.sheetName,
    context.sectionName,
    product?.source?.sheet,
    product?._meta?.source?.sheet,
    product?.source?.rawText,
    product?._meta?.source?.rawText,
    product?.source?.rawSku,
    product?._meta?.source?.rawSku,
  ].filter(Boolean).join(" ");
  const n = fold(sourceText);
  const gateEvidence = /cong\s*(?:tu\s*dong|truot|xoay|tay\s*don)|gate|vulcan|ayros|torq|nyk|star\s*k3|stark\s*600/.test(n)
    || fold(incomingCategory) === "cong tu dong";
  if (!gateEvidence) return null;

  // Do not force accessories/whole-gate records into a motor identity. Strong
  // evidence must come from the source product line/specification or known gate
  // opener models.
  const sellableEvidence = /mo\s*to|moto|motor|dong\s*co|cong\s*xoay\s*tu\s*dong\s*am\s*san/.test(n)
    || /vulcan|ayros|torq|nyk|star\s*k3|stark\s*600/.test(n);
  if (!sellableEvidence) return null;

  const subtype = detectGateSubtype([sourceName, documentCategory, sourceText].filter(Boolean).join(" "));
  const { model, evidence: modelEvidence } = extractGateCommercialModel(product, context);
  const productType = gateProductTypeFromSource(sourceName, subtype.key);
  const category = normalizeGateDocumentCategory(documentCategory || incomingCategory, subtype.key);
  const canonicalName = canonicalGateName(sourceName, productType, model, subtype.key, product.specs || "");

  return {
    family: "Cổng tự động",
    category,
    productType,
    subtype: subtype.label,
    subtypeKey: subtype.key,
    model,
    canonicalName,
    evidence: {
      rule: "gate_source_taxonomy",
      family: "strong_context",
      category: documentCategory ? "quote_specification" : "source_product_line",
      productType: "source_product_line",
      model: modelEvidence,
    },
  };
}

const SEMANTIC_RULES = [gateMotorRule];

/**
 * Returns semantic identity without mutating the source product.
 * Unknown dimensions stay blank instead of copying Category into Product Type.
 */
export function deriveProductSemantics(product = {}, context = {}) {
  for (const rule of SEMANTIC_RULES) {
    const result = rule(product, context);
    if (result) return result;
  }
  return {
    family: compact(product?.attributes?.identity?.family || ""),
    category: compact(product.category || context.category || ""),
    productType: compact(product.productType || product?.attributes?.identity?.productType || ""),
    subtype: compact(product.subtype || product?.attributes?.identity?.subtype || ""),
    subtypeKey: compact(product?.attributes?.identity?.subtypeKey || ""),
    model: compact(product.model || product?.attributes?.identity?.model || ""),
    canonicalName: compact(product.name || ""),
    evidence: { rule: "none", productType: "none", model: "none" },
  };
}

/**
 * Apply semantics only when a strong rule identifies the actual sellable item.
 * The original imported display name is retained in identity.sourceName.
 */
export function applyProductSemantics(product = {}, context = {}) {
  const p = { ...product };
  const semantics = deriveProductSemantics(p, context);
  const existingIdentity = p?.attributes?.identity && typeof p.attributes.identity === "object"
    ? p.attributes.identity : {};
  const sourceAlias = compact(
    p?.source?.rawSku || p?._meta?.source?.rawSku || existingIdentity.sourceAlias || ""
  );
  const sourceName = compact(context.sourceCommercialName || existingIdentity.sourceName || p.name || "");
  const strong = semantics?.evidence?.rule && semantics.evidence.rule !== "none";

  if (strong && semantics.canonicalName) p.name = semantics.canonicalName;
  if (strong && semantics.category) p.category = semantics.category;
  p.productType = semantics.productType || p.productType || "";
  p.subtype = semantics.subtype || p.subtype || "";
  p.model = semantics.model || p.model || "";
  p.attributes = {
    ...(p.attributes || {}),
    identity: {
      ...existingIdentity,
      family: semantics.family || existingIdentity.family || "",
      category: semantics.category || p.category || "",
      productType: p.productType || "",
      subtype: p.subtype || "",
      subtypeKey: semantics.subtypeKey || existingIdentity.subtypeKey || "",
      model: p.model || "",
      sku: compact(p.sku || ""),
      canonicalName: compact(p.name || ""),
      sourceName,
      sourceAlias,
      semanticRule: semantics?.evidence?.rule || "none",
      evidence: semantics.evidence || {},
    },
  };
  return p;
}

function extractLabelledLegacyCode(rawText = "") {
  const raw = String(rawText ?? "").replace(/\r/g, "");
  const re = /\b(?:model|sku|code|part\s*(?:no\.?|number)?|mã\s*(?:sp|sản\s*phẩm|hàng|thiết\s*bị)|ma\s*(?:sp|san\s*pham|hang|thiet\s*bi))\s*[:：#-]?\s*([A-Z0-9][A-Z0-9._\-/]*(?:\s+V\d+)?)\b/ig;
  const m = re.exec(raw);
  if (!m) return "";
  const code = compact(m[1]).toUpperCase().replace(/\s*[-–—]\s*/g, "-");
  if (!code || /^\d+(?:V|W|A|HZ|MM|CM|KG)$/i.test(code)) return "";
  return code;
}

/**
 * Safe compatibility bridge for catalogs created before P2.3.1/P2.3.2.
 * It only changes SKU when an explicit labelled Model/SKU/Code survives in
 * stored specs/provenance. This lets re-import repair an old alias identity
 * instead of creating a duplicate product.
 */
export function canonicalizeLegacyProductForMatching(product = {}) {
  const rawEvidence = [
    typeof product.specs === "string" ? product.specs : "",
    product?.source?.rawText,
    product?._meta?.source?.rawText,
    product?.attributes?.identity?.sourceName,
  ].filter(Boolean).join("\n");
  const labelled = extractLabelledLegacyCode(rawEvidence);
  let repaired = { ...product };
  if (labelled) {
    const oldSku = compact(product.sku || "");
    const oldNorm = fold(oldSku).replace(/[^a-z0-9]/g, "");
    const newNorm = fold(labelled).replace(/[^a-z0-9]/g, "");
    if (!oldNorm || oldNorm !== newNorm) {
      repaired.sku = labelled;
      repaired.attributes = {
        ...(repaired.attributes || {}),
        identity: {
          ...(repaired.attributes?.identity || {}),
          sourceAlias: repaired.attributes?.identity?.sourceAlias || oldSku,
          repairedFromLegacySku: oldSku,
          skuRepairEvidence: "explicit_model_label",
        },
      };
    }
  }
  return applyProductSemantics(repaired, {
    category: repaired.category,
    sheetName: repaired?.source?.sheet || repaired?._meta?.source?.sheet || "",
    sectionName: repaired?.source?.section || repaired?._meta?.source?.section || "",
    documentCategory: repaired?.source?.documentCategory || repaired?._meta?.source?.documentCategory || "",
    rawSku: repaired?.attributes?.identity?.sourceAlias || repaired?.source?.rawSku || repaired?._meta?.source?.rawSku || "",
  });
}
