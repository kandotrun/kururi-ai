"""Export exact trained weights; no image data is sent over the network.

This script performs CPU forwards. Run only in the coordinated compute window.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import time
from pathlib import Path


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--checkpoint", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--model-name", help="Required for a bare v1 state dictionary")
    parser.add_argument(
        "--preprocess",
        required=True,
        choices=["v1-autocrop224-no-normalization", "v2-whole224-bilinear-imagenet"],
    )
    parser.add_argument("--input-tensor", type=Path)
    parser.add_argument("--batch-size", type=int, choices=[1, 4], default=1)
    parser.add_argument("--threads", type=int, default=1)
    parser.add_argument("--recommended-views", type=int, choices=[1, 4], default=1)
    args = parser.parse_args()
    output_paths = [
        args.output,
        Path(str(args.output) + ".data"),
        args.output.with_suffix(args.output.suffix + ".export.json"),
        args.output.with_suffix(".metadata.json"),
    ]
    if any(path.exists() for path in output_paths):
        parser.error("Output model or sidecar already exists; choose a new path")

    import numpy as np
    import onnx
    import onnxruntime as ort
    import timm
    import torch

    torch.set_num_threads(args.threads)
    torch.set_num_interop_threads(1)
    torch.manual_seed(20261020)
    started = time.perf_counter()
    checkpoint_digest = sha256(args.checkpoint)
    checkpoint = torch.load(args.checkpoint, map_location="cpu", weights_only=True)
    if "state_dict" in checkpoint:
        state = checkpoint["state_dict"]
        model_name = args.model_name or checkpoint.get("model_name")
        if args.model_name and args.model_name != checkpoint.get("model_name"):
            parser.error("--model-name contradicts checkpoint model_name")
        declared_preprocess = checkpoint.get("config", {}).get("preprocess", {})
        image_size = int(declared_preprocess.get("image_size", 0))
        if image_size not in (224, 288, 384):
            parser.error("V2 checkpoints must declare image_size 224, 288 or 384")
        expected = {
            "image_size": image_size,
            "color": "RGB",
            "interpolation": "Pillow bilinear",
            "pixel_scale": 1 / 255,
            "mean": [0.485, 0.456, 0.406],
            "std": [0.229, 0.224, 0.225],
            "layout": "NCHW",
            "class_correction_clockwise_degrees": [0, 90, 180, 270],
        }
        declared = checkpoint.get("config", {}).get("preprocess", {})
        if args.preprocess != "v2-whole224-bilinear-imagenet" or any(
            declared.get(key) != value for key, value in expected.items()
        ):
            parser.error(
                "V2 checkpoint preprocessing configuration does not match the requested pipeline"
            )
    else:
        state = checkpoint
        model_name = args.model_name
        if (
            args.preprocess != "v1-autocrop224-no-normalization"
            or model_name != "vit_large_patch16_224"
        ):
            parser.error(
                "Bare checkpoints are supported only for the verified v1 ViT pipeline"
            )
    if not model_name:
        parser.error("--model-name is required when checkpoint has no model_name")
    if "state_dict" not in checkpoint:
        image_size = 224
    cleaned = {key.removeprefix("module."): value for key, value in state.items()}
    model = (
        timm.create_model(model_name, pretrained=False, num_classes=4).float().eval()
    )
    model.load_state_dict(cleaned, strict=True)
    if args.input_tensor:
        array = np.fromfile(args.input_tensor, dtype="<f4").reshape(
            args.batch_size, 3, image_size, image_size
        )
        sample = torch.from_numpy(array.copy())
    else:
        sample = torch.rand(
            args.batch_size, 3, image_size, image_size, dtype=torch.float32
        )
    with torch.inference_mode():
        reference = model(sample).numpy()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    export_started = time.perf_counter()
    torch.onnx.export(
        model,
        (sample,),
        str(args.output),
        input_names=["images"],
        output_names=["logits"],
        opset_version=18,
        dynamo=True,
        external_data=True,
        dynamic_shapes=None,
        optimize=True,
    )
    export_seconds = time.perf_counter() - export_started

    graph = onnx.load(str(args.output), load_external_data=False)
    if sha256(args.checkpoint) != checkpoint_digest:
        raise SystemExit(
            "Checkpoint changed during export; discard output and use a frozen checkpoint"
        )
    properties = {
        "kururi.model_name": model_name,
        "kururi.preprocess": args.preprocess,
        "kururi.class_order": "0,90,180,270",
        "kururi.class_semantics": "correction_clockwise_degrees",
        "kururi.input_size": str(image_size),
        "kururi.batch_size": str(args.batch_size),
        "kururi.recommended_views": str(args.recommended_views),
        "kururi.checkpoint_sha256": checkpoint_digest,
    }
    onnx.helper.set_model_props(graph, properties)
    onnx.save(graph, str(args.output))
    onnx.checker.check_model(str(args.output))
    options = ort.SessionOptions()
    options.intra_op_num_threads = args.threads
    options.inter_op_num_threads = 1
    session = ort.InferenceSession(
        str(args.output), sess_options=options, providers=["CPUExecutionProvider"]
    )
    result = session.run(["logits"], {"images": sample.numpy()})[0]
    absolute = np.abs(reference - result)
    passes = bool(np.allclose(reference, result, rtol=1e-3, atol=1e-4))
    report = {
        "model_name": model_name,
        "checkpoint_sha256": properties["kururi.checkpoint_sha256"],
        "preprocess": args.preprocess,
        "class_order_correction_cw": [0, 90, 180, 270],
        "recommended_views": args.recommended_views,
        "input_shape": [args.batch_size, 3, image_size, image_size],
        "dtype": "float32",
        "torch": torch.__version__,
        "timm": timm.__version__,
        "onnx": onnx.__version__,
        "onnxruntime": ort.__version__,
        "parameters": sum(parameter.numel() for parameter in model.parameters()),
        "export_seconds": export_seconds,
        "total_seconds": time.perf_counter() - started,
        "parity_max_abs": float(absolute.max()),
        "parity_mean_abs": float(absolute.mean()),
        "parity_allclose_rtol_1e3_atol_1e4": passes,
        "reference_logits": reference.tolist(),
        "onnx_logits": result.tolist(),
        "parity_scope": (
            "single supplied tensor"
            if args.input_tensor
            else "single seeded random tensor"
        ),
        "files": [
            {"name": path.name, "bytes": path.stat().st_size, "sha256": sha256(path)}
            for path in sorted(args.output.parent.glob(args.output.name + "*"))
            if path.is_file() and not path.name.endswith(".json")
        ],
    }
    report_path = args.output.with_suffix(args.output.suffix + ".export.json")
    report_path.write_text(json.dumps(report, indent=2) + "\n")
    metadata = {
        "schema_version": 1,
        "model_name": model_name,
        "preprocess": args.preprocess,
        "input_shape": [args.batch_size, 3, image_size, image_size],
        "input_size": image_size,
        "batch_size": args.batch_size,
        "dtype": "float32",
        "class_order_correction_cw": [0, 90, 180, 270],
        "onnx_files": report["files"],
        "recommended_views": args.recommended_views,
        "checkpoint_sha256": properties["kururi.checkpoint_sha256"],
        "training_resize": (
            "Pillow BILINEAR"
            if args.preprocess.startswith("v2-")
            else "Pillow BICUBIC AutoCrop"
        ),
        "native_resize": "kururi-bilinear-pillow13-rgb8; empirical parity required",
    }
    args.output.with_suffix(".metadata.json").write_text(
        json.dumps(metadata, indent=2) + "\n"
    )
    print(json.dumps(report, indent=2))
    if not passes:
        raise SystemExit("Export numeric parity failed")


if __name__ == "__main__":
    main()
