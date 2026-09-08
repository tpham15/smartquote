# Phase 14.0A — Scan PDF Page-Image Vision

## Why

The pilot Lumi Lighting PDF is 1,446,491 bytes. Base64 expands it to about 1.93M characters.
The previous "page-by-page" implementation attached that same full PDF to every Claude call and only changed the prompt to ask for page N. `/api/claude` defaults to a 1.2MB request-body cap and a 950k-character PDF document-block cap, so all seven page calls failed with HTTP 413 before Claude could read the page.

## Fix

- Render the actual requested PDF page in the browser with PDF.js.
- Use `page.getViewport(...)`, which honors the PDF page rotation seen by users.
- Encode the page as JPEG and adapt quality/scale until base64 is <= 760k characters.
- Send one Claude `image` block per page, not the whole PDF document.
- Allow/cap image blocks in `/api/claude` (`850k` base64 by default).
- If a recovery page still yields zero rows, split that page into three overlapping horizontal bands and retry each band.
- Scan PDFs no longer fall back to re-sending the whole document after page-image failure.
- If deterministic `/api/pdf-extract` itself fails, SmartQuote can still start page-image vision directly and obtain the page count from PDF.js.

## Acceptance target for the Lumi Lighting pilot

- 7 pages processed without 413.
- Expected catalog cardinality: 48 physical STT rows.
- Partial-page failures do not abort rows already recovered.
- Low-recall result remains visible as a warning instead of silently passing.

Runtime accuracy (48/48) still requires an authenticated deployed Claude call; the local smoke test validates the regression boundary and payload architecture without requiring secrets.
