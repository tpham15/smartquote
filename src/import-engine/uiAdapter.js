// ============================================================
// uiAdapter — cầu nối engine ↔ UI SmartQuote hiện tại.
// Phase 2: mọi import trả về ImportPreviewResult chuẩn,
// rồi adapter mới chuyển sang product shape UI.
// ============================================================
import { runImport } from "./index.js";
import {
  engineResultToImportPreviewResult,
  importPreviewLinesToProducts,
  combineImportPreviewResults,
  productsToImportPreviewResult,
} from "./previewResult.js";

/** uid đơn giản cho item import */
let _c = 0;
const uid = (p = "imp") => `${p}_${Date.now().toString(36)}_${(_c++).toString(36)}`;

/**
 * Chạy import 1 file → trả về { result, preview, products }
 * - result: legacy/v2 engine result cũ, giữ cho backward compatibility
 * - preview: ImportPreviewResult canonical
 * - products: shape UI dùng (đã lọc failed/skipped)
 *
 * @param {File} file
 * @param {Object} opts
 * @param {Array}    opts.catalog
 * @param {Function} [opts.aiExtract]  - async fallback
 * @returns {Promise<{result, preview, products}>}
 */
export async function importFileForUI(file, opts = {}) {
  const result = await runImport(file, {
    catalog: opts.catalog || [],
    aiExtract: opts.aiExtract,
  });

  // Phase 2.8: runImport already returns canonical preview/lines.
  // Prefer that preview to avoid regenerating new lineIds and drifting from engine source rows.
  const preview = result.preview || (result.lines ? result : engineResultToImportPreviewResult(result, file.name));
  const products = importPreviewLinesToProducts(preview).map((p) => ({ ...p, id: uid() }));

  return { result, preview, products };
}

/**
 * Import nhiều file, gộp + khử trùng theo SKU/name.
 * @returns {Promise<{products, preview, perFile:[{name,count,engine,warnings,summary}], stats}>}
 */
export async function importManyForUI(files, opts = {}) {
  const all = [];
  const previews = [];
  const perFile = [];
  const seen = new Map(); // sku/name key -> index trong all

  for (const file of files) {
    try {
      const { result, preview, products } = await importFileForUI(file, opts);
      previews.push(preview);
      perFile.push({
        name: file.name,
        count: products.length,
        engine: preview.engine || result.engine,
        domain: preview.detectedIndustry || result.domain,
        warnings: preview.warnings || result.warnings,
        stats: result.stats,
        summary: preview.summary,
        preview,
      });
      for (const p of products) {
        const key = (p.sku || p.name || "").toLowerCase().replace(/[\s\-\/\.\_]/g, "");
        if (key && seen.has(key)) {
          all[seen.get(key)] = p; // bản sau ghi đè
        } else {
          if (key) seen.set(key, all.length);
          all.push(p);
        }
      }
    } catch (e) {
      const errorPreview = productsToImportPreviewResult({
        products: [],
        fileName: file.name,
        engine: "error",
        warnings: [e.message],
      });
      previews.push(errorPreview);
      perFile.push({ name: file.name, count: 0, engine: "error", warnings: [e.message], stats: null, summary: errorPreview.summary, preview: errorPreview });
    }
  }

  const preview = combineImportPreviewResults(previews, {
    fileName: `${files.length} files`,
    importType: "catalog_batch",
    engine: "mixed",
  });

  const stats = preview.summary;

  return { products: all, preview, perFile, stats };
}

export {
  productsToImportPreviewResult,
  importPreviewLinesToProducts,
  combineImportPreviewResults,
};
