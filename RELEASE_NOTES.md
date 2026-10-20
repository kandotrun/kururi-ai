# Kururi AI v2.0.0

Kururi AI v2.0.0 replaces the v1 orientation model with a native Rust/ONNX
runtime and a three-model ConvNeXt ensemble.

## Results

- Frozen test: 700/704 rotations correct (99.43%).
- v1 on the same 704 rotations: 626/704 (88.92%).
- Paired scene-group bootstrap improvement: +10.51 points, 95% interval
  +5.24 to +17.95.
- Validation: 424/428 rotations correct (99.07%).
- 4032×3024 JPEG fresh-process latency on Apple M4 Max: 418.6 ms median,
  461.5 ms p95.

## Changes

- Switched to Rust with ONNX Runtime 1.31 CPU execution.
- Added ConvNeXt-Base 224 and ConvNeXt-Small 288 general models.
- Added a validation-selected Small-224 cascade for low-margin decisions.
- Batched all four orientation views into one ONNX input per model.
- Added parallel model loading and inference for the two general models.
- Added lazy loading for the cascade model.
- Added a portable `kururi` launcher with the release configuration.
- Preserved no-overwrite output behavior and atomic corrected-image saves.

## Assets

- `kururi-ai-v2.0.0-model.tar.gz`
- `kururi-ai-v2.0.0-macos-arm64.tar.gz`
- `kururi-ai-v2.0.0-linux-x86_64.tar.gz`
- `SHA256SUMS`

Extract the runtime archive and model archive into the same parent directory.
The model archive creates `models/`; `./kururi predict --image photo.jpg` then
uses the recommended ensemble.

## Limitations

The model corrects only right-angle rotations. It does not estimate arbitrary
tilt. The 176-source test set is private and uses provisional AI-reviewed
labels. Native decoding supports JPEG, PNG, WebP, TIFF, and BMP; HEIC and RAW
require conversion. Saved outputs omit source EXIF/ICC metadata and JPEG output
is re-encoded.

See `MODEL_CARD.md` and `README.md` for the full contract.
