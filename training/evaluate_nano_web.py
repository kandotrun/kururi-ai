from __future__ import annotations

import argparse
import collections
import hashlib
import json
import statistics
import time
from pathlib import Path
from typing import cast

import numpy as np
import onnxruntime as ort
from PIL import Image, ImageOps

Record = dict[str, object]
MEAN = np.asarray([0.485, 0.456, 0.406], dtype=np.float32)[:, None, None]
STD = np.asarray([0.229, 0.224, 0.225], dtype=np.float32)[:, None, None]


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def prepare(path: Path) -> np.ndarray:
    with Image.open(path) as source:
        image = ImageOps.exif_transpose(source).convert("RGB")
    resized = image.resize((224, 224), Image.Resampling.BILINEAR)
    image.close()
    array = np.asarray(resized, dtype=np.float32).transpose(2, 0, 1) / 255.0
    resized.close()
    return (array - MEAN) / STD


def aligned_probabilities(
    session: ort.InferenceSession, image: np.ndarray
) -> np.ndarray:
    probabilities = []
    for applied_cw in range(4):
        view = np.rot90(image, -applied_cw, axes=(-2, -1))
        logits = session.run(["logits"], {"images": view[None]})[0][0]
        shifted = logits - np.max(logits)
        probability = np.exp(shifted) / np.exp(shifted).sum()
        probabilities.append(probability)
    return np.mean(
        [np.roll(probabilities[k], k) for k in range(4)],
        axis=0,
    )


def metrics(rows: list[Record]) -> Record:
    by_group: dict[str, list[bool]] = collections.defaultdict(list)
    by_original: dict[str, list[bool]] = collections.defaultdict(list)
    by_category: dict[str, list[bool]] = collections.defaultdict(list)
    for row in rows:
        correct = bool(row["correct"])
        by_group[cast(str, row["group_id"])].append(correct)
        by_original[cast(str, row["id"])].append(correct)
        by_category[cast(str, row["category"])].append(correct)
    total = len(rows)
    correct = sum(bool(row["correct"]) for row in rows)
    return {
        "variants": total,
        "originals": len(by_original),
        "groups": len(by_group),
        "correct": correct,
        "accuracy": correct / total,
        "group_macro_accuracy": statistics.mean(
            sum(values) / len(values) for values in by_group.values()
        ),
        "all_four_correct_originals": sum(
            all(values) for values in by_original.values()
        ),
        "all_four_correct_fraction": sum(all(values) for values in by_original.values())
        / len(by_original),
        "by_category": {
            category: {
                "variants": len(values),
                "correct": sum(values),
                "accuracy": sum(values) / len(values),
            }
            for category, values in sorted(by_category.items())
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--split", required=True, choices=("val", "test"))
    parser.add_argument("--model", required=True, type=Path, action="append")
    parser.add_argument("--weight", required=True, type=float, action="append")
    parser.add_argument("--threads", type=int, default=8)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    if len(args.model) != len(args.weight):
        parser.error("provide one --weight for every --model")
    if not 0 < sum(args.weight) <= 1.000001:
        parser.error("weights must have a positive sum no greater than one")
    manifest_bytes = args.manifest.read_bytes()
    manifest = cast(Record, json.loads(manifest_bytes))
    selected = [
        row
        for row in cast(list[Record], manifest["images"])
        if row["split"] == args.split and not row.get("duplicate_of")
    ]
    options = ort.SessionOptions()
    options.intra_op_num_threads = args.threads
    options.inter_op_num_threads = 1
    options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    sessions = [
        ort.InferenceSession(
            str(path),
            sess_options=options,
            providers=["CPUExecutionProvider"],
        )
        for path in args.model
    ]
    started = time.perf_counter()
    rows = []
    for index, row in enumerate(selected, start=1):
        image = prepare(Path(cast(str, row["canonical_path"])))
        base = np.zeros(4, dtype=np.float32)
        for session, weight in zip(sessions, args.weight, strict=True):
            base += weight * aligned_probabilities(session, image)
        for applied_cw in range(4):
            probability = np.roll(base, -applied_cw)
            predicted = int(probability.argmax())
            expected = (-applied_cw) % 4
            rows.append(
                {
                    "id": row["id"],
                    "group_id": row["group_id"],
                    "category": row.get("category", "unknown"),
                    "applied_cw": applied_cw,
                    "expected": expected,
                    "predicted": predicted,
                    "confidence": float(probability[predicted]),
                    "correct": predicted == expected,
                }
            )
        if index % 10 == 0 or index == len(selected):
            print(f"evaluated {index}/{len(selected)}", flush=True)
    result = {
        "split": args.split,
        "manifest_sha256": hashlib.sha256(manifest_bytes).hexdigest(),
        "models": [
            {
                "path": path.name,
                "sha256": file_sha256(path),
                "bytes": path.stat().st_size,
                "weight": weight,
            }
            for path, weight in zip(args.model, args.weight, strict=True)
        ],
        "runtime": {
            "onnxruntime": ort.__version__,
            "threads": args.threads,
            "providers": sessions[0].get_providers(),
        },
        "metrics": metrics(rows),
        "elapsed_seconds": time.perf_counter() - started,
        "privacy": "Aggregate-only public evidence; per-photo predictions are omitted.",
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
