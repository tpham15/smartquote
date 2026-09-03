#!/usr/bin/env python3
"""Phase 12.5.1 regression: historical product merges must not collapse dynamic schema columns."""
import base64
import importlib.util
import io
import sys
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from xml.etree import ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'api'))
from xlsx_lossless import analyze_template, build_lossless_workbook, fidelity_report

spec = importlib.util.spec_from_file_location('phase124_fixture', ROOT / 'scripts' / 'phase124-lossless-excel-smoke.py')
fixture_mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture_mod)

M = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
XDR = '{http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing}'


def malformed_fixture():
    raw, parts = fixture_mod.make_fixture()
    with ZipFile(io.BytesIO(raw), 'r') as zin:
        source_parts = {n: zin.read(n) for n in zin.namelist()}
    root = ET.fromstring(source_parts['xl/worksheets/sheet1.xml'])
    merges = root.find(M + 'mergeCells')
    # Simulate a historical quote where Image + SKU were merged on every candidate body row.
    for ref in ('E12:F12', 'E13:F13'):
        ET.SubElement(merges, M + 'mergeCell', {'ref': ref})
    merges.set('count', str(len(list(merges))))
    # In real XLSX files the non-top-left cell of a merge is often absent. Remove F12/F13 so
    # Phase 12.5.1 must recreate SKU cells and recover body styling.
    sheet_data = root.find(M + 'sheetData')
    for row in list(sheet_data):
        rn = int(row.get('r'))
        if rn not in (12, 13):
            continue
        for c in list(row):
            if c.tag == M + 'c' and c.get('r') == f'F{rn}':
                row.remove(c)
    source_parts['xl/worksheets/sheet1.xml'] = ET.tostring(root, encoding='utf-8', xml_declaration=True)
    bio = io.BytesIO()
    with ZipFile(bio, 'w', ZIP_DEFLATED) as zout:
        for name, data in source_parts.items():
            zout.writestr(name, data)
    return bio.getvalue(), source_parts


def main():
    raw, parts = malformed_fixture()
    analyzed = analyze_template(raw)
    assert analyzed['mapping']['items']['columns']['image'] == 'E'
    assert analyzed['mapping']['items']['columns']['sku'] == 'F'
    assert analyzed['mapping']['items']['templateRow'] == 12, 'all body candidates are intentionally malformed in this fixture'

    png = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQMcAAAAASUVORK5CYII=')
    image_data = 'data:image/png;base64,' + base64.b64encode(png).decode()
    payload = {
        'company': {'salesPerson': 'Demo'},
        'customer': {'name': 'Khách demo', 'project': 'Demo'},
        'calc': {'deviceTotal': 2_000_000, 'laborTotal': 0, 'grand': 2_000_000},
        'sections': [{'name': 'Giải pháp demo', 'rows': [
            {'no': 1, 'note': 'Khu vực A', 'name': 'Thiết bị A', 'specs': 'Spec A', 'image': image_data,
             'sku': 'SKU-SEPARATE-01', 'supplier': 'Brand A', 'unit': 'Cái', 'qty': 1, 'unitPrice': 1_000_000},
            {'no': 2, 'note': 'Khu vực B', 'name': 'Thiết bị B', 'specs': 'Spec B',
             'sku': 'SKU-SEPARATE-02', 'supplier': 'Brand B', 'unit': 'Cái', 'qty': 1, 'unitPrice': 1_000_000},
        ]}],
    }

    def image_loader(src):
        return base64.b64decode(src.split(',', 1)[1]) if src.startswith('data:image/') else None

    out, report = build_lossless_workbook(raw, payload, image_loader=image_loader)
    with ZipFile(io.BytesIO(out), 'r') as z:
        assert z.testzip() is None
        root = ET.fromstring(z.read('xl/worksheets/sheet1.xml'))
        merge_parent = root.find(M + 'mergeCells')
        refs = [m.get('ref') for m in (list(merge_parent) if merge_parent is not None else [])]
        assert 'E12:F12' not in refs and 'E13:F13' not in refs, refs

        rows = {int(r.get('r')): r for r in root.find(M + 'sheetData')}
        for rn, sku in ((12, 'SKU-SEPARATE-01'), (13, 'SKU-SEPARATE-02')):
            cells = {c.get('r'): c for c in rows[rn].findall(M + 'c')}
            assert f'E{rn}' in cells and f'F{rn}' in cells, f'Image/SKU cells must exist separately on row {rn}'
            sku_text = ''.join(t.text or '' for t in cells[f'F{rn}'].iter(M + 't'))
            assert sku_text == sku, (rn, sku_text)
            assert cells[f'F{rn}'].get('s') is not None, f'SKU cell style must be recovered on row {rn}'

        drawing = ET.fromstring(z.read('xl/drawings/drawing1.xml'))
        product_anchors = []
        for anchor in list(drawing):
            row_node = anchor.find(XDR + 'from/' + XDR + 'row')
            col_node = anchor.find(XDR + 'from/' + XDR + 'col')
            if row_node is not None and int(row_node.text) + 1 == 12:
                product_anchors.append(anchor)
                assert col_node is not None and int(col_node.text) == 4, 'image must start in column E'
                to_col = anchor.find(XDR + 'to/' + XDR + 'col')
                if to_col is not None:
                    assert int(to_col.text) == 4, 'image anchor must not extend into SKU column F'
        assert product_anchors, 'normalized product image anchor missing'

        # Static dealer-owned package parts stay byte-identical.
        for name in ['xl/styles.xml', 'xl/theme/theme1.xml', 'xl/media/logo.wmf', 'xl/printerSettings/printerSettings1.bin', 'docProps/custom.xml']:
            assert z.read(name) == parts[name], f'{name} changed'

    allowed = {
        'xl/worksheets/sheet1.xml', 'xl/drawings/drawing1.xml', 'xl/drawings/_rels/drawing1.xml.rels',
        'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', '[Content_Types].xml', 'xl/calcChain.xml'
    }
    fidelity = fidelity_report(raw, out, allowed)
    assert fidelity['staticPartFidelityPct'] == 100.0, fidelity
    norm = report.get('dynamicMergeNormalization') or {}
    assert 'E12:F12' in norm.get('suppressedTemplateMerges', []), norm
    assert norm.get('imageColumn') == 'E' and norm.get('skuColumn') == 'F'
    print('Phase 12.5.1 dynamic table merge normalization smoke: PASS')
    print('Image and SKU remain separate; image anchor confined to E; static fidelity=100%')


if __name__ == '__main__':
    main()
