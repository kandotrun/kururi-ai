# Kururi native runtime

`kururi-native` is the Rust release runtime for v2.0.0. It decodes an image,
applies EXIF orientation once, runs a weighted ONNX ensemble, optionally saves a
corrected copy, and reports structured timings and probabilities.

## Release ensemble

```sh
kururi-native predict \
  --model models/convnext-base-224.onnx --model-weight 0.5 \
  --model models/convnext-small-288.onnx --model-weight 0.4 \
  --fallback-model models/convnext-small-224.onnx \
  --fallback-weight 0.1 \
  --fallback-margin 0.033333333 \
  --parallel-models \
  --threads 12 \
  --image photo.jpg
```

The release launcher `scripts/kururi` supplies this configuration. Users
normally need only:

```sh
./kururi predict --image photo.jpg
```

Each ONNX graph has static input `[4,3,S,S]` and output `[4,4]`. The four batch
elements are rotations `[0,90,180,270]`. Softmax probabilities are aligned back
to the input coordinate system before averaging. The two general models execute
concurrently. The fallback graph is loaded lazily only when its probability
margin rule fires.

`--threads` is a total budget for the parallel general models. It defaults to
the available CPU count capped at 12. For two models, the budget is split
evenly. The fallback runs alone with the full budget.

## Image and save behavior

- Supported input: JPEG, PNG, WebP, TIFF, and BMP.
- EXIF orientation is applied exactly once.
- Native RGB resizing matches the validated Pillow 13 bilinear pipeline.
- HEIC, DNG, NEF, and other RAW containers are not decoded.
- `--output` writes only to a new file and uses an atomic no-clobber save.
- PNG alpha and 16-bit grayscale are preserved.
- Saved outputs do not retain source EXIF/ICC metadata.
- JPEG output uses the image-rs encoder's quality 75 and is not lossless.
- `--output-dir` preserves relative paths and skips symlinks.
- A directory run returns exit code 2 if any supported image fails.

`--min-confidence` controls abstention and prevents saving below its threshold.
The default is zero. The score is uncalibrated.

## Build

```sh
cargo build --release --locked
cargo test --locked
cargo clippy --all-targets --locked -- -D warnings
```

At runtime, provide ONNX Runtime 1.31 with API 31. The default search path is a
`libonnxruntime.dylib`, `libonnxruntime.so`, or `onnxruntime.dll` beside the
executable. `--runtime-library` and `ORT_DYLIB_PATH` override that path.

The exported graphs require their adjacent `.onnx.data` files. Do not copy only
the `.onnx` graph.

## Export

Export uses a batch size of four and embeds model metadata validated by the
runtime:

```sh
python export_onnx.py \
  --checkpoint /path/to/best.pt \
  --output models/convnext-small-288.onnx \
  --preprocess v2-whole224-bilinear-imagenet \
  --batch-size 4 \
  --recommended-views 4
```

Checkpoints declare the expected 224, 288, or 384 input size. The exporter uses
FP32, eval mode, opset 18, external data, ONNX validation, and a
PyTorch/ONNX Runtime parity check.

## Verification

```sh
python smoke_tests.py \
  --binary target/release/kururi-native \
  --report smoke-report.json
```

The synthetic suite covers EXIF orientation, save semantics, no-clobber atomic
writes, PNG alpha and 16-bit grayscale, abstention, recursive input, symlink
handling, raw-tensor refusal rules, Pillow-identical resizing, weighted
ensembles, and metadata checks. It does not establish trained-model accuracy.

Private photo manifests and per-image predictions must remain outside the
repository and public release archives.
