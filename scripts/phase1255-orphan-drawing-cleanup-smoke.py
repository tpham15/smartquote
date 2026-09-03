#!/usr/bin/env python3
"""Phase 12.5.5 regression: only static-whitelisted + freshly generated pictures survive."""
import base64, copy, importlib.util, io, sys
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from xml.etree import ElementTree as ET

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'api'))
from xlsx_lossless import build_lossless_workbook, analyze_template, _validate_orphan_pictures

spec=importlib.util.spec_from_file_location('phase124_fixture', ROOT/'scripts'/'phase124-lossless-excel-smoke.py')
fixture=importlib.util.module_from_spec(spec); spec.loader.exec_module(fixture)
XDR='{http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing}'
A='{http://schemas.openxmlformats.org/drawingml/2006/main}'
DR='{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'
PKG='{http://schemas.openxmlformats.org/package/2006/relationships}'
EMU=9525


def _one_cell(pic, client, name, col, row_zero, width_px=180, height_px=70):
    anc=ET.Element(XDR+'oneCellAnchor')
    fr=ET.SubElement(anc,XDR+'from')
    ET.SubElement(fr,XDR+'col').text=str(col)
    ET.SubElement(fr,XDR+'colOff').text='0'
    ET.SubElement(fr,XDR+'row').text=str(row_zero)
    ET.SubElement(fr,XDR+'rowOff').text='0'
    ext=ET.SubElement(anc,XDR+'ext'); ext.set('cx',str(width_px*EMU)); ext.set('cy',str(height_px*EMU))
    cloned=copy.deepcopy(pic)
    c=cloned.find(XDR+'nvPicPr/'+XDR+'cNvPr'); c.set('id',str(200+row_zero+col)); c.set('name',name)
    anc.append(cloned); anc.append(copy.deepcopy(client))
    return anc


def fixture_with_far_orphan_and_static_signature():
    raw,_=fixture.make_fixture()
    with ZipFile(io.BytesIO(raw),'r') as z:
        parts={n:z.read(n) for n in z.namelist()}
    drawing=ET.fromstring(parts['xl/drawings/drawing1.xml'])
    product=next(a for a in list(drawing)
                 if a.find('.//'+A+'blip') is not None and a.find('.//'+A+'blip').get(DR+'embed')=='rId2')
    pic=product.find(XDR+'pic'); client=product.find(XDR+'clientData')
    # Far below dynamic rows, visually crossing D/E/F. 12.5.4 used to preserve this because the
    # vertical bbox no longer intersected the dynamic block.
    drawing.append(_one_cell(pic,client,'Historical orphan far below',3,49,300,80))
    # A legitimate footer/static picture outside image/SKU columns should be auto-whitelisted.
    drawing.append(_one_cell(pic,client,'Footer signature static',9,49,80,50))
    parts['xl/drawings/drawing1.xml']=ET.tostring(drawing,encoding='utf-8',xml_declaration=True)
    bio=io.BytesIO()
    with ZipFile(bio,'w',ZIP_DEFLATED) as z:
        for n,d in parts.items(): z.writestr(n,d)
    return bio.getvalue()


def main():
    raw=fixture_with_far_orphan_and_static_signature()
    analyzed=analyze_template(raw)
    whitelist=analyzed['mapping'].get('staticDrawingWhitelist') or []
    names={x.get('name') for x in whitelist}
    assert 'Logo' in names, whitelist  # fixture header logo
    assert 'Footer signature static' in names, whitelist
    assert 'Historical orphan far below' not in names, whitelist

    png=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQMcAAAAASUVORK5CYII=')
    img='data:image/png;base64,'+base64.b64encode(png).decode()
    payload={
      'company':{}, 'customer':{'name':'Khách demo'},
      'calc':{'deviceTotal':1_000_000,'laborTotal':0,'grand':1_000_000},
      'sections':[{'name':'I./ Demo','rows':[{
        'no':1,'note':'Phòng A','name':'Thiết bị A','specs':'Spec','image':img,
        'sku':'SKU-1255','supplier':'Brand','unit':'Cái','qty':1,'unitPrice':1_000_000
      }]}]
    }
    def loader(src): return base64.b64decode(src.split(',',1)[1]) if src.startswith('data:image/') else None
    out,report=build_lossless_workbook(raw,payload,image_loader=loader)
    with ZipFile(io.BytesIO(out),'r') as z:
        drawing=ET.fromstring(z.read('xl/drawings/drawing1.xml'))
        rels=ET.fromstring(z.read('xl/drawings/_rels/drawing1.xml.rels'))
        names=[]
        for a in list(drawing):
            c=a.find(XDR+'pic/'+XDR+'nvPicPr/'+XDR+'cNvPr')
            if c is not None: names.append(c.get('name',''))
        assert 'Historical orphan far below' not in names, names
        assert 'Logo' in names, names
        assert 'Footer signature static' in names, names
        assert sum(n.startswith('SmartQuote product image ') for n in names)==1, names
        # Original historical product picture must also be gone.
        assert not any(n == 'Product Image' for n in names), names

        cleanup=(report.get('dynamicMergeNormalization') or {}).get('imageBoundaryValidation') or {}
        assert cleanup.get('drawingCleanupMode')=='static_whitelist_v5', cleanup
        assert cleanup.get('removedOrphanPictures',0)>=2, cleanup
        orphan=cleanup.get('orphanDrawingValidation') or {}
        assert orphan.get('orphanViolations')==0, cleanup
        assert orphan.get('preservedStaticPictures')==2, cleanup

        # Fail-closed proof: inject an unexpected picture after cleanup; validator must reject it.
        bad=copy.deepcopy(drawing)
        generated=next(a for a in list(bad) if (a.find(XDR+'pic/'+XDR+'nvPicPr/'+XDR+'cNvPr') is not None and
                       a.find(XDR+'pic/'+XDR+'nvPicPr/'+XDR+'cNvPr').get('name','').startswith('SmartQuote product image ')))
        injected=copy.deepcopy(generated)
        injected.find(XDR+'pic/'+XDR+'nvPicPr/'+XDR+'cNvPr').set('name','Unexpected leftover picture')
        bad.append(injected)
        try:
            _validate_orphan_pictures(bad,rels,cleanup.get('staticDrawingWhitelist') or [])
        except ValueError:
            pass
        else:
            raise AssertionError('orphan validator must reject any non-whitelisted historical picture')

    norm=report.get('dynamicMergeNormalization') or {}
    assert int(norm.get('version') or 0)>=5, norm
    print('Phase 12.5.5 orphan drawing cleanup smoke: PASS')
    print('Static whitelist + far-below orphan removal + fail-closed validator')

if __name__=='__main__': main()
