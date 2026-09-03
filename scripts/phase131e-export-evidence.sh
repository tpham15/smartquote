#!/usr/bin/env bash
set -euo pipefail
PRIVATE_ROOT="${1:-}"
OUT="${2:-}"
if [[ -z "$PRIVATE_ROOT" ]]; then echo "Usage: $0 /private/root [output.tar.gz]" >&2; exit 2; fi
PRIVATE_ROOT="$(cd "$PRIVATE_ROOT" && pwd)"
BUNDLE="$PRIVATE_ROOT/reports/phase13.1E-evidence-bundle"
[[ -f "$BUNDLE/evidence-manifest.json" ]] || { echo "Seal evidence first." >&2; exit 3; }
OUT="${OUT:-$PRIVATE_ROOT/phase13.1E-paddle-evidence.tar.gz}"
tar -C "$(dirname "$BUNDLE")" -czf "$OUT" "$(basename "$BUNDLE")"
echo "$OUT"
