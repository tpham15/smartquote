import { supabase } from './client.js';

export const CATALOG_IMAGE_BUCKET = 'catalog-product-images';
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

function safeSegment(value, fallback = 'product') {
  const cleaned = String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96);
  return cleaned || fallback;
}

function extensionFor(file) {
  const type = String(file?.type || '').toLowerCase();
  if (type === 'image/png') return 'png';
  if (type === 'image/webp') return 'webp';
  return 'jpg';
}

export function assertDealerCatalogImageFile(file) {
  if (!file) throw new Error('Chưa chọn ảnh.');
  const type = String(file.type || '').toLowerCase();
  if (!ALLOWED_IMAGE_TYPES.has(type)) {
    throw new Error('Ảnh sản phẩm chỉ hỗ trợ JPG, PNG hoặc WebP.');
  }
  const size = Number(file.size || 0);
  if (!size) throw new Error('File ảnh trống.');
  if (size > 4 * 1024 * 1024) throw new Error('Ảnh quá lớn. Giới hạn hiện tại là 4MB.');
  return true;
}

export async function uploadDealerCatalogImage({ dealerId, productId, file, previousPath = '' } = {}) {
  if (!supabase) throw new Error('Supabase chưa được cấu hình.');
  if (!dealerId) throw new Error('Chưa xác định workspace.');
  if (!productId) throw new Error('Chưa xác định sản phẩm.');
  assertDealerCatalogImageFile(file);

  const ext = extensionFor(file);
  const productSegment = safeSegment(productId);
  const objectPath = `${dealerId}/${productSegment}/main.${ext}`;

  const { error } = await supabase.storage
    .from(CATALOG_IMAGE_BUCKET)
    .upload(objectPath, file, {
      upsert: true,
      contentType: file.type,
      cacheControl: '3600',
    });
  if (error) throw error;

  const oldPath = String(previousPath || '').trim();
  if (oldPath && oldPath !== objectPath && oldPath.startsWith(`${dealerId}/`)) {
    supabase.storage.from(CATALOG_IMAGE_BUCKET).remove([oldPath]).catch(() => {});
  }

  const { data } = supabase.storage.from(CATALOG_IMAGE_BUCKET).getPublicUrl(objectPath);
  const publicUrl = String(data?.publicUrl || '').trim();
  if (!publicUrl) throw new Error('Không lấy được URL ảnh sau khi upload.');

  return {
    publicUrl: `${publicUrl}?v=${Date.now()}`,
    storagePath: objectPath,
    bucket: CATALOG_IMAGE_BUCKET,
  };
}
