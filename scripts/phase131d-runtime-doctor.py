#!/usr/bin/env python3
from __future__ import annotations

import argparse
import importlib
import json
import os
import platform
import shutil
import socket
import subprocess
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
LOCK_PATH = ROOT / "benchmarks" / "vietnam-docbench" / "runtime" / "paddleocr-vl-1.6" / "runtime-lock.json"


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def package_version(name: str):
    try:
        mod = importlib.import_module(name)
        return getattr(mod, "__version__", "unknown")
    except Exception:
        return None


def parse_version(v: str | None):
    if not v:
        return None
    out = []
    for part in str(v).split("."):
        digits = "".join(ch for ch in part if ch.isdigit())
        if not digits:
            break
        out.append(int(digits))
    return tuple(out)


def memory_gib():
    try:
        meminfo = Path("/proc/meminfo")
        if meminfo.exists():
            for line in meminfo.read_text().splitlines():
                if line.startswith("MemTotal:"):
                    kb = int(line.split()[1])
                    return round(kb / 1024 / 1024, 2)
        if sys.platform == "darwin":
            r = subprocess.run(["sysctl", "-n", "hw.memsize"], capture_output=True, text=True, timeout=3)
            if r.returncode == 0:
                return round(int(r.stdout.strip()) / (1024**3), 2)
    except Exception:
        pass
    return None


def node_version():
    exe = shutil.which("node")
    if not exe:
        return None
    try:
        r = subprocess.run([exe, "--version"], capture_output=True, text=True, timeout=3)
        if r.returncode == 0:
            return r.stdout.strip().lstrip("v")
    except Exception:
        pass
    return None


def gpu_probe():
    exe = shutil.which("nvidia-smi")
    if not exe:
        return {"nvidiaSmi": False, "gpus": []}
    try:
        r = subprocess.run(
            [exe, "--query-gpu=name,memory.total,driver_version", "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=5,
        )
        gpus = []
        if r.returncode == 0:
            for line in r.stdout.splitlines():
                parts = [x.strip() for x in line.split(",")]
                if len(parts) >= 3:
                    gpus.append({"name": parts[0], "memoryMiB": int(parts[1]), "driver": parts[2]})
        return {"nvidiaSmi": True, "gpus": gpus, "error": None if r.returncode == 0 else r.stderr.strip()}
    except Exception as exc:
        return {"nvidiaSmi": True, "gpus": [], "error": str(exc)}


def dns_probe(hosts):
    results = []
    for host in hosts:
        try:
            socket.getaddrinfo(host, 443)
            results.append({"host": host, "dnsReady": True})
        except Exception as exc:
            results.append({"host": host, "dnsReady": False, "error": str(exc)})
    return results


def cache_probe(cache_root: Path):
    official = cache_root / "official_models"
    files = 0
    bytes_total = 0
    dirs = []
    if official.exists():
        try:
            dirs = sorted([p.name for p in official.iterdir() if p.is_dir()])
            for p in official.rglob("*"):
                if p.is_file():
                    files += 1
                    try:
                        bytes_total += p.stat().st_size
                    except OSError:
                        pass
        except OSError:
            pass
    return {
        "path": str(cache_root),
        "officialModelsPath": str(official),
        "officialModelsPresent": official.is_dir() and bool(dirs),
        "modelDirectories": dirs,
        "fileCount": files,
        "bytes": bytes_total,
    }


def corpus_probe(private_root: Path | None):
    if private_root is None:
        return None
    required = [
        private_root / "manifest.json",
        private_root / "manifest-paddle-pdf-subset.json",
        private_root / "freeze-lock.json",
    ]
    docs_ok = True
    doc_count = None
    subset = required[1]
    if subset.exists():
        try:
            manifest = read_json(subset)
            docs = manifest.get("documents", [])
            doc_count = len(docs)
            for d in docs:
                src = d.get("sourceFile") or d.get("source") or d.get("sourcePath") or d.get("path")
                if src:
                    p = Path(src)
                    if not p.is_absolute():
                        p = private_root / src
                    if not p.exists():
                        docs_ok = False
        except Exception:
            docs_ok = False
    return {
        "path": str(private_root),
        "requiredFilesPresent": all(p.exists() for p in required),
        "subsetDocuments": doc_count,
        "documentSourcesResolvable": docs_ok,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--private-root")
    parser.add_argument("--out")
    parser.add_argument("--offline", action="store_true")
    parser.add_argument("--require-device", choices=["cpu", "gpu"])
    args = parser.parse_args()

    lock = read_json(LOCK_PATH)
    cache_root = Path(os.getenv("PADDLE_PDX_CACHE_HOME", str(Path.home() / ".paddlex"))).expanduser().resolve()
    private_root = Path(args.private_root).expanduser().resolve() if args.private_root else None

    paddleocr_v = package_version("paddleocr")
    paddlex_v = package_version("paddlex")
    paddle_v = package_version("paddle")
    class_ready = False
    class_error = None
    try:
        from paddleocr import PaddleOCRVL  # noqa: F401
        class_ready = True
    except Exception as exc:
        class_error = str(exc)

    gpu = gpu_probe()
    device = os.getenv("SQ_PADDLEOCR_VL_DEVICE", "cpu")
    version_checks = {
        "paddleocr": paddleocr_v == lock["packages"]["paddleocr"],
        "paddlepaddle": paddle_v == lock["packages"]["paddlepaddle"],
    }
    py = sys.version_info[:2]
    python_ok = py == (3, 12)
    node_v = node_version()
    node_ok = node_v == lock.get("node")
    platform_ok = platform.system().lower() == "linux" and platform.machine().lower() in {"x86_64", "amd64"}
    device_ok = True
    if args.require_device == "gpu":
        device_ok = bool(gpu.get("gpus"))
    if args.require_device == "cpu":
        device_ok = True

    cache = cache_probe(cache_root)
    hosts = ["pypi.org", "www.paddlepaddle.org.cn", "paddle-model-ecology.bj.bcebos.com"]
    network = dns_probe(hosts)
    network_ready = all(x["dnsReady"] for x in network)
    corpus = corpus_probe(private_root)
    corpus_ok = True if corpus is None else (corpus["requiredFilesPresent"] and corpus["documentSourcesResolvable"])

    runtime_ready = python_ok and node_ok and platform_ok and class_ready and paddle_v is not None and all(version_checks.values()) and device_ok and corpus_ok
    if runtime_ready and cache["officialModelsPresent"]:
        status = "READY"
        blocker = None
    elif runtime_ready and args.offline:
        status = "BLOCKED_MODEL_CACHE"
        blocker = "Offline execution requested but PaddleX official model cache is empty. Warm the cache online first."
    elif runtime_ready and network_ready:
        status = "READY"
        blocker = None
    elif runtime_ready:
        status = "READY_RUNTIME_BLOCKED_MODEL_DOWNLOAD"
        blocker = "Runtime is installed, but model cache is empty and model/package hosts are not DNS-reachable."
    else:
        status = "BLOCKED_RUNTIME"
        problems = []
        if not python_ok:
            problems.append(f"Python must equal locked major.minor {lock['python']['requiredMajorMinor']} (observed {sys.version_info.major}.{sys.version_info.minor})")
        if not node_ok:
            problems.append(f"Node must equal {lock.get('node')} (observed {node_v or 'missing'})")
        if not platform_ok:
            problems.append(f"locked platform is linux/x86_64 (observed {platform.system().lower()}/{platform.machine()})")
        if not class_ready:
            problems.append("PaddleOCRVL class import is unavailable")
        if not version_checks["paddleocr"]:
            problems.append(f"paddleocr must equal {lock['packages']['paddleocr']} (observed {paddleocr_v or 'missing'})")
        if not version_checks["paddlepaddle"]:
            problems.append(f"paddle must equal {lock['packages']['paddlepaddle']} (observed {paddle_v or 'missing'})")
        if not device_ok:
            problems.append("requested GPU runtime has no visible NVIDIA GPU")
        if not corpus_ok:
            problems.append("private frozen corpus is incomplete or source files do not resolve")
        blocker = "; ".join(problems) or "Runtime is not ready"

    disk = shutil.disk_usage(str(cache_root.parent if cache_root.parent.exists() else Path.cwd()))
    result = {
        "schemaVersion": "sq-phase131d-runtime-doctor-v1",
        "phase": "13.1D",
        "status": status,
        "blocker": blocker,
        "lock": lock,
        "runtime": {
            "python": sys.version.split()[0],
            "node": node_v,
            "platform": platform.platform(),
            "machine": platform.machine(),
            "cpuCount": os.cpu_count(),
            "memoryGiB": memory_gib(),
            "freeDiskGiB": round(disk.free / (1024**3), 2),
            "paddleocr": paddleocr_v,
            "paddlex": paddlex_v,
            "paddle": paddle_v,
            "PaddleOCRVLImportReady": class_ready,
            "PaddleOCRVLImportError": class_error,
            "device": device,
            "gpu": gpu,
        },
        "checks": {
            "pythonLockedVersion": python_ok,
            "nodeLockedVersion": node_ok,
            "platformLocked": platform_ok,
            "lockedVersions": version_checks,
            "deviceReady": device_ok,
            "corpusReady": corpus_ok,
            "offlineRequested": bool(args.offline),
            "modelCacheReady": cache["officialModelsPresent"],
            "networkDnsReady": network_ready,
        },
        "cache": cache,
        "network": network,
        "corpus": corpus,
        "productionPromotionAllowed": False,
    }
    text = json.dumps(result, ensure_ascii=False, indent=2) + "\n"
    if args.out:
        out = Path(args.out).expanduser().resolve()
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(text, encoding="utf-8")
    print(text, end="")
    return 0 if status == "READY" else 3


if __name__ == "__main__":
    raise SystemExit(main())
