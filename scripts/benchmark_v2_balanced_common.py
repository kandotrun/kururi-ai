#!/usr/bin/env python3
"""Measure the common two-model Kururi balanced path on an Intel CPU."""

from __future__ import annotations

import argparse
import json
import math
import platform
import resource
import statistics
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
import onnxruntime as ort

from benchmark_v2_balanced import MODELS, aligned, sha256


def percentile(values: list[float], fraction: float) -> float:
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, math.ceil(len(ordered) * fraction) - 1)]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-dir", type=Path, required=True)
    parser.add_argument("--threads", type=int, required=True)
    parser.add_argument("--trials", type=int, default=20)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    options = ort.SessionOptions()
    options.intra_op_num_threads = max(1, args.threads // 2)
    options.inter_op_num_threads = 1
    options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
    options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    options.enable_cpu_mem_arena = False
    options.enable_mem_pattern = False
    options.add_session_config_entry("session.intra_op.allow_spinning", "0")
    options.add_session_config_entry("session.inter_op.allow_spinning", "0")

    rng = np.random.default_rng(20261021)
    paths = {}
    inputs = {}
    sessions = {}
    for name, stem, side, _ in MODELS:
        path = args.model_dir / f"{stem}.int8.onnx"
        paths[name] = path
        inputs[name] = rng.standard_normal((4, 3, side, side), dtype=np.float32)
        sessions[name] = ort.InferenceSession(
            str(path),
            sess_options=options,
            providers=["CPUExecutionProvider"],
        )

    for name in ("base224", "small288", "small224"):
        aligned(sessions[name], inputs[name])
    executor = ThreadPoolExecutor(max_workers=2)
    timings = []
    for _ in range(args.trials):
        started = time.perf_counter()
        base = executor.submit(aligned, sessions["base224"], inputs["base224"])
        small288 = executor.submit(aligned, sessions["small288"], inputs["small288"])
        base.result()
        small288.result()
        timings.append((time.perf_counter() - started) * 1000)

    rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    peak_rss_mib = rss / (1024 * 1024) if rss > 10_000_000 else rss / 1024
    report = {
        "platform": {
            "system": platform.system(),
            "machine": platform.machine(),
            "processor": platform.processor(),
        },
        "mode": "dynamic-int8-common-path",
        "fallback_executed": False,
        "fallback_session_resident": True,
        "threads": args.threads,
        "model_threads": options.intra_op_num_threads,
        "trials": args.trials,
        "latency_ms": {
            "median": statistics.median(timings),
            "p95": percentile(timings, 0.95),
        },
        "peak_rss_mib": peak_rss_mib,
        "onnxruntime": ort.__version__,
        "providers": sessions["base224"].get_providers(),
        "models": {
            name: {
                "file": path.name,
                "bytes": path.stat().st_size,
                "sha256": sha256(path),
            }
            for name, path in paths.items()
        },
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report))


if __name__ == "__main__":
    main()
