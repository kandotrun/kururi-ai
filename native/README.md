# Native runtime candidate

This is a local release candidate and benchmark harness. Its build and numeric
validation status must be reported from actual checks, not inferred from source.

## Scope

- `--tensor` takes exactly 602,112 bytes: little-endian FP32 NCHW `[1,3,224,224]`.
  This is an inference harness and **excludes image decoding/preprocessing**.
- `--image` decodes locally, applies EXIF orientation, converts RGB, resizes the
  entire image to 224×224 using the Pillow 13 compatible RGB8 bilinear resampler,
  normalizes with ImageNet mean
  and standard deviation, and runs the model. It requires embedded v2 metadata.
- The resampler follows Pillow 13's fixed-point coefficients and pass order;
  see [resample-notes.md](resample-notes.md). Different image decoders may still
  produce different pixels, so validate actual input formats before release.
- `--output` writes only a new file. No original or existing file is overwritten.
  Its pixels already have EXIF orientation applied; original EXIF/ICC metadata
  is not copied. PNG output preserves alpha and bit depth. JPEG output is
  re-encoded with image-rs's default quality 75 and is not lossless. Encoded
  pixels are staged before an atomic no-clobber save; a failed encode leaves no
  final output file.
- The default confidence threshold is zero; `--min-confidence` allows abstention.
  Softmax confidence is not yet calibrated, so this is not a safety guarantee.
- `internal_total_ms` begins inside Rust `main` and excludes process launching,
  executable loader setup, JSON printing and process teardown. It includes the
  explicit ONNX Runtime library load under `environment_ms`. Measure wall time
  around each new process separately for the user-facing single-image latency.
- Timings from repeated `--runs` share one loaded session and input.
- `--views` defaults to the model's embedded `kururi.recommended_views` value.
  The selected ConvNeXt v2 candidate requires four views for its reported accuracy.
  Four views rotate the preprocessed tensor, run four forwards, align class
  probabilities and average them. Reports include all four inference durations.
  An explicit `--views 1` override is experimental for that model and does not
  carry its four-view accuracy claim.
- CPU selection is explicit. ort 2.0.0-rc.15 otherwise automatically selects
  Core ML on macOS via its default efficiency policy.

## Commands

```sh
cargo build --release --locked
./target/release/kururi-native predict --model model.onnx --tensor input.f32 --threads 1 --runs 1
./target/release/kururi-native predict --model model.onnx --image photo.jpg
./target/release/kururi-native predict --model model.onnx --dir ./photos
./target/release/kururi-native predict --image photo.jpg --preprocess-only --write-input input.f32
```

Runtime setup for local development:

```sh
# Install onnxruntime==1.31.0 in a Python environment, then copy its native library:
cp /path/to/site-packages/onnxruntime/capi/libonnxruntime.1.31.0.dylib \
  target/release/libonnxruntime.dylib
```

On Linux use the wheel's `libonnxruntime.so.*`, installed next to the executable
as `libonnxruntime.so`. `--runtime-library PATH` or `ORT_DYLIB_PATH` overrides this
search. The Python environment is only a source of the runtime library; the
packaged executable does not import Python. Include ONNX Runtime's `LICENSE` and
`ThirdPartyNotices.txt` when redistributing its library.

Export a frozen v2 checkpoint in a Python environment containing PyTorch, timm,
ONNX, ONNXScript, and ONNX Runtime:

```sh
python export_onnx.py \
  --checkpoint /path/to/frozen-best.pt \
  --output models/kururi-v2.onnx \
  --preprocess v2-whole224-bilinear-imagenet \
  --recommended-views 4
```

Export v1 only as a control, preserving its existing architecture and class order:

```sh
python export_onnx.py \
  --checkpoint /path/to/kururi-orient-v1.pth \
  --model-name vit_large_patch16_224 \
  --output models/kururi-v1.onnx \
  --preprocess v1-autocrop224-no-normalization
```

Keep any `.onnx.data` file beside the `.onnx` file. `export_onnx.py` uses the
checkpoint's exact weights, static batch one, FP32, eval mode, opset 18, external
data, ONNX validation and a single-tensor PyTorch/ONNX Runtime CPU parity check.
Runtime validation must additionally check real image tensors.
The adjacent `.metadata.json` records the pipeline, class order and model hashes;
the executable validates preprocessing and class semantics embedded in ONNX.
Directory processing skips unsupported formats and symlinks, preserves relative
paths under a new output directory, and returns exit code 2 for per-image errors.

## API provenance

- ort pinned `2.0.0-rc.15`, ONNX Runtime `1.31.0`; APIs inspected in the downloaded
  crate and [official docs](https://docs.rs/ort/2.0.0-rc.15/ort/session/struct.Session.html).
- image pinned `0.25.10`; EXIF decoder orientation and `apply_orientation` inspected
  in its downloaded source and [official docs](https://docs.rs/image/0.25.10/image/).
- The executable links a native ONNX Runtime library. Packaging must include its
  required dynamic library and license/notice files; a binary alone is insufficient.
- The runtime is explicitly loaded at startup. The crate's prebuilt static runtime
  failed to link on this Mac with `___isPlatformVersionAtLeast` unresolved; the
  matching official ONNX Runtime 1.31 Python wheel's dynamic library was verified.
