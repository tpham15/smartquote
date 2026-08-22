// Phase 7.1 production upload guards.
// Goal: reject unexpectedly large/untrusted files before XLSX/PDF parsers touch them.
export const UPLOAD_LIMITS = {
  excelBytes: Number(import.meta?.env?.VITE_SQ_MAX_EXCEL_BYTES || 8 * 1024 * 1024),
  pdfBytes: Number(import.meta?.env?.VITE_SQ_MAX_PDF_BYTES || 18 * 1024 * 1024),
  imageBytes: Number(import.meta?.env?.VITE_SQ_MAX_IMAGE_BYTES || 4 * 1024 * 1024),
  maxBatchFiles: Number(import.meta?.env?.VITE_SQ_MAX_IMPORT_FILES || 40),
};

function formatMb(bytes) {
  return `${(Number(bytes || 0) / 1024 / 1024).toFixed(1)}MB`;
}

function extOf(file) {
  return String(file?.name || '').split('.').pop().toLowerCase();
}

export function classifySmartQuoteFile(file) {
  const ext = extOf(file);
  const type = String(file?.type || '').toLowerCase();
  if (['xlsx', 'xls'].includes(ext)) return 'excel';
  if (ext === 'pdf' || type === 'application/pdf') return 'pdf';
  if (type.startsWith('image/') || /^(png|jpe?g|webp|gif|svg)$/i.test(ext)) return 'image';
  return 'unknown';
}

export function assertSmartQuoteUploadFile(file, { allow = ['excel', 'pdf', 'image'] } = {}) {
  if (!file) throw new Error('Không tìm thấy file upload.');
  const kind = classifySmartQuoteFile(file);
  if (!allow.includes(kind)) {
    throw new Error(`File ${file.name || ''} không đúng định dạng được hỗ trợ.`);
  }
  const size = Number(file.size || 0);
  const limit = kind === 'excel' ? UPLOAD_LIMITS.excelBytes : kind === 'pdf' ? UPLOAD_LIMITS.pdfBytes : UPLOAD_LIMITS.imageBytes;
  if (size > limit) {
    const label = kind === 'excel' ? 'Excel' : kind === 'pdf' ? 'PDF' : 'ảnh';
    throw new Error(`${label} "${file.name}" quá lớn (${formatMb(size)}). Giới hạn hiện tại là ${formatMb(limit)}. Hãy tách file nhỏ hơn trước khi import.`);
  }
  return { kind, size, limit };
}

export function filterSafeSmartQuoteFiles(files, opts = {}) {
  const allow = opts.allow || ['excel', 'pdf'];
  const maxFiles = Number(opts.maxFiles || UPLOAD_LIMITS.maxBatchFiles);
  const accepted = [];
  const rejected = [];
  for (const file of Array.from(files || []).slice(0, maxFiles)) {
    try {
      assertSmartQuoteUploadFile(file, { allow });
      accepted.push(file);
    } catch (error) {
      rejected.push({ file, reason: error.message });
    }
  }
  const extra = Math.max(0, Array.from(files || []).length - maxFiles);
  if (extra > 0) rejected.push({ file: null, reason: `Đã bỏ qua ${extra} file vì mỗi lần import tối đa ${maxFiles} file.` });
  return { accepted, rejected };
}

export function rejectedFilesMessage(rejected = []) {
  if (!rejected.length) return '';
  return rejected.slice(0, 8).map((r) => `• ${r.reason}`).join('\n') + (rejected.length > 8 ? `\n... và ${rejected.length - 8} lỗi khác` : '');
}
