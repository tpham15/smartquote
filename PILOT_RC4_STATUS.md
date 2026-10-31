# SmartQuote P2.3.4 RC4 — Pilot hardening status

RC4 is a narrow Bisco real-file gate fix. No new product feature is added.

## Change
- Preserve the explicit source commercial product line as Product Name authority.
- Model/SKU/sheet tokens (for example V2) cannot be injected into Product Name unless the source commercial line contains them.
- Roger PDF parser is unchanged from RC3.

## Required gates
1. Bisco real-file gate
2. Roger real-file gate
3. smoke:pilot:offline
4. production build

RC4 is not pilot-ready until all gates pass on the user's machine.
