import assert from 'node:assert/strict';
import {
  QUOTE_TEMPLATE_PRESET_LIST,
  applyQuoteTemplatePreset,
  buildDefaultQuoteTemplateConfig,
  enabledQuoteColumns,
  getQuoteTemplateLabel,
  normalizeQuoteTemplateConfig,
} from '../src/quoteTemplates.js';

assert.equal(QUOTE_TEMPLATE_PRESET_LIST.length, 5, 'expected 5 quote template presets');

const interior = buildDefaultQuoteTemplateConfig('interior_visual');
assert.equal(interior.presetId, 'interior_visual');
assert.equal(interior.columns.image, true);
assert.equal(interior.columns.sku, false, 'interior visual should hide SKU by default');

const normalized = normalizeQuoteTemplateConfig({ presetId: 'minimal_business', brand: { logoUrl: 'https://example.com/logo.png' }, columns: { image: true } });
assert.equal(normalized.brand.logoUrl, 'https://example.com/logo.png');
assert.equal(normalized.columns.name, true);
assert.equal(normalized.columns.image, true);

const applied = applyQuoteTemplatePreset(normalized, 'camera_security');
assert.equal(applied.presetId, 'camera_security');
assert.equal(applied.brand.logoUrl, 'https://example.com/logo.png', 'preset switch should preserve company logo');
assert.equal(getQuoteTemplateLabel(applied.presetId), 'Camera / Security');
assert.ok(enabledQuoteColumns(applied).includes('sku'));
assert.ok(enabledQuoteColumns(applied).includes('total'));

console.log('Quote template smoke: PASS');
