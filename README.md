# Kururi AI v2.0.0

Kururi AI estimates a clockwise image correction of `0`, `90`, `180`, or
`270` degrees. The v2 Rust/ONNX CLI combines three ConvNeXt models. Two general
models run on every image; the third is loaded only for close decisions.

On the frozen private test set's identical 704 rotations, v1 scored 626/704
(88.92%) and v2 scored 700/704 (99.43%). For a 4032×3024 JPEG, fresh-process
wall time on Apple M4 Max was 418.6 ms median and 461.5 ms p95.

## Improvement over v1

| Metric | v1 | v2.0.0 | Change |
|---|---:|---:|---:|
| Correct rotations | 626/704 (88.92%) | **700/704 (99.43%)** | **+74 cases / +10.51 points** |
| Scene-group macro accuracy | 83.35% | **99.36%** | **+16.01 points** |
| Sources correct on all four rotations | 141/176 (80.11%) | **175/176 (99.43%)** | **+34 images / +19.32 points** |
| Incorrect rotations | 78 | **4** | **94.87% fewer** |
| 12MP JPEG wall time | 3,932 ms | **418.6 ms** | **about 9.4× faster** |

The screen category improved from 111/176 to **176/176**, and scenes improved
from 199/208 to **208/208**. All four remaining errors came from the same
closeup source. The paired scene-group 95% interval for rotation accuracy
improvement is **+5.24 to +17.95 points**.

The latency comparison is for the same source image on macOS ARM64. v1 used its
Python/MPS path; v2 uses the Rust/ONNX CPU path.

## Download

The release is available on
[GitHub Releases v2.0.0](https://github.com/kandotrun/kururi-ai/releases/tag/v2.0.0).

- [Browser v2-nano demo](https://kandotrun.github.io/kururi-ai/)
- `kururi-ai-v2.0.0-macos-arm64.tar.gz`
- `kururi-ai-v2.0.0-linux-x86_64.tar.gz`
- `kururi-ai-v2.0.0-model.tar.gz`
- `SHA256SUMS`

The browser demo runs an approximately 11.9MB Nano ensemble with ONNX Runtime
Web/WASM and shows batch correction without uploading images. Nano is a separate
demo model at 81.82% on its frozen test, distinct from the full v2.0.0 result.

Read [the model card](MODEL_CARD.md) and
[benchmark report](BENCHMARK_REPORT.md) for the 176-image test set, provisional
labels, hashes, speed conditions, uncertainty, and limitations. The 99.43%
result is a measured point estimate on this collection, not a claim of universal
accuracy.

## Release usage

The runtime archive contains `kururi-native`, `kururi`, and the ONNX Runtime
shared library. The model archive contains three `.onnx` files, their adjacent
`.onnx.data` files, license notices, and metadata.

After extracting both archives into the same parent directory:

```sh
./kururi predict --image /path/to/photo.jpg
```

If the models are elsewhere:

```sh
KURURI_MODEL_DIR=/path/to/models \
  ./kururi predict --image /path/to/photo.jpg
```

Save a corrected copy:

```sh
./kururi predict \
  --image /path/to/photo.jpg \
  --output /path/to/corrected.jpg
```

Reuse the loaded models across a directory:

```sh
./kururi predict \
  --dir /path/to/photos \
  --output-dir /path/to/new-output-directory
```

Existing outputs are rejected. Directory traversal skips symlinks. Per-image
errors remain in the JSON result, and any failed image makes the exit code `2`.

The native decoder supports JPEG, PNG, WebP, TIFF, and BMP. HEIC, DNG, NEF, and
other RAW containers currently require conversion. Preserve their EXIF
orientation during conversion.

## Build from source

Building requires Rust 1.96 or newer, a C/C++ linker, and Python 3.12 to obtain
the ONNX Runtime library.

```sh
cargo build --release --locked --manifest-path native/Cargo.toml
python3.12 -m venv .venv-native
.venv-native/bin/python -m pip install -r native/requirements-native.txt
.venv-native/bin/python scripts/prepare_native_runtime.py \
  --binary native/target/release/kururi-native \
  --destination dist/native-runtime
```

Place the release models under `dist/native-runtime/models/` to use the bundled
`kururi` launcher. Python is not needed after the runtime has been staged.

The equivalent direct native invocation is:

```sh
./kururi-native predict \
  --model models/convnext-base-224.onnx --model-weight 0.5 \
  --model models/convnext-small-288.onnx --model-weight 0.4 \
  --fallback-model models/convnext-small-224.onnx \
  --fallback-weight 0.1 \
  --fallback-margin 0.033333333 \
  --parallel-models \
  --threads 12 \
  --image /path/to/photo.jpg
```

## Input and output

EXIF orientation is applied once to the decoded pixels. `correction_cw` is the
clockwise rotation to apply to those displayed pixels. Saving uses the same
direction at the source resolution.

Saved files omit the original EXIF/ICC metadata. JPEG output is re-encoded at
quality 75 and is not lossless. With no output option, source images are read
only and never overwritten.

`--min-confidence` can abstain below a softmax threshold and avoid saving a
file. Its default is `0`. Softmax confidence is not calibrated, so a high score
does not prove correctness.

Each model receives the four rotations as one batch. The two general models run
concurrently. The Small-224 cascade is loaded and evaluated only when the
normalized top-one minus top-two margin is below `0.033333333`.

## Data and evaluation

Orientation training, validation, and testing use private owner-provided
photographs. EXIF-transposed RGB pixels are normalized to a maximum side of
1,024, and source/scene groups do not cross train, validation, and test.

As an additional experiment, 1,120 Wikimedia Commons photographs, 1,700
iNaturalist observations, and 1,000 synthetic UI fixtures were collected and
evaluated through candidate generations v6-v9. The selected release uses the
validation-selected v5 models; the Wikimedia and iNaturalist candidates are not
part of the shipped weights. The Small-224 model does include 958 synthetic UI
training fixtures.

Source photographs, private paths, and per-photo predictions are not published.
See [MODEL_CARD.md](MODEL_CARD.md) for aggregate evaluation and provenance.

## v1 compatibility

The original Python CLI and ViT model remain documented in
[legacy v1 usage](docs/LEGACY_V1.md). v1's `angle_ccw` field did not describe
the direction applied by its save path. v2 uses `correction_cw`. The v1 and v2
weights require different preprocessing and cannot be swapped directly.

## License

Project code is MIT licensed. The v2 weights are derivatives of timm ConvNeXt
pretrained weights whose model cards declare Apache-2.0. Classifier replacement,
orientation fine-tuning, ONNX conversion, and ensembling are modifications.
See [third-party notices](THIRD_PARTY_NOTICES.md).

Dependency-audit and private vulnerability-reporting policies are documented
in [SECURITY.md](SECURITY.md) and
[docs/DEPENDENCIES.md](docs/DEPENDENCIES.md).

The legacy v1 orientation model was created by
[Yuki Arano / 新野ユキ](https://github.com/ObuchiYuki).

[Japanese](README.ja.md)
