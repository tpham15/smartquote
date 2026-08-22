#!/usr/bin/env python3
"""Phase 12.5.2 regression: stale structural mappings cannot pin a bad product row;
product images are aspect-fit inside an inset safe box and stay visually separated from SKU.
"""
import base64
import binascii
import io
import struct
import sys
import zlib
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from xml.etree import ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'api'))
from xlsx_lossless import analyze_template, build_lossless_workbook, fidelity_report

import importlib.util
spec = importlib.util.spec_from_file_location('phase124_fixture', ROOT / 'scripts' / 'phase124-lossless-excel-smoke.py')
fixture_mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture_mod)

M = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
XDR = '{http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing}'
A = '{http://schemas.openxmlformats.org/drawingml/2006/main}'
DR = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'
EMU = 9525


def png_bytes(w=400, h=100):
    # Tiny valid RGB PNG with a deliberately wide aspect ratio.
    raw = b''.join(b'\x00' + (b'\xff\xff\xff' * w) for _ in range(h))
    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', binascii.crc32(kind + data) & 0xffffffff)
    return (b'\x89PNG\r\n\x1a\n' +
            chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)) +
            chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b''))


def tall_stale_fixture():
    raw, parts = fixture_mod.make_fixture()
    with ZipFile(io.BytesIO(raw), 'r') as zin:
        source_parts = {n: zin.read(n) for n in zin.namelist()}
    root = ET.fromstring(source_parts['xl/worksheets/sheet1.xml'])
    rows = {int(r.get('r')): r for r in root.find(M + 'sheetData')}
    # Historical outlier: old mapping used this very tall product row as templateRow.
    rows[13].set('ht', '220')
    rows[13].set('customHeight', '1')
    source_parts['xl/worksheets/sheet1.xml'] = ET.tostring(root, encoding='utf-8', xml_declaration=True)
    bio = io.BytesIO()
    with ZipFile(bio, 'w', ZIP_DEFLATED) as zout:
        for name, data in source_parts.items():
            zout.writestr(name, data)
    return bio.getvalue(), source_parts


def text(cell):
    return ''.join(t.text or '' for t in cell.iter(M + 't'))


def main():
    raw, parts = tall_stale_fixture()
    analyzed = analyze_template(raw)
    assert analyzed['mapping']['items']['templateRow'] == 12, analyzed['mapping']['items']

    png = png_bytes(400, 100)
    image_data = 'data:image/png;base64,' + base64.b64encode(png).decode()
    payload = {
        'company': {'salesPerson': 'Demo'},
        'customer': {'name': 'Khách demo', 'project': 'Demo'},
        'calc': {'deviceTotal': 1_000_000, 'laborTotal': 0, 'grand': 1_000_000},
        'sections': [{'name': 'Giải pháp demo', 'rows': [{
            'no': 1, 'note': 'Khu vực A', 'name': 'Thiết bị A', 'specs': 'Spec A', 'image': image_data,
            'sku': 'SKU-SAFE-GUTTER', 'supplier': 'Brand A', 'unit': 'Cái', 'qty': 1, 'unitPrice': 1_000_000,
        }]}],
    }
    # This simulates a template saved by an older phase. Structural row hints are stale and must be ignored.
    stale_hint = {
        'sheetName': 'Quote',
        'items': {'startRow': 12, 'templateRow': 13, 'clearUntilRow': 13,
                  'columns': analyzed['mapping']['items']['columns']},
    }

    def loader(src):
        return base64.b64decode(src.split(',', 1)[1]) if src.startswith('data:image/') else None

    out, report = build_lossless_workbook(raw, payload, mapping_hint=stale_hint, image_loader=loader)
    with ZipFile(io.BytesIO(out), 'r') as z:
        assert z.testzip() is None
        sheet = ET.fromstring(z.read('xl/worksheets/sheet1.xml'))
        rows = {int(r.get('r')): r for r in sheet.find(M + 'sheetData')}
        # New product inherits the canonical 58pt row, not stale 220pt row.
        assert float(rows[12].get('ht')) == 58.0, rows[12].attrib
        cells = {c.get('r'): c for c in rows[12].findall(M + 'c')}
        assert text(cells['F12']) == 'SKU-SAFE-GUTTER'

        drawing = ET.fromstring(z.read('xl/drawings/drawing1.xml'))
        anchors = []
        for anchor in list(drawing):
            row = anchor.find(XDR + 'from/' + XDR + 'row')
            col = anchor.find(XDR + 'from/' + XDR + 'col')
            if row is not None and col is not None and int(row.text) + 1 == 12 and int(col.text) == 4:
                anchors.append(anchor)
        assert len(anchors) == 1, len(anchors)
        anchor = anchors[0]
        left = int(anchor.find(XDR + 'from/' + XDR + 'colOff').text) / EMU
        top = int(anchor.find(XDR + 'from/' + XDR + 'rowOff').text) / EMU
        if anchor.tag == XDR + 'oneCellAnchor':
            ext = anchor.find(XDR + 'ext')
            assert ext is not None
            width = int(ext.get('cx')) / EMU
            height = int(ext.get('cy')) / EMU
            right = left + width
            bottom = top + height
            assert anchor.find(XDR + 'to') is None
        else:
            to_col = anchor.find(XDR + 'to/' + XDR + 'col')
            assert to_col is not None and int(to_col.text) == 4
            right = int(anchor.find(XDR + 'to/' + XDR + 'colOff').text) / EMU
            bottom = int(anchor.find(XDR + 'to/' + XDR + 'rowOff').text) / EMU
            width, height = right - left, bottom - top
        # Default fixture E width is ~59px. Keep at least an 8px visual gutter from both sides.
        assert left >= 8, (left, right)
        assert right <= 51, (left, right)
        # 4:1 source should remain approximately 4:1, not be stretched into a square prototype box.
        ratio = width / max(1, height)
        assert 3.5 <= ratio <= 4.5, ratio
        assert anchor.tag == XDR + 'twoCellAnchor'
        assert int(anchor.find(XDR + 'to/' + XDR + 'col').text) == 4

        for name in ['xl/styles.xml', 'xl/theme/theme1.xml', 'xl/media/logo.wmf',
                     'xl/printerSettings/printerSettings1.bin', 'docProps/custom.xml']:
            assert z.read(name) == parts[name], f'{name} changed'

    norm = report.get('dynamicMergeNormalization') or {}
    assert int(norm.get('version') or 0) >= 4, norm
    assert norm.get('imageGeometry') == 'hard_cell_boundary_two_marker_v4', norm
    assert (norm.get('imageBoundaryValidation') or {}).get('violations') == 0, norm
    assert norm.get('structureMode') == 'auto_fresh', norm
    allowed = {
        'xl/worksheets/sheet1.xml', 'xl/drawings/drawing1.xml', 'xl/drawings/_rels/drawing1.xml.rels',
        'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', '[Content_Types].xml', 'xl/calcChain.xml'
    }
    fidelity = fidelity_report(raw, out, allowed)
    assert fidelity['staticPartFidelityPct'] == 100.0, fidelity
    print('Phase 12.5.2 image cell geometry smoke: PASS')
    print('Fresh structural detection; aspect ratio preserved; image inset from SKU; static fidelity=100%')


if __name__ == '__main__':
    main()
