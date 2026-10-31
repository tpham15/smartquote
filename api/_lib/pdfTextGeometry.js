// Shared deterministic PDF text/geometry extraction used by production API and pilot gates.
// Keep this module free of auth/network concerns so the exact same extractor can be
// exercised against golden PDFs before a release.
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { buildPdfProbe, classifyPdfProbe } from '../../src/import-engine/documentRouter.js';

try {
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    '../../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs',
    import.meta.url,
  ).href;
} catch (_) {}

const MAX_PAGE_TEXT_CHARS = 26000;

export function cleanPageText(text) {
  return String(text || '')
    .replace(/\u0000/g, '')
    .replace(/[\t ]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_PAGE_TEXT_CHARS);
}

export function textItemsToRows(items) {
  const rows = [];
  for (const item of items || []) {
    const str = item?.str || '';
    if (!str.trim()) continue;
    const y = Math.round((item.transform?.[5] || 0) * 10) / 10;
    const x = Math.round((item.transform?.[4] || 0) * 10) / 10;
    const width = Math.round((item.width || 0) * 10) / 10;
    const height = Math.round((item.height || Math.abs(item.transform?.[3] || 0) || 0) * 10) / 10;
    let row = rows.find((r) => Math.abs(r.y - y) < 2);
    if (!row) {
      row = { y, parts: [] };
      rows.push(row);
    }
    row.parts.push({ x, width, height, str });
  }

  rows.sort((a, b) => b.y - a.y);
  return rows.map((row) => {
    const parts = row.parts.sort((a, b) => a.x - b.x);
    const minX = Math.min(...parts.map((p) => p.x));
    const maxX = Math.max(...parts.map((p) => p.x + p.width));
    const height = Math.max(1, ...parts.map((p) => p.height || 0));
    return {
      y: row.y,
      text: parts.map((p) => p.str).join(' ').replace(/\s+/g, ' ').trim(),
      parts,
      bbox: { x: minX, y: row.y, width: Math.max(1, maxX - minX), height },
    };
  }).filter((r) => r.text);
}

export async function extractPagesFromPdf(buffer) {
  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(buffer),
    disableWorker: true,
    disableFontFace: true,
    isEvalSupported: false,
    useSystemFonts: true,
  });
  const pdf = await loadingTask.promise;
  const pages = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent({
      normalizeWhitespace: false,
      disableCombineTextItems: false,
    });
    const viewport = page.getViewport({ scale: 1 });
    const rows = textItemsToRows(content.items);
    const text = cleanPageText(rows.map((r) => r.text).join('\n'));
    pages.push({
      page: pageNum,
      text,
      pageWidth: Math.round(viewport.width * 10) / 10,
      pageHeight: Math.round(viewport.height * 10) / 10,
      rows: rows.slice(0, 500),
    });
    page.cleanup?.();
  }

  await pdf.destroy?.();
  const textChars = pages.reduce((s, p) => s + (p.text?.length || 0), 0);
  const probe = buildPdfProbe({
    pageCount: pages.length,
    textChars,
    pages: pages.map((p) => ({ page: p.page, textChars: p.text?.length || 0 })),
  });
  const classification = classifyPdfProbe(probe);
  return {
    pageCount: pages.length,
    textChars,
    pages,
    probe: {
      ...probe,
      inputKind: classification.inputKind,
      confidence: classification.confidence,
      reasons: classification.reasons,
    },
  };
}
