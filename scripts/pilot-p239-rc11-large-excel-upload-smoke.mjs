import assert from 'node:assert/strict';
import {
  UPLOAD_LIMITS,
  UPLOAD_WARNING_THRESHOLDS,
  assertSmartQuoteUploadFile,
  filterSafeSmartQuoteFiles,
  smartQuoteUploadWarning,
} from '../src/import-engine/fileGuards.js';

const MiB = 1024 * 1024;
const fakeFile = (name, size, type = '') => ({ name, size, type });

assert.equal(UPLOAD_LIMITS.excelBytes, 50 * MiB, 'default Excel upload limit must be 50 MiB');
assert.equal(UPLOAD_LIMITS.pdfBytes, 18 * MiB, 'PDF upload limit must remain 18 MiB');
assert.equal(UPLOAD_LIMITS.imageBytes, 4 * MiB, 'image upload limit must remain 4 MiB');
assert.equal(UPLOAD_WARNING_THRESHOLDS.excelBytes, 20 * MiB, 'large Excel advisory threshold must be 20 MiB');

const realPilotSized = fakeFile('Tổng hợp báo giá.xlsx', 38_854_212, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
const accepted = assertSmartQuoteUploadFile(realPilotSized, { allow: ['excel'] });
assert.equal(accepted.kind, 'excel');
assert.ok(accepted.limit > realPilotSized.size, '37 MB pilot workbook must be accepted');
assert.match(smartQuoteUploadWarning(realPilotSized), /khá lớn/i, 'large accepted workbook should get a processing advisory');

assert.doesNotThrow(() => assertSmartQuoteUploadFile(fakeFile('49mb.xlsx', 49 * MiB), { allow: ['excel'] }));
assert.throws(
  () => assertSmartQuoteUploadFile(fakeFile('51mb.xlsx', 51 * MiB), { allow: ['excel'] }),
  /Giới hạn hiện tại là 50\.0MB/,
  'Excel above 50 MiB must still fail safe',
);
assert.throws(
  () => assertSmartQuoteUploadFile(fakeFile('19mb.pdf', 19 * MiB, 'application/pdf'), { allow: ['pdf'] }),
  /Giới hạn hiện tại là 18\.0MB/,
  'PDF limit must not be widened by the Excel hotfix',
);
assert.equal(smartQuoteUploadWarning(fakeFile('10mb.xlsx', 10 * MiB)), '', 'normal Excel should not show large-file advisory');

const filtered = filterSafeSmartQuoteFiles([
  realPilotSized,
  fakeFile('too-large.xlsx', 51 * MiB),
], { allow: ['excel'] });
assert.equal(filtered.accepted.length, 1);
assert.equal(filtered.rejected.length, 1);
assert.equal(filtered.accepted[0].name, 'Tổng hợp báo giá.xlsx');

console.log('✓ P2.3.9 RC11 large-Excel browser upload guard PASS');
console.log('  - 37 MB pilot workbook is accepted by the browser guard');
console.log('  - accepted Excel >20 MiB receives a slow-processing advisory');
console.log('  - Excel >50 MiB remains rejected fail-safe');
console.log('  - PDF/image limits remain unchanged');
