# BOM fixtures

These files are used by `npm run smoke:bom` to catch regressions on real-world BOM/takeoff shapes.

Included:
- `architect-smarthome-lighting.xlsx`: real architect/MEP workbook with ĐTM and landscape lighting sheets.

Recommended next fixtures when available:
- HVAC vertical-list workbook using headers like `STT | TÊN GỌI VÀ QUY CÁCH | ĐƠN VỊ | SỐ LƯỢNG`.
- Matrix/cross-tab takeoff workbook where rows are floors/areas and columns are devices.

The smoke test already includes generated regression workbooks for HVAC-header and matrix routing, but adding the original real files here will make CI stronger.
