import hashlib
import json
import sys
import time
from pathlib import Path

import numpy as np
import onnxruntime as ort
import PIL
from PIL import Image, ImageOps

MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32).reshape(3, 1, 1)
STD = np.array([0.229, 0.224, 0.225], dtype=np.float32).reshape(3, 1, 1)
TRANSPOSE = {
    1: Image.Transpose.ROTATE_270,
    2: Image.Transpose.ROTATE_180,
    3: Image.Transpose.ROTATE_90,
}


def decode(path: Path) -> Image.Image:
    with Image.open(path) as opened:
        return ImageOps.exif_transpose(opened).convert("RGB")


def turned(image: Image.Image, quarters: int) -> Image.Image:
    return image if quarters == 0 else image.transpose(TRANSPOSE[quarters])


def tensor(image: Image.Image, side: int) -> np.ndarray:
    resized = np.asarray(
        image.resize((side, side), Image.Resampling.BILINEAR), dtype=np.uint8
    )
    chw = resized.transpose(2, 0, 1).astype(np.float32)
    return ((chw / np.float32(255.0) - MEAN) / STD).astype(np.float32)


def batch(chw: np.ndarray) -> np.ndarray:
    return np.stack(
        [np.ascontiguousarray(np.rot90(chw, k=-view, axes=(1, 2))) for view in range(4)]
    )


def aligned(logits: np.ndarray) -> np.ndarray:
    probabilities = np.zeros(4, dtype=np.float32)
    for view in range(4):
        row = logits[view].astype(np.float32)
        exp = np.exp(row - row.max()).astype(np.float32)
        denominator = np.float32(exp.sum(dtype=np.float32))
        for klass in range(4):
            probabilities[(klass + view) % 4] += (
                exp[klass] / denominator / np.float32(4)
            )
    return probabilities


def combine(runs: list[tuple[float, np.ndarray]]) -> np.ndarray:
    total = np.float32(0)
    for weight, _ in runs:
        total = np.float32(total + np.float32(weight))
    combined = np.zeros(4, dtype=np.float32)
    for weight, probabilities in runs:
        combined += np.float32(weight) / total * probabilities
    return combined


def argmax_last(values: np.ndarray) -> int:
    best = 0
    for index in range(1, len(values)):
        if values[index] >= values[best]:
            best = index
    return best


def margin(values: np.ndarray) -> float:
    ordered = sorted(values.tolist(), reverse=True)
    return float(np.float32(ordered[0]) - np.float32(ordered[1]))


def main() -> None:
    models_dir, samples_dir, thumbs_dir, out_dir = (
        Path(value) for value in sys.argv[1:5]
    )
    ensemble = json.loads((models_dir / "ensemble.json").read_text())
    threshold = np.float32(0.033333333)
    options = ort.SessionOptions()
    options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    started = time.perf_counter()
    general = [
        (
            model["weight"],
            model["input_size"],
            ort.InferenceSession(
                str(models_dir / model["graph"]["file"]),
                options,
                providers=["CPUExecutionProvider"],
            ),
        )
        for model in ensemble["general_models"]
    ]
    fallback_model = ensemble["fallback"]
    fallback = (
        fallback_model["weight"],
        fallback_model["input_size"],
        ort.InferenceSession(
            str(models_dir / fallback_model["graph"]["file"]),
            options,
            providers=["CPUExecutionProvider"],
        ),
    )
    load_seconds = time.perf_counter() - started
    photos = [
        (path.stem, path, "sample")
        for path in sorted(samples_dir.iterdir())
        if path.suffix in {".jpg", ".webp"}
    ]
    index = json.loads((thumbs_dir / "index.json").read_text())
    photos += [
        (item["id"], thumbs_dir / item["file"], "commons")
        for item in index
        if item["ok"]
    ]
    rgb_dir = out_dir / "rgb"
    rgb_dir.mkdir(parents=True, exist_ok=True)
    cases = []
    sources = []
    for photo_id, path, kind in photos:
        image = decode(path)
        raw = image.tobytes()
        (rgb_dir / f"{photo_id}.rgb").write_bytes(raw)
        sources.append(
            {
                "id": photo_id,
                "kind": kind,
                "path": str(path),
                "width": image.width,
                "height": image.height,
                "rgbSha256": hashlib.sha256(raw).hexdigest(),
            }
        )
        for quarters in range(4):
            rotated = turned(image, quarters)
            tensors = {}
            runs = []
            timings = []
            for weight, side, session in general:
                if side not in tensors:
                    tensors[side] = tensor(rotated, side)
                tick = time.perf_counter()
                logits = session.run(["logits"], {"images": batch(tensors[side])})[0]
                timings.append(time.perf_counter() - tick)
                runs.append((weight, aligned(logits)))
            general_combined = combine(runs)
            general_margin = margin(general_combined)
            fallback_used = np.float32(general_margin) < threshold
            weight, side, session = fallback
            if side not in tensors:
                tensors[side] = tensor(rotated, side)
            fallback_probabilities = aligned(
                session.run(["logits"], {"images": batch(tensors[side])})[0]
            )
            final = (
                combine(runs + [(weight, fallback_probabilities)])
                if fallback_used
                else general_combined
            )
            cases.append(
                {
                    "id": photo_id,
                    "kind": kind,
                    "simulated": quarters,
                    "correction": argmax_last(final),
                    "probabilities": [float(value) for value in final],
                    "generalProbabilities": [
                        float(value) for value in general_combined
                    ],
                    "fallbackProbabilities": [
                        float(value) for value in fallback_probabilities
                    ],
                    "generalMargin": general_margin,
                    "fallbackUsed": bool(fallback_used),
                    "tensorSha256": {
                        str(key): hashlib.sha256(
                            value.astype("<f4").tobytes()
                        ).hexdigest()
                        for key, value in tensors.items()
                    },
                    "cpuSeconds": sum(timings),
                }
            )
        print(
            photo_id,
            [case["correction"] for case in cases[-4:]],
            [case["fallbackUsed"] for case in cases[-4:]],
            flush=True,
        )
    report = {
        "pillow": PIL.__version__,
        "onnxruntime": ort.__version__,
        "numpy": np.__version__,
        "loadSeconds": load_seconds,
        "sources": sources,
        "cases": cases,
    }
    (out_dir / "reference.json").write_text(json.dumps(report, indent=1))


main()
