// ============================================================
// fingerprintTemplate — tạo "vân tay" của cấu trúc file
// để nhận ra file CÙNG MẪU lần sau và tái dùng column mapping.
// Phase 2.8: persistence moved to templateMemory.js.
// ============================================================

import {
  hashText as hashStr,
  loadEngineTemplateMap,
  saveEngineTemplateMapping,
  getEngineTemplateMapping,
} from "./templateMemory.js";

/**
 * Tạo fingerprint từ workbook chuẩn hoá + thông tin header mỗi sheet.
 * @param {import('./types').NormalizedWorkbook} wb
 * @param {Array<{sheet:string, headerLabels:string[]}>} headerInfos
 * @returns {string}
 */
export function fingerprintTemplate(wb, headerInfos) {
  const parts = [];
  for (const info of headerInfos) {
    const labels = (info.headerLabels || [])
      .map((l) => String(l || "").toLowerCase().replace(/\s+/g, ""))
      .filter(Boolean)
      .join("|");
    parts.push(`${info.sheet}::${labels}`);
  }
  const sig = parts.join("##");
  return "tpl_" + hashStr(sig);
}

export function loadTemplateMap() {
  return loadEngineTemplateMap();
}

export function saveTemplateMapping(templateId, mappingBySheet, meta = {}) {
  return saveEngineTemplateMapping(templateId, mappingBySheet, meta);
}

export function getTemplateMapping(templateId) {
  return getEngineTemplateMapping(templateId);
}

export { hashStr };
