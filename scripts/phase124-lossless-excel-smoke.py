#!/usr/bin/env python3
import base64, io, json, sys
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
from xml.etree import ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'api'))
from xlsx_lossless import analyze_template, build_lossless_workbook, fidelity_report

M = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
XDR = '{http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing}'
A = '{http://schemas.openxmlformats.org/drawingml/2006/main}'
DR = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'


def inline_cell(ref, text, style):
    esc = str(text).replace('&','&amp;').replace('<','&lt;').replace('>','&gt;')
    return f'<c r="{ref}" s="{style}" t="inlineStr"><is><t>{esc}</t></is></c>'


def num_cell(ref, value, style):
    return f'<c r="{ref}" s="{style}"><v>{value}</v></c>'


def formula_cell(ref, formula, style):
    return f'<c r="{ref}" s="{style}"><f>{formula}</f><v>0</v></c>'


def make_fixture():
    rows = [
        '<row r="1" ht="20" customHeight="1">'+inline_cell('A1','LOGO AREA',1)+'</row>',
        '<row r="5" ht="18" customHeight="1">'+inline_cell('A5','Khách hàng: OLD',2)+inline_cell('E5','Số báo giá: OLD',2)+'</row>',
        '<row r="6" ht="18" customHeight="1">'+inline_cell('A6','Điện thoại: 000',2)+inline_cell('E6','Ngày: 01/01/2026',2)+'</row>',
        '<row r="7" ht="18" customHeight="1">'+inline_cell('A7','Địa điểm công trình: OLD',2)+inline_cell('E7','Người báo giá: OLD',2)+'</row>',
        '<row r="8" ht="18" customHeight="1">'+inline_cell('A8','Hạng mục: OLD',2)+inline_cell('E8','Điện thoại: 111',2)+'</row>',
        '<row r="10" ht="26" customHeight="1">'+''.join([
            inline_cell('A10','STT',3),inline_cell('B10','Khu vực lắp đặt',3),inline_cell('C10','Tên hàng hoá',3),inline_cell('D10','Thông số kỹ thuật',3),inline_cell('E10','Hình ảnh',3),inline_cell('F10','Mã thiết bị',3),inline_cell('G10','Xuất xứ',3),inline_cell('H10','ĐVT',3),inline_cell('I10','Số lượng',3),inline_cell('J10','Đơn giá',3),inline_cell('K10','Thành tiền',3)])+'</row>',
        '<row r="11" ht="22" customHeight="1">'+inline_cell('A11','I./ Giải pháp chiếu sáng',4)+formula_cell('K11','SUM(K12:K13)',4)+'</row>',
        '<row r="12" ht="58" customHeight="1">'+''.join([num_cell('A12',1,5),inline_cell('B12','Phòng mẫu',5),inline_cell('C12','Sản phẩm mẫu',5),inline_cell('D12','Thông số mẫu',6),inline_cell('F12','SKU-OLD',5),inline_cell('G12','Brand',5),inline_cell('H12','Cái',5),num_cell('I12',1,5),num_cell('J12',100,7),formula_cell('K12','I12*J12',8)])+'</row>',
        '<row r="13" ht="58" customHeight="1">'+''.join([num_cell('A13',2,5),inline_cell('C13','Old second item',5),num_cell('I13',1,5),num_cell('J13',200,7),formula_cell('K13','I13*J13',8)])+'</row>',
        '<row r="14" ht="20" customHeight="1">'+inline_cell('A14','TỔNG HỢP CÁC GIẢI PHÁP',9)+'</row>',
        '<row r="15" ht="18" customHeight="1">'+inline_cell('A15','I./ Giải pháp chiếu sáng',10)+formula_cell('K15','K11',11)+'</row>',
        '<row r="16" ht="18" customHeight="1">'+inline_cell('A16','Tổng tiền hàng:',12)+formula_cell('K16','SUM(K15:K15)',13)+'</row>',
        '<row r="17" ht="18" customHeight="1">'+inline_cell('A17','Nhân công thi công',12)+formula_cell('K17','K16*10%',13)+'</row>',
        '<row r="18" ht="18" customHeight="1">'+inline_cell('A18','Tổng giá trị hợp đồng',12)+formula_cell('K18','K16+K17',13)+'</row>',
        '<row r="19" ht="24" customHeight="1">'+inline_cell('A19','QUY TRÌNH LÀM VIỆC',14)+'</row>',
    ]
    sheet = f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<dimension ref="A1:K19"/><sheetViews><sheetView workbookViewId="0"/></sheetViews><sheetFormatPr defaultRowHeight="15"/>
<cols><col min="1" max="1" width="5" customWidth="1"/><col min="2" max="2" width="14" customWidth="1"/><col min="3" max="3" width="30" customWidth="1"/><col min="4" max="4" width="40" customWidth="1"/></cols>
<sheetData>{''.join(rows)}</sheetData>
<mergeCells count="7"><mergeCell ref="A1:D2"/><mergeCell ref="A11:J11"/><mergeCell ref="A14:K14"/><mergeCell ref="A15:J15"/><mergeCell ref="A16:J16"/><mergeCell ref="A17:J17"/><mergeCell ref="A18:J18"/></mergeCells>
<pageMargins left="0.2" right="0.2" top="0.3" bottom="0.3" header="0" footer="0"/><pageSetup orientation="landscape" scale="80" r:id="rId2"/><drawing r:id="rId1"/>
</worksheet>'''.encode()
    drawing = b'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<xdr:twoCellAnchor><xdr:from><xdr:col>1</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>0</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>3</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>2</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="1" name="Logo"/><xdr:cNvPicPr/></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr/></xdr:pic><xdr:clientData/></xdr:twoCellAnchor>
<xdr:twoCellAnchor><xdr:from><xdr:col>4</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>11</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>4</xdr:col><xdr:colOff>500000</xdr:colOff><xdr:row>11</xdr:row><xdr:rowOff>500000</xdr:rowOff></xdr:to><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="2" name="Old product"/><xdr:cNvPicPr/></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr/></xdr:pic><xdr:clientData/></xdr:twoCellAnchor>
</xdr:wsDr>'''
    styles = b'''<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="10"/><name val="Arial"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="15">''' + b''.join([b'<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' for _ in range(15)]) + b'''</cellXfs></styleSheet>'''
    parts = {
      '[Content_Types].xml': b'''<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="wmf" ContentType="image/x-wmf"/><Default Extension="bin" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.printerSettings"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/><Override PartName="/xl/calcChain.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.calcChain+xml"/></Types>''',
      '_rels/.rels': b'''<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>''',
      'xl/workbook.xml': b'''<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Quote" sheetId="1" r:id="rId1"/></sheets><calcPr calcId="1"/></workbook>''',
      'xl/_rels/workbook.xml.rels': b'''<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/calcChain" Target="calcChain.xml"/></Relationships>''',
      'xl/worksheets/sheet1.xml': sheet,
      'xl/worksheets/_rels/sheet1.xml.rels': b'''<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/printerSettings" Target="../printerSettings/printerSettings1.bin"/></Relationships>''',
      'xl/styles.xml': styles,
      'xl/theme/theme1.xml': b'<theme-marker>DO-NOT-TOUCH</theme-marker>',
      'xl/drawings/drawing1.xml': drawing,
      'xl/drawings/_rels/drawing1.xml.rels': b'''<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/logo.wmf"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/old-product.png"/></Relationships>''',
      'xl/media/logo.wmf': b'OPAQUE-WMF-BYTES-123',
      'xl/media/old-product.png': b'OLD-PRODUCT-PNG',
      'xl/printerSettings/printerSettings1.bin': b'OPAQUE-PRINTER-SETTINGS',
      'xl/calcChain.xml': b'''<?xml version="1.0"?><calcChain xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><c r="K12" i="1"/></calcChain>''',
      'docProps/custom.xml': b'<custom-marker>dealer-owned-opaque-metadata</custom-marker>',
    }
    bio = io.BytesIO()
    with ZipFile(bio,'w',ZIP_DEFLATED) as z:
      for name,data in parts.items(): z.writestr(name,data)
    return bio.getvalue(), parts


def main():
    raw, parts = make_fixture()
    analyzed = analyze_template(raw)
    m = analyzed['mapping']
    assert m['items']['headerRow'] == 10
    assert m['items']['sectionRow'] == 11
    assert m['items']['templateRow'] == 12
    assert m['items']['sectionLabelColumn'] == 'A'
    assert m['summary']['titleRow'] == 14
    assert m['totals']['subtotal'] == 'K16' and m['totals']['labor'] == 'K17' and m['totals']['grandTotal'] == 'K18'

    png = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQMcAAAAASUVORK5CYII=')
    img = 'data:image/png;base64,' + base64.b64encode(png).decode()
    def image_loader(src):
      return base64.b64decode(src.split(',',1)[1]) if src.startswith('data:image/') else None

    payload = {
      'company': {'salesPerson':'Sale New','salesPhone':'0900000000'},
      'customer': {'name':'Khách mới','phone':'0911111111','address':'Đà Nẵng','project':'Dự án mới','quoteNumber':'SQ-NEW'},
      'calc': {'deviceTotal':4000000,'laborTotal':0,'grand':4000000},
      'sections': [
        {'name':'I./ Giải pháp chiếu sáng','rows':[
          {'no':1,'note':'Phòng khách','name':'Thiết bị A','specs':{'text':'BLE Mesh'},'image':img,'sku':'A-1','supplier':'Brand A','unit':'Cái','qty':2,'unitPrice':1000000},
          {'no':2,'note':'Phòng ngủ','name':'Thiết bị B','specs':['220V','BLE'],'sku':'B-1','supplier':'Brand A','unit':'Cái','qty':1,'unitPrice':1000000},
        ]},
        {'name':'II./ Hệ thống camera','rows':[
          {'no':3,'note':'Ngoài cổng','name':'Camera','specs':'4MP','sku':'C-1','supplier':'Brand B','unit':'Cái','qty':1,'unitPrice':1000000},
        ]},
      ]
    }
    out, report = build_lossless_workbook(raw, payload, image_loader=image_loader)
    with ZipFile(io.BytesIO(out)) as z:
      assert z.testzip() is None
      for name in ['xl/styles.xml','xl/theme/theme1.xml','xl/media/logo.wmf','xl/printerSettings/printerSettings1.bin','docProps/custom.xml']:
        assert z.read(name) == parts[name], f'{name} must be byte-identical'
      assert 'xl/calcChain.xml' not in z.namelist(), 'stale calcChain must be removed'
      sheet = ET.fromstring(z.read('xl/worksheets/sheet1.xml'))
      rows = {int(r.get('r')):r for r in sheet.find(M+'sheetData')}
      assert 22 in rows and 19 in rows and 20 in rows and 21 in rows, f'row shift must preserve totals/footer, got {sorted(rows)}'
      def cell(row, ref):
        return next(c for c in rows[row].findall(M+'c') if c.get('r') == ref)
      def text(c): return ''.join(t.text or '' for t in c.iter(M+'t'))
      assert text(cell(5,'A5')) == 'Khách hàng: Khách mới'
      assert text(cell(11,'A11')) == 'I./ Giải pháp chiếu sáng'
      assert cell(11,'A11').get('s') == '4', 'section raw style id must survive'
      assert text(cell(12,'C12')) == 'Thiết bị A' and cell(12,'C12').get('s') == '5'
      assert text(cell(12,'D12')) == 'BLE Mesh' and '[object Object]' not in z.read('xl/worksheets/sheet1.xml').decode('utf-8')
      assert cell(12,'K12').find(M+'f').text == 'I12*J12'
      assert text(cell(14,'A14')) == 'II./ Hệ thống camera'
      assert text(cell(17,'A17')) == 'I./ Giải pháp chiếu sáng'
      assert text(cell(18,'A18')) == 'II./ Hệ thống camera'
      assert cell(19,'K19').find(M+'f').text == 'SUM(K17:K18)'
      assert cell(20,'K20').find(M+'v').text == '0', 'labor must not inherit old 10% rule'
      assert cell(21,'K21').find(M+'f').text == 'K19+K20'
      assert text(cell(22,'A22')) == 'QUY TRÌNH LÀM VIỆC', 'footer row must survive and shift'
      drawing = ET.fromstring(z.read('xl/drawings/drawing1.xml'))
      anchors = list(drawing)
      logo = [a for a in anchors if (a.find('.//'+A+'blip') is not None and a.find('.//'+A+'blip').get(DR+'embed') == 'rId1')]
      assert len(logo) == 1, 'logo drawing must remain'
      assert any((a.find(XDR+'from/'+XDR+'row') is not None and int(a.find(XDR+'from/'+XDR+'row').text)+1 == 12) for a in anchors), 'new product image anchor missing'

    allowed = {'xl/worksheets/sheet1.xml','xl/drawings/drawing1.xml','xl/drawings/_rels/drawing1.xml.rels','xl/workbook.xml','xl/_rels/workbook.xml.rels','[Content_Types].xml','xl/calcChain.xml'}
    fidelity = fidelity_report(raw, out, allowed)
    assert fidelity['staticPartFidelityPct'] == 100.0, fidelity
    assert report['engineVersion'] == 'lossless_xml_v3'
    print('Phase 12.4 lossless Excel smoke: PASS')
    print(json.dumps({'staticPartFidelityPct':fidelity['staticPartFidelityPct'],'modifiedParts':fidelity['changedParts'],'addedParts':fidelity['addedParts'],'missingParts':fidelity['missingParts']},ensure_ascii=False))

if __name__ == '__main__': main()
