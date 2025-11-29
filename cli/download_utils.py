from __future__ import annotations

import hashlib
import urllib.error
import urllib.request
from pathlib import Path


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(8 * 1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def download_file(url: str, dest: Path, timeout: int) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    request = urllib.request.Request(url, headers={"User-Agent": "kururi-ai-cli"})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        length_header = response.headers.get("Content-Length")
        total = int(length_header) if length_header is not None else None
        downloaded = 0
        temp_path = dest.with_suffix(dest.suffix + ".download")
        with temp_path.open("wb") as f:
            while True:
                chunk = response.read(8 * 1024 * 1024)
                if not chunk:
                    break
                f.write(chunk)
                downloaded += len(chunk)
                if total:
                    percent = int(downloaded * 100 / total)
                    print(
                        f"downloading {dest.name}: {percent}% ({downloaded}/{total} bytes)",
                        end="\r",
                    )
        if total:
            print(f"downloading {dest.name}: 100% ({downloaded}/{total} bytes)")
        temp_path.replace(dest)


def ensure_checkpoint(
    checkpoint_path: Path,
    url: str | None,
    expected_sha256: str | None,
    timeout: int,
) -> None:
    if checkpoint_path.exists():
        if expected_sha256 is None:
            return
        current_hash = sha256_file(checkpoint_path)
        if current_hash == expected_sha256:
            return
        checkpoint_path.unlink()
    if url is None:
        raise RuntimeError(
            "Checkpoint is missing. Provide URL via --checkpoint-url or KURURI_MODEL_URL."
        )
    try:
        print(f"checkpoint not found. downloading from {url}")
        download_file(url, checkpoint_path, timeout)
    except (urllib.error.URLError, TimeoutError) as e:
        raise RuntimeError(f"Download failed: {e}") from e
    if expected_sha256 is not None:
        downloaded_hash = sha256_file(checkpoint_path)
        if downloaded_hash != expected_sha256:
            checkpoint_path.unlink(missing_ok=True)
            raise RuntimeError("Checksum mismatch after download.")
