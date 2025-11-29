from __future__ import annotations

import argparse
import os
from pathlib import Path
from typing import Optional

import torch

from cli.constants import DEFAULT_DOWNLOAD_TIMEOUT, DEFAULT_MODEL_URL
from cli.download_utils import ensure_checkpoint
from cli.model_loader import load_model
from cli.prediction import angle_from_class, list_image_files, predict_with_model


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Image rotation classifier CLI")
    subparsers = parser.add_subparsers(dest="command", required=True)

    predict_parser = subparsers.add_parser(
        "predict", help="Predict rotation class for an image"
    )
    group = predict_parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--image", type=str, help="Path to input image")
    group.add_argument(
        "--dir", type=str, help="Process all images in a directory (recursive)"
    )
    predict_parser.add_argument(
        "--checkpoint",
        default="models/kururi-orient-v1.pth",
        type=str,
        help="Path to model checkpoint",
    )
    predict_parser.add_argument(
        "--checkpoint-url",
        default=None,
        type=str,
        help="URL to download checkpoint when missing",
    )
    predict_parser.add_argument(
        "--checkpoint-sha256",
        default=None,
        type=str,
        help="Expected SHA256 of checkpoint for integrity verification",
    )
    predict_parser.add_argument(
        "--download-timeout",
        default=None,
        type=int,
        help="Timeout seconds for checkpoint download",
    )
    predict_parser.add_argument(
        "--model-name",
        default="vit_large_patch16_224",
        type=str,
        help="timm model name",
    )
    predict_parser.add_argument(
        "--device",
        default="cpu",
        type=str,
        help="cpu or cuda (e.g. cuda:0)",
    )
    predict_parser.add_argument(
        "--save-rotated",
        default=None,
        type=str,
        help="Optional path to save image rotated back to upright",
    )
    predict_parser.add_argument(
        "--save-rotated-dir",
        default=None,
        type=str,
        help="Directory to save corrected images when using --dir",
    )
    predict_parser.add_argument(
        "--skip-broken",
        action="store_true",
        help="Skip unreadable images instead of aborting",
    )

    return parser


def resolve_checkpoint_args(
    args: argparse.Namespace,
) -> tuple[Path, str | None, str | None, int]:
    checkpoint_path = Path(args.checkpoint)
    model_url = (
        args.checkpoint_url or os.getenv("KURURI_MODEL_URL") or DEFAULT_MODEL_URL
    )
    model_sha = args.checkpoint_sha256 or os.getenv("KURURI_MODEL_SHA256")
    download_timeout = args.download_timeout or int(
        os.getenv("KURURI_MODEL_TIMEOUT", str(DEFAULT_DOWNLOAD_TIMEOUT))
    )
    return checkpoint_path, model_url, model_sha, download_timeout


def run_single(
    image: Path,
    model: torch.nn.Module,
    device: torch.device,
    save_rotated: Optional[Path],
) -> None:
    rotation_class, probabilities = predict_with_model(
        image_path=image,
        model=model,
        device=device,
        save_rotated=save_rotated,
    )
    angle = angle_from_class(rotation_class)
    print(f"rotation_class={rotation_class} angle_ccw={angle}")
    for idx, prob in enumerate(probabilities):
        print(f"class_{idx}: {prob.item():.4f}")
    if save_rotated is not None:
        print(f"rotated_image_saved={save_rotated}")


def run_directory(
    root: Path,
    output_root: Optional[Path],
    model: torch.nn.Module,
    device: torch.device,
    skip_broken: bool,
) -> None:
    files = list_image_files(root)
    if len(files) == 0:
        print(f"No supported images found under {root}")
        return
    for path in files:
        save_path = None
        if output_root is not None:
            save_path = output_root / path.relative_to(root)
        try:
            rotation_class, probabilities = predict_with_model(
                image_path=path,
                model=model,
                device=device,
                save_rotated=save_path,
            )
            angle = angle_from_class(rotation_class)
            prob_str = " ".join(
                f"class_{idx}:{prob.item():.4f}"
                for idx, prob in enumerate(probabilities)
            )
            print(
                f"{path}: rotation_class={rotation_class} angle_ccw={angle} {prob_str}"
            )
        except Exception as e:  # noqa: BLE001
            if skip_broken:
                print(f"{path}: skipped ({e})")
                continue
            raise
    if output_root is not None:
        print(f"rotated_images_saved_under={output_root}")


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()

    if args.command == "predict":
        device = torch.device(args.device)
        if device.type == "cuda" and not torch.cuda.is_available():
            raise RuntimeError("CUDA is not available on this machine.")

        checkpoint_path, model_url, model_sha, timeout = resolve_checkpoint_args(args)
        ensure_checkpoint(checkpoint_path, model_url, model_sha, timeout)

        model = load_model(args.model_name, checkpoint_path, device)

        if args.dir is None:
            save_path = (
                Path(args.save_rotated) if args.save_rotated is not None else None
            )
            run_single(
                image=Path(args.image),
                model=model,
                device=device,
                save_rotated=save_path,
            )
        else:
            output_root = (
                Path(args.save_rotated_dir)
                if args.save_rotated_dir is not None
                else None
            )
            run_directory(
                root=Path(args.dir),
                output_root=output_root,
                model=model,
                device=device,
                skip_broken=args.skip_broken,
            )


if __name__ == "__main__":
    main()
