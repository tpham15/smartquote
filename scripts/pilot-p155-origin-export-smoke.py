from __future__ import annotations

import io
import importlib.util
import sys
from pathlib import Path
from openpyxl import load_workbook, Workbook

ROOT = Path(__file__).resolve().parents[1]


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod

excel_builder = load_module('sq_excel_builder_p155', ROOT / 'api' / 'excel_builder.py')
xlsx_lossless = load_module('sq_xlsx_lossless_p155', ROOT / 'api' / 'xlsx_lossless.py')

data = {
    'company': {'name': 'Demo', 'laborPercent': 0, 'vatPercent': 8},
    'customer': {'name': 'Khach', 'quoteNumber': 'SQ-P155'},
    'rooms': [{
        'name': 'Hang muc',
        'lines': [{
            'productId': 'p1',
            'qty': 1,
            'price': 24900000,
            'note': '',
            'product': {
                'name': 'MO TO CONG TRUOT TORQ 500D',
                'sku': 'TORQ 500D',
                'supplier': 'Bisco Tech',
                'brand': 'Roger',
                'origin': 'Italia',
                'unit': 'bo',
                'specs': '24V',
                'image': '',
            },
        }],
    }],
    'calc': {'deviceTotal': 24900000, 'laborTotal': 0, 'vatPercent': 8, 'vatTotal': 1992000, 'grand': 26892000},
}

raw = excel_builder.build_excel(data)
wb = load_workbook(io.BytesIO(raw), data_only=False)
ws = wb.active
header_row = None
for row in ws.iter_rows(min_row=1, max_row=30):
    vals = [str(c.value or '') for c in row]
    if 'Xuất xứ' in vals:
        header_row = row[0].row
        break
assert header_row, 'default workbook must contain Xuất xứ header'
origin_col = None
for cell in ws[header_row]:
    if cell.value == 'Xuất xứ':
        origin_col = cell.column
        break
assert origin_col, 'origin column not found'
product_origin = ws.cell(header_row + 2, origin_col).value if ws.cell(header_row + 1, 1).value else ws.cell(header_row + 1, origin_col).value
# The builder inserts a section row before the product; search first non-empty origin cell below header.
origin_values = [ws.cell(r, origin_col).value for r in range(header_row + 1, min(ws.max_row, header_row + 10) + 1)]
assert 'Italia' in origin_values, f'Xuất xứ must export Italia, got {origin_values}'
assert 'Bisco Tech' not in origin_values, f'supplier must not leak into Xuất xứ when origin exists: {origin_values}'

analysis = xlsx_lossless.analyze_template(raw)
cols = analysis['mapping']['items']['columns']
assert cols.get('origin') == ws.cell(header_row, origin_col).column_letter, cols
assert cols.get('supplier') != cols.get('origin'), cols
assert cols.get('brand') != cols.get('origin'), cols

# A custom dealer template may contain all three columns; they must stay distinct.
custom = Workbook()
cws = custom.active
cws.title = 'Quote'
headers = ['STT', 'Tên sản phẩm', 'Mã SP', 'Nhà cung cấp', 'Hãng', 'Xuất xứ', 'ĐVT', 'SL', 'Đơn giá', 'Thành tiền']
for idx, value in enumerate(headers, 1):
    cws.cell(5, idx, value)
row = [1, 'Motor TORQ 500D', 'TORQ 500D', 'Bisco Tech', 'Roger', 'Italia', 'bộ', 1, 24900000, 24900000]
for idx, value in enumerate(row, 1):
    cws.cell(6, idx, value)
buf = io.BytesIO(); custom.save(buf)
custom_analysis = xlsx_lossless.analyze_template(buf.getvalue())
custom_cols = custom_analysis['mapping']['items']['columns']
assert custom_cols.get('supplier') == 'D', custom_cols
assert custom_cols.get('brand') == 'E', custom_cols
assert custom_cols.get('origin') == 'F', custom_cols

# Old saved manifests used supplier=G for a column headed 'Xuất xứ'. Fresh header
# semantics must win and the stale hint must not create a duplicate meaning.
merged = xlsx_lossless._merge_mapping(analysis['mapping'], {'items': {'columns': {'supplier': 'G'}}})
merged_cols = merged['items']['columns']
assert merged_cols.get('origin') == 'G', merged_cols
assert merged_cols.get('supplier') != 'G', merged_cols

print('✓ Pilot P1.5.5 origin/export semantic smoke PASS')
