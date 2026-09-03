#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROFILE="${1:-cpu}"
RUNTIME_DIR="$ROOT/benchmarks/vietnam-docbench/runtime/paddleocr-vl-1.6"
case "$PROFILE" in
  cpu)
    IMAGE="smartquote/paddleocr-vl:13.1d-cpu"
    DOCKERFILE="$RUNTIME_DIR/Dockerfile.cpu"
    ;;
  gpu|gpu-cu126)
    IMAGE="smartquote/paddleocr-vl:13.1d-gpu-cu126"
    DOCKERFILE="$RUNTIME_DIR/Dockerfile.gpu-cu126"
    ;;
  *)
    echo "Usage: $0 [cpu|gpu-cu126]" >&2
    exit 2
    ;;
esac
command -v docker >/dev/null || { echo "Docker is required for Phase 13.1D runtime build." >&2; exit 3; }
echo "Building $IMAGE from $(basename "$DOCKERFILE")"
docker build --pull --platform linux/amd64 -f "$DOCKERFILE" -t "$IMAGE" "$ROOT"
echo "$IMAGE"
