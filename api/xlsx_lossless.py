"""SmartQuote Phase 12.4 — lossless XLSX package patcher.

The contract is intentionally strict: parts that SmartQuote does not need to edit are copied
from the uploaded .xlsx byte-for-byte. Dynamic quote data is patched in worksheet XML and,
when product images are supplied, the existing drawing package is extended instead of asking
an Excel serializer to rebuild the workbook.

This module uses only Python's standard library so unsupported Excel objects (WMF/EMF,
printerSettings, themes, custom props, etc.) stay opaque and untouched.
"""
from __future__ import annotations

import base64
import copy
import hashlib
import io
import json
import math
import re
import statistics
import struct
from dataclasses import dataclass
from datetime import date
from typing import Callable, Iterable
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo
from xml.etree import ElementTree as ET

MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
REL = "http://schemas.openxmlformats.org/package/2006/relationships"
DOC_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
XDR = "http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing"
A = "http://schemas.openxmlformats.org/drawingml/2006/main"
CT = "http://schemas.openxmlformats.org/package/2006/content-types"
XML = "http://www.w3.org/XML/1998/namespace"

# Preserve familiar prefixes when a modified XML part is serialized.
for prefix, uri in [
    ("", MAIN), ("r", DOC_REL), ("xdr", XDR), ("a", A),
]:
    try:
        ET.register_namespace(prefix, uri)
    except Exception:
        pass

M = "{%s}" % MAIN
R = "{%s}" % REL
DR = "{%s}" % DOC_REL
XD = "{%s}" % XDR
AN = "{%s}" % A
CTN = "{%s}" % CT

CELL_RE = re.compile(r"^(\$?[A-Z]{1,3})(\$?)(\d+)$")
CELL_IN_FORMULA_RE = re.compile(r"(?<![A-Za-z0-9_\.])((?:'[^']+'|[A-Za-z0-9_]+)!)?(\$?[A-Z]{1,3})(\$?)(\d+)")
SECTION_RE = re.compile(r"^(?:[ivxlcdm]+|\d+)\s*[\.\/]\s+", re.I)


@dataclass
class Package:
    infos: list[ZipInfo]
    parts: dict[str, bytes]


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _read_package(raw: bytes) -> Package:
    with ZipFile(io.BytesIO(raw), "r") as z:
        infos = [copy.copy(i) for i in z.infolist()]
        parts = {i.filename: z.read(i.filename) for i in z.infolist()}
    return Package(infos=infos, parts=parts)


def _write_package(pkg: Package, overrides: dict[str, bytes], removed: set[str] | None = None, added: dict[str, bytes] | None = None) -> bytes:
    removed = removed or set()
    added = added or {}
    out = io.BytesIO()
    existing_names = {i.filename for i in pkg.infos}
    with ZipFile(out, "w") as z:
        for info in pkg.infos:
            if info.filename in removed:
                continue
            data = overrides.get(info.filename, pkg.parts[info.filename])
            # Clone metadata where possible. Python recompresses the member, but the decompressed
            # bytes of untouched parts remain exactly identical.
            clone = copy.copy(info)
            z.writestr(clone, data)
        for name, data in added.items():
            if name in existing_names and name not in removed:
                continue
            zi = ZipInfo(name)
            zi.compress_type = ZIP_DEFLATED
            z.writestr(zi, data)
    return out.getvalue()


def _xml(data: bytes) -> ET.Element:
    return ET.fromstring(data)


def _xml_bytes(root: ET.Element) -> bytes:
    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


def _col_to_num(col: str) -> int:
    n = 0
    for ch in re.sub(r"[^A-Z]", "", str(col or "").upper()):
        n = n * 26 + ord(ch) - 64
    return n


def _num_to_col(n: int) -> str:
    out = ""
    n = max(1, int(n))
    while n:
        n, r = divmod(n - 1, 26)
        out = chr(65 + r) + out
    return out


def _split_ref(ref: str) -> tuple[str, int] | tuple[None, None]:
    m = re.match(r"^\$?([A-Z]{1,3})\$?(\d+)$", str(ref or "").upper())
    return (m.group(1), int(m.group(2))) if m else (None, None)


def _range_rows(ref: str) -> tuple[int, int] | tuple[None, None]:
    if not ref:
        return None, None
    parts = str(ref).split(":", 1)
    _, a = _split_ref(parts[0])
    _, b = _split_ref(parts[-1])
    return a, b


def _shift_cell_ref(ref: str, threshold: int, delta: int) -> str:
    if not ref or not delta:
        return ref
    prefix = "$" if str(ref).startswith("$") else ""
    col, row = _split_ref(str(ref).replace("$", ""))
    if not col or row is None:
        return ref
    if row >= threshold:
        row = max(1, row + delta)
    return f"{prefix}{col}{row}"


def _shift_range_ref(ref: str, threshold: int, delta: int) -> str:
    if not ref or not delta:
        return ref
    chunks = []
    for token in str(ref).split():
        if ":" in token:
            a, b = token.split(":", 1)
            chunks.append(f"{_shift_cell_ref(a, threshold, delta)}:{_shift_cell_ref(b, threshold, delta)}")
        else:
            chunks.append(_shift_cell_ref(token, threshold, delta))
    return " ".join(chunks)


def _shift_formula(formula: str, threshold: int, delta: int) -> str:
    if not formula or not delta:
        return formula

    def repl(m: re.Match) -> str:
        sheet_prefix, col, abs_row, row_s = m.groups()
        row = int(row_s)
        # Absolute rows are still shifted when rows are inserted/deleted in Excel.
        if row >= threshold:
            row = max(1, row + delta)
        return f"{sheet_prefix or ''}{col}{abs_row}{row}"

    return CELL_IN_FORMULA_RE.sub(repl, formula)


def _normalize_text(value) -> str:
    text = str(value or "")
    text = text.lower().replace("đ", "d")
    # Lightweight Vietnamese accent folding without external dependencies.
    import unicodedata
    text = "".join(ch for ch in unicodedata.normalize("NFD", text) if unicodedata.category(ch) != "Mn")
    return re.sub(r"[^a-z0-9]+", " ", text).strip()


def _display_text(value) -> str:
    if value is None:
        return ""
    if isinstance(value, (str, int, float, bool)):
        return str(value)
    if isinstance(value, list):
        return "\n".join(x for x in (_display_text(v).strip() for v in value) if x)
    if isinstance(value, dict):
        for key in ("text", "value", "description", "specs", "label"):
            if key in value and value[key] not in (None, ""):
                return _display_text(value[key])
        parts = []
        for key, val in value.items():
            txt = _display_text(val).strip()
            if txt:
                parts.append(f"{key}: {txt}")
        return "\n".join(parts)
    return str(value)


def _shared_strings(parts: dict[str, bytes]) -> list[str]:
    data = parts.get("xl/sharedStrings.xml")
    if not data:
        return []
    root = _xml(data)
    out = []
    for si in root.findall(f"{M}si"):
        out.append("".join((t.text or "") for t in si.iter(f"{M}t")))
    return out


def _cell_value(cell: ET.Element, shared: list[str]) -> str:
    t = cell.get("t")
    if t == "inlineStr":
        return "".join((x.text or "") for x in cell.iter(f"{M}t"))
    v = cell.find(f"{M}v")
    value = v.text if v is not None and v.text is not None else ""
    if t == "s" and value:
        try:
            return shared[int(value)]
        except Exception:
            return value
    return value


def _relationship_target(rels_root: ET.Element, rid: str) -> str | None:
    for rel in rels_root.findall(f"{R}Relationship"):
        if rel.get("Id") == rid:
            return rel.get("Target")
    return None


def _normalize_part(base_dir: str, target: str) -> str:
    import posixpath
    if target.startswith("/"):
        return target.lstrip("/")
    return posixpath.normpath(posixpath.join(base_dir, target))


def _sheet_part(parts: dict[str, bytes], requested_name: str = "") -> tuple[str, str]:
    wb = _xml(parts["xl/workbook.xml"])
    rels = _xml(parts["xl/_rels/workbook.xml.rels"])
    sheets = wb.find(f"{M}sheets")
    choices = list(sheets) if sheets is not None else []
    selected = None
    if requested_name:
        selected = next((s for s in choices if s.get("name") == requested_name), None)
    selected = selected or (choices[0] if choices else None)
    if selected is None:
        raise ValueError("Workbook không có worksheet.")
    rid = selected.get(f"{DR}id")
    target = _relationship_target(rels, rid)
    if not target:
        raise ValueError("Không tìm thấy worksheet relationship.")
    return selected.get("name") or "", _normalize_part("xl", target)


def _row_map(sheet_root: ET.Element) -> dict[int, ET.Element]:
    data = sheet_root.find(f"{M}sheetData")
    return {int(r.get("r")): r for r in list(data or []) if r.get("r", "").isdigit()}


def _row_cells(row: ET.Element) -> list[ET.Element]:
    return list(row.findall(f"{M}c"))


def _row_text_map(row: ET.Element, shared: list[str]) -> dict[str, str]:
    out = {}
    for c in _row_cells(row):
        col, _ = _split_ref(c.get("r", ""))
        if col:
            out[col] = _cell_value(c, shared)
    return out


def _first_nonempty_cell(row: ET.Element, shared: list[str]) -> tuple[str, str] | tuple[None, str]:
    for c in sorted(_row_cells(row), key=lambda x: _col_to_num(_split_ref(x.get("r", ""))[0] or "A")):
        txt = _cell_value(c, shared).strip()
        if txt:
            return _split_ref(c.get("r", ""))[0], txt
    return None, ""


def _is_section_text(text: str) -> bool:
    norm = _normalize_text(text)
    return bool(re.match(r"^(?:[ivxlcdm]+|\d+)\s+(?:giai phap|he thong|hang muc)\b", norm, re.I)) or norm.startswith(("giai phap ", "he thong ", "hang muc "))


def _prefix(raw: str, fallback: str = "") -> str:
    text = re.sub(r"\s+", " ", str(raw or "")).strip()
    idx = text.find(":")
    if 0 <= idx <= 50:
        return text[: idx + 1] + " "
    return fallback


def analyze_template(raw: bytes, requested_sheet: str = "") -> dict:
    """Analyze raw OOXML and return a validated, export-ready manifest/mapping."""
    pkg = _read_package(raw)
    shared = _shared_strings(pkg.parts)
    sheet_name, sheet_path = _sheet_part(pkg.parts, requested_sheet)
    root = _xml(pkg.parts[sheet_path])
    rows = _row_map(root)
    if not rows:
        raise ValueError("Sheet Excel không có dữ liệu.")

    # Cell text index.
    cell_index: dict[str, str] = {}
    for rn, row in rows.items():
        for c in _row_cells(row):
            cell_index[c.get("r")] = _cell_value(c, shared)

    # Fields: same-cell label/value patterns. We deliberately do not invent companyName.
    fields = {
        "customerName": "", "customerPhone": "", "projectAddress": "", "projectName": "",
        "quoteDate": "", "quoteNumber": "", "companyName": "", "salesPerson": "", "salesPhone": "",
    }
    prefixes = {}
    hits = []
    phone_candidates = []
    field_specs = [
        ("customerName", ["khach hang", "ten khach hang"], "Khách hàng: "),
        ("projectAddress", ["dia diem cong trinh", "dia chi cong trinh"], "Địa điểm công trình: "),
        ("projectName", ["hang muc", "ten du an"], "Hạng mục: "),
        ("quoteNumber", ["so bao gia", "ma bao gia"], "Số báo giá: "),
        ("salesPerson", ["nguoi bao gia", "nhan vien bao gia"], "Người báo giá: "),
    ]
    max_col = 1
    for ref in cell_index:
        col, _ = _split_ref(ref)
        max_col = max(max_col, _col_to_num(col or "A"))
    midpoint = max(1, max_col // 2)

    for ref, raw_text in cell_index.items():
        col, rn = _split_ref(ref)
        if rn is None or rn > 90:
            continue
        norm = _normalize_text(raw_text)
        if not norm:
            continue
        for key, needles, fallback in field_specs:
            if fields[key]:
                continue
            if any(n in norm for n in needles):
                fields[key] = ref
                prefixes[key] = _prefix(raw_text, fallback)
                hits.append({"key": key, "ref": ref})
        if norm.startswith("ngay") and not fields["quoteDate"]:
            fields["quoteDate"] = ref; prefixes["quoteDate"] = _prefix(raw_text, "Ngày: "); hits.append({"key": "quoteDate", "ref": ref})
        if "dien thoai" in norm or norm.startswith("sdt"):
            phone_candidates.append((ref, col, rn, raw_text))

    # Resolve duplicate phone labels by position/proximity.
    customer_row = _split_ref(fields.get("customerName"))[1] if fields.get("customerName") else None
    sales_row = _split_ref(fields.get("salesPerson"))[1] if fields.get("salesPerson") else None
    if phone_candidates:
        ranked_customer = sorted(phone_candidates, key=lambda x: ((0 if _col_to_num(x[1]) <= midpoint else 1), abs((customer_row or x[2]) - x[2])))
        fields["customerPhone"] = ranked_customer[0][0]
        prefixes["customerPhone"] = _prefix(ranked_customer[0][3], "Điện thoại: ")
        remaining = [p for p in phone_candidates if p[0] != fields["customerPhone"]]
        if remaining:
            ranked_sales = sorted(remaining, key=lambda x: (abs((sales_row or x[2]) - x[2]), 0 if _col_to_num(x[1]) > midpoint else 1))
            fields["salesPhone"] = ranked_sales[0][0]
            prefixes["salesPhone"] = _prefix(ranked_sales[0][3], "Điện thoại: ")

    header_patterns = {
        "no": ["stt", "tt"],
        "note": ["khu vuc", "phong", "vi tri", "khu vuc lap dat"],
        "name": ["ten hang", "ten san pham", "hang hoa", "mo ta"],
        "specs": ["thong so", "tinh nang", "mo ta chi tiet"],
        "image": ["hinh anh", "anh"],
        "sku": ["ma thiet bi", "ma hang", "ma sp", "sku", "model"],
        "supplier": ["xuat xu", "thuong hieu", "nha cung cap", "hang"],
        "unit": ["dvt", "don vi tinh", "don vi"],
        "qty": ["so luong", "qty", "sl"],
        "unitPrice": ["don gia", "gia ban", "gia"],
        "lineTotal": ["thanh tien", "tong tien", "amount"],
    }
    best = (0, None, {})
    for rn in sorted(rows):
        if rn > 140:
            break
        found = {}
        score = 0
        textmap = _row_text_map(rows[rn], shared)
        for col, txt in textmap.items():
            norm = _normalize_text(txt)
            for key, needles in header_patterns.items():
                if key in found or not norm:
                    continue
                ok = False
                for needle in needles:
                    if key == "no":
                        ok = norm == needle or norm.startswith(needle + " ")
                    elif key == "unitPrice":
                        ok = needle in norm and "thanh tien" not in norm
                    elif key == "supplier" and needle == "hang":
                        ok = norm == "hang" or "thuong hieu" in norm
                    else:
                        ok = needle in norm
                    if ok:
                        break
                if ok:
                    found[key] = col
                    score += 2 if key in ("name", "qty", "unitPrice", "lineTotal", "sku") else 1
        if all(k in found for k in ("name", "qty", "unitPrice", "lineTotal")):
            score += 8
        if score > best[0]:
            best = (score, rn, found)

    _, header_row, columns = best
    if not header_row:
        raise ValueError("Không nhận diện được dòng header sản phẩm. Hãy chọn mapping thủ công.")

    # Fill only low-risk conventional defaults if header omitted an optional column.
    conventional = {"no": "A", "note": "B", "name": "C", "specs": "D", "image": "E", "sku": "F", "supplier": "G", "unit": "H", "qty": "I", "unitPrice": "J", "lineTotal": "K"}
    for k, v in conventional.items():
        columns.setdefault(k, v)

    # Summary first so totals can be searched in the financial block only, not in long footer text.
    totals = {"subtotal": "", "labor": "", "vat": "", "grandTotal": ""}
    total_hits = []
    summary_start = None
    summary_label_col = None
    summary_template_row = None
    total_col = columns.get("lineTotal") or "K"
    for rn in sorted(rows):
        textmap = _row_text_map(rows[rn], shared)
        row_norm = " ".join(_normalize_text(x) for x in textmap.values() if x)
        if summary_start is None and "tong hop" in row_norm and ("giai phap" in row_norm or "hang muc" in row_norm):
            summary_start = rn
            break

    total_scan_start = summary_start or header_row
    total_scan_end = min(max(rows), total_scan_start + 18) if summary_start else max(rows)
    for rn in range(total_scan_start, total_scan_end + 1):
        row = rows.get(rn)
        if row is None:
            continue
        textmap = _row_text_map(row, shared)
        labels = [_normalize_text(x) for x in textmap.values() if x]
        ref = f"{total_col}{rn}"
        if any(x.startswith("tong gia tri hop dong") or x.startswith("tong thanh toan") for x in labels):
            totals["grandTotal"] = ref; total_hits.append({"key": "grandTotal", "ref": ref})
        elif any(x.startswith("tong tien hang") or x.startswith("tam tinh") for x in labels):
            totals["subtotal"] = ref; total_hits.append({"key": "subtotal", "ref": ref})
        elif any(x.startswith("nhan cong") or x.startswith("chi phi nhan cong") for x in labels):
            totals["labor"] = ref; total_hits.append({"key": "labor", "ref": ref})
        elif any(x == "vat" or x.startswith("thue gtgt") for x in labels):
            totals["vat"] = ref; total_hits.append({"key": "vat", "ref": ref})

    subtotal_row = _split_ref(totals["subtotal"])[1] if totals["subtotal"] else None
    if summary_start and subtotal_row and summary_start + 1 < subtotal_row:
        summary_template_row = summary_start + 1
        summary_label_col, _ = _first_nonempty_cell(rows.get(summary_template_row), shared) if rows.get(summary_template_row) is not None else ("A", "")

    section_row = None
    section_label_col = None
    template_row = None
    start_row = None
    item_candidates: list[int] = []
    name_col, sku_col, qty_col, price_col = [columns.get(k) for k in ("name", "sku", "qty", "unitPrice")]
    scan_end = min(max(rows), header_row + 45)
    if summary_start:
        scan_end = min(scan_end, summary_start - 1)
    for rn in range(header_row + 1, scan_end + 1):  # CRITICAL: never treat the header itself as a product.
        row = rows.get(rn)
        if row is None:
            continue
        textmap = _row_text_map(row, shared)
        first_col, first_text = _first_nonempty_cell(row, shared)
        name_text = textmap.get(name_col, "")
        sku_text = textmap.get(sku_col, "")
        qty_text = textmap.get(qty_col, "")
        price_text = textmap.get(price_col, "")
        if section_row is None and first_text and _is_section_text(first_text) and not qty_text and not price_text:
            section_row, section_label_col = rn, first_col
            continue
        has_item = bool(name_text.strip()) and bool(str(sku_text).strip() or str(qty_text).strip() or str(price_text).strip())
        if has_item and not _is_section_text(first_text):
            item_candidates.append(rn)
            if start_row is None:
                start_row = rn

    if item_candidates:
        # Phase 12.5.2: header semantics still outrank historical merges, but the body-style donor
        # must also be representative. Old dealer workbooks often contain one-off very tall rows
        # for large photos. Cloning the first such row made every new product 200+ pt high. Pick the
        # clean row whose height is closest to the median clean product height instead.
        clean_candidates = [rn for rn in item_candidates if not _row_has_invalid_product_merge(root, rn, columns)]
        pool = clean_candidates or item_candidates
        def _candidate_height(rn):
            row = rows.get(rn)
            try:
                return float(row.get("ht") or 15) if row is not None else 15.0
            except Exception:
                return 15.0
        median_height = statistics.median([_candidate_height(rn) for rn in pool]) if pool else 15.0
        template_row = min(pool, key=lambda rn: (abs(_candidate_height(rn) - median_height), rn))

    if template_row is None:
        raise ValueError("Đã thấy header nhưng chưa nhận diện được dòng sản phẩm mẫu.")
    data_first = min(section_row or start_row, start_row)
    if summary_start:
        clear_until = summary_start - 1
    elif subtotal_row:
        clear_until = subtotal_row - 1
    else:
        clear_until = max(data_first, min(max(rows), data_first + 30))

    static_drawing_whitelist = _auto_static_picture_whitelist(
        pkg.parts, sheet_path, root, data_first, columns.get("image"), columns.get("sku")
    )

    mapping = {
        "sheetName": sheet_name,
        "fields": fields,
        "fieldPrefixes": prefixes,
        "items": {
            "headerRow": header_row,
            "sectionRow": section_row,
            "sectionLabelColumn": section_label_col or columns.get("no") or "A",
            "startRow": start_row,
            "templateRow": template_row,
            "clearUntilRow": clear_until,
            "columns": columns,
        },
        "summary": {
            "titleRow": summary_start,
            "templateRow": summary_template_row,
            "labelColumn": summary_label_col or "A",
            "totalColumn": total_col,
        },
        "totals": totals,
        # Phase 12.5.5: only identified static pictures survive export. Historical product
        # pictures are never inferred as static merely because their row sits below the dynamic block.
        "staticDrawingWhitelist": static_drawing_whitelist,
    }
    confidence = 35
    confidence += min(28, len([v for v in fields.values() if v]) * 4)
    confidence += min(25, len(columns) * 2)
    confidence += 8 if section_row else 0
    confidence += 8 if summary_start else 0
    confidence += min(12, len(total_hits) * 4)
    confidence = min(100, confidence)
    notes = [
        f"Header sản phẩm: dòng {header_row}.",
        f"Dòng section mẫu: {section_row or 'không có'}.",
        f"Dòng sản phẩm mẫu: {template_row}.",
        f"Vùng dữ liệu động: {data_first}–{clear_until}.",
    ]
    if summary_start:
        notes.append(f"Vùng tổng hợp bắt đầu ở dòng {summary_start}.")
    return {
        "mapping": mapping,
        "manifest": mapping,
        "detection": {
            "source": "lossless_xml_mapper_v2",
            "confidence": confidence,
            "sheetName": sheet_name,
            "headerRow": header_row,
            "sectionRow": section_row,
            "templateRow": template_row,
            "clearUntilRow": clear_until,
            "summaryStartRow": summary_start,
            "fieldHits": hits,
            "totalHits": total_hits,
            "notes": notes,
        },
        "sourceChecksum": sha256_bytes(raw),
        "manifestVersion": 3,
        "engineVersion": "lossless_xml_v3",
    }


def _merge_mapping(base: dict, hint: dict | None) -> dict:
    """Keep validated structural rows from the XML analyzer; accept safe manual cell/column overrides."""
    hint = hint or {}
    out = copy.deepcopy(base)
    for group in ("fields", "fieldPrefixes", "totals"):
        for k, v in (hint.get(group) or {}).items():
            if v not in (None, ""):
                out.setdefault(group, {})[k] = v
    hint_items = hint.get("items") or {}
    out_items = out.setdefault("items", {})
    for k, v in (hint_items.get("columns") or {}).items():
        if v:
            out_items.setdefault("columns", {})[k] = re.sub(r"[^A-Z]", "", str(v).upper())
    # Phase 12.5.2: old saved manifests must not silently override newly-fixed structural detection.
    # Existing Phase 12.4/12.5 templates frequently carry stale templateRow/startRow values, so
    # structural rows are accepted only after the user explicitly edits them in the new UI and the
    # mapping is marked structureMode=manual_v2. Column/field overrides remain backwards-compatible.
    header = int(out_items.get("headerRow") or 0)
    allow_structure_override = str(hint.get("structureMode") or "").lower() == "manual_v2"
    out["structureMode"] = "manual_v2" if allow_structure_override else "auto_fresh"
    if allow_structure_override:
        for key in ("sectionRow", "startRow", "templateRow", "clearUntilRow"):
            v = hint_items.get(key)
            try:
                v = int(v)
            except Exception:
                continue
            if v <= 0:
                continue
            if key in ("startRow", "templateRow") and v <= header:
                continue
            if key == "clearUntilRow" and v < int(out_items.get("startRow") or header + 1):
                continue
            out_items[key] = v
    if hint_items.get("sectionLabelColumn"):
        out_items["sectionLabelColumn"] = re.sub(r"[^A-Z]", "", str(hint_items["sectionLabelColumn"]).upper())
    # Summary manual overrides are low-risk if provided.
    for k, v in (hint.get("summary") or {}).items():
        if v not in (None, ""):
            out.setdefault("summary", {})[k] = v

    # Optional explicit static-picture whitelist. Auto-detected entries from the fresh source
    # remain authoritative; manual entries may add a known signature/stamp without allowing stale
    # structural manifests to bring historical product pictures back.
    existing = list(out.get("staticDrawingWhitelist") or [])
    for entry in (hint.get("staticDrawingWhitelist") or []):
        if not isinstance(entry, dict):
            continue
        clean = {k: str(entry.get(k) or "").strip() for k in ("name", "target")}
        if not clean["name"] and not clean["target"]:
            continue
        if not any((x.get("name") or "") == clean["name"] and (x.get("target") or "") == clean["target"] for x in existing):
            existing.append({**clean, "reason": str(entry.get("reason") or "manual")})
    out["staticDrawingWhitelist"] = existing
    return out


def _cell_for_ref(root: ET.Element, ref: str) -> ET.Element | None:
    col, row_num = _split_ref(ref)
    if not col:
        return None
    row = _row_map(root).get(row_num)
    if row is None:
        return None
    for c in _row_cells(row):
        if str(c.get("r", "")).replace("$", "").upper() == f"{col}{row_num}":
            return c
    return None


def _merge_refs(root: ET.Element) -> list[str]:
    parent = root.find(f"{M}mergeCells")
    return [m.get("ref") for m in list(parent or []) if m.get("ref")]


def _merged_top_left(root: ET.Element, ref: str) -> str:
    col, row = _split_ref(ref)
    if not col:
        return ref
    cnum = _col_to_num(col)
    for rng in _merge_refs(root):
        a, b = (rng.split(":", 1) + [rng])[:2] if ":" in rng else (rng, rng)
        ac, ar = _split_ref(a); bc, br = _split_ref(b)
        if ac and ar <= row <= br and _col_to_num(ac) <= cnum <= _col_to_num(bc):
            return f"{ac}{ar}"
    return ref


def _ensure_cell(row: ET.Element, col: str, row_num: int) -> ET.Element:
    target = f"{col}{row_num}"
    cells = _row_cells(row)
    for c in cells:
        if c.get("r") == target:
            return c
    c = ET.Element(f"{M}c", {"r": target})
    target_n = _col_to_num(col)
    inserted = False
    for idx, existing in enumerate(cells):
        ec, _ = _split_ref(existing.get("r", ""))
        if ec and _col_to_num(ec) > target_n:
            row.insert(list(row).index(existing), c)
            inserted = True
            break
    if not inserted:
        row.append(c)
    return c


def _clear_cell(cell: ET.Element):
    cell.attrib.pop("t", None)
    for child in list(cell):
        if child.tag in (f"{M}v", f"{M}f", f"{M}is"):
            cell.remove(child)


def _set_text(cell: ET.Element, value) -> None:
    _clear_cell(cell)
    text = _display_text(value)
    cell.set("t", "inlineStr")
    inline = ET.SubElement(cell, f"{M}is")
    t = ET.SubElement(inline, f"{M}t")
    if text.startswith(" ") or text.endswith(" ") or "\n" in text:
        t.set(f"{{{XML}}}space", "preserve")
    t.text = text


def _set_number(cell: ET.Element, value) -> None:
    _clear_cell(cell)
    try:
        n = float(value or 0)
        text = str(int(n)) if n.is_integer() else ("%.10f" % n).rstrip("0").rstrip(".")
    except Exception:
        text = "0"
    v = ET.SubElement(cell, f"{M}v")
    v.text = text


def _set_formula(cell: ET.Element, formula: str) -> None:
    _clear_cell(cell)
    f = ET.SubElement(cell, f"{M}f")
    f.text = str(formula or "").lstrip("=")


def _clear_row_values(row: ET.Element):
    for cell in _row_cells(row):
        _clear_cell(cell)


def _clone_row(template: ET.Element, target_row: int) -> ET.Element:
    row = copy.deepcopy(template)
    row.set("r", str(target_row))
    for c in _row_cells(row):
        col, _ = _split_ref(c.get("r", ""))
        if col:
            c.set("r", f"{col}{target_row}")
    _clear_row_values(row)
    return row


def _horizontal_merge_templates(root: ET.Element, template_row: int) -> list[tuple[str, str]]:
    out = []
    for ref in _merge_refs(root):
        if ":" not in ref:
            continue
        a, b = ref.split(":", 1)
        ac, ar = _split_ref(a); bc, br = _split_ref(b)
        if ar == template_row and br == template_row:
            out.append((ac, bc))
    return out


def _semantic_column_numbers(columns: dict) -> set[int]:
    """Columns in the product schema declared by the table header.

    Phase 12.5.1 rule: header semantics outrank historical row merges. If a product
    row merges two distinct mapped columns (for example Hình ảnh E + Mã thiết bị F),
    that merge is treated as historical presentation noise and is not cloned.
    """
    nums = set()
    for col in (columns or {}).values():
        n = _col_to_num(col)
        if n:
            nums.add(n)
    return nums


def _merge_bounds(ref: str):
    a, b = ref.split(":", 1) if ":" in str(ref or "") else (ref, ref)
    ac, ar = _split_ref(a); bc, br = _split_ref(b)
    if not ac or ar is None or not bc or br is None:
        return None
    return _col_to_num(ac), ar, _col_to_num(bc), br


def _merge_crosses_product_schema(ref: str, columns: dict) -> bool:
    bounds = _merge_bounds(ref)
    if not bounds:
        return False
    c1, _r1, c2, _r2 = bounds
    semantic = _semantic_column_numbers(columns)
    return len([c for c in semantic if c1 <= c <= c2]) >= 2


def _row_has_invalid_product_merge(root: ET.Element, row_num: int, columns: dict) -> bool:
    for ref in _merge_refs(root):
        bounds = _merge_bounds(ref)
        if not bounds:
            continue
        _c1, r1, _c2, r2 = bounds
        if r1 <= row_num <= r2 and _merge_crosses_product_schema(ref, columns):
            return True
    return False


def _canonical_product_merge_templates(root: ET.Element, template_row: int, columns: dict) -> tuple[list[tuple[str, str]], list[str]]:
    """Keep only merges that do not collapse distinct header-defined product fields."""
    kept, removed = [], []
    for ac, bc in _horizontal_merge_templates(root, template_row):
        ref = f"{ac}{template_row}:{bc}{template_row}"
        if _merge_crosses_product_schema(ref, columns):
            removed.append(ref)
        else:
            kept.append((ac, bc))
    return kept, removed


def _remove_invalid_product_merges(root: ET.Element, product_rows: Iterable[int], columns: dict) -> list[str]:
    """Final fail-safe: no generated product row may merge two semantic columns."""
    target_rows = {int(x) for x in product_rows}
    if not target_rows:
        return []
    kept, removed = [], []
    for ref in _merge_refs(root):
        bounds = _merge_bounds(ref)
        if not bounds:
            kept.append(ref); continue
        _c1, r1, _c2, r2 = bounds
        touches_product = any(r1 <= rn <= r2 for rn in target_rows)
        if touches_product and _merge_crosses_product_schema(ref, columns):
            removed.append(ref)
        else:
            kept.append(ref)
    if removed:
        _replace_merge_refs(root, kept)
    return removed


def _column_style_donors(root: ET.Element, rows: dict[int, ET.Element], columns: dict, first: int, last: int, preferred: int) -> tuple[dict[str, str], str | None]:
    """Find body style ids for mapped columns, preferring clean, unmerged product rows."""
    order = [preferred] + sorted((rn for rn in rows if first <= rn <= last and rn != preferred), key=lambda rn: abs(rn - preferred))
    donors: dict[str, str] = {}
    fallback = None
    semantic_nums = _semantic_column_numbers(columns)
    for rn in order:
        row = rows.get(rn)
        if row is None:
            continue
        invalid = _row_has_invalid_product_merge(root, rn, columns)
        for cell in _row_cells(row):
            col, _ = _split_ref(cell.get("r", ""))
            if not col or _col_to_num(col) not in semantic_nums:
                continue
            style = cell.get("s")
            if style is not None and fallback is None:
                fallback = style
            if not invalid and style is not None and col not in donors:
                donors[col] = style
        if len(donors) >= len(semantic_nums):
            break
    # If every historical row is malformed, still use per-column styles where cells exist.
    if len(donors) < len(semantic_nums):
        for rn in order:
            row = rows.get(rn)
            if row is None:
                continue
            for cell in _row_cells(row):
                col, _ = _split_ref(cell.get("r", ""))
                if col and _col_to_num(col) in semantic_nums and cell.get("s") is not None:
                    donors.setdefault(col, cell.get("s"))
    return donors, fallback


def _ensure_merge_parent(root: ET.Element) -> ET.Element:
    parent = root.find(f"{M}mergeCells")
    if parent is not None:
        return parent
    parent = ET.Element(f"{M}mergeCells", {"count": "0"})
    # mergeCells normally follows sheetData; insertion near conditionalFormatting is safe.
    data = root.find(f"{M}sheetData")
    idx = list(root).index(data) + 1 if data is not None else len(root)
    root.insert(idx, parent)
    return parent


def _replace_merge_refs(root: ET.Element, refs: Iterable[str]):
    parent = _ensure_merge_parent(root)
    for child in list(parent):
        parent.remove(child)
    unique = []
    seen = set()
    for ref in refs:
        if ref and ref not in seen:
            unique.append(ref); seen.add(ref)
    for ref in unique:
        ET.SubElement(parent, f"{M}mergeCell", {"ref": ref})
    parent.set("count", str(len(unique)))


def _replace_row_block(root: ET.Element, first: int, last: int, new_rows: list[ET.Element], merge_templates_by_row: list[list[tuple[str, str]]] | None = None) -> int:
    """Replace a contiguous row block and shift all following row-addressed XML structures."""
    data = root.find(f"{M}sheetData")
    if data is None:
        raise ValueError("Worksheet thiếu sheetData.")
    old_count = max(0, last - first + 1)
    delta = len(new_rows) - old_count

    # Capture/transform merge refs before rows are changed.
    new_merge_refs = []
    for ref in _merge_refs(root):
        a, b = ref.split(":", 1) if ":" in ref else (ref, ref)
        ac, ar = _split_ref(a); bc, br = _split_ref(b)
        if ar is None:
            new_merge_refs.append(ref); continue
        # Fully inside replaced block => generated from row templates instead.
        if first <= ar and br <= last:
            continue
        # Cross-boundary merge beginning above the block (e.g. L13:L14) is preserved if its
        # lower edge touches the first row. It is part of the header, not product content.
        if ar < first <= br <= last:
            new_merge_refs.append(ref)
            continue
        if ar > last:
            a = f"{ac}{ar + delta}"
            b = f"{bc}{br + delta}"
        elif br > last:
            b = f"{bc}{br + delta}"
        new_merge_refs.append(a if a == b else f"{a}:{b}")

    # Remove old rows BEFORE shifting. With a negative delta, shifting first could move footer
    # rows into the deletion range and silently delete them.
    for row in list(data):
        try:
            rn = int(row.get("r"))
        except Exception:
            continue
        if first <= rn <= last:
            data.remove(row)

    # Shift rows that originally lived after the old block.
    for row in list(data):
        try:
            rn = int(row.get("r"))
        except Exception:
            continue
        if rn > last and delta:
            nr = rn + delta
            row.set("r", str(nr))
            for c in _row_cells(row):
                col, _ = _split_ref(c.get("r", ""))
                if col:
                    c.set("r", f"{col}{nr}")
                f = c.find(f"{M}f")
                if f is not None and f.text:
                    f.text = _shift_formula(f.text, last + 1, delta)

    # Append then sort. sheetData row ordering is semantically significant.
    for row in new_rows:
        data.append(row)
    ordered = sorted(list(data), key=lambda r: int(r.get("r", "0")))
    for row in list(data):
        data.remove(row)
    for row in ordered:
        data.append(row)

    # Generated horizontal merges.
    if merge_templates_by_row:
        for row, merges in zip(new_rows, merge_templates_by_row):
            rn = int(row.get("r"))
            for ac, bc in merges:
                new_merge_refs.append(f"{ac}{rn}:{bc}{rn}")
    _replace_merge_refs(root, new_merge_refs)

    # Shift refs in common worksheet structures that live below the replaced block.
    for elem in root.iter():
        for attr in ("ref", "sqref"):
            val = elem.get(attr)
            if val and elem.tag not in (f"{M}mergeCell", f"{M}dimension"):
                try:
                    elem.set(attr, _shift_range_ref(val, last + 1, delta))
                except Exception:
                    pass
    return delta


def _update_dimension(root: ET.Element):
    rows = _row_map(root)
    max_row = max(rows) if rows else 1
    max_col = 1
    for row in rows.values():
        for c in _row_cells(row):
            col, _ = _split_ref(c.get("r", ""))
            if col:
                max_col = max(max_col, _col_to_num(col))
    dim = root.find(f"{M}dimension")
    if dim is not None:
        dim.set("ref", f"A1:{_num_to_col(max_col)}{max_row}")


def _set_sheet_cell(root: ET.Element, ref: str, value, kind: str = "text"):
    ref = _merged_top_left(root, ref)
    col, rn = _split_ref(ref)
    if not col:
        return
    rows = _row_map(root)
    row = rows.get(rn)
    if row is None:
        return
    cell = _ensure_cell(row, col, rn)
    if kind == "number": _set_number(cell, value)
    elif kind == "formula": _set_formula(cell, value)
    else: _set_text(cell, value)


def _shift_manifest_ref(ref: str, shifts: list[tuple[int, int]]) -> str:
    out = ref
    for threshold, delta in shifts:
        out = _shift_cell_ref(out, threshold, delta)
    return out


def _find_drawing_parts(parts: dict[str, bytes], sheet_path: str, sheet_root: ET.Element):
    drawing = sheet_root.find(f"{M}drawing")
    if drawing is None:
        return None
    rid = drawing.get(f"{DR}id")
    if not rid:
        return None
    import posixpath
    rels_path = posixpath.join(posixpath.dirname(sheet_path), "_rels", posixpath.basename(sheet_path) + ".rels")
    if rels_path not in parts:
        return None
    rels_root = _xml(parts[rels_path])
    target = _relationship_target(rels_root, rid)
    if not target:
        return None
    drawing_path = _normalize_part(posixpath.dirname(sheet_path), target)
    drawing_rels_path = posixpath.join(posixpath.dirname(drawing_path), "_rels", posixpath.basename(drawing_path) + ".rels")
    if drawing_path not in parts or drawing_rels_path not in parts:
        return None
    return drawing_path, drawing_rels_path, _xml(parts[drawing_path]), _xml(parts[drawing_rels_path])



def _drawing_relationship_targets(rels_root: ET.Element) -> dict[str, str]:
    return {rel.get("Id", ""): rel.get("Target", "") for rel in rels_root.findall(f"{R}Relationship")}


def _picture_identity(anchor: ET.Element, rel_targets: dict[str, str]) -> dict:
    pic = anchor.find(f"{XD}pic")
    if pic is None:
        return {"name": "", "target": "", "rid": ""}
    name_node = pic.find(f"{XD}nvPicPr/{XD}cNvPr")
    name = (name_node.get("name", "") if name_node is not None else "").strip()
    blip = pic.find(f".//{AN}blip")
    rid = (blip.get(f"{DR}embed", "") if blip is not None else "").strip()
    return {"name": name, "target": (rel_targets.get(rid) or "").strip(), "rid": rid}


def _whitelist_matches(identity: dict, whitelist: list[dict] | None) -> bool:
    name = str(identity.get("name") or "")
    target = str(identity.get("target") or "")
    for entry in whitelist or []:
        if not isinstance(entry, dict):
            continue
        wanted_name = str(entry.get("name") or "").strip()
        wanted_target = str(entry.get("target") or "").strip()
        if wanted_name and wanted_name != name:
            continue
        if wanted_target and wanted_target != target:
            continue
        if wanted_name or wanted_target:
            return True
    return False


def _auto_static_picture_whitelist(parts: dict[str, bytes], sheet_path: str, sheet_root: ET.Element,
                                   data_first: int, image_col: str | None, sku_col: str | None) -> list[dict]:
    """Identify conservative static pictures from the pristine template.

    Phase 12.5.5 deliberately does *not* treat "outside the current dynamic rows" as static.
    Historical product photos are often stranded far below the quote after years of row edits.
    We auto-keep header pictures (logos) and pictures that are horizontally outside the
    image/SKU neighborhood (typical footer signatures/branding). Anything at/under the product
    table that overlaps image/SKU columns must be explicitly whitelisted or it is removed.
    """
    found = _find_drawing_parts(parts, sheet_path, sheet_root)
    if not found:
        return []
    _drawing_path, _rels_path, drawing_root, drawing_rels = found
    rel_targets = _drawing_relationship_targets(drawing_rels)
    image_num = _col_to_num(image_col or "")
    sku_num = _col_to_num(sku_col or "")
    if not image_num:
        return []
    image_zero = image_num - 1
    sku_zero = sku_num - 1 if sku_num else image_zero
    zone_left = _column_left_emu(sheet_root, image_zero)
    zone_right = _column_left_emu(sheet_root, sku_zero) + _column_width_emu(sheet_root, sku_zero)
    data_top = _row_top_emu(sheet_root, max(1, int(data_first)))
    out = []
    for anchor in list(drawing_root):
        pic = anchor.find(f"{XD}pic")
        if pic is None or anchor.find(f".//{AN}blip") is None:
            continue
        identity = _picture_identity(anchor, rel_targets)
        # Never bless pictures generated by an older SmartQuote export as static template art.
        if identity["name"].startswith("SmartQuote product image "):
            continue
        bbox = _anchor_bbox_emu(sheet_root, anchor)
        if bbox is None:
            continue
        entirely_above_table = bbox[3] <= data_top
        touches_product_columns = bbox[2] > zone_left and bbox[0] < zone_right
        if entirely_above_table or not touches_product_columns:
            out.append({
                "name": identity["name"],
                "target": identity["target"],
                "reason": "header_static" if entirely_above_table else "outside_product_columns",
            })
    return out


def _validate_orphan_pictures(drawing_root: ET.Element, drawing_rels: ET.Element,
                              static_whitelist: list[dict] | None) -> dict:
    """Fail closed unless every visible picture is static-whitelisted or freshly generated."""
    rel_targets = _drawing_relationship_targets(drawing_rels)
    preserved_static = 0
    generated = 0
    violations = []
    for anchor in list(drawing_root):
        if anchor.find(f"{XD}pic") is None or anchor.find(f".//{AN}blip") is None:
            continue
        identity = _picture_identity(anchor, rel_targets)
        if identity["name"].startswith("SmartQuote product image "):
            generated += 1
            continue
        if _whitelist_matches(identity, static_whitelist):
            preserved_static += 1
            continue
        violations.append(identity["name"] or identity["target"] or "unnamed picture")
    if violations:
        raise ValueError("Orphan drawing validation failed: " + "; ".join(violations[:5]))
    return {
        "generatedPictures": generated,
        "preservedStaticPictures": preserved_static,
        "orphanViolations": 0,
    }


def _anchor_row(anchor: ET.Element, which: str = "from") -> int | None:
    node = anchor.find(f"{XD}{which}/{XD}row")
    try:
        return int(node.text) + 1 if node is not None else None
    except Exception:
        return None


def _set_anchor_row(anchor: ET.Element, row_one: int, which: str = "from"):
    node = anchor.find(f"{XD}{which}/{XD}row")
    if node is not None:
        node.text = str(max(0, int(row_one) - 1))


def _anchor_col(anchor: ET.Element, which: str = "from") -> int | None:
    node = anchor.find(f"{XD}{which}/{XD}col")
    try:
        return int(node.text) if node is not None else None
    except Exception:
        return None


def _set_anchor_col(anchor: ET.Element, col_zero: int, which: str = "from"):
    node = anchor.find(f"{XD}{which}/{XD}col")
    if node is not None:
        node.text = str(max(0, int(col_zero)))


def _set_anchor_offset(anchor: ET.Element, which: str, axis: str, emu: int):
    node = anchor.find(f"{XD}{which}/{XD}{axis}Off")
    if node is not None:
        node.text = str(max(0, int(emu)))


def _column_width_pixels(sheet_root: ET.Element, col_zero: int) -> int:
    """Convert stored Excel column width to pixels for drawing geometry.

    Phase 12.5.4 uses the result only to choose conservative offsets *inside* one cell.
    The actual hard boundary is encoded with a two-marker anchor whose from/to columns are
    both the image column, so a small rendering difference cannot move the picture into SKU.
    """
    fmt = sheet_root.find(f"{M}sheetFormatPr")
    width = 8.43
    if fmt is not None:
        try:
            if fmt.get("defaultColWidth"):
                width = float(fmt.get("defaultColWidth"))
        except Exception:
            pass
    cols = sheet_root.find(f"{M}cols")
    if cols is not None:
        one = col_zero + 1
        for c in list(cols):
            try:
                if int(c.get("min", "0")) <= one <= int(c.get("max", "0")):
                    if c.get("hidden") in ("1", "true", "True"):
                        return 0
                    if c.get("width"):
                        width = float(c.get("width"))
                    break
            except Exception:
                pass
    # Excel's width unit is based on the maximum digit width of the Normal font. For the
    # Calibri-compatible workbooks SmartQuote targets, this is the conventional conversion.
    if width < 1:
        px = int(math.floor(width * 12 + 0.5))
    else:
        px = int(math.floor(width * 7 + 5))
    return max(0, px)


def _column_width_emu(sheet_root: ET.Element, col_zero: int) -> int:
    return max(0, _column_width_pixels(sheet_root, col_zero) * 9525)


def _column_left_emu(sheet_root: ET.Element, col_zero: int) -> int:
    return sum(_column_width_emu(sheet_root, c) for c in range(max(0, int(col_zero))))


def _row_height_pixels(sheet_root: ET.Element, row_one: int) -> int:
    fmt = sheet_root.find(f"{M}sheetFormatPr")
    points = 15.0
    if fmt is not None:
        try:
            if fmt.get("defaultRowHeight"):
                points = float(fmt.get("defaultRowHeight"))
        except Exception:
            pass
    row = _row_map(sheet_root).get(int(row_one))
    if row is not None:
        try:
            if row.get("hidden") in ("1", "true", "True"):
                return 0
            points = float(row.get("ht") or points)
        except Exception:
            pass
    return max(0, int(round(points * 96 / 72)))


def _row_height_emu(sheet_root: ET.Element, row_one: int) -> int:
    return max(0, _row_height_pixels(sheet_root, row_one) * 9525)


def _row_top_emu(sheet_root: ET.Element, row_one: int) -> int:
    return sum(_row_height_emu(sheet_root, r) for r in range(1, max(1, int(row_one))))


def _image_dimensions(data: bytes) -> tuple[int, int] | None:
    """Read PNG/GIF/JPEG dimensions without Pillow so Vercel stays stdlib-only."""
    try:
        if data.startswith(b"\x89PNG\r\n\x1a\n") and len(data) >= 24:
            return struct.unpack(">II", data[16:24])
        if data.startswith((b"GIF87a", b"GIF89a")) and len(data) >= 10:
            return struct.unpack("<HH", data[6:10])
        if data[:3] == b"\xff\xd8\xff":
            i = 2
            while i + 9 < len(data):
                if data[i] != 0xFF:
                    i += 1; continue
                while i < len(data) and data[i] == 0xFF:
                    i += 1
                marker = data[i]; i += 1
                if marker in (0xD8, 0xD9) or 0xD0 <= marker <= 0xD7:
                    continue
                if i + 2 > len(data): break
                seglen = int.from_bytes(data[i:i+2], "big")
                if seglen < 2 or i + seglen > len(data): break
                if marker in (0xC0,0xC1,0xC2,0xC3,0xC5,0xC6,0xC7,0xC9,0xCA,0xCB,0xCD,0xCE,0xCF) and seglen >= 7:
                    h = int.from_bytes(data[i+3:i+5], "big")
                    w = int.from_bytes(data[i+5:i+7], "big")
                    if w and h: return w, h
                i += seglen
    except Exception:
        return None
    return None


def _hard_image_geometry(sheet_root: ET.Element, image_col: str | None, row_one: int,
                         image_data: bytes) -> tuple[int, int, int, int, int]:
    """Return inset image geometry (left, top, right, bottom, right_gutter) in EMU.

    Unlike 12.5.2/12.5.3, the geometry is expressed as two offsets *inside the same Excel
    cell*. A deliberately large right gutter is reserved before the next column. This makes
    the image/SKU separation a structural DrawingML boundary rather than a visual estimate.
    """
    n = _col_to_num(image_col or "")
    if not n:
        return 0, 0, 6 * 9525, 6 * 9525, 0
    col_zero = n - 1
    col_px = max(16, _column_width_pixels(sheet_root, col_zero))
    row_px = max(16, _row_height_pixels(sheet_root, row_one))

    # Reserve 20-25% of the image cell on the SKU side. Even if a viewer uses slightly
    # different font metrics for column width, the object remains visibly separated.
    left_pad = max(8, min(14, int(round(col_px * 0.14))))
    right_gutter = max(12, min(22, int(round(col_px * 0.24))))
    top_pad = max(4, min(10, int(round(row_px * 0.08))))
    bottom_pad = max(4, min(10, int(round(row_px * 0.08))))
    box_w = max(6, col_px - left_pad - right_gutter)
    box_h = max(6, row_px - top_pad - bottom_pad)

    dims = _image_dimensions(image_data) or (1, 1)
    iw, ih = max(1, dims[0]), max(1, dims[1])
    scale = min(box_w / iw, box_h / ih)
    draw_w = max(4, min(box_w, int(round(iw * scale))))
    draw_h = max(4, min(box_h, int(round(ih * scale))))
    left_px = left_pad + max(0, int(round((box_w - draw_w) / 2)))
    top_px = top_pad + max(0, int(round((box_h - draw_h) / 2)))
    right_px = min(col_px - right_gutter, left_px + draw_w)
    bottom_px = min(row_px - bottom_pad, top_px + draw_h)
    if right_px <= left_px:
        right_px = min(max(left_px + 1, left_px), max(left_px + 1, col_px - right_gutter))
    if bottom_px <= top_px:
        bottom_px = min(max(top_px + 1, top_px), max(top_px + 1, row_px - bottom_pad))
    return tuple(int(v * 9525) for v in (left_px, top_px, right_px, bottom_px, right_gutter))


def _new_hard_cell_image_anchor(pic_template: ET.Element, client_template: ET.Element | None,
                                col_zero: int, row_one: int, left_emu: int, top_emu: int,
                                right_emu: int, bottom_emu: int, rid: str, object_id: int) -> ET.Element:
    """Build a fresh two-marker anchor constrained to one worksheet cell.

    Both markers use the image column and product row. There is no absolute width extending
    toward the SKU column, so the object cannot inherit/serialize a historical cross-column
    drawing box. `editAs=oneCell` preserves the expected move-with-cell behavior.
    """
    anchor = ET.Element(f"{XD}twoCellAnchor", {"editAs": "oneCell"})
    fr = ET.SubElement(anchor, f"{XD}from")
    ET.SubElement(fr, f"{XD}col").text = str(max(0, col_zero))
    ET.SubElement(fr, f"{XD}colOff").text = str(max(0, int(left_emu)))
    ET.SubElement(fr, f"{XD}row").text = str(max(0, int(row_one) - 1))
    ET.SubElement(fr, f"{XD}rowOff").text = str(max(0, int(top_emu)))
    to = ET.SubElement(anchor, f"{XD}to")
    ET.SubElement(to, f"{XD}col").text = str(max(0, col_zero))
    ET.SubElement(to, f"{XD}colOff").text = str(max(0, int(right_emu)))
    ET.SubElement(to, f"{XD}row").text = str(max(0, int(row_one) - 1))
    ET.SubElement(to, f"{XD}rowOff").text = str(max(0, int(bottom_emu)))

    width_emu = max(1, int(right_emu) - int(left_emu))
    height_emu = max(1, int(bottom_emu) - int(top_emu))
    pic = copy.deepcopy(pic_template)
    cNvPr = pic.find(f"{XD}nvPicPr/{XD}cNvPr")
    if cNvPr is not None:
        cNvPr.set("id", str(object_id))
        cNvPr.set("name", f"SmartQuote product image {object_id}")
    blip = pic.find(f".//{AN}blip")
    if blip is not None:
        blip.set(f"{DR}embed", rid)
        blip.attrib.pop(f"{DR}link", None)
    xfrm_ext = pic.find(f"{XD}spPr/{AN}xfrm/{AN}ext")
    if xfrm_ext is not None:
        xfrm_ext.set("cx", str(width_emu)); xfrm_ext.set("cy", str(height_emu))
    xfrm_off = pic.find(f"{XD}spPr/{AN}xfrm/{AN}off")
    if xfrm_off is not None:
        xfrm_off.set("x", "0"); xfrm_off.set("y", "0")
    anchor.append(pic)
    if client_template is not None:
        anchor.append(copy.deepcopy(client_template))
    else:
        ET.SubElement(anchor, f"{XD}clientData")
    return anchor


def _marker_sheet_xy(sheet_root: ET.Element, marker: ET.Element | None) -> tuple[int, int] | None:
    if marker is None:
        return None
    try:
        col = int(marker.find(f"{XD}col").text)
        row_zero = int(marker.find(f"{XD}row").text)
        col_off = int((marker.find(f"{XD}colOff").text or "0"))
        row_off = int((marker.find(f"{XD}rowOff").text or "0"))
    except Exception:
        return None
    return (_column_left_emu(sheet_root, col) + col_off,
            _row_top_emu(sheet_root, row_zero + 1) + row_off)


def _anchor_bbox_emu(sheet_root: ET.Element, anchor: ET.Element) -> tuple[int, int, int, int] | None:
    """Return a picture anchor's sheet-space bounding box in EMU."""
    tag = anchor.tag.rsplit('}', 1)[-1]
    if tag == "twoCellAnchor":
        p1 = _marker_sheet_xy(sheet_root, anchor.find(f"{XD}from"))
        p2 = _marker_sheet_xy(sheet_root, anchor.find(f"{XD}to"))
        if not p1 or not p2:
            return None
        x1, y1 = p1; x2, y2 = p2
    elif tag == "oneCellAnchor":
        p1 = _marker_sheet_xy(sheet_root, anchor.find(f"{XD}from"))
        ext = anchor.find(f"{XD}ext")
        if not p1 or ext is None:
            return None
        try:
            cx, cy = int(ext.get("cx", "0")), int(ext.get("cy", "0"))
        except Exception:
            return None
        x1, y1 = p1; x2, y2 = x1 + cx, y1 + cy
    elif tag == "absoluteAnchor":
        pos, ext = anchor.find(f"{XD}pos"), anchor.find(f"{XD}ext")
        if pos is None or ext is None:
            return None
        try:
            x1, y1 = int(pos.get("x", "0")), int(pos.get("y", "0"))
            x2, y2 = x1 + int(ext.get("cx", "0")), y1 + int(ext.get("cy", "0"))
        except Exception:
            return None
    else:
        return None
    return min(x1, x2), min(y1, y2), max(x1, x2), max(y1, y2)


def _rects_intersect(a: tuple[int, int, int, int], b: tuple[int, int, int, int]) -> bool:
    return a[0] < b[2] and a[2] > b[0] and a[1] < b[3] and a[3] > b[1]


def _dynamic_image_sku_zone(sheet_root: ET.Element, first_row: int, last_row: int,
                            image_col_zero: int, sku_col_zero: int | None) -> tuple[int, int, int, int]:
    left = _column_left_emu(sheet_root, image_col_zero)
    right_col = sku_col_zero if sku_col_zero is not None else image_col_zero
    right = _column_left_emu(sheet_root, right_col) + _column_width_emu(sheet_root, right_col)
    top = _row_top_emu(sheet_root, first_row)
    bottom = _row_top_emu(sheet_root, last_row) + _row_height_emu(sheet_root, last_row)
    return left, top, right, bottom


def _validate_image_sku_boundary(sheet_root: ET.Element, drawing_root: ET.Element,
                                 product_rows: list[int], image_col_zero: int,
                                 sku_col_zero: int | None) -> dict:
    """Fail closed if a dynamic product picture reaches the SKU boundary."""
    if not product_rows:
        return {"checked": 0, "minimumGutterPx": None, "violations": 0}
    image_left = _column_left_emu(sheet_root, image_col_zero)
    image_width = _column_width_emu(sheet_root, image_col_zero)
    image_right = image_left + image_width
    sku_left = _column_left_emu(sheet_root, sku_col_zero) if sku_col_zero is not None else image_right
    required_gutter = max(8 * 9525, min(22 * 9525, int(image_width * 0.20)))
    hard_right = min(image_right, sku_left) - required_gutter
    min_gutter = None
    checked = 0
    violations = []
    row_set = set(int(r) for r in product_rows)

    for anchor in list(drawing_root):
        pic = anchor.find(f"{XD}pic")
        if pic is None:
            continue
        bbox = _anchor_bbox_emu(sheet_root, anchor)
        if bbox is None:
            continue
        fr = _anchor_row(anchor, "from")
        tr = _anchor_row(anchor, "to") or fr
        touches_product_row = (fr in row_set) or (tr in row_set)
        if not touches_product_row:
            # Catch floating anchors whose marker row is outside but whose actual box spills in.
            zone_top = min(_row_top_emu(sheet_root, r) for r in row_set)
            zone_bottom = max(_row_top_emu(sheet_root, r) + _row_height_emu(sheet_root, r) for r in row_set)
            touches_product_row = bbox[1] < zone_bottom and bbox[3] > zone_top
        if not touches_product_row:
            continue
        # Only pictures that horizontally touch the image/SKU neighborhood are relevant.
        if bbox[2] <= image_left or bbox[0] >= (sku_left + (_column_width_emu(sheet_root, sku_col_zero) if sku_col_zero is not None else 0)):
            continue
        checked += 1
        name_node = pic.find(f"{XD}nvPicPr/{XD}cNvPr")
        name = (name_node.get("name", "") if name_node is not None else "")
        is_generated = name.startswith("SmartQuote product image ")
        if is_generated:
            tag = anchor.tag.rsplit('}', 1)[-1]
            fc, tc = _anchor_col(anchor, "from"), _anchor_col(anchor, "to")
            if tag != "twoCellAnchor" or fc != image_col_zero or tc != image_col_zero:
                violations.append(f"generated anchor not hard-bound to image cell: {name}")
            to_off = anchor.find(f"{XD}to/{XD}colOff")
            try:
                to_off_v = int(to_off.text or "0") if to_off is not None else image_width
            except Exception:
                to_off_v = image_width
            if to_off_v > image_width - required_gutter:
                violations.append(f"generated anchor exceeds image-cell safe right edge: {name}")
        gutter = sku_left - bbox[2]
        min_gutter = gutter if min_gutter is None else min(min_gutter, gutter)
        if bbox[2] > hard_right:
            violations.append(f"picture reaches SKU boundary ({name or 'unnamed picture'})")

    if violations:
        raise ValueError("Image/SKU hard-boundary validation failed: " + "; ".join(violations[:5]))
    return {
        "checked": checked,
        "minimumGutterPx": None if min_gutter is None else round(min_gutter / 9525, 2),
        "requiredGutterPx": round(required_gutter / 9525, 2),
        "violations": 0,
    }


def _next_rid(rels_root: ET.Element) -> str:
    nums = []
    for rel in rels_root.findall(f"{R}Relationship"):
        m = re.match(r"rId(\d+)$", rel.get("Id", ""))
        if m: nums.append(int(m.group(1)))
    return f"rId{max(nums or [0]) + 1}"


def _image_type(data: bytes) -> tuple[str, str]:
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png", "image/png"
    if data[:3] == b"\xff\xd8\xff":
        return "jpeg", "image/jpeg"
    if data.startswith((b"GIF87a", b"GIF89a")):
        return "gif", "image/gif"
    # normalize uncommon inputs at caller if desired; JPEG is a conservative fallback name.
    return "jpeg", "image/jpeg"


def _ensure_content_type(parts: dict[str, bytes], overrides: dict[str, bytes], ext: str, mime: str):
    raw = overrides.get("[Content_Types].xml", parts.get("[Content_Types].xml"))
    if not raw:
        return
    root = _xml(raw)
    if not any(x.get("Extension", "").lower() == ext.lower() for x in root.findall(f"{CTN}Default")):
        ET.SubElement(root, f"{CTN}Default", {"Extension": ext, "ContentType": mime})
        overrides["[Content_Types].xml"] = _xml_bytes(root)


def _patch_drawings(pkg: Package, overrides: dict[str, bytes], added: dict[str, bytes],
                    sheet_path: str, sheet_root: ET.Element,
                    data_first: int, data_last: int, shifts: list[tuple[int, int]], template_row: int,
                    products: list[tuple[int, dict]], image_loader: Callable[[str], bytes | None] | None,
                    image_col: str | None = None, sku_col: str | None = None,
                    static_drawing_whitelist: list[dict] | None = None) -> dict:
    """Replace dynamic product pictures with hard cell-bound anchors and validate them.

    Phase 12.5.5 is whitelist-based. Historical pictures are removed unless the fresh analyzer
    identifies them as static template art (or an explicit whitelist adds them). This catches stale
    product photos stranded far below the dynamic quote region. New product images are then created
    with from/to markers inside the image cell itself and validated separately.
    """
    found = _find_drawing_parts(pkg.parts, sheet_path, sheet_root)
    if not found:
        return {"checked": 0, "minimumGutterPx": None, "violations": 0, "removedHistoricalPictures": 0}
    drawing_path, drawing_rels_path, dr_root, dr_rels = found
    anchors = list(dr_root)
    rel_targets = _drawing_relationship_targets(dr_rels)
    static_drawing_whitelist = list(static_drawing_whitelist or [])
    image_num = _col_to_num(image_col or "")
    sku_num = _col_to_num(sku_col or "")
    image_col_zero = image_num - 1 if image_num else None
    sku_col_zero = sku_num - 1 if sku_num else None
    if image_col_zero is None:
        return {"checked": 0, "minimumGutterPx": None, "violations": 0, "removedHistoricalPictures": 0}

    pic_template = None
    client_template = None
    current_last = max([data_last] + [r for r, _ in products])
    zone = _dynamic_image_sku_zone(sheet_root, data_first, current_last, image_col_zero, sku_col_zero)

    def _picture_intersects_dynamic_zone(anchor: ET.Element) -> bool:
        if anchor.find(f"{XD}pic") is None or anchor.find(f".//{AN}blip") is None:
            return False
        bbox = _anchor_bbox_emu(sheet_root, anchor)
        return bool(bbox and _rects_intersect(bbox, zone))

    # Capture only picture shape/style from a historical product image. The anchor itself is never
    # copied. Bounding-box intersection catches stale oneCellAnchor/absoluteAnchor objects that
    # begin outside E but visually spill into E/F.
    for anchor in anchors:
        if _picture_intersects_dynamic_zone(anchor):
            pic = anchor.find(f"{XD}pic")
            if pic is not None:
                pic_template = copy.deepcopy(pic)
                client = anchor.find(f"{XD}clientData")
                client_template = copy.deepcopy(client) if client is not None else None
                break

    # If the dynamic zone had no picture (some templates keep an empty image column), fall back to
    # the nearest historical picture on/around the template row, still copying shape only.
    if pic_template is None:
        candidates = []
        for anchor in anchors:
            pic = anchor.find(f"{XD}pic")
            if pic is None or anchor.find(f".//{AN}blip") is None:
                continue
            fr = _anchor_row(anchor, "from")
            fc = _anchor_col(anchor, "from")
            if fr is None or fc is None:
                continue
            candidates.append((abs(fr - int(template_row)) + abs(fc - image_col_zero), anchor))
        if candidates:
            _, anchor = min(candidates, key=lambda x: x[0])
            pic_template = copy.deepcopy(anchor.find(f"{XD}pic"))
            client = anchor.find(f"{XD}clientData")
            client_template = copy.deepcopy(client) if client is not None else None

    removed_historical = 0
    removed_orphans = []
    preserved_static = []
    for anchor in list(dr_root):
        is_picture = anchor.find(f"{XD}pic") is not None and anchor.find(f".//{AN}blip") is not None
        if is_picture:
            identity = _picture_identity(anchor, rel_targets)
            if not _whitelist_matches(identity, static_drawing_whitelist):
                dr_root.remove(anchor)
                removed_historical += 1
                removed_orphans.append(identity)
                continue
            preserved_static.append(identity)

        # Whitelisted static pictures and non-picture drawings below a resized dynamic block still
        # need row shifting. Historical product pictures never reach this branch.
        fr = _anchor_row(anchor, "from")
        if fr is not None:
            new_fr = fr
            to = _anchor_row(anchor, "to")
            new_to = to
            for threshold, delta in shifts:
                if new_fr >= threshold:
                    new_fr += delta
                if new_to is not None and new_to >= threshold:
                    new_to += delta
            if new_fr != fr:
                _set_anchor_row(anchor, new_fr, "from")
            if to is not None and new_to != to:
                _set_anchor_row(anchor, new_to, "to")

    if pic_template is not None and image_loader is not None:
        max_id = 0
        for c in dr_root.iter(f"{XD}cNvPr"):
            try:
                max_id = max(max_id, int(c.get("id", "0")))
            except Exception:
                pass
        media_index = 1
        while any(f"xl/media/sq_image_{media_index}.{ext}" in pkg.parts or f"xl/media/sq_image_{media_index}.{ext}" in added
                  for ext in ("png", "jpeg", "gif")):
            media_index += 1
        for row_num, product in products:
            src = _display_text(product.get("image") or product.get("imageUrl") or "").strip()
            if not src:
                continue
            try:
                data = image_loader(src)
            except Exception:
                data = None
            if not data:
                continue
            ext, mime = _image_type(data)
            media_path = f"xl/media/sq_image_{media_index}.{ext}"
            media_index += 1
            added[media_path] = data
            _ensure_content_type(pkg.parts, overrides, ext, mime)
            rid = _next_rid(dr_rels)
            ET.SubElement(dr_rels, f"{R}Relationship", {
                "Id": rid,
                "Type": f"{DOC_REL}/image",
                "Target": "../media/" + media_path.rsplit("/", 1)[-1],
            })
            left, top, right, bottom, _gutter = _hard_image_geometry(sheet_root, image_col, row_num, data)
            max_id += 1
            anchor = _new_hard_cell_image_anchor(pic_template, client_template, image_col_zero, row_num,
                                                  left, top, right, bottom, rid, max_id)
            dr_root.append(anchor)

    validation = _validate_image_sku_boundary(sheet_root, dr_root,
                                              [r for r, _ in products], image_col_zero, sku_col_zero)
    orphan_validation = _validate_orphan_pictures(dr_root, dr_rels, static_drawing_whitelist)
    validation["removedHistoricalPictures"] = removed_historical
    validation["removedOrphanPictures"] = removed_historical
    validation["preservedStaticPictures"] = len(preserved_static)
    validation["staticDrawingWhitelist"] = static_drawing_whitelist
    validation["orphanDrawingValidation"] = orphan_validation
    validation["anchorMode"] = "fresh_two_marker_same_cell_v4"
    validation["drawingCleanupMode"] = "static_whitelist_v5"
    overrides[drawing_path] = _xml_bytes(dr_root)
    overrides[drawing_rels_path] = _xml_bytes(dr_rels)
    return validation


def _remove_calc_chain(pkg: Package, overrides: dict[str, bytes], removed: set[str]):
    if "xl/calcChain.xml" not in pkg.parts:
        return
    removed.add("xl/calcChain.xml")
    # Remove workbook relationship to calcChain.
    rel_path = "xl/_rels/workbook.xml.rels"
    rel_root = _xml(pkg.parts[rel_path])
    for rel in list(rel_root):
        if str(rel.get("Type", "")).endswith("/calcChain"):
            rel_root.remove(rel)
    overrides[rel_path] = _xml_bytes(rel_root)
    # Remove content type override.
    ct_root = _xml(overrides.get("[Content_Types].xml", pkg.parts["[Content_Types].xml"]))
    for node in list(ct_root):
        if node.get("PartName") == "/xl/calcChain.xml":
            ct_root.remove(node)
    overrides["[Content_Types].xml"] = _xml_bytes(ct_root)


def _force_recalc(pkg: Package, overrides: dict[str, bytes]):
    root = _xml(pkg.parts["xl/workbook.xml"])
    calc = root.find(f"{M}calcPr")
    if calc is None:
        calc = ET.SubElement(root, f"{M}calcPr")
    calc.set("calcMode", "auto")
    calc.set("fullCalcOnLoad", "1")
    calc.set("forceFullCalc", "1")
    overrides["xl/workbook.xml"] = _xml_bytes(root)


def _flatten_sections(data: dict) -> list[dict]:
    sections = []
    for sec in data.get("sections") or []:
        if not isinstance(sec, dict):
            continue
        rows = [r for r in (sec.get("rows") or []) if isinstance(r, dict)]
        if rows:
            sections.append({"name": _display_text(sec.get("name") or rows[0].get("room") or "Hạng mục"), "rows": rows})
    if sections:
        return sections
    rows = [r for r in (data.get("rows") or []) if isinstance(r, dict)]
    grouped = []
    by = {}
    for row in rows:
        name = _display_text(row.get("room") or row.get("note") or "Hạng mục")
        if name not in by:
            by[name] = {"name": name, "rows": []}; grouped.append(by[name])
        by[name]["rows"].append(row)
    return grouped


def build_lossless_workbook(raw: bytes, data: dict, mapping_hint: dict | None = None,
                            image_loader: Callable[[str], bytes | None] | None = None) -> tuple[bytes, dict]:
    """Patch an XLSX while preserving every untouched package part byte-for-byte."""
    analyzed = analyze_template(raw, (mapping_hint or {}).get("sheetName") or "")
    mapping = _merge_mapping(analyzed["mapping"], mapping_hint)
    pkg = _read_package(raw)
    sheet_name, sheet_path = _sheet_part(pkg.parts, mapping.get("sheetName") or "")
    root = _xml(pkg.parts[sheet_path])
    rows_original = _row_map(root)
    items = mapping.get("items") or {}
    columns = items.get("columns") or {}
    summary = mapping.get("summary") or {}
    totals = mapping.get("totals") or {}
    sections = _flatten_sections(data)
    company = data.get("company") or {}
    customer = data.get("customer") or {}
    calc = data.get("calc") or {}

    header_row = int(items.get("headerRow") or 0)
    section_row = int(items.get("sectionRow") or 0) or None
    start_row = int(items.get("startRow") or 0)
    template_row = int(items.get("templateRow") or start_row)
    clear_until = int(items.get("clearUntilRow") or start_row)
    if not start_row or start_row <= header_row or template_row <= header_row:
        raise ValueError("Mapping không hợp lệ: dòng sản phẩm không được trùng/đứng trên header.")
    data_first = min(section_row or start_row, start_row)
    data_last = max(clear_until, template_row, section_row or 0)
    section_tpl = rows_original.get(section_row) if section_row else None
    item_tpl = rows_original.get(template_row)
    if item_tpl is None:
        raise ValueError("Không tìm thấy dòng sản phẩm mẫu trong worksheet gốc.")

    section_merges = _horizontal_merge_templates(root, section_row) if section_row else []
    item_merges, suppressed_template_merges = _canonical_product_merge_templates(root, template_row, columns)
    style_donors, fallback_body_style = _column_style_donors(root, rows_original, columns, data_first, data_last, template_row)
    summary_template_row = int(summary.get("templateRow") or 0) or None
    summary_tpl = rows_original.get(summary_template_row) if summary_template_row else None
    summary_merges = _horizontal_merge_templates(root, summary_template_row) if summary_template_row else []

    # Build dynamic data rows from raw row XML — style ids and row dimensions are inherited exactly.
    generated_rows: list[ET.Element] = []
    generated_merge_templates = []
    current = data_first
    section_totals: list[str] = []
    product_image_rows: list[tuple[int, dict]] = []
    line_col = columns.get("lineTotal") or "K"
    section_label_col = items.get("sectionLabelColumn") or columns.get("no") or "A"
    for sec in sections:
        item_total_refs = []
        section_total_ref = None
        if section_tpl is not None:
            row = _clone_row(section_tpl, current)
            _set_text(_ensure_cell(row, section_label_col, current), sec.get("name") or "Hạng mục")
            section_total_ref = f"{line_col}{current}"
            generated_rows.append(row); generated_merge_templates.append(section_merges)
            current += 1
        for product in sec.get("rows") or []:
            row = _clone_row(item_tpl, current)
            for key, col in columns.items():
                if not col:
                    continue
                cell = _ensure_cell(row, col, current)
                if cell.get("s") is None:
                    donor_style = style_donors.get(col) or fallback_body_style
                    if donor_style is not None:
                        cell.set("s", donor_style)
                if key == "image":
                    _clear_cell(cell)
                    continue
                if key == "lineTotal":
                    qty_col = columns.get("qty"); price_col = columns.get("unitPrice")
                    if qty_col and price_col:
                        _set_formula(cell, f"{qty_col}{current}*{price_col}{current}")
                    else:
                        _set_number(cell, product.get("lineTotal") or 0)
                    item_total_refs.append(f"{col}{current}")
                    continue
                value = product.get(key, "")
                if key in ("qty", "unitPrice"):
                    _set_number(cell, value)
                else:
                    _set_text(cell, value)
            generated_rows.append(row); generated_merge_templates.append(item_merges)
            product_image_rows.append((current, product))
            current += 1
        if section_total_ref:
            # Locate section row in generated list robustly.
            sec_row_elem = next((r for r in generated_rows if int(r.get("r")) == int(_split_ref(section_total_ref)[1])), None)
            if sec_row_elem is not None:
                c = _ensure_cell(sec_row_elem, line_col, int(sec_row_elem.get("r")))
                if item_total_refs:
                    first_ref, last_ref = item_total_refs[0], item_total_refs[-1]
                    _set_formula(c, f"SUM({first_ref}:{last_ref})")
                else:
                    _set_number(c, 0)
            section_totals.append(section_total_ref)

    if not generated_rows:
        generated_rows = [_clone_row(item_tpl, data_first)]
        generated_merge_templates = [item_merges]

    delta_data = _replace_row_block(root, data_first, data_last, generated_rows, generated_merge_templates)
    normalized_product_merges = _remove_invalid_product_merges(root, [rn for rn, _ in product_image_rows], columns)
    shifts: list[tuple[int, int]] = [(data_last + 1, delta_data)] if delta_data else []

    # Summary data rows are a second dynamic block. The title row itself is retained and shifts with data.
    delta_summary = 0
    summary_title_orig = int(summary.get("titleRow") or 0) or None
    subtotal_orig_row = _split_ref(totals.get("subtotal") or "")[1]
    summary_total_refs: list[str] = []
    if summary_title_orig and summary_tpl is not None and subtotal_orig_row:
        summary_title = summary_title_orig + delta_data
        subtotal_after_data = subtotal_orig_row + delta_data
        old_first = summary_title + 1
        old_last = subtotal_after_data - 1
        new_summary_rows = []
        new_summary_merges = []
        label_col = summary.get("labelColumn") or "A"
        summary_total_col = summary.get("totalColumn") or line_col
        for idx, sec in enumerate(sections):
            rn = old_first + idx
            row = _clone_row(summary_tpl, rn)
            _set_text(_ensure_cell(row, label_col, rn), sec.get("name") or f"Hạng mục {idx + 1}")
            c = _ensure_cell(row, summary_total_col, rn)
            if idx < len(section_totals):
                # Data block starts at same first row, so section refs already carry their final rows.
                _set_formula(c, section_totals[idx])
            else:
                _set_number(c, 0)
            new_summary_rows.append(row); new_summary_merges.append(summary_merges)
            summary_total_refs.append(f"{summary_total_col}{rn}")
        # Keep at least one summary row if template has a summary block but the quote is empty.
        if not new_summary_rows:
            new_summary_rows = [_clone_row(summary_tpl, old_first)]; new_summary_merges = [summary_merges]
        if old_last >= old_first:
            delta_summary = _replace_row_block(root, old_first, old_last, new_summary_rows, new_summary_merges)
            if delta_summary:
                shifts.append((old_last + 1, delta_summary))

    # Write customer/company fields after all row shifts so references point at final positions.
    today = date.today().strftime("%d/%m/%Y")
    values = {
        "customerName": customer.get("name") or "",
        "customerPhone": customer.get("phone") or "",
        "projectAddress": customer.get("address") or "",
        "projectName": customer.get("project") or customer.get("category") or "",
        "quoteDate": today,
        "quoteNumber": customer.get("quoteNumber") or company.get("quoteNumber") or "",
        "companyName": company.get("name") or "",
        "salesPerson": company.get("salesPerson") or "",
        "salesPhone": company.get("salesPhone") or company.get("phone") or "",
    }
    for key, ref in (mapping.get("fields") or {}).items():
        if not ref:
            continue
        final_ref = _shift_manifest_ref(ref, shifts)
        prefix = (mapping.get("fieldPrefixes") or {}).get(key) or ""
        _set_sheet_cell(root, final_ref, f"{prefix}{_display_text(values.get(key, ''))}", "text")

    # Final total refs and formulas.
    final_totals = {k: _shift_manifest_ref(v, shifts) if v else "" for k, v in totals.items()}
    subtotal_ref = final_totals.get("subtotal")
    labor_ref = final_totals.get("labor")
    vat_ref = final_totals.get("vat")
    grand_ref = final_totals.get("grandTotal")
    if subtotal_ref:
        refs = summary_total_refs if summary_total_refs else section_totals
        if refs:
            _set_sheet_cell(root, subtotal_ref, f"SUM({refs[0]}:{refs[-1]})", "formula")
        else:
            _set_sheet_cell(root, subtotal_ref, calc.get("deviceTotal") or 0, "number")
    if labor_ref:
        device_total = float(calc.get("deviceTotal") or 0)
        labor_total = float(calc.get("laborTotal") or 0)
        if subtotal_ref and device_total > 0 and labor_total > 0:
            _set_sheet_cell(root, labor_ref, f"{subtotal_ref}*{labor_total / device_total:.10f}", "formula")
        else:
            _set_sheet_cell(root, labor_ref, labor_total, "number")
    if vat_ref:
        _set_sheet_cell(root, vat_ref, 0, "number")
    if grand_ref:
        refs = [r for r in (subtotal_ref, labor_ref, vat_ref) if r]
        if refs:
            _set_sheet_cell(root, grand_ref, "+".join(refs), "formula")
        else:
            _set_sheet_cell(root, grand_ref, calc.get("grand") or 0, "number")

    _update_dimension(root)
    overrides = {sheet_path: _xml_bytes(root)}
    removed: set[str] = set()
    added: dict[str, bytes] = {}
    image_boundary = _patch_drawings(pkg, overrides, added, sheet_path, root, data_first, data_last, shifts,
                                     template_row, product_image_rows, image_loader,
                                     columns.get("image"), columns.get("sku"),
                                     mapping.get("staticDrawingWhitelist") or [])
    _remove_calc_chain(pkg, overrides, removed)
    _force_recalc(pkg, overrides)
    out = _write_package(pkg, overrides, removed, added)

    report = {
        "engineVersion": "lossless_xml_v3",
        "manifestVersion": 3,
        "sourceChecksum": sha256_bytes(raw),
        "outputChecksum": sha256_bytes(out),
        "sheetName": sheet_name,
        "dataRegion": {"first": data_first, "last": data_last, "generatedRows": len(generated_rows), "delta": delta_data},
        "summaryDelta": delta_summary,
        "sections": len(sections),
        "products": sum(len(s.get("rows") or []) for s in sections),
        "mapping": mapping,
        "dynamicMergeNormalization": {
            "version": 5,
            "headerSchemaColumns": columns,
            "suppressedTemplateMerges": suppressed_template_merges,
            "removedFinalMerges": normalized_product_merges,
            "imageColumn": columns.get("image") or "",
            "skuColumn": columns.get("sku") or "",
            "imageGeometry": "hard_cell_boundary_two_marker_v4",
            "imageBoundaryValidation": image_boundary,
            "structureMode": mapping.get("structureMode") or "auto_fresh",
        },
        "modifiedParts": sorted(overrides),
        "removedParts": sorted(removed),
        "addedParts": sorted(added),
    }
    return out, report


def fidelity_report(source: bytes, output: bytes, allowed_modified: set[str] | None = None) -> dict:
    """Compare OOXML parts. Untouched parts must have identical decompressed bytes."""
    a, b = _read_package(source), _read_package(output)
    allowed_modified = allowed_modified or set()
    all_names = set(a.parts) | set(b.parts)
    identical, changed, missing, added = [], [], [], []
    for name in sorted(all_names):
        if name not in a.parts: added.append(name); continue
        if name not in b.parts: missing.append(name); continue
        if a.parts[name] == b.parts[name]: identical.append(name)
        else: changed.append(name)
    static_expected = [n for n in a.parts if n not in allowed_modified]
    static_identical = [n for n in static_expected if n in b.parts and a.parts[n] == b.parts[n]]
    score = 100.0 if not static_expected else round(100 * len(static_identical) / len(static_expected), 2)
    return {
        "sourceParts": len(a.parts), "outputParts": len(b.parts),
        "identicalParts": identical, "changedParts": changed, "missingParts": missing, "addedParts": added,
        "staticPartFidelityPct": score,
        "sourceBytes": len(source), "outputBytes": len(output),
    }
