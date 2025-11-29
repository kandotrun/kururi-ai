# Kururi AI CLI

Image rotation classifier with a ViT model. The CLI runs on CPU, CUDA, or Apple MPS, auto-downloads the checkpoint from a GitHub Release, and supports single-file or recursive directory processing.

## Features
- Auto checkpoint download on first run (URL/sha256 configurable via args or env).
- Single image prediction or recursive directory batch processing.
- Optional saving of rotation-corrected images.
- Pure-Python CLI (no comments, typed, minimal dependencies).

## Requirements
- Python 3.12.9
- PyTorch, TorchVision, timm, Pillow (installed via `uv pip install -e cli`)

## Setup
```bash
cd /Users/kan/UGREEN-NAS/DEVELOP/kandotrun/kururi-ai
uv venv .venv
source .venv/bin/activate
uv pip install -e cli
```

## Model download
- If `models/kururi-orient-v1.pth` is missing, the CLI downloads it from the configured URL.
- Set URL and hash via args or environment variables:
```bash
export KURURI_MODEL_URL="https://github.com/<owner>/<repo>/releases/download/v0.1.0/kururi-orient-v1.pth"
export KURURI_MODEL_SHA256="<sha256sum>"
# optional
export KURURI_MODEL_TIMEOUT=1800
```
- Default URL is a placeholder: `https://github.com/OWNER/REPO/releases/download/v0.1.0/kururi-orient-v1.pth`. Replace it after publishing your Release.

## Usage
Single image:
```bash
uv run python cli/main.py predict \
  --image /path/to/image.jpg \
  --device cpu \
  --model-name vit_large_patch16_224 \
  --save-rotated /path/to/fixed.jpg
```

Recursive directory:
```bash
uv run python cli/main.py predict \
  --dir /path/to/images \
  --save-rotated-dir outputs \
  --device cpu \
  --model-name vit_large_patch16_224
```
Supported extensions: jpg, jpeg, png, bmp, tif, tiff, webp.

### Checkpoint options
- `--checkpoint` path (default `models/kururi-orient-v1.pth`)
- `--checkpoint-url` override download URL
- `--checkpoint-sha256` integrity check
- `--download-timeout` seconds (default 1800 or `KURURI_MODEL_TIMEOUT`)

## Publish the model to GitHub Release
1. Compute hash: `shasum -a 256 models/kururi-orient-v1.pth`
2. Create a Release and upload `kururi-orient-v1.pth` as an asset.
3. Update README, env examples, and default URL in code/CI with the Release URL and sha256.

## License
- Code and packaged model are released under the MIT License. See `LICENSE`.

## Japanese documentation
See `README.ja.md` for the Japanese version.
