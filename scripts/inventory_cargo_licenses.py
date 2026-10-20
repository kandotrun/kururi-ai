#!/usr/bin/env python3
"""Collect license evidence for the exact local Cargo.lock without network access."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import tarfile
import tomllib
from datetime import datetime, timezone
from pathlib import Path


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def license_candidate(path: Path) -> bool:
    name = path.name.lower()
    return any(
        name == prefix or name.startswith(prefix + separator)
        for prefix in ("license", "licence", "copying", "copyright", "notice")
        for separator in ("", ".", "-", "_", " ")
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cargo-manifest", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    manifest_path = args.cargo_manifest.resolve()
    lock_path = manifest_path.parent / "Cargo.lock"
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    lock = tomllib.loads(lock_path.read_text())
    manifest = tomllib.loads(manifest_path.read_text())
    before_lock_hash = sha256(lock_path)
    before_manifest_hash = sha256(manifest_path)
    metadata_result = subprocess.run(
        [
            "cargo",
            "metadata",
            "--offline",
            "--locked",
            "--format-version",
            "1",
            "--manifest-path",
            str(manifest_path),
        ],
        text=True,
        capture_output=True,
        check=False,
    )
    if before_lock_hash != sha256(lock_path) or before_manifest_hash != sha256(
        manifest_path
    ):
        raise SystemExit("Source manifest/lock changed during inspection; retry later.")
    metadata = (
        json.loads(metadata_result.stdout) if metadata_result.returncode == 0 else {}
    )
    metadata_packages = {
        (package["name"], package["version"], package.get("source")): package
        for package in metadata.get("packages", [])
    }
    target_metadata_results = {}
    for target in ("aarch64-apple-darwin", "x86_64-unknown-linux-gnu"):
        result = subprocess.run(
            [
                "cargo",
                "metadata",
                "--offline",
                "--locked",
                "--format-version",
                "1",
                "--filter-platform",
                target,
                "--manifest-path",
                str(manifest_path),
            ],
            text=True,
            capture_output=True,
            check=False,
        )
        target_metadata = json.loads(result.stdout) if result.returncode == 0 else {}
        target_metadata_results[target] = {
            "exit_code": result.returncode,
            "succeeded": result.returncode == 0,
            "package_count": len(target_metadata.get("packages", [])),
            "diagnostic": result.stderr.strip()
            .replace(str(manifest_path.parent), "<crate>")
            .replace(str(Path.home()), "<home>")
            or None,
            "resolved_package_keys": {
                (package["name"], package["version"], package.get("source"))
                for package in target_metadata.get("packages", [])
            },
        }
        metadata_packages.update(
            {
                (package["name"], package["version"], package.get("source")): package
                for package in target_metadata.get("packages", [])
            }
        )
    if before_lock_hash != sha256(lock_path) or before_manifest_hash != sha256(
        manifest_path
    ):
        raise SystemExit(
            "Source manifest/lock changed during metadata inspection; retry later."
        )
    target_metadata_complete = all(
        data["succeeded"] for data in target_metadata_results.values()
    )
    cargo_cache_root = Path(os.environ.get("CARGO_HOME", str(Path.home() / ".cargo")))
    registry_roots = sorted((cargo_cache_root / "registry" / "src").glob("*"))
    records = []
    for locked in sorted(
        lock["package"], key=lambda item: (item["name"], item["version"])
    ):
        name, version, source = locked["name"], locked["version"], locked.get("source")
        record = {
            "name": name,
            "version": version,
            "source": source,
            "source_checksum_sha256": locked.get("checksum"),
            "in_successful_cargo_metadata": (name, version, source)
            in metadata_packages,
            "resolved_targets": [
                target
                for target, data in target_metadata_results.items()
                if (name, version, source) in data["resolved_package_keys"]
            ],
        }
        if source is None:
            record.update(
                {
                    "kind": "workspace",
                    "declared_license": manifest["package"].get("license"),
                    "current_manifest_version": manifest["package"].get("version"),
                    "texts": [],
                    "review_status": "project license supplied by release staging, not registry inventory",
                }
            )
            records.append(record)
            continue
        if not record["resolved_targets"] and target_metadata_complete:
            record.update(
                {
                    "kind": "dependency",
                    "included_in_target_license_bundle": False,
                    "source_available": None,
                    "declared_license": None,
                    "texts": [],
                    "review_status": "outside intended Apple Silicon/macOS and Linux/x86_64 target union; excluded",
                }
            )
            records.append(record)
            continue
        record["included_in_target_license_bundle"] = True
        candidates = [
            root / f"{name}-{version}"
            for root in registry_roots
            if (root / f"{name}-{version}" / "Cargo.toml").is_file()
        ]
        crate = None
        crate_checksum = None
        archive_path = None
        for candidate in candidates:
            checksum_path = candidate / ".cargo-checksum.json"
            checksum = (
                json.loads(checksum_path.read_text()) if checksum_path.exists() else {}
            )
            archive = (
                candidate.parent.parent.parent
                / "cache"
                / candidate.parent.name
                / f"{name}-{version}.crate"
            )
            archive_matches = archive.is_file() and sha256(archive) == locked.get(
                "checksum"
            )
            if checksum.get("package") == locked.get("checksum") or archive_matches:
                crate, crate_checksum = candidate, checksum
                archive_path = archive if archive_matches else None
                break
        if crate is None:
            record.update(
                {
                    "kind": "dependency",
                    "source_available": False,
                    "declared_license": None,
                    "texts": [],
                    "review_status": "missing downloaded registry source matching locked checksum",
                }
            )
            records.append(record)
            continue
        cargo_package = tomllib.loads((crate / "Cargo.toml").read_text())["package"]
        package_metadata = metadata_packages.get((name, version, source), {})
        declared_license = package_metadata.get("license") or cargo_package.get(
            "license"
        )
        declared_license_file = package_metadata.get(
            "license_file"
        ) or cargo_package.get("license-file")
        paths = [
            path
            for path in crate.rglob("*")
            if path.is_file() and license_candidate(path)
        ]
        if declared_license_file:
            explicit = Path(declared_license_file)
            if not explicit.is_absolute():
                explicit = crate / explicit
            if explicit.is_file() and explicit.resolve().is_relative_to(
                crate.resolve()
            ):
                paths.append(explicit)
        paths = sorted(set(paths))
        texts = []
        for path in paths:
            resolved = path.resolve()
            if not resolved.is_relative_to(crate.resolve()):
                continue
            relative = path.relative_to(crate)
            destination = output / "crates" / f"{name}-{version}" / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(path, destination)
            actual_sha = sha256(destination)
            source_file_sha = crate_checksum.get("files", {}).get(relative.as_posix())
            archive_file_matches = None
            if archive_path:
                with tarfile.open(archive_path, "r:gz") as archive:
                    try:
                        member = archive.extractfile(
                            f"{name}-{version}/{relative.as_posix()}"
                        )
                    except KeyError:
                        member = None
                    if member is not None:
                        archive_file_matches = (
                            hashlib.sha256(member.read()).hexdigest() == actual_sha
                        )
            if archive_file_matches is False or (
                source_file_sha is not None and actual_sha != source_file_sha
            ):
                raise SystemExit(
                    f"License text integrity mismatch: {name}@{version}/{relative}"
                )
            texts.append(
                {
                    "path": destination.relative_to(output).as_posix(),
                    "source_relative_path": relative.as_posix(),
                    "sha256": actual_sha,
                    "bytes": destination.stat().st_size,
                    "registry_file_checksum_matches": (
                        actual_sha == source_file_sha if source_file_sha else None
                    ),
                    "cached_archive_file_matches": archive_file_matches,
                }
            )
        record.update(
            {
                "kind": "dependency",
                "source_available": True,
                "registry_package_checksum_matches": True,
                "registry_package_checksum_evidence": (
                    "cached .crate archive SHA256"
                    if archive_path
                    else ".cargo-checksum.json package"
                ),
                "declared_license": declared_license,
                "declared_license_file": (
                    Path(declared_license_file).name if declared_license_file else None
                ),
                "repository": package_metadata.get("repository")
                or cargo_package.get("repository"),
                "homepage": cargo_package.get("homepage"),
                "texts": texts,
                "review_status": (
                    "license/notice candidates copied; applicability requires review"
                    if texts
                    else "no standalone license/notice text found in downloaded crate"
                ),
            }
        )
        records.append(record)
    expected_text_paths = {
        text["path"] for record in records for text in record["texts"]
    }
    copied_root = output / "crates"
    if copied_root.exists():
        for path in copied_root.rglob("*"):
            if (
                path.is_file()
                and path.relative_to(output).as_posix() not in expected_text_paths
            ):
                path.unlink()
        for path in sorted(copied_root.rglob("*"), reverse=True):
            if path.is_dir() and not any(path.iterdir()):
                path.rmdir()
    error = metadata_result.stderr.strip()
    error = error.replace(str(manifest_path.parent), "<crate>")
    error = error.replace(str(Path.home()), "<home>")
    dependency_records = [
        record for record in records if record["kind"] == "dependency"
    ]
    target_dependency_records = [
        record
        for record in dependency_records
        if record["included_in_target_license_bundle"]
    ]
    missing_sources = [
        f'{record["name"]}@{record["version"]}'
        for record in target_dependency_records
        if not record["source_available"]
    ]
    missing_text = [
        f'{record["name"]}@{record["version"]}'
        for record in target_dependency_records
        if record["source_available"] and not record["texts"]
    ]
    manifest_output = {
        "schema_version": 1,
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "scope": (
            "Every entry in exact Cargo.lock is recorded. "
            + (
                "License texts cover the union of aarch64-apple-darwin and "
                "x86_64-unknown-linux-gnu dependencies, including build dependencies."
                if target_metadata_complete
                else "Target resolution is incomplete; license texts conservatively cover all available "
                "locked dependency sources. No intended-target membership claim is established."
            )
        ),
        "cargo_lock_sha256": before_lock_hash,
        "cargo_manifest_sha256": before_manifest_hash,
        "cargo_metadata": {
            "command": "cargo metadata --offline --locked --format-version 1",
            "exit_code": metadata_result.returncode,
            "succeeded": metadata_result.returncode == 0,
            "package_count": len(metadata.get("packages", [])),
            "diagnostic": error or None,
        },
        "cargo_metadata_by_target": {
            target: {
                key: value
                for key, value in result.items()
                if key != "resolved_package_keys"
            }
            for target, result in target_metadata_results.items()
        },
        "summary": {
            "lock_package_count": len(records),
            "dependency_count": len(dependency_records),
            "inventory_dependency_count": len(target_dependency_records),
            "target_membership_complete": target_metadata_complete,
            "intended_target_dependency_count": (
                len(target_dependency_records) if target_metadata_complete else None
            ),
            "copied_text_count": sum(len(record["texts"]) for record in records),
            "missing_matching_sources": missing_sources,
            "dependencies_without_standalone_license_text": missing_text,
            "outside_intended_target_union": [
                f'{record["name"]}@{record["version"]}'
                for record in dependency_records
                if not record["included_in_target_license_bundle"]
            ],
        },
        "limitations": [
            "This is an evidence inventory, not a determination of complete legal compliance.",
            "Cargo.lock includes packages that may not be built for a particular release target.",
            "Text filename matching can include notices for bundled material; applicability must be reviewed.",
            "The presence of a copied text does not prove every alternative in an SPDX expression is supplied.",
            "Native ONNX Runtime distributions and pretrained model licenses are outside this Cargo inventory.",
            "No network access was requested; missing source/text must be resolved separately.",
        ],
        "packages": records,
    }
    result_path = output / "cargo-license-manifest.json"
    result_path.write_text(
        json.dumps(manifest_output, indent=2, ensure_ascii=False) + "\n"
    )
    lines = [
        "# Cargo dependency license evidence",
        "",
        f"Generated: {manifest_output['generated_at_utc']}",
        "",
        f"Cargo.lock SHA256: `{before_lock_hash}`",
        "",
        f"Cargo.toml SHA256: `{before_manifest_hash}`",
        "",
        f"Offline locked metadata succeeded: **{metadata_result.returncode == 0}**.",
        "",
        *[
            f"- `{target}` filtered offline locked metadata: "
            f"{'succeeded' if data['succeeded'] else 'failed'}, "
            f"{data['package_count']} packages."
            for target, data in target_metadata_results.items()
        ],
        "",
        f"Recorded {len(dependency_records)} locked dependency entries; "
        f"inventoried {len(target_dependency_records)} dependencies; "
        f"copied {manifest_output['summary']['copied_text_count']} candidate license/notice texts.",
        "",
        "This inventory is not a determination of complete legal compliance. "
        + (
            "Both intended target graphs resolved successfully. "
            if target_metadata_complete
            else "Target membership is incomplete: the conservative fallback inventories all available "
            "locked sources, including packages that may only be used on unsupported targets. "
        )
        + "Build/proc-macro dependencies are retained conservatively; actual runtime linkage can be narrower. "
        "Native ONNX Runtime distribution and pretrained model notices need separate inventories.",
        "",
        "## Unresolved items",
        "",
    ]
    if metadata_result.returncode:
        lines += [
            "Requested `cargo metadata --offline --locked` did not succeed. "
            "The package list was read directly from the unchanged lockfile, and package declarations "
            "were read from cached registry sources whose package checksum matched the lock.",
            "",
            "```text",
            error,
            "```",
            "",
        ]
    lines += [
        f"- Missing matching registry source: {', '.join(missing_sources) or 'none'}.",
        f"- Downloaded dependencies without standalone text: {', '.join(missing_text) or 'none'}.",
        "- Review the applicable branch of each SPDX expression and any bundled subcomponent notices.",
        "- Re-run the inventory after Cargo.toml or Cargo.lock changes.",
        "",
        "## Inventory",
        "",
        "| Package | Declared license | Copied text files | Status |",
        "|---|---|---:|---|",
    ]
    for record in records:
        license_value = str(record.get("declared_license") or "unknown").replace(
            "|", "\\|"
        )
        lines.append(
            f"| {record['name']} {record['version']} | {license_value} | "
            f"{len(record['texts'])} | {record['review_status']} |"
        )
    (output / "README.md").write_text("\n".join(lines) + "\n")
    print(
        json.dumps(
            {
                "manifest": result_path.name,
                "cargo_metadata_succeeded": metadata_result.returncode == 0,
                **manifest_output["summary"],
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
