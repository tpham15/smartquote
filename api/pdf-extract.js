// Vercel Serverless Function — deterministic PDF text extraction
// Purpose: extract text page-by-page so the frontend can parse catalog PDFs
// using deterministic fallback + small AI chunks.

import { extractPagesFromPdf } from './_lib/pdfTextGeometry.js';
import { handleOptions, setCorsHeaders } from './_lib/cors.js';
import { assertBodySize, enforceAllowedOrigin, getRequestId, setRequestId } from './_lib/security.js';
import { nowMs, logApiEvent } from './_lib/logger.js';
import { assertRateLimit } from './_lib/rateLimit.js';
import { requireApiAccess } from './_lib/auth.js';
import { assertPlanCapability } from './_lib/limits.js';
import { assertWithinQuota, recordUsage, sendQuotaError } from './_lib/usage.js';

const MAX_BASE64_BYTES = 18 * 1024 * 1024; // safety guard before decode

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
