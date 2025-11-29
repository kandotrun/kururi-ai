from pathlib import Path
from types import SimpleNamespace

import pytest

from cli.download_utils import ensure_checkpoint, sha256_file


class _MockResponse:
    def __init__(self, data: bytes):
        self._data = data
        self._read_offset = 0
        self.headers = {"Content-Length": str(len(data))}

    def read(self, size: int) -> bytes:
        if self._read_offset >= len(self._data):
            return b""
        chunk = self._data[self._read_offset : self._read_offset + size]
        self._read_offset += len(chunk)
        return chunk

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        return False


def test_sha256_file(tmp_path: Path):
    data = b"abc123"
    target = tmp_path / "file.bin"
    target.write_bytes(data)
    assert (
        sha256_file(target)
        == "6ca13d52ca70c883e0f0bb101e425a89e8624de51db2d2392593af6a84118090"
    )


def test_ensure_checkpoint_downloads_and_verifies(monkeypatch, tmp_path: Path):
    data = b"hello"
    expected_hash = "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
    dest = tmp_path / "model.pth"

    def _urlopen(_req, timeout):
        return _MockResponse(data)

    monkeypatch.setattr("cli.download_utils.urllib.request.urlopen", _urlopen)
    ensure_checkpoint(dest, "http://example.com/model.pth", expected_hash, timeout=5)
    assert dest.read_bytes() == data


def test_ensure_checkpoint_checksum_fail(monkeypatch, tmp_path: Path):
    data = b"bad"
    dest = tmp_path / "model.pth"

    def _urlopen(_req, timeout):
        return _MockResponse(data)

    monkeypatch.setattr("cli.download_utils.urllib.request.urlopen", _urlopen)
    with pytest.raises(RuntimeError):
        ensure_checkpoint(dest, "http://example.com/model.pth", "deadbeef", timeout=5)
