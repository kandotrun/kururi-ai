# Kururi AI v2

Kururi AI estimates the right-angle correction needed to make an image upright.
The v2 candidate uses a Rust CLI and an ONNX orientation model trained from an
ImageNet-pretrained image-classification backbone. The candidate selected on
validation data is `convnext_tiny.fb_in22k_ft_in1k`; MobileNetV4 was evaluated
earlier and is not part of this release asset.

**Status: experimental `v2.0.0-rc.1` candidate.** On the frozen 78-photo test
set, v2 scored 292/312 across four rotations versus 298/312 for v1. Four-view v2
was much faster on the benchmarked Mac, but the accuracy point estimate was
lower. Keep v1 as the stable default and read [the model card](MODEL_CARD.md)
before using this candidate.

## Build and run

The candidate uses ONNX Runtime on CPU. Source builds require Rust, a C/C++
linker, and Python 3.12 to obtain the runtime library. Keep the model's `.onnx`
file and its external data file, when present, in the same directory.

```sh
cargo build --release --locked --manifest-path native/Cargo.toml
python3.12 -m venv .venv-native
.venv-native/bin/python -m pip install -r native/requirements-native.txt
.venv-native/bin/python scripts/prepare_native_runtime.py \
  --binary native/target/release/kururi-native \
  --destination dist/native-runtime
./dist/native-runtime/kururi-native predict \
  --model models/kururi-orient-v2.onnx \
  --image /path/to/photo.jpg
```

The model must contain v2 preprocessing and class-order metadata. Model
provenance and artifact hashes are documented in its model card and metadata.
The source checkout does not include private training photos.

Save a corrected copy to a new path:

```sh
./dist/native-runtime/kururi-native predict \
  --model models/kururi-orient-v2.onnx \
  --image /path/to/photo.jpg \
  --output /path/to/corrected.jpg
```

Process a directory with one loaded model session:

```sh
./dist/native-runtime/kururi-native predict \
  --model models/kururi-orient-v2.onnx \
  --dir /path/to/photos \
  --output-dir /path/to/new-output-directory
```

The CLI supports JPEG, PNG, WebP, TIFF and BMP. It skips symlinks during directory
traversal. Existing output files and directories are rejected. Directory results
include per-file errors, and the command exits with code 2 when any file fails.
HEIC, DNG, NEF and other RAW containers are not decoded by this binary. Convert
them to a supported display image before inference and retain the original
EXIF orientation during that step.

The native executable loads an ONNX Runtime shared library. The helper stages
the binary, runtime and runtime notices in a new directory; it is not the final
release packaging step. Keep the runtime library beside the executable. A
prepared native runtime does not require Python to run. An explicit
`--runtime-library` or `ORT_DYLIB_PATH` can override the sibling library.
Complete release archives also need the project and Cargo dependency licenses.

## Rotation and output

EXIF orientation is applied before prediction. `correction_cw` is the clockwise
rotation, in degrees, to apply to those displayed pixels: `0`, `90`, `180` or
`270`. The same direction is used when saving a corrected image.

Saved copies are re-encoded from the original-resolution, oriented pixels.
The RGB conversion for inference does not replace the saved source pixels.
Original EXIF and ICC metadata are not copied; JPEG saving is not lossless.
Without an output option, input files are only read.
The current JPEG encoder uses quality 75.

`--min-confidence` optionally abstains below a softmax threshold and avoids
saving that image. Its default is `0`, which accepts every prediction. This
score is not calibrated, and a high value does not guarantee a correct rotation.

## Performance and evaluation

For single-image waiting time, measure wall time around each newly started CLI
process. `internal_total_ms` excludes process launch, dynamic loading, JSON
printing and teardown. Repeated `--runs` measurements reuse a loaded session and
input, so they are inference microbenchmarks, not single-command latency.

Current native inference is CPU-only. Core ML, MPS and CUDA are not enabled in
this Rust candidate. See [the model card](MODEL_CARD.md) for the exact hardware,
formats, test size and measurements used for any performance claim.

The selected model recommends four views in its embedded metadata. Four-view
prediction rotates the input tensor, runs four forwards and averages their
probabilities after aligning the correction classes. An explicit `--views 1`
override is experimental and had only 66.0% test accuracy for this checkpoint.
`--threads` defaults to the available CPU count capped at eight.

Training and evaluation procedures are in [docs/TRAINING.md](docs/TRAINING.md).
Release criteria and packaging checks are in [docs/RELEASE.md](docs/RELEASE.md).

## v1 compatibility

The Python CLI and original ViT model remain separately available. See
[legacy v1 usage](docs/LEGACY_V1.md). v1's `angle_ccw` field name did not describe
the direction its save operation applied; v2 uses the explicit `correction_cw`
field. v2 also applies EXIF orientation and uses a different preprocessing
pipeline. Do not swap v1 and v2 weights without the matching runtime pipeline.

## License and attribution

Project code is MIT licensed. The v2 model is fine-tuned from Apache-2.0
pretrained weights, and its distribution includes the relevant license and
upstream attribution. The project code license does not replace model or
dependency license terms. See [third-party notices](THIRD_PARTY_NOTICES.md).

The original v1 orientation model was created by
[Yuki Arano / 新野ユキ](https://github.com/ObuchiYuki). This attribution is
retained for the legacy model; v2 fine-tuning and its limitations are described
separately in the model card.

[日本語](README.ja.md)
