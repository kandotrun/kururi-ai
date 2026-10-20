#!/usr/bin/env python3
"""Download public pretrained weights at fixed upstream revisions (no photo upload)."""

import argparse
import hashlib
import json
from pathlib import Path

from huggingface_hub import hf_hub_download

SOURCES = {
    "small": (
        "mobilenetv4_conv_small.e2400_r224_in1k",
        "331fb803779522b685cf942e15f914fb6741c1eb",
    ),
    "medium": (
        "mobilenetv4_conv_medium.e500_r224_in1k",
        "02a09fbfb82b289e871ba8255f9da58c056fb13b",
    ),
    "convnext": (
        "convnext_tiny.fb_in22k_ft_in1k",
        "bc48a87f119bae1b06418f5340bfa97ef75d4609",
    ),
}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--models", nargs="+", choices=list(SOURCES), default=["small", "medium"]
    )
    args = parser.parse_args()
    root = Path(__file__).resolve().parent / "pretrained"
    for key in args.models:
        name, revision = SOURCES[key]
        target = root / key
        target.mkdir(parents=True, exist_ok=True)
        files = {}
        for filename in ("model.safetensors", "config.json", "README.md"):
            path = Path(
                hf_hub_download(
                    "timm/" + name, filename, revision=revision, local_dir=target
                )
            )
            files[filename] = {
                "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                "bytes": path.stat().st_size,
            }
        record = {
            "model_name": name,
            "repository": "timm/" + name,
            "revision": revision,
            "model_card_url": f"https://huggingface.co/timm/{name}/blob/{revision}/README.md",
            "license_declared_by_upstream": "apache-2.0",
            "pretraining_dataset": (
                "ImageNet-22k, fine-tuned on ImageNet-1k"
                if key == "convnext"
                else "ImageNet-1k"
            ),
            "upstream_author": (
                "Meta/Facebook Research; timm conversion"
                if key == "convnext"
                else "Ross Wightman / timm"
            ),
            "files": files,
        }
        (target / "provenance.json").write_text(json.dumps(record, indent=2) + "\n")
        print(json.dumps(record), flush=True)


if __name__ == "__main__":
    main()
