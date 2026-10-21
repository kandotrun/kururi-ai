#!/usr/bin/env python3
"""Benchmark resident FP32 and dynamic-INT8 Kururi v2 ensembles on a CPU."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import platform
import resource
import statistics
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
import onnx
import onnxruntime as ort
from onnxruntime.quantization import QuantType, quantize_dynamic

MODELS = (
    ("base224", "convnext-base-224", 224, 0.5),
    ("small288", "convnext-small-288", 288, 0.4),
    ("small224", "convnext-small-224", 224, 0.1),
)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def percentile(values: list[float], fraction: float) -> float:
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, math.ceil(len(ordered) * fraction) - 1)]


def softmax(values: np.ndarray) -> np.ndarray:
    shifted = values - values.max(axis=-1, keepdims=True)
    exponentials = np.exp(shifted)
    return exponentials / exponentials.sum(axis=-1, keepdims=True)


def aligned(session: ort.InferenceSession, batch: np.ndarray) -> np.ndarray:
    logits = session.run(["logits"], {"images": batch})[0]
    probabilities = softmax(logits)
    return np.mean(
        [np.roll(probabilities[view], view) for view in range(4)],
        axis=0,
    )


def dynamic_models(source_dir: Path, destination: Path) -> None:
    destination.mkdir(parents=True, exist_ok=True)
    for _, stem, _, _ in MODELS:
        source = source_dir / f"{stem}.onnx"
        output = destination / f"{stem}.int8.onnx"
        if output.exists():
            continue
        model = onnx.load(source)
        del model.graph.value_info[:]
        for value in [*model.graph.input, *model.graph.output]:
            shape = value.type.tensor_type.shape
            if shape.dim:
                shape.dim[0].ClearField("dim_value")
                shape.dim[0].dim_param = "batch"
        relaxed = destination / f"{stem}.relaxed.onnx"
        data_name = f"{stem}.relaxed.onnx.data"
        onnx.save_model(
            model,
            relaxed,
            save_as_external_data=True,
            all_tensors_to_one_file=True,
            location=data_name,
            size_threshold=1024,
        )
        quantize_dynamic(
            relaxed,
            output,
            per_channel=True,
            reduce_range=False,
            weight_type=QuantType.QInt8,
            op_types_to_quantize=["MatMul", "Gemm"],
            use_external_data_format=False,
            extra_options={"MatMulConstBOnly": True},
        )
        relaxed.unlink()
        (destination / data_name).unlink(missing_ok=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-dir", type=Path, required=True)
    parser.add_argument("--mode", choices=("fp32", "dynamic-int8"), required=True)
    parser.add_argument("--provider", choices=("cpu", "openvino"), default="cpu")
    parser.add_argument("--threads", type=int, required=True)
    parser.add_argument("--trials", type=int, default=20)
    parser.add_argument("--low-memory", action="store_true")
    parser.add_argument("--prepare-dynamic", action="store_true")
    parser.add_argument("--prepare-only", action="store_true")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.prepare_only and not args.prepare_dynamic:
        parser.error("--prepare-only requires --prepare-dynamic")
    if args.prepare_dynamic:
        dynamic_models(args.model_dir, args.output.parent / "dynamic-int8")
        if args.prepare_only:
            print(json.dumps({"dynamic_models": "prepared"}))
            return
        args.model_dir = args.output.parent / "dynamic-int8"

    options = ort.SessionOptions()
    options.intra_op_num_threads = max(1, args.threads // 2)
    options.inter_op_num_threads = 1
    options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
    options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    options.enable_cpu_mem_arena = not args.low_memory
    options.enable_mem_pattern = not args.low_memory
    options.add_session_config_entry("session.intra_op.allow_spinning", "0")
    options.add_session_config_entry("session.inter_op.allow_spinning", "0")

    model_paths = {}
    inputs = {}
    sessions = {}
    rng = np.random.default_rng(20261021)
    providers = (
        [
            (
                "OpenVINOExecutionProvider",
                {
                    "device_type": "CPU",
                    "num_of_threads": str(max(1, args.threads)),
                },
            ),
            "CPUExecutionProvider",
        ]
        if args.provider == "openvino"
        else ["CPUExecutionProvider"]
    )
    for name, stem, side, _ in MODELS:
        suffix = "" if args.mode == "fp32" else ".int8"
        path = args.model_dir / f"{stem}{suffix}.onnx"
        model_paths[name] = path
        inputs[name] = rng.standard_normal((4, 3, side, side), dtype=np.float32)
        sessions[name] = ort.InferenceSession(
            str(path),
            sess_options=options,
            providers=providers,
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
        aligned(sessions["small224"], inputs["small224"])
        timings.append((time.perf_counter() - started) * 1000)

    rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    peak_rss_mib = rss / (1024 * 1024) if rss > 10_000_000 else rss / 1024
    report = {
        "platform": {
            "system": platform.system(),
            "machine": platform.machine(),
            "processor": platform.processor(),
        },
        "mode": args.mode,
        "provider_requested": args.provider,
        "threads": args.threads,
        "model_threads": options.intra_op_num_threads,
        "low_memory": args.low_memory,
        "trials": args.trials,
        "worst_case_fallback_per_trial": True,
        "latency_ms": {
            "median": statistics.median(timings),
            "p95": percentile(timings, 0.95),
        },
        "peak_rss_mib": peak_rss_mib,
        "onnxruntime": ort.__version__,
        "providers": sessions["base224"].get_providers(),
        "available_providers": ort.get_available_providers(),
        "models": {
            name: {
                "file": path.name,
                "bytes": path.stat().st_size,
                "sha256": sha256(path),
            }
            for name, path in model_paths.items()
        },
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report))


if __name__ == "__main__":
    main()
