#!/usr/bin/env python3
import importlib.util
import io
import sys
from pathlib import Path
from zipfile import ZipFile
from xml.etree import ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'api'))
from xlsx_lossless import build_lossless_workbook, fidelity_report

spec = importlib.util.spec_from_file_location('phase124_fixture', ROOT / 'scripts' / 'phase124-lossless-excel-smoke.py')
fixture_mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture_mod)

M = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'


def main():
    raw, parts = fixture_mod.make_fixture()
    products = [
        ('Thiết bị 01', 'SKU-01', 2, 1_100_000),
        ('Thiết bị 02', 'SKU-02', 1, 2_200_000),
        ('Thiết bị 03', 'SKU-03', 4, 330_000),
        ('Thiết bị 04', 'SKU-04', 3, 450_000),
        ('Thiết bị 05', 'SKU-05', 1, 5_000_000),
        ('Thiết bị 06', 'SKU-06', 2, 675_000),
        ('Thiết bị 07', 'SKU-07', 5, 120_000),
        ('Thiết bị 08', 'SKU-08', 1, 780_000),
    ]
    rows = []
    subtotal = 0
    for idx, (name, sku, qty, price) in enumerate(products, 1):
        subtotal += qty * price
        rows.append({
            'no': idx,
            'note': 'Khu vực demo',
            'name': name,
            'specs': f'Thông số {idx}',
            'sku': sku,
            'supplier': 'Hãng demo',
            'unit': 'Cái',
            'qty': qty,
            'unitPrice': price,
        })
    labor = round(subtotal * 0.10)
    grand = subtotal + labor
    payload = {
        'company': {'salesPerson': 'Nhân viên demo', 'salesPhone': '0900000000', 'laborPercent': 10},
        'customer': {
            'name': 'Khách hàng mới',
            'phone': '0911111111',
            'address': 'Địa chỉ mới',
            'project': 'Công trình mới',
            'quoteNumber': 'SQ-2026-001',
        },
        'calc': {'deviceTotal': subtotal, 'laborTotal': labor, 'grand': grand},
        'sections': [{'name': 'Gói giải pháp mới', 'rows': rows}],
    }

    out, report = build_lossless_workbook(raw, payload)
    with ZipFile(io.BytesIO(out)) as z:
        assert z.testzip() is None
        sheet = ET.fromstring(z.read('xl/worksheets/sheet1.xml'))
        row_nodes = {int(r.get('r')): r for r in sheet.find(M + 'sheetData')}

        def cell(row_num, ref):
            return next(c for c in row_nodes[row_num].findall(M + 'c') if c.get('r') == ref)

        def text(c):
            return ''.join(t.text or '' for t in c.iter(M + 't'))

        def number(c):
            v = c.find(M + 'v')
            return float(v.text) if v is not None and v.text is not None else None

        assert text(cell(5, 'A5')) == 'Khách hàng: Khách hàng mới'
        assert text(cell(11, 'A11')) == 'Gói giải pháp mới'

        # Eight current-quote products must replace old template data at rows 12..19.
        for idx, (name, sku, qty, price) in enumerate(products, 1):
            row_num = 11 + idx
            assert text(cell(row_num, f'C{row_num}')) == name
            assert text(cell(row_num, f'F{row_num}')) == sku
            assert number(cell(row_num, f'I{row_num}')) == qty
            assert number(cell(row_num, f'J{row_num}')) == price
            assert cell(row_num, f'K{row_num}').find(M + 'f').text == f'I{row_num}*J{row_num}'

        # One section => summary title + one section row + totals, then original footer.
        assert text(cell(20, 'A20')) == 'TỔNG HỢP CÁC GIẢI PHÁP'
        assert text(cell(21, 'A21')) == 'Gói giải pháp mới'
        assert cell(22, 'K22').find(M + 'f').text == 'SUM(K21:K21)'
        assert cell(23, 'K23').find(M + 'f').text == 'K22*0.1000000000'
        assert cell(24, 'K24').find(M + 'f').text == 'K22+K23'
        assert text(cell(25, 'A25')) == 'QUY TRÌNH LÀM VIỆC'

        # Static dealer-owned OOXML remains untouched.
        for name in ['xl/styles.xml', 'xl/theme/theme1.xml', 'xl/media/logo.wmf', 'xl/printerSettings/printerSettings1.bin', 'docProps/custom.xml']:
            assert z.read(name) == parts[name], f'{name} changed during quote fill'

    allowed = {
        'xl/worksheets/sheet1.xml', 'xl/drawings/drawing1.xml', 'xl/drawings/_rels/drawing1.xml.rels',
        'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', '[Content_Types].xml', 'xl/calcChain.xml'
    }
    fidelity = fidelity_report(raw, out, allowed)
    assert fidelity['staticPartFidelityPct'] == 100.0, fidelity
    assert report['engineVersion'] == 'lossless_xml_v3'
    print('Phase 12.5 dynamic quote→template fill smoke: PASS')
    print(f'8 products filled; subtotal={subtotal}; labor={labor}; grand={grand}; static fidelity=100%')


if __name__ == '__main__':
    main()
