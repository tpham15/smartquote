import { chooseComponentCandidate, shouldAutoAddComponent } from "./packTemplates.js";

// BOM Phase 6 — Quote Composer A/B/C + Pack Template lines
// Builds deterministic quote scenarios from parsed BOM lines, selected solution packs,
// catalog suggestions and user resolutions. No AI dependency.

const DEFAULT_VARIANTS = [
  {
    id: "budget",
    label: "Tiết kiệm",
    shortLabel: "A",
    subtitle: "Ưu tiên giá thấp, phù hợp báo giá mở đầu",
    intent: "min_price",
    multiplier: 0.95,
  },
  {
    id: "standard",
    label: "Tiêu chuẩn",
    shortLabel: "B",
    subtitle: "Ưu tiên phương án đang chọn và match chắc nhất",
    intent: "balanced",
    multiplier: 1,
  },
  {
    id: "premium",
    label: "Cao cấp",
    shortLabel: "C",
    subtitle: "Ưu tiên thương hiệu/giá trị cao hơn nếu có lựa chọn",
    intent: "max_quality",
    multiplier: 1.08,
  },
];

function normalize(value = "") {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function priceOf(product = {}) {
  return Number(product.listPrice || product.publicPrice || product.salePrice || product.price || product.costPrice || 0) || 0;
}

function costOf(product = {}) {
  return Number(product.costPrice || 0) || 0;
}

function getLineScopeId(line = {}) {
  return line.scopeId || `scope_${String(line.solutionKey || "other").replace(/[^a-z0-9_-]/gi, "_")}`;
}

function getSelectedRecommendation(line = {}, solutionPacks = [], packSelections = {}) {
  const scopeId = getLineScopeId(line);
  const pack = (solutionPacks || []).find((p) => p.scopeId === scopeId);
  if (!pack) return null;
  const selectedId = packSelections[scopeId] || pack.selectedRecommendationId || pack.recommendations?.[0]?.id;
  return (pack.recommendations || []).find((r) => r.id === selectedId) || pack.recommendations?.[0] || null;
}

function isExplicitUserResolution(line = {}, resolutionMap = {}) {
  return Object.prototype.hasOwnProperty.call(resolutionMap || {}, line.id)
    && resolutionMap[line.id]
    && resolutionMap[line.id] !== "__none__";
}

function getExplicitProductId(line = {}, resolutionMap = {}) {
  if (!Object.prototype.hasOwnProperty.call(resolutionMap || {}, line.id)) return "";
  const v = resolutionMap[line.id];
  return v && v !== "__none__" ? v : "";
}

function rankSuggestionForVariant({ suggestion, product, variant, selectedRecommendation }) {
  const score = Number(suggestion.score || 0);
  const price = priceOf(product);
  const supplierText = normalize(`${product.supplier || ""} ${product.name || ""} ${product.sku || ""}`);
  const selectedVendor = normalize(selectedRecommendation?.vendor || "");
  const selectedProductIds = new Set(selectedRecommendation?.productIds || []);
  let rank = score * 1000;

  if (selectedProductIds.has(product.id)) rank += 140;
  if (selectedVendor && supplierText.includes(selectedVendor)) rank += 95;

  if (variant.id === "budget") {
    rank += Math.max(0, 220 - Math.min(220, price / 100000));
    if (/pho thong|tiet kiem|basic|tp link|kingled|imou|osuno/.test(normalize(selectedRecommendation?.tier || selectedRecommendation?.title || ""))) rank += 70;
  } else if (variant.id === "premium") {
    rank += Math.min(220, price / 100000);
    if (/cao cap|premium|philips|kaadas|bas|unifi|hikvision|schneider/.test(normalize(`${selectedRecommendation?.tier || ""} ${selectedRecommendation?.title || ""} ${product.supplier || ""}`))) rank += 90;
  } else {
    rank += 40;
  }

  return rank;
}

function chooseProductForVariant(line, variant, productsById, resolutionMap, solutionPacks, packSelections) {
  const explicit = getExplicitProductId(line, resolutionMap);
  if (explicit && productsById.get(explicit)) {
    return { product: productsById.get(explicit), source: "user_locked", confidence: 1 };
  }

  const selectedRecommendation = getSelectedRecommendation(line, solutionPacks, packSelections);
  const candidates = (line.matchSuggestions || [])
    .map((sg) => ({ suggestion: sg, product: productsById.get(sg.productId) }))
    .filter((row) => row.product && Number(row.suggestion.score || 0) >= 0.18);

  if (!candidates.length && line.suggestedMatch?.productId && productsById.get(line.suggestedMatch.productId)) {
    return { product: productsById.get(line.suggestedMatch.productId), source: "suggested", confidence: Number(line.suggestedMatch.score || 0.45) };
  }
  if (!candidates.length) return null;

  candidates.sort((a, b) => rankSuggestionForVariant({ suggestion: b.suggestion, product: b.product, variant, selectedRecommendation })
    - rankSuggestionForVariant({ suggestion: a.suggestion, product: a.product, variant, selectedRecommendation }));
  const top = candidates[0];
  return { product: top.product, source: "variant_suggestion", confidence: Number(top.suggestion.score || 0.35) };
}

function makeRoomName(line, grouping, selectedRecommendation) {
  if (grouping === "pack") return selectedRecommendation?.title || line.solutionLabel || line.solutionFamily?.label || line.category || "Hạng mục BOM";
  if (grouping === "area") return line.area && line.area !== "Chưa phân khu" ? line.area : (line.section || line.category || "Hạng mục BOM");
  return line.solutionLabel || line.solutionFamily?.label || line.category || "Hạng mục BOM";
}

function addLine(roomMap, roomName, product, line, selectedRecommendation, extra = {}) {
  if (!roomMap.has(roomName)) roomMap.set(roomName, []);
  const qty = Number(extra.qty || line.qty) || 1;
  const note = extra.note || `${line.name || ""}${line.model ? ` · ${line.model}` : ""}${line.sourceSheet ? ` · ${line.sourceSheet} dòng ${line.sourceRow}` : ""}${selectedRecommendation?.title ? ` · PA: ${selectedRecommendation.title}` : ""}`.trim();
  const lines = roomMap.get(roomName);
  const existing = lines.find((l) => l.productId === product.id && (l.note || "") === note);
  if (existing) existing.qty += qty;
  else lines.push({ productId: product.id, qty, note, source: extra.source || "bom_line" });
}

function getSelectedPackRecommendation(pack = {}, packSelections = {}) {
  const selectedId = packSelections[pack.scopeId] || pack.selectedRecommendationId || pack.recommendations?.[0]?.id;
  return (pack.recommendations || []).find((r) => r.id === selectedId) || pack.recommendations?.[0] || null;
}

function addPackTemplateLines({ roomMap, solutionPacks, productsById, packSelections, variant, grouping, existingProductIds }) {
  let addedCount = 0;
  let addedTotal = 0;
  let addedCost = 0;
  const addedRoles = [];

  for (const pack of solutionPacks || []) {
    const recommendation = getSelectedPackRecommendation(pack, packSelections);
    const template = recommendation?.template;
    if (!template?.components?.length) continue;
    const roomName = grouping === "pack"
      ? recommendation.title
      : grouping === "area"
        ? `Bộ cấu hình: ${pack.scopeLabel}`
        : pack.scopeLabel || recommendation.title || "Bộ cấu hình";

    for (const component of template.components) {
      if (!shouldAutoAddComponent(component, variant)) continue;
      const candidate = chooseComponentCandidate(component, variant, productsById);
      if (!candidate?.product) continue;
      // Không add trùng nếu BOM line đã match đúng product đó.
      if (existingProductIds.has(candidate.product.id)) continue;
      existingProductIds.add(candidate.product.id);
      const qty = Number(component.qty) || 1;
      const note = `Bộ cấu hình · ${template.label} · ${component.label} · PA: ${recommendation.title}`;
      addLine(roomMap, roomName, candidate.product, { qty }, recommendation, {
        qty,
        note,
        source: "pack_template",
      });
      addedCount += 1;
      addedTotal += priceOf(candidate.product) * qty;
      addedCost += costOf(candidate.product) * qty;
      addedRoles.push(`${component.label}: ${candidate.product.name || candidate.product.sku}`);
    }
  }

  return { addedCount, addedTotal, addedCost, addedRoles };
}

export function buildBomQuoteVariants({
  bomPreview,
  products = [],
  resolutionMap = {},
  ignoredMap = {},
  packSelections = {},
  grouping = "scope",
  laborPercent = 0,
} = {}) {
  const productsById = new Map((products || []).map((p) => [p.id, p]));
  const solutionPacks = bomPreview?.solutionPacks || [];
  const lines = (bomPreview?.lines || []).filter((line) => !ignoredMap[line.id] && resolutionMap[line.id] !== "__none__");

  return DEFAULT_VARIANTS.map((variant) => {
    const roomMap = new Map();
    const unmatched = [];
    const locked = [];
    let deviceTotal = 0;
    let costTotal = 0;
    let itemCount = 0;
    let qtyTotal = 0;
    let autoPicked = 0;

    const existingProductIds = new Set();
    let matchedBomLineCount = 0;

    for (const line of lines) {
      const selectedRecommendation = getSelectedRecommendation(line, solutionPacks, packSelections);
      const chosen = chooseProductForVariant(line, variant, productsById, resolutionMap, solutionPacks, packSelections);
      if (!chosen?.product) {
        unmatched.push(line);
        continue;
      }
      const product = chosen.product;
      const qty = Number(line.qty) || 1;
      const sale = priceOf(product) * qty;
      const cost = costOf(product) * qty;
      deviceTotal += sale;
      costTotal += cost;
      qtyTotal += qty;
      itemCount += 1;
      matchedBomLineCount += 1;
      existingProductIds.add(product.id);
      if (chosen.source === "user_locked") locked.push(line.id);
      else autoPicked += 1;
      addLine(roomMap, makeRoomName(line, grouping, selectedRecommendation), product, line, selectedRecommendation);
    }

    const templateAdds = addPackTemplateLines({
      roomMap,
      solutionPacks,
      productsById,
      packSelections,
      variant,
      grouping,
      existingProductIds,
    });
    if (templateAdds.addedCount) {
      deviceTotal += templateAdds.addedTotal;
      costTotal += templateAdds.addedCost;
      itemCount += templateAdds.addedCount;
      qtyTotal += templateAdds.addedCount;
      autoPicked += templateAdds.addedCount;
    }

    const laborTotal = Math.round((deviceTotal * (Number(laborPercent) || 0)) / 100);
    const grandTotal = deviceTotal + laborTotal;
    const grossProfit = Math.max(0, deviceTotal - costTotal);
    const marginPercent = deviceTotal > 0 ? Math.round((grossProfit / deviceTotal) * 100) : 0;
    const rooms = Array.from(roomMap.entries()).map(([name, roomLines]) => ({ name, lines: roomLines }));
    const coverage = lines.length ? Math.round((matchedBomLineCount / lines.length) * 100) : 0;

    return {
      ...variant,
      rooms,
      itemCount,
      qtyTotal,
      unmatchedCount: unmatched.length,
      unmatchedSample: unmatched.slice(0, 5).map((l) => l.name || l.model || `Dòng ${l.sourceRow}`).filter(Boolean),
      lockedCount: locked.length,
      autoPickedCount: autoPicked,
      matchedBomLineCount,
      packTemplateLineCount: templateAdds.addedCount,
      packTemplateSample: templateAdds.addedRoles.slice(0, 5),
      deviceTotal,
      costTotal,
      laborTotal,
      grandTotal,
      grossProfit,
      marginPercent,
      coverage,
      ready: itemCount > 0,
    };
  });
}

export function quoteVariantToRooms(variant, makeId = () => Math.random().toString(36).slice(2)) {
  return (variant?.rooms || []).map((room) => ({
    id: makeId("room"),
    name: room.name,
    lines: (room.lines || []).map((line) => ({
      id: makeId("ln"),
      productId: line.productId,
      qty: line.qty,
      note: line.note || "",
      factor: 1,
    })),
  }));
}

export function buildBomQuoteDiagnostics(variants = []) {
  const ready = variants.filter((v) => v.ready);
  const bestCoverage = ready.reduce((max, v) => Math.max(max, v.coverage || 0), 0);
  const lowest = ready.slice().sort((a, b) => a.grandTotal - b.grandTotal)[0] || null;
  const highest = ready.slice().sort((a, b) => b.grandTotal - a.grandTotal)[0] || null;
  return {
    readyCount: ready.length,
    bestCoverage,
    priceSpread: lowest && highest ? Math.max(0, highest.grandTotal - lowest.grandTotal) : 0,
    lowestVariantId: lowest?.id || "",
    highestVariantId: highest?.id || "",
  };
}
