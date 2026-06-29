// ============================================================
// IMPORT ENGINE — orchestrator
// runImport(file, ctx) → ImportPreviewResult
//
// Pipeline (deterministic-first, AI chỉ fallback):
//   normalizeWorkbook → fingerprintTemplate
//   → [mỗi sheet] detectHeader → mapColumns → detectRegions
//   → extractItems → matchCatalog → validateItems → scoreConfidence
//   → (nếu kém) aiFallback → (cuối cùng) legacyParser
// ============================================================
import { normalizeWorkbook } from "./normalizeWorkbook.js";
import { detectHeader } from "./detectHeader.js";
import { mapColumns } from "./mapColumns.js";
import { detectRegions } from "./detectRegions.js";
import { extractItemsWithStats } from "./extractItems.js";
import { matchCatalog } from "./matchCatalog.js";
import { validateItems } from "./validateItems.js";
import { scoreConfidence } from "./scoreConfidence.js";
import { detectDomain } from "./detectDomain.js";
import { fingerprintTemplate, getTemplateMapping, saveTemplateMapping } from "./fingerprintTemplate.js";
import { loadCorrections } from "./corrections.js";
import { needsAIFallback, runAIFallback } from "./aiFallback.js";
import { legacyParse } from "./legacyParser.js";
import { STATUS } from "./types.js";
import { engineResultToImportPreviewResult } from "./previewResult.js";

/**
 * @param {File|ArrayBuffer} file
 * @param {import('./types').ImportContext} ctx
 * @returns {Promise<import('./types').ImportPreviewResult>}
 */
export async function runImport(file, ctx = {}) {
  const fileName = file.name || ctx.fileName || "catalog.xlsx";
  const buf = file instanceof ArrayBuffer ? file : await file.arrayBuffer();
  const catalog = ctx.catalog || [];
  const corrections = ctx.corrections || loadCorrections();
  const warnings = [];

  let wb;
  try {
    wb = normalizeWorkbook(buf, fileName);
  } catch (e) {
    return failResult(fileName, "Không đọc được file: " + e.message);
  }
  if (!wb.sheets.length) {
    return failResult(fileName, "File không có dữ liệu");
  }

  // ---- Phân tích từng sheet: header + mapping ----
  const headerInfos = [];
  const perSheet = []; // {sheet, headerRow, headerIndex, map, mapConfidence}
  for (const sheet of wb.sheets) {
    const { headerRow, headerIndex } = detectHeader(sheet.rows);
    const dataRows = headerIndex >= 0 ? sheet.rows.slice(headerIndex + 1) : sheet.rows;
    const { map, confidence } = mapColumns(headerRow, dataRows, sheet.maxCol);
    perSheet.push({ sheet, headerRow, headerIndex, map, mapConfidence: confidence });
    headerInfos.push({
      sheet: sheet.name,
      headerLabels: headerRow ? headerRow.text.filter(Boolean) : [],
    });
  }

  // ---- Template fingerprint + tái dùng mapping đã lưu ----
  const templateId = fingerprintTemplate(wb, headerInfos);
  const savedMapping = getTemplateMapping(templateId);
  const templateKnown = !!savedMapping;
  if (templateKnown) {
    for (const ps of perSheet) {
      const saved = savedMapping[ps.sheet.name];
      if (saved) { ps.map = { ...ps.map, ...saved }; ps.mapConfidence = Math.max(ps.mapConfidence, 0.8); }
    }
  }

  // ---- Trích items từ tất cả sheet/region ----
  let allRaw = [];
  let minMapConf = 1;
  const extractionStats = { totalRows: 0, skipped: 0, notes: 0, totals: 0, sections: 0, headers: 0, blank: 0, products: 0 };
  for (const ps of perSheet) {
    const { sheet, headerIndex, map, mapConfidence } = ps;
    minMapConf = Math.min(minMapConf, mapConfidence);
    const preMap = { priceCol: map.price ?? null, nameCol: map.name ?? null };
    const regions = detectRegions(sheet, preMap);
    for (const region of regions) {
      const out = extractItemsWithStats(sheet, region, map, headerIndex, wb.fileSupplier);
      allRaw = allRaw.concat(out.items);
      for (const [k, v] of Object.entries(out.stats || {})) extractionStats[k] = (extractionStats[k] || 0) + (Number(v) || 0);
    }
  }

  // ---- Match + validate + score (deterministic) ----
  let matched = matchCatalog(allRaw, catalog, corrections);
  let validated = validateItems(matched);
  let scored = scoreConfidence(validated, minMapConf);

  let engine = "v2";
  let aiUsed = 0;

  // ---- AI fallback (chỉ khi cần) ----
  const determResult = { items: scored, mapConfidence: minMapConf };
  if (needsAIFallback(determResult) && typeof ctx.aiExtract === "function") {
    // gom các sheet để AI đọc lại (chỉ sheet có vấn đề)
    for (const ps of perSheet) {
      const sheetItems = scored.filter((it) => it.source?.sheet === ps.sheet.name);
      const badRatio = sheetItems.length
        ? sheetItems.filter((i) => i.status === STATUS.REVIEW || i.status === STATUS.REJECTED).length / sheetItems.length
        : 1;
      if (badRatio > 0.4 || sheetItems.length === 0) {
        const payload = {
          sheetName: ps.sheet.name,
          fileName,
          rows: ps.sheet.rows.map((r) => r.text),
        };
        const aiItems = await runAIFallback(payload, ctx.aiExtract);
        if (aiItems && aiItems.length) {
          aiUsed += aiItems.length;
          // thay thế items của sheet này bằng kết quả AI
          const aiMatched = matchCatalog(aiItems, catalog, corrections);
          const aiValidated = validateItems(aiMatched);
          const aiScored = scoreConfidence(aiValidated, 0.7);
          scored = scored.filter((it) => it.source?.sheet !== ps.sheet.name).concat(aiScored);
        }
      }
    }
  }

  // ---- Fallback cuối: legacy nếu vẫn rỗng ----
  if (scored.length === 0) {
    try {
      const legacy = legacyParse(buf, fileName);
      const lMatched = matchCatalog(legacy, catalog, corrections);
      const lValidated = validateItems(lMatched);
      scored = scoreConfidence(lValidated, 0.4);
      engine = "legacy";
      warnings.push("Dùng parser cũ (legacy) vì engine v2 không trích được dữ liệu");
    } catch {}
  }

  // ---- Lưu template mapping nếu mapping tốt ----
  if (minMapConf >= 0.6 && !templateKnown) {
    const mappingBySheet = {};
    for (const ps of perSheet) mappingBySheet[ps.sheet.name] = ps.map;
    saveTemplateMapping(templateId, mappingBySheet);
  }

  // ---- Domain + stats ----
  const { domain } = detectDomain(scored);
  const stats = {
    total: scored.length,
    sourceRows: extractionStats.totalRows || scored.length,
    // skipped ở extractionStats là các dòng note/total/blank/header đã bỏ qua từ classifier.
    // Các dòng sản phẩm đã trích nhưng sau đó được nhận diện là subtotal cũng có status="skipped"
    // và sẽ được cộng thêm ở previewResult.buildSummary để không hiện như lỗi nặng.
    skipped: extractionStats.skipped || 0,
    noteRows: extractionStats.notes || 0,
    matched: scored.filter((i) => i.status === STATUS.MATCHED).length,
    new: scored.filter((i) => i.status === STATUS.NEW).length,
    review: scored.filter((i) => i.status === STATUS.REVIEW).length,
    rejected: scored.filter((i) => i.status === STATUS.REJECTED).length,
    aiUsed,
  };

  return attachCanonicalPreview({
    items: scored,
    templateId,
    templateKnown,
    domain,
    stats,
    needsReview: stats.review > 0 || stats.rejected > 0,
    engine,
    warnings,
  }, fileName);
}

function attachCanonicalPreview(result, fileName) {
  const preview = engineResultToImportPreviewResult(result, fileName);
  // Backward compatible: giữ items/stats cũ, đồng thời expose schema Phase 2 trực tiếp.
  return {
    ...result,
    preview,
    importId: preview.importId,
    fileName: preview.fileName,
    importType: preview.importType,
    detectedTemplateId: preview.detectedTemplateId,
    detectedIndustry: preview.detectedIndustry,
    overallConfidence: preview.overallConfidence,
    summary: preview.summary,
    lines: preview.lines,
  };
}

function failResult(fileName, msg) {
  return attachCanonicalPreview({
    items: [], templateId: "", templateKnown: false, domain: "general",
    stats: { total: 0, matched: 0, new: 0, review: 0, rejected: 0, aiUsed: 0 },
    needsReview: false, engine: "v2", warnings: [msg],
  }, fileName);
}

// re-export tiện dùng từ ngoài
export { saveCorrection, saveCorrections } from "./corrections.js";
export { STATUS } from "./types.js";
