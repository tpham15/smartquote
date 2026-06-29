// Vercel Serverless Function — deterministic PDF text extraction
// Purpose: extract text page-by-page so the frontend can parse catalog PDFs
// using deterministic fallback + small AI chunks.

import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

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
    let row = rows.find((r) => Math.abs(r.y - y) < 2);
    if (!row) {
      row = { y, parts: [] };
      rows.push(row);
    }
    row.parts.push({ x, width, str });
  }

  rows.sort((a, b) => b.y - a.y);
  return rows.map((row) => {
    const parts = row.parts.sort((a, b) => a.x - b.x);
    return {
      y: row.y,
      text: parts.map((p) => p.str).join(' ').replace(/\s+/g, ' ').trim(),
      parts,
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
    const rows = textItemsToRows(content.items);
    const text = cleanPageText(rows.map((r) => r.text).join('\n'));
    pages.push({
      page: pageNum,
      text,
      rows: rows.slice(0, 500),
    });
    page.cleanup?.();
  }

  await pdf.destroy?.();
  return {
    pageCount: pages.length,
    textChars: pages.reduce((s, p) => s + (p.text?.length || 0), 0),
    pages,
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
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
    return res.status(200).json({
      fileName: fileName || 'catalog.pdf',
      ...extracted,
    });
  } catch (err) {
    return res.status(500).json({
      error: err?.message || 'Failed to extract PDF text',
    });
  }
}
