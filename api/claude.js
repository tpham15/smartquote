// Vercel Serverless Function — proxy Anthropic API
// Phase 2: bảo vệ bằng Supabase JWT + quota theo dealer.
import { handleOptions, setCorsHeaders } from './_lib/cors.js';
import { assertBodySize, enforceAllowedOrigin, getRequestId, setRequestId } from './_lib/security.js';
import { nowMs, logApiEvent } from './_lib/logger.js';
import { assertRateLimit } from './_lib/rateLimit.js';
import { requireApiAccess } from './_lib/auth.js';
import { assertPlanCapability } from './_lib/limits.js';
import { assertWithinQuota, recordUsage, sendQuotaError } from './_lib/usage.js';

const EVENT_TYPE = 'ai_claude_request';

function allowedClaudeModels() {
  const raw = process.env.SMARTQUOTE_ALLOWED_CLAUDE_MODELS || 'claude-sonnet-4-6,claude-sonnet-4-5,claude-3-7-sonnet-latest,claude-3-5-sonnet-latest';
  return raw.split(',').map((x) => x.trim()).filter(Boolean);
}

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(Math.floor(n), max));
}

function truncateText(value, maxChars) {
  const s = String(value || '');
  return s.length > maxChars ? s.slice(0, maxChars) : s;
}

function sanitizeClaudeMessages(messages = []) {
  if (!Array.isArray(messages) || !messages.length) {
    const err = new Error('Claude request thiếu messages.');
    err.statusCode = 400;
    throw err;
  }
  const maxMessages = clampNumber(process.env.SMARTQUOTE_MAX_CLAUDE_MESSAGES, 1, 24, 12);
  const maxTextChars = clampNumber(process.env.SMARTQUOTE_MAX_CLAUDE_TEXT_CHARS, 1000, 250000, 120000);
  const maxDocumentBase64Chars = clampNumber(process.env.SMARTQUOTE_MAX_CLAUDE_DOCUMENT_BASE64_CHARS, 0, 2000000, 950000);
  let textBudget = maxTextChars;

  return messages.slice(0, maxMessages).map((msg) => {
    const role = msg?.role === 'assistant' ? 'assistant' : 'user';
    const content = msg?.content;
    if (typeof content === 'string') {
      const text = truncateText(content, textBudget);
      textBudget -= text.length;
      return { role, content: text };
    }
    if (!Array.isArray(content)) return { role, content: '' };
    const blocks = [];
    for (const block of content.slice(0, 24)) {
      if (!block || typeof block !== 'object') continue;
      if (block.type === 'text') {
        const text = truncateText(block.text || '', textBudget);
        textBudget -= text.length;
        blocks.push({ type: 'text', text });
      } else if (block.type === 'document' && block.source?.type === 'base64') {
        const mediaType = String(block.source.media_type || '').toLowerCase();
        const data = String(block.source.data || '');
        if (mediaType !== 'application/pdf') continue;
        if (data.length > maxDocumentBase64Chars) {
          const err = new Error('PDF/document payload gửi AI quá lớn. Hãy tách file PDF hoặc dùng PDF text extraction trước.');
          err.statusCode = 413;
          throw err;
        }
        blocks.push({ type: 'document', source: { type: 'base64', media_type: mediaType, data } });
      }
      if (textBudget <= 0) break;
    }
    return { role, content: blocks.length ? blocks : '' };
  });
}

function sanitizeClaudeRequest(body = {}) {
  const allowed = allowedClaudeModels();
  const requestedModel = String(body?.model || '').trim();
  const model = allowed.includes(requestedModel) ? requestedModel : allowed[0];
  const maxTokensCap = clampNumber(process.env.SMARTQUOTE_MAX_CLAUDE_OUTPUT_TOKENS, 512, 12000, 8000);
  const out = {
    model,
    max_tokens: clampNumber(body?.max_tokens, 1, maxTokensCap, 1000),
    messages: sanitizeClaudeMessages(body?.messages),
  };
  if (typeof body?.system === 'string' && body.system.trim()) {
    out.system = truncateText(body.system, clampNumber(process.env.SMARTQUOTE_MAX_CLAUDE_SYSTEM_CHARS, 1000, 50000, 12000));
  }
  if (body?.temperature !== undefined) out.temperature = clampNumber(body.temperature, 0, 1, 0);
  return out;
}

export default async function handler(req, res) {
  const requestId = getRequestId(req);
  const start = nowMs();
  setRequestId(res, requestId);
  setCorsHeaders(req, res, 'POST, OPTIONS');
  if (handleOptions(req, res, 'POST, OPTIONS')) return;
  if (!enforceAllowedOrigin(req, res)) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const auth = await requireApiAccess(req, res);
  if (!auth.ok) return;

  try {
    assertBodySize(req.body, Number(process.env.SMARTQUOTE_MAX_CLAUDE_BODY_BYTES || 1200000), 'Claude request');
    const safeClaudeBody = sanitizeClaudeRequest(req.body || {});
    await assertRateLimit(auth, req, { eventType: EVENT_TYPE, units: 1 });
    await assertPlanCapability(auth, 'ai_import');
    await assertWithinQuota(auth, { eventType: EVENT_TYPE, units: 1 });

    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(500).json({ error: 'ANTHROPIC_API_KEY chưa được cấu hình trên server.' });
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(safeClaudeBody),
    });

    const data = await response.json();
    if (response.ok) {
      await recordUsage(auth, {
        eventType: EVENT_TYPE,
        units: 1,
        meta: {
          model: safeClaudeBody.model || '',
          inputTokens: data?.usage?.input_tokens || null,
          outputTokens: data?.usage?.output_tokens || null,
          status: response.status,
        },
      });
    }
    await logApiEvent(auth, { requestId, route: '/api/claude', eventType: EVENT_TYPE, method: req.method, statusCode: response.status, durationMs: nowMs() - start, meta: { model: safeClaudeBody.model || '', upstreamStatus: response.status } });
    return res.status(response.status).json(data);
  } catch (err) {
    const statusCode = err.statusCode || (err?.quota ? 403 : 500);
    await logApiEvent(auth, { requestId, route: '/api/claude', eventType: EVENT_TYPE, method: req.method, statusCode, durationMs: nowMs() - start, errorMessage: err.message });
    if (err?.quota) return sendQuotaError(res, err);
    return res.status(statusCode).json({ error: err.message || 'Claude proxy failed', rateLimit: err.rateLimit || undefined });
  }
}
