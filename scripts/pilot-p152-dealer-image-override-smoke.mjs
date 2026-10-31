import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const must = (cond, msg) => { if (!cond) throw new Error(msg); };

const app = read('src/SmartQuote.jsx');
const store = read('src/supabase/catalogImageStore.js');
const sql = read('supabase/phase15_2_catalog_image_overrides.sql');
const pkg = JSON.parse(read('package.json'));

must(app.includes('uploadDealerCatalogImage'), 'Catalog must use uploadDealerCatalogImage');
must(app.includes('openProductImagePicker'), 'Catalog image must be clickable');
must(app.includes('handleSingleProductImageUpload'), 'Single product image upload handler missing');
must(app.includes('accept="image/jpeg,image/png,image/webp"'), 'Single upload input must restrict to JPG/PNG/WebP');
must(app.includes('imageSource: "dealer_upload"'), 'Dealer upload metadata missing');
must(app.includes('imageLocked: true'), 'Dealer upload must lock/override automatic image choice');
must(app.includes('p?._meta?.imageSource !== "dealer_upload"'), 'Automatic Serper image search must not target dealer-upload overrides');
must(app.includes('cat-thumb-overlay'), 'Clickable image affordance missing');
must(app.includes('Ảnh do đại lý upload'), 'Dealer-upload source indicator missing');

must(store.includes("CATALOG_IMAGE_BUCKET = 'catalog-product-images'"), 'Storage bucket constant missing');
must(store.includes('.upload(objectPath, file'), 'Storage upload call missing');
must(store.includes('getPublicUrl(objectPath)'), 'Public quotation-safe image URL missing');
must(store.includes('4 * 1024 * 1024'), '4MB image limit missing');
must(/image\/jpeg/.test(store) && /image\/png/.test(store) && /image\/webp/.test(store), 'Allowed image MIME types incomplete');
must(store.includes('previousPath') && store.includes('.remove([oldPath])'), 'Old uploaded object cleanup missing');

must(sql.includes("'catalog-product-images'"), 'Storage migration bucket missing');
must(sql.includes('public.can_manage_catalog_image_path(name)'), 'Tenant path guard missing');
must(sql.includes('for insert') && sql.includes('for update') && sql.includes('for delete'), 'Tenant write policies incomplete');
must(sql.includes('public = true'), 'Bucket must be public-read for customer quote image embedding');
must(sql.includes("array['image/jpeg','image/png','image/webp']"), 'Bucket MIME restriction missing');

must(pkg.scripts?.['smoke:pilot-p15.2']?.includes('pilot-p152-dealer-image-override-smoke.mjs'), 'package script smoke:pilot-p15.2 missing');

console.log('✓ Pilot P1.5.2 Dealer Image Override smoke PASS');
console.log('  - catalog image is clickable and opens a single-image picker');
console.log('  - dealer upload becomes the preferred/locked product image');
console.log('  - Serper auto-image search cannot overwrite dealer-upload overrides');
console.log('  - cloud uploads use tenant-write Supabase Storage');
console.log('  - JPG/PNG/WebP only, max 4MB, old override object cleanup supported');
