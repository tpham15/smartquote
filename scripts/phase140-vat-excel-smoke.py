#!/usr/bin/env python3
import importlib.util
import io
import sys
from pathlib import Path
from zipfile import ZipFile
from xml.etree import ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'api'))
from xlsx_lossless import build_lossless_workbook

spec = importlib.util.spec_from_file_location('phase124_fixture', ROOT / 'scripts' / 'phase124-lossless-excel-smoke.py')
fixture_mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture_mod)
M = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'

raw, _ = fixture_mod.make_fixture()
subtotal = 1_000_000
labor = 100_000
vat = 88_000
grand = 1_188_000
payload = {
    'company': {'laborPercent': 10, 'vatPercent': 8},
    'customer': {'name': 'VAT demo'},
    'calc': {'deviceTotal': subtotal, 'laborTotal': labor, 'vatPercent': 8, 'vatTotal': vat, 'grand': grand},
    'sections': [{'name': 'Hạng mục', 'rows': [{'no': 1, 'name': 'Thiết bị', 'sku': 'VAT-01', 'unit': 'Cái', 'qty': 1, 'unitPrice': subtotal}]}],
}
out, _ = build_lossless_workbook(raw, payload)
with ZipFile(io.BytesIO(out)) as z:
    root = ET.fromstring(z.read('xl/worksheets/sheet1.xml'))
    cells = {c.get('r'): c for c in root.iter(M + 'c')}
    # Fixture cũ không có ô VAT riêng. Grand phải cộng VAT trực tiếp trong formula.
    grand_cell = cells['K17'] if 'K17' in cells else cells[sorted([r for r in cells if r.startswith('K')], key=lambda x: int(x[1:]))[-1]]
    formulas = [(ref, (cell.find(M + 'f').text if cell.find(M + 'f') is not None else '')) for ref, cell in cells.items()]
    assert any('1+0.0800000000' in f for _, f in formulas), formulas
print('✓ Phase 14.0 VAT lossless Excel: VAT included even when template has no VAT row')
