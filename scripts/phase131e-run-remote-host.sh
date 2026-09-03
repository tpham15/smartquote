#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PRIVATE_ROOT="${1:-}"
PROFILE="${2:-gpu-cu126}"
MODE="${3:-online}"
if [[ -z "$PRIVATE_ROOT" ]]; then
  echo "Usage: $0 /absolute/path/to/private-corpus [gpu-cu126|cpu] [online|offline]" >&2
  exit 2
fi
PRIVATE_ROOT="$(cd "$PRIVATE_ROOT" && pwd)"
ATTEMPT="$PRIVATE_ROOT/reports/phase13.1E-host-attempt"
mkdir -p "$ATTEMPT"
{
  echo "utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "uname=$(uname -a)"
  echo "profile=$PROFILE"
  echo "mode=$MODE"
  echo "docker=$(docker --version 2>/dev/null || true)"
  echo "nvidia_smi=$(nvidia-smi --query-gpu=name,driver_version,memory.total --format=csv,noheader 2>/dev/null | tr '\n' ';' || true)"
} > "$ATTEMPT/host.txt"
set +e
bash "$ROOT/scripts/phase131d-run-docker.sh" "$PRIVATE_ROOT" "$PROFILE" "$MODE" >"$ATTEMPT/run.stdout.txt" 2>"$ATTEMPT/run.stderr.txt"
CODE=$?
set -e
printf '%s\n' "$CODE" > "$ATTEMPT/run.exit-code.txt"
if [[ $CODE -ne 0 ]]; then
  echo "Phase 13.1E remote execution blocked/failed. See $ATTEMPT" >&2
  exit "$CODE"
fi
node "$ROOT/scripts/phase131e-seal-evidence.mjs" "$PRIVATE_ROOT"
echo "Phase 13.1E evidence ready: $PRIVATE_ROOT/reports/phase13.1E-evidence-bundle"
