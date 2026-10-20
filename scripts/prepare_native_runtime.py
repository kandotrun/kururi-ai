from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
from pathlib import Path
import shutil
import sys


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--binary", required=True, type=Path)
    parser.add_argument("--destination", required=True, type=Path)
    args = parser.parse_args()
    binary = args.binary.resolve(strict=True)
    destination = args.destination.resolve()
    distribution = importlib.metadata.distribution("onnxruntime")
    if distribution.version != "1.31.0":
        parser.error("Expected the pinned onnxruntime==1.31.0 wheel")
    capi = Path(distribution.locate_file("onnxruntime/capi"))
    if sys.platform == "darwin":
        matches = list(capi.glob("libonnxruntime.*.dylib"))
        target_name = "libonnxruntime.dylib"
        extra_libraries: list[Path] = []
    elif sys.platform.startswith("linux"):
        matches = list(capi.glob("libonnxruntime.so.*"))
        target_name = "libonnxruntime.so"
        extra_libraries = sorted(capi.glob("libonnxruntime_providers_*.so"))
    else:
        parser.error("Only macOS and Linux runtime staging is supported")
    if len(matches) != 1:
        parser.error(f"Expected exactly one runtime library; found {len(matches)}")
    licenses = [
        Path(distribution.locate_file("onnxruntime/LICENSE")),
        Path(distribution.locate_file("onnxruntime/ThirdPartyNotices.txt")),
    ]
    if not all(path.is_file() for path in licenses):
        parser.error("The installed runtime wheel is missing expected license files")
    destination.mkdir(parents=True, exist_ok=False)
    (destination / "licenses" / "onnxruntime").mkdir(parents=True)
    shutil.copy2(binary, destination / "kururi-native")
    shutil.copy2(matches[0], destination / target_name)
    for library in extra_libraries:
        shutil.copy2(library, destination / library.name)
    for license_path in licenses:
        shutil.copy2(
            license_path,
            destination / "licenses" / "onnxruntime" / license_path.name,
        )
    inventory = {
        "scope": "native binary and runtime staging; not a complete release archive",
        "onnxruntime": distribution.version,
        "files": [
            {
                "name": str(path.relative_to(destination)),
                "bytes": path.stat().st_size,
                "sha256": sha256(path),
            }
            for path in sorted(destination.rglob("*"))
            if path.is_file()
        ],
    }
    (destination / "runtime-inventory.json").write_text(
        json.dumps(inventory, indent=2) + "\n",
        encoding="utf-8",
    )
    print(json.dumps(inventory, indent=2))


if __name__ == "__main__":
    main()
