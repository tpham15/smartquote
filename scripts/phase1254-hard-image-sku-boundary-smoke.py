#!/usr/bin/env python3
"""Phase 12.5.4 regression: image/SKU is a hard DrawingML boundary, not a visual guess."""
import base64, copy, importlib.util, io, sys
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from xml.etree import ElementTree as ET

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'api'))
from xlsx_lossless import (build_lossless_workbook, _validate_image_sku_boundary,
                           _column_width_emu)

spec=importlib.util.spec_from_file_location('phase124_fixture', ROOT/'scripts'/'phase124-lossless-excel-smoke.py')
fixture=importlib.util.module_from_spec(spec); spec.loader.exec_module(fixture)
XDR='{http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing}'
A='{http://schemas.openxmlformats.org/drawingml/2006/main}'
DR='{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'
M='{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
EMU=9525


def pathological_fixture():
    raw, parts=fixture.make_fixture()
    with ZipFile(io.BytesIO(raw),'r') as z:
        all_parts={n:z.read(n) for n in z.namelist()}
    drawing=ET.fromstring(all_parts['xl/drawings/drawing1.xml'])
    product=next(a for a in list(drawing)
                 if a.find('.//'+A+'blip') is not None and a.find('.//'+A+'blip').get(DR+'embed')=='rId2')
    pic=copy.deepcopy(product.find(XDR+'pic'))
    client=copy.deepcopy(product.find(XDR+'clientData'))
    # Stale picture starts in D, so a cell-index-only test for E would miss it, but the absolute
    # ext is huge and visually crosses E and F on product row 12.
    anc=ET.Element(XDR+'oneCellAnchor')
    fr=ET.SubElement(anc,XDR+'from')
    ET.SubElement(fr,XDR+'col').text='3'  # D
    ET.SubElement(fr,XDR+'colOff').text='0'
    ET.SubElement(fr,XDR+'row').text='11' # row 12
    ET.SubElement(fr,XDR+'rowOff').text='0'
    ext=ET.SubElement(anc,XDR+'ext'); ext.set('cx',str(420*EMU)); ext.set('cy',str(45*EMU))
    c=pic.find(XDR+'nvPicPr/'+XDR+'cNvPr'); c.set('id','99'); c.set('name','Pathological spill D through F')
    anc.append(pic); anc.append(client)
    drawing.append(anc)
    all_parts['xl/drawings/drawing1.xml']=ET.tostring(drawing,encoding='utf-8',xml_declaration=True)
    bio=io.BytesIO()
    with ZipFile(bio,'w',ZIP_DEFLATED) as z:
        for n,d in all_parts.items(): z.writestr(n,d)
    return bio.getvalue()


def main():
    raw=pathological_fixture()
    png=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQMcAAAAASUVORK5CYII=')
    img='data:image/png;base64,'+base64.b64encode(png).decode()
    payload={
      'company':{}, 'customer':{'name':'Khách demo'},
      'calc':{'deviceTotal':1_000_000,'laborTotal':0,'grand':1_000_000},
      'sections':[{'name':'I./ Demo','rows':[{
        'no':1,'note':'Phòng A','name':'Thiết bị A','specs':'Spec','image':img,
        'sku':'SKU-HARD-BOUNDARY','supplier':'Brand','unit':'Cái','qty':1,'unitPrice':1_000_000
      }]}]
    }
    def loader(src): return base64.b64decode(src.split(',',1)[1]) if src.startswith('data:image/') else None
    out, report=build_lossless_workbook(raw,payload,image_loader=loader)
    with ZipFile(io.BytesIO(out),'r') as z:
        sheet=ET.fromstring(z.read('xl/worksheets/sheet1.xml'))
        drawing=ET.fromstring(z.read('xl/drawings/drawing1.xml'))
        # Pathological D-starting oneCellAnchor must be gone.
        names=[]; generated=[]
        for a in list(drawing):
            c=a.find(XDR+'pic/'+XDR+'nvPicPr/'+XDR+'cNvPr')
            if c is not None: names.append(c.get('name',''))
            if c is not None and c.get('name','').startswith('SmartQuote product image '): generated.append(a)
        assert not any('Pathological spill' in n for n in names), names
        assert len(generated)==1, names
        a=generated[0]
        assert a.tag==XDR+'twoCellAnchor', a.tag
        fc=int(a.find(XDR+'from/'+XDR+'col').text); tc=int(a.find(XDR+'to/'+XDR+'col').text)
        assert fc==4 and tc==4, (fc,tc)  # both markers structurally inside E
        to_off=int(a.find(XDR+'to/'+XDR+'colOff').text)
        e_width=_column_width_emu(sheet,4)
        assert to_off < e_width, (to_off,e_width)
        boundary=(report.get('dynamicMergeNormalization') or {}).get('imageBoundaryValidation') or {}
        assert boundary.get('violations')==0, boundary
        assert boundary.get('removedHistoricalPictures',0)>=2, boundary  # old E picture + pathological spill
        assert boundary.get('minimumGutterPx') is None or boundary.get('minimumGutterPx')>=8, boundary

        # Fail-closed proof: mutate the generated to-marker into F and invoke the validator.
        bad=copy.deepcopy(drawing)
        bad_gen=next(x for x in list(bad) if (x.find(XDR+'pic/'+XDR+'nvPicPr/'+XDR+'cNvPr') is not None and
                     x.find(XDR+'pic/'+XDR+'nvPicPr/'+XDR+'cNvPr').get('name','').startswith('SmartQuote product image ')))
        bad_gen.find(XDR+'to/'+XDR+'col').text='5'  # F -> forbidden
        try:
            _validate_image_sku_boundary(sheet,bad,[12],4,5)
        except ValueError:
            pass
        else:
            raise AssertionError('validator must reject image crossing into SKU column')

    norm=report.get('dynamicMergeNormalization') or {}
    assert int(norm.get('version') or 0)>=4, norm
    assert norm.get('imageGeometry')=='hard_cell_boundary_two_marker_v4', norm
    print('Phase 12.5.4 hard image/SKU boundary smoke: PASS')
    print('Bounding-box cleanup + same-cell two-marker anchors + fail-closed overlap validator')

if __name__=='__main__': main()
