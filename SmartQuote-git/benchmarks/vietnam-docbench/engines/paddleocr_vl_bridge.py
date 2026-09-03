#!/usr/bin/env python3
"""Phase 13.1A bridge for the *full* PaddleOCR-VL pipeline.

This is benchmark-only. It intentionally invokes PaddleOCRVL (layout + VLM + assembly),
not the standalone 0.9B VLM component, because those are not equivalent according to
PaddleOCR's official documentation.
"""
from __future__ import annotations

import argparse
import importlib
import json
import os
import platform
import sys
import time
from pathlib import Path


def version_of(name: str):
    try:
        mod = importlib.import_module(name)
        return getattr(mod, "__version__", "unknown")
    except Exception:
        return None


def runtime_probe():
    paddleocr_version = version_of("paddleocr")
    paddlex_version = version_of("paddlex")
    paddle_version = version_of("paddle")
    class_import_ready = False
    class_import_error = None
    try:
        from paddleocr import PaddleOCRVL  # noqa: F401
        class_import_ready = True
    except Exception as exc:
        class_import_error = str(exc)
    backend = os.getenv("SQ_PADDLEOCR_VL_BACKEND", "native").strip() or "native"
    server_configured = bool(os.getenv("SQ_PADDLEOCR_VL_SERVER_URL"))
    native_ready = class_import_ready and paddle_version is not None
    remote_ready = class_import_ready and backend != "native" and server_configured
    return {
        "schemaVersion": "sq-paddleocr-vl-runtime-probe-v1",
        "python": sys.version.split()[0],
        "platform": platform.platform(),
        "paddleocr": paddleocr_version,
        "paddlex": paddlex_version,
        "paddle": paddle_version,
        "pipelineVersion": os.getenv("SQ_PADDLEOCR_VL_PIPELINE_VERSION", "v1.6"),
        "backend": backend,
        "device": os.getenv("SQ_PADDLEOCR_VL_DEVICE", "cpu"),
        "serverConfigured": server_configured,
        "apiKeyConfigured": bool(os.getenv("SQ_PADDLEOCR_VL_API_KEY")),
        "classImportReady": class_import_ready,
        "classImportError": class_import_error,
        "ready": native_ready if backend == "native" else remote_ready,
    }


def json_safe(value):
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, dict):
        return {str(k): json_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [json_safe(v) for v in value]
    if hasattr(value, "tolist"):
        return json_safe(value.tolist())
    return str(value)


def build_pipeline():
    try:
        from paddleocr import PaddleOCRVL
    except Exception as exc:
        raise RuntimeError(
            "PaddleOCR is not installed. Create an isolated Python environment and install the official PaddleOCR/PaddlePaddle runtime before benchmarking."
        ) from exc

    pipeline_version = os.getenv("SQ_PADDLEOCR_VL_PIPELINE_VERSION", "v1.6")
    backend = os.getenv("SQ_PADDLEOCR_VL_BACKEND", "native").strip() or "native"
    kwargs = {
        "pipeline_version": pipeline_version,
        "device": os.getenv("SQ_PADDLEOCR_VL_DEVICE", "cpu"),
        "use_layout_detection": True,
        "use_doc_orientation_classify": True,
        "use_doc_unwarping": True,
        "format_block_content": True,
    }
    if backend != "native":
        server_url = os.getenv("SQ_PADDLEOCR_VL_SERVER_URL", "").strip()
        if not server_url:
            raise RuntimeError(f"SQ_PADDLEOCR_VL_SERVER_URL is required for backend={backend}")
        kwargs["vl_rec_backend"] = backend
        kwargs["vl_rec_server_url"] = server_url
        model_name = os.getenv("SQ_PADDLEOCR_VL_API_MODEL_NAME", "").strip()
        api_key = os.getenv("SQ_PADDLEOCR_VL_API_KEY", "").strip()
        if model_name:
            kwargs["vl_rec_api_model_name"] = model_name
        if api_key:
            kwargs["vl_rec_api_key"] = api_key
    return PaddleOCRVL(**kwargs), {"pipelineVersion": pipeline_version, "backend": backend}


def run(input_path: str):
    pipeline, config = build_pipeline()
    started = time.time()
    output = pipeline.predict(input=input_path)
    pages = []
    for res in output:
        data = getattr(res, "json", None)
        if callable(data):
            data = data()
        if data is None:
            data = getattr(res, "res", None)
        if data is None:
            raise RuntimeError("PaddleOCR-VL Result object exposes neither json nor res")
        pages.append(json_safe(data))
    return {
        "schemaVersion": "sq-paddleocr-vl-raw-v1",
        "engine": "PaddleOCR-VL",
        "config": config,
        "runtimeMs": round((time.time() - started) * 1000),
        "pages": pages,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--probe", action="store_true")
    parser.add_argument("--input")
    parser.add_argument("--out")
    args = parser.parse_args()

    if args.probe:
        print(json.dumps(runtime_probe(), ensure_ascii=False, indent=2))
        return 0
    if not args.input or not args.out:
        parser.error("--input and --out are required unless --probe is used")
    source = Path(args.input)
    if not source.exists():
        raise FileNotFoundError(source)
    payload = run(str(source))
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"ok": True, "runtimeMs": payload["runtimeMs"], "pages": len(payload["pages"]), "out": str(out)}))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        raise SystemExit(1)
