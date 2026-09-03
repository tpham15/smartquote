#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PRIVATE_ROOT="${1:-}"
PROFILE="${2:-cpu}"
MODE="${3:-online}"
if [[ -z "$PRIVATE_ROOT" ]]; then
  echo "Usage: $0 /absolute/path/to/private-corpus [cpu|gpu-cu126] [online|offline]" >&2
  exit 2
fi
PRIVATE_ROOT="$(cd "$PRIVATE_ROOT" && pwd)"
[[ -f "$PRIVATE_ROOT/manifest-paddle-pdf-subset.json" ]] || { echo "Missing private Paddle manifest" >&2; exit 2; }
CACHE_DIR="${SQ_PADDLE_MODEL_CACHE:-$HOME/.cache/smartquote-paddleocr-vl-1.6}"
mkdir -p "$CACHE_DIR" "$PRIVATE_ROOT/reports"
case "$PROFILE" in
  cpu)
    IMAGE="smartquote/paddleocr-vl:13.1d-cpu"
    DEVICE="cpu"
    GPU_ARGS=()
    REQUIRE_DEVICE="cpu"
    ;;
  gpu|gpu-cu126)
    IMAGE="smartquote/paddleocr-vl:13.1d-gpu-cu126"
    DEVICE="gpu:0"
    GPU_ARGS=(--gpus all)
    REQUIRE_DEVICE="gpu"
    ;;
  *) echo "Unknown profile: $PROFILE" >&2; exit 2 ;;
esac
command -v docker >/dev/null || { echo "Docker is required." >&2; exit 3; }
docker image inspect "$IMAGE" >/dev/null 2>&1 || "$ROOT/scripts/phase131d-build-runtime.sh" "$PROFILE" >/dev/null
IMAGE_ID="$(docker image inspect --format='{{.Id}}' "$IMAGE")"
OFFLINE_ARGS=()
OFFLINE_ENV=()
if [[ "$MODE" == "offline" ]]; then
  OFFLINE_ARGS=(--offline)
  OFFLINE_ENV=(-e PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK=True)
fi

# Preflight is separated from the benchmark so a bad runtime can never emit predictions.
docker run --rm --platform linux/amd64 "${GPU_ARGS[@]}" "${OFFLINE_ENV[@]}" \
  -e PADDLE_PDX_CACHE_HOME=/model-cache \
  -e SQ_PADDLEOCR_VL_PIPELINE_VERSION=v1.6 \
  -e SQ_PADDLEOCR_VL_BACKEND=native \
  -e SQ_PADDLEOCR_VL_DEVICE="$DEVICE" \
  -e SQ_PADDLE_RUNTIME_IMAGE_ID="$IMAGE_ID" \
  -v "$ROOT:/workspace:ro" \
  -v "$PRIVATE_ROOT:/private" \
  -v "$CACHE_DIR:/model-cache" \
  -w /workspace \
  "$IMAGE" \
  python scripts/phase131d-runtime-doctor.py --private-root /private --require-device "$REQUIRE_DEVICE" --out /private/reports/phase13.1D-runtime-doctor.json "${OFFLINE_ARGS[@]}" >/dev/null

# Run the same frozen 13.1C decision pipeline inside the locked execution image.
docker run --rm --platform linux/amd64 "${GPU_ARGS[@]}" "${OFFLINE_ENV[@]}" \
  -e PADDLE_PDX_CACHE_HOME=/model-cache \
  -e SQ_PADDLEOCR_PYTHON=python \
  -e SQ_PADDLEOCR_VL_PIPELINE_VERSION=v1.6 \
  -e SQ_PADDLEOCR_VL_BACKEND=native \
  -e SQ_PADDLEOCR_VL_DEVICE="$DEVICE" \
  -e SQ_PADDLE_RUNTIME_IMAGE_ID="$IMAGE_ID" \
  -e SQ_PADDLEOCR_RAW_DIR=/private/raw/phase13.1D-paddleocr-vl-1.6 \
  -v "$ROOT:/workspace:ro" \
  -v "$PRIVATE_ROOT:/private" \
  -v "$CACHE_DIR:/model-cache" \
  -w /workspace \
  "$IMAGE" \
  node scripts/phase131d-run-execution.mjs /private --doctor /private/reports/phase13.1D-runtime-doctor.json --profile "$PROFILE" --mode "$MODE"
