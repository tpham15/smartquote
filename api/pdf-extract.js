// Vercel Serverless Function — deterministic PDF text extraction
// Purpose: extract text page-by-page so the frontend can parse catalog PDFs
// using deterministic fallback + small AI chunks.

import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { handleOptions, setCorsHeaders } from './_lib/cors.js';
import { assertBodySize, enforceAllowedOrigin, getRequestId, setRequestId } from './_lib/security.js';
import { nowMs, logApiEvent } from './_lib/logger.js';
import { assertRateLimit } from './_lib/rateLimit.js';
import { requireApiAccess } from './_lib/auth.js';
import { assertPlanCapability } from './_lib/limits.js';
import { assertWithinQuota, recordUsage, sendQuotaError } from './_lib/usage.js';
import { buildPdfProbe, classifyPdfProbe } from '../src/import-engine/documentRouter.js';

// Keep explicit workerSrc for environments that require it, but getDocument below
// also sets disableWorker=true so Vercel does not have to dynamic-import worker
// files at runtime.
try {
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    '../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs',
    import.meta.url,
  ).href;
} catch (_) {}

const MAX_BASE64_BYTES = 18 * 1024 * 1024; // safety guard before decode
const MAX_PAGE_TEXT_CHARS = 26000;

function cleanPageText(text) {
  return String(text || '')
    .replace(/\u0000/g, '')
    .replace(/[\t ]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_PAGE_TEXT_CHARS);
}

function textItemsToRows(items) {
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

async function extractPagesFromPdf(buffer) {
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

export default async function handler(req, res) {
  const requestId = getRequestId(req);
  const start = nowMs();
  setRequestId(res, requestId);
  setCorsHeaders(req, res, 'POST, OPTIONS');
  if (handleOptions(req, res, 'POST, OPTIONS')) return;
  if (!enforceAllowedOrigin(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const auth = await requireApiAccess(req, res);
  if (!auth.ok) return;

  try {
    assertBodySize(req.body, Number(process.env.SMARTQUOTE_MAX_PDF_BODY_BYTES || 20000000), 'PDF extract request');
    await assertRateLimit(auth, req, { eventType: 'pdf_extract', units: 1 });
    await assertPlanCapability(auth, 'ai_import');
    await assertWithinQuota(auth, { eventType: 'pdf_extract', units: 1 });
    const { base64, fileName } = req.body || {};
    if (!base64 || typeof base64 !== 'string') {
      return res.status(400).json({ error: 'Missing base64 PDF payload' });
    }
    if (base64.length > MAX_BASE64_BYTES) {
      return res.status(413).json({
        error: 'PDF quá lớn cho serverless text extraction. Hãy tách PDF theo nhóm sản phẩm hoặc dùng file Excel.',
      });
    }

    const buffer = Buffer.from(base64, 'base64');
    if (!buffer.length || buffer.slice(0, 4).toString() !== '%PDF') {
      return res.status(400).json({ error: 'Uploaded file is not a valid PDF' });
    }

    const extracted = await extractPagesFromPdf(buffer);
    await recordUsage(auth, {
      eventType: 'pdf_extract',
      units: 1,
      meta: { fileName: fileName || 'catalog.pdf', pageCount: extracted.pageCount, textChars: extracted.textChars },
    });
    await logApiEvent(auth, { requestId, route: '/api/pdf-extract', eventType: 'pdf_extract', method: req.method, statusCode: 200, durationMs: nowMs() - start, meta: { fileName: fileName || 'catalog.pdf', pageCount: extracted.pageCount } });
    return res.status(200).json({
      fileName: fileName || 'catalog.pdf',
      ...extracted,
    });
  } catch (err) {
    const statusCode = err.statusCode || (err?.quota ? 403 : 500);
    await logApiEvent(auth, { requestId, route: '/api/pdf-extract', eventType: 'pdf_extract', method: req.method, statusCode, durationMs: nowMs() - start, errorMessage: err.message });
    if (err?.quota) return sendQuotaError(res, err);
    return res.status(statusCode).json({
      error: err?.message || 'Failed to extract PDF text',
      rateLimit: err.rateLimit || undefined,
    });
  }
}
