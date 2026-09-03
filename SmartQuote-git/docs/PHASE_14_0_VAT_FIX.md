# Phase 14.0 VAT fix

- Company default VAT: 8% for companies that do not yet have a saved VAT setting.
- Per-quote VAT override in the quote summary.
- VAT base: goods + labor/programming.
- Grand total: goods + labor + VAT.
- PDF export includes VAT.
- Generic Excel export includes a VAT row and VAT in grand total.
- Lossless dealer Excel templates use the mapped VAT cell when present.
- Templates without a VAT cell still include VAT directly in the grand-total formula/value.
- Saved cloud quotes retain the quote VAT through `calc.vatPercent` / `calc.vatTotal`.
