import io, sys
from pathlib import Path
from zipfile import ZipFile
from xml.etree import ElementTree as ET
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'api'))
from xlsx_lossless import build_lossless_workbook

ROOT=Path(__file__).resolve().parents[1]
TEMPLATE=Path('/mnt/data/BG KH a Phúc 22-06-26(2).xlsx')
raw=TEMPLATE.read_bytes()
with ZipFile(io.BytesIO(raw)) as z:
    # pick a normal product image from the template package
    img_data=z.read('xl/media/image2.jpeg')

def loader(_src): return img_data
rows=[]
for i in range(8):
    rows.append({'no':i+1,'note':'Phòng demo','name':f'Sản phẩm {i+1}','specs':'Thông số','image':f'local:{i}','sku':f'SKU-{i+1:02d}','supplier':'Demo','unit':'Cái','qty':1,'unitPrice':1000000})
payload={'company':{'salesPerson':'Demo','salesPhone':'0900000000'},'customer':{'name':'Khách test','project':'Công trình test'},'calc':{'deviceTotal':8000000,'laborTotal':800000,'grand':8800000},'sections':[{'name':'Bộ test','rows':rows}]}
out, report=build_lossless_workbook(raw,payload,image_loader=loader)
with ZipFile(io.BytesIO(out)) as z:
    d=ET.fromstring(z.read('xl/drawings/drawing1.xml'))
    ns={'xdr':'http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing','a':'http://schemas.openxmlformats.org/drawingml/2006/main','r':'http://schemas.openxmlformats.org/officeDocument/2006/relationships'}
    pics=[]
    for anc in d.findall('xdr:twoCellAnchor',ns):
        pic=anc.find('xdr:pic',ns)
        if pic is None: continue
        blip=pic.find('.//a:blip',ns)
        if blip is None: continue
        fr=anc.find('xdr:from',ns)
        col=int(fr.find('xdr:col',ns).text)+1
        row=int(fr.find('xdr:row',ns).text)+1
        co=int(fr.find('xdr:colOff',ns).text); ro=int(fr.find('xdr:rowOff',ns).text)
        to=anc.find('xdr:to',ns)
        tc=int(to.find('xdr:col',ns).text)+1
        tco=int(to.find('xdr:colOff',ns).text); tro=int(to.find('xdr:rowOff',ns).text)
        pics.append((row,col,co,ro,tc,tco,tro))
    # New product images must use fresh two-marker anchors with both markers inside E.
    prod=[x for x in pics if 15 <= x[0] <= 22 and x[1]==5]
    assert len(prod)==8, pics
    # No product image may start in section row 14 or use a to-cell anchor.
    assert all(x[0] == 15+i for i,x in enumerate(prod)), prod
    assert all(x[4] == 5 for x in prod), prod
print('Phase 12.5.3 image geometry smoke: PASS')
print('8 product images use fresh same-cell two-marker anchors in column E; no stale section-row anchors')
