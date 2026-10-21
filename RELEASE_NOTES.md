# Kururi AI v2.0.0

Kururi AI v2.0.0 replaces the v1 orientation model with a native Rust/ONNX
runtime and a three-model ConvNeXt ensemble.

## Results

| Metric | v1 | v2.0.0 | Change |
|---|---:|---:|---:|
| Frozen test rotations | 626/704 (88.92%) | 700/704 (99.43%) | +74 cases / +10.51 points |
| Scene-group macro accuracy | 83.35% | 99.36% | +16.01 points |
| All-four-correct sources | 141/176 (80.11%) | 175/176 (99.43%) | +34 images / +19.32 points |
| Incorrect rotations | 78 | 4 | 94.87% fewer |

The paired scene-group bootstrap improvement for rotation accuracy is +10.51
points with a 95% interval of +5.24 to +17.95.

- Validation: 424/428 rotations correct (99.07%).
- 4032×3024 JPEG fresh-process latency on Apple M4 Max: 418.6 ms median,
  461.5 ms p95.

## Changes

- Added a separate 11.9MB MobileNetV4 v2-nano WASM demo at
  https://kururi-ai.2-38.com/
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
