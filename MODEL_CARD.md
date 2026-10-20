# Kururi AI orientation model v2.0.0

## Status

`v2.0.0` is the first Kururi release that replaces v1 as the recommended
orientation pipeline. It predicts a right-angle clockwise correction in
`0`, `90`, `180`, or `270` degrees.

The release is a three-model ConvNeXt ensemble with a validation-selected
low-confidence cascade. On the frozen private test set it scored 700/704
rotations (99.43%) in the native Rust/ONNX runtime. The v1 checkpoint scored
626/704 (88.92%) on the identical canonical pixels and rotations.

The result is conditional on a small owner-provided test collection and
provisional AI-reviewed orientation labels. It demonstrates the measured
release criterion, not universal photographic accuracy.

## Intended use

The model is intended for still images where the correct result is one of four
right-angle rotations. Typical examples are phone screenshots, documents,
scanned pages, maps, people, and ordinary camera scenes.

It does not estimate small tilt angles, camera pose, the intended reading order
inside a screenshot, or a unique upright direction for symmetric and abstract
content. It can rotate an already upright image incorrectly. Saving is opt-in
and never overwrites the source image.

## Ensemble

The models use ImageNet normalization, RGB input, NCHW layout, and class order
`[0,90,180,270]` meaning clockwise correction.

| Role | Backbone | Input | Ensemble weight | Checkpoint SHA256 |
|---|---|---:|---:|---|
| General | `convnext_base.fb_in22k_ft_in1k` | 224×224 | 0.5 | `62e3bfdfa6e821f4ce600de894af593c8561bd2d3c3ca090a2c2396d64135f9f` |
| General | `convnext_small.fb_in22k_ft_in1k` | 288×288 | 0.4 | `bf07348b61fd4c012ce555d54fe7bfddd71373ee5e22100ce49f8fcb6f451d35` |
| Cascade | `convnext_small.fb_in22k_ft_in1k` | 224×224 | 0.1 | `4b1f1209f950d11ee8fbc1ea7388e74c07916f8591356555d58523fe533b1e8b` |

Each model receives all four rotations `[0,90,180,270]` as one batch. The
runtime aligns each class back to the input coordinate system and averages the
four softmax distributions. The two general models are weighted 0.5 and 0.4.
The 224-pixel cascade model is loaded only when the normalized top-one minus
top-two probability margin is below `0.033333333`, and its full weight is 0.1.

The cascade rule is a latency optimization selected on validation data. It
invokes the third model for 8/428 validation rotations and 24/704 test
rotations. Every model's ONNX input is static batch 4, so the four rotations
execute in one ONNX Runtime call per model.

### ONNX artifacts

| Artifact | Graph SHA256 | External data SHA256 | Total bytes |
|---|---|---|---:|
| `convnext-base-224.onnx` | `c6b208e7d60733a0665b889e91f1f2a5aa91de2904e011e868d6d788b2935f42` | `edd2c08881fcee5407c48bbfcfabd0018ace8cf0a63b7883a27f661b6292c833` | 351,746,177 |
| `convnext-small-288.onnx` | `3f81e598475bd51f0a02581d21051146c737fdb324e1de48b139a7df23563cdc` | `983e83a68323b0785acaf4abd4a62f1d04c497521e86ed4e296409fd8f1f07f7` | 199,309,562 |
| `convnext-small-224.onnx` | `343f9ff1394725f4f69b37aabf6cc0de915a074cd6e54e719825c5d5689d4cea` | `5321c288da8eed5f46a8eff8c9272252622adb4be5391c3ab5f70452976d5192` | 199,309,562 |

Total model storage is 750,365,301 bytes. Every graph requires its adjacent
`.onnx.data` file.

Export used PyTorch 2.14.1, timm 1.0.30, ONNX 1.23.2, ONNX Runtime 1.31.0,
ONNXScript 0.7.2, FP32 weights, opset 18, eval mode, and a static batch of four.
Random-tensor PyTorch/ONNX parity checks passed with maximum absolute logit
differences below `0.000008`.

## Data

### Private orientation data

The source images came from the owner's photo collection. The owner reported
that most images were already upright. Correctness at test time is therefore
partly based on an owner premise plus an independent AI visual review, not a
fully human-verified annotation project.

The release split is grouped by source and scene before rotation augmentation:

| Split | Sources | Scene groups | Rotation cases |
|---|---:|---:|---:|
| Train | 438 | 202 | 1,752 |
| Validation | 107 | 35 | 428 |
| Test | 176 | 78 | 704 |

Exact and cross-format duplicates do not cross splits. Canonical pixels are
EXIF-transposed RGB, maximum dimension 1,024, with EXIF removed. DNG and NEF
inputs use embedded JPEG previews. Source images and per-photo evidence are
private and are not part of this repository or public release archives.

### Public and synthetic experiments

Additional upright data was collected from 1,120 Wikimedia Commons files and
1,700 iNaturalist observations. A separate set of 1,000 synthetic UI fixtures
was also generated. The public candidates were evaluated in the recorded
iterations v6-v9 and were useful for testing domain expansion, but they did not
replace the validation-selected v5 general models. The shipped Small-224 model
uses 958 synthetic UI fixtures together with private training sources.

Wikimedia attribution and license URLs remain in the private manifests. The
public collection is not redistributed in the release archives.

## Evaluation

All accuracy runs use the same canonical pixels, 78 scene groups, four synthetic
rotations per source, and class correction `(-applied_rotation) mod 360`.
Confidence intervals resample scene groups rather than treating rotations as
independent observations.

| Metric | v1 | v2 native |
|---|---:|---:|
| Rotations correct | 626/704 (88.92%) | 700/704 (99.43%) |
| Scene-group macro accuracy | 83.35% | 99.36% |
| Sources correct on all four rotations | 141/176 (80.11%) | 175/176 (99.43%) |
| Screen rotations | 111/176 (63.07%) | 176/176 (100%) |
| Scene rotations | 199/208 (95.67%) | 208/208 (100%) |

The paired scene-group bootstrap difference for v2 minus v1 was:

| Metric | Difference | 95% interval |
|---|---:|---:|
| Rotation accuracy | +10.51 points | +5.24 to +17.95 |
| Scene-group macro accuracy | +16.01 points | +9.52 to +22.86 |
| All-four-correct source fraction | +19.32 points | +11.17 to +30.66 |

The intervals remain conditional on this private collection and its provisional
labels. They do not establish accuracy on all cameras, cultures, document
layouts, screen contents, or unusual compositions.

### Native accuracy validation

- Validation: 424/428 (99.07%), 8 cascade invocations.
- Frozen test: 700/704 (99.43%), 24 cascade invocations.
- Native execution returned no per-image errors.
- The final native class counts agree with the pre-export ensemble evaluation.

## Speed

Measurements use Apple M4 Max, 128 GiB RAM, macOS 27.0.1 ARM64, ONNX Runtime
1.31.0 CPU, 12 total model threads split across the two concurrently running
general models. Source images were on the NAS and the operating-system file
cache was warm.

| Operation | Median | p95 | Trials |
|---|---:|---:|---:|
| v1 process, 4032×3024 JPEG | 3,932 ms | 4,420 ms | 5 |
| v2 final process, 4032×3024 JPEG | 418.6 ms | 461.5 ms | 7 |
| v2 native item, 704 test rotations | 185.7 ms | 243.6 ms | 704 |

The final process includes process launch, ONNX Runtime loading, parallel model
session loading, JPEG decoding, native preprocessing, two general models,
four-view inference, optional cascade inference, and JSON output. The cascade
model is not loaded on the high-confidence path. These are not cold-storage
measurements. Linux benchmark numbers must be measured on Linux hardware and
must not be inferred from macOS or from an emulated container.

## Limits

- The native decoder supports JPEG, PNG, WebP, TIFF, and BMP. HEIC, DNG, NEF,
  and RAW containers currently require conversion with EXIF orientation
  preserved.
- Saved outputs omit original EXIF/ICC metadata. JPEG output is re-encoded and
  is not lossless.
- The ensemble is large because the accuracy target required three FP32 models.
- Softmax confidence is not a calibrated correctness probability.
- The test set is small and its labels are not a fully independent human gold
  standard.
- The release model is transfer learning from ImageNet-pretrained weights, not
  a model trained from random initialization.

## License and attribution

Project code is MIT licensed. The released model weights are derivatives of
timm ConvNeXt weights whose model cards declare Apache-2.0. ONNX conversion,
the four-class heads, fine-tuning, and ensemble are modifications.

The legacy v1 orientation model was created by
[Yuki Arano / 新野ユキ](https://github.com/ObuchiYuki). Its attribution remains
in the legacy documentation and third-party notices.
