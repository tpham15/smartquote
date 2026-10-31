# Pilot RC8 status

Status: **CANDIDATE — NOT YET PILOT-APPROVED**

Local pure-JS regressions passed in the build workspace:
- P2.3.7 RC8 hardening smoke
- P2.3.6 RC7 alias preservation
- P2.3.6 RC6 identity/provenance
- P2.3.5 importer hardening
- P1.5.3.2 Bisco identity regression
- P2.3.3 taxonomy
- P2.3 engineering rules
- P2.0 learning memory
- P1.5.4 identity safety

Real-file gates were not executable in the container because the local dependency tree is incomplete (`xlsx` / `pdfjs-dist`). Do not infer a real-file PASS from these local regressions. Run the real gates on the Mac repository before accepting RC8.
