# SmartQuote P2.3.4 RC3 — Pilot hardening status

RC3 is a narrow real-file gate fix. No new product feature is added.

## Change from RC2
- Fix Bisco `Quy Cách` provenance duplication caused by merged Excel cells.
- `normalizeWorkbook` may expand merged cells for table parsing, but `extractSheetDocumentContext` now ignores replicated `_merged` cells when reading document metadata.
- Added regression proving `Quy Cách: Cổng Âm sàn tự động` remains exactly one value through merged-cell expansion.
- Roger PDF parser is unchanged from RC2; Roger real-file gate already passed 88/88 on the user's golden PDF.

## Release rule
RC3 is not pilot-ready until both real-file gates pass on the user's machine, followed by offline regression and production build.
