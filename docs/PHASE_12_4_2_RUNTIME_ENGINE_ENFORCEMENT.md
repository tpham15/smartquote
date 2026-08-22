# Phase 12.4.2 — Runtime Lossless Engine Enforcement

## Problem confirmed from production export
The production XLSX still had only 11 OOXML parts, no media/drawings/printer settings, and a tiny styles.xml. That signature matches the old rebuilt-workbook path, not lossless v3.

## Fix
- Lossless v3 is now the server default when exportMode is omitted.
- `/api/excel-template` returns `X-SmartQuote-Excel-Engine: lossless_xml_v3` and `X-SmartQuote-Excel-Manifest: 3`.
- CORS exposes the diagnostic headers.
- Frontend refuses to download any template export unless both headers confirm the Phase 12.4 engine.
- Legacy v2 remains available only when explicitly requested by regression tests/legacy tooling.

This turns template export into a fail-closed contract: a stale Vercel function can no longer silently produce a low-fidelity workbook.
