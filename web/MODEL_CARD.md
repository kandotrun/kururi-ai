# Kururi AI v2-nano model card

## Status

`v2-nano-demo.2` is a browser demonstration model. It does not replace the
full `v2.0.0` Rust/ONNX release.

The model predicts a clockwise correction in `0`, `90`, `180`, or `270`
degrees. It is intended for demonstrating multi-image orientation correction
entirely inside a browser tab.

## Architecture

| Role | Backbone | Weight | Quantized bytes |
|---|---|---:|---:|
| Small | `mobilenetv4_conv_small.e2400_r224_in1k` | 0.18 | 2,788,640 |
| Medium | `mobilenetv4_conv_medium.e500_r224_in1k` | 0.82 | 9,119,801 |

Both models use QDQ static INT8 quantization. Inputs are FP32 RGB NCHW
`[1,3,224,224]`. Four rotations are evaluated separately, inverse-aligned, and
averaged. The two model distributions are then weighted.

## Training data

Training combines:

- 541 images from the private `dataset-v9` training split.
- 1,009 Wikimedia Commons images.
- 1,521 iNaturalist observations.
- 894 synthetic UI images.

Validation uses 107 private images and 35 scene groups. The 99-image/46-group
`dataset-v9` test split is excluded from training. Training uses teacher KL
loss from Kururi v1+v2 private teachers and upright one-hot labels for public
images.

The public data is not redistributed with the demo. Upstream repository,
license, and attribution metadata is included in `public/model/`.

## Evaluation

The native Python ONNX Runtime evaluator uses the same 224×224 preprocessing,
four rotations, alignment, and ensemble weights as the browser worker.

| Split | Correct rotations | Accuracy | Scene-group macro |
|---|---:|---:|---:|
| Validation | 400/428 | 93.46% | 87.82% |
| Frozen test | 324/396 | 81.82% | 75.27% |

The full `v2.0.0` ensemble scores 99.43% on its separate release test. The Nano
model's lower accuracy is a deliberate size tradeoff.

## Runtime

- ONNX Runtime Web 1.23.2, WASM execution provider.
- Single-thread WASM for static hosting without cross-origin isolation.
- Model download: 11.9MB.
- Measurement is shown per image in the UI.

## License

Model derivatives are based on Apache-2.0 timm MobileNetV4 weights. The demo
code is MIT. ONNX Runtime Web is MIT. Exact project notices and upstream
provenance are included in the build.

## Limits

This is not calibrated confidence, arbitrary-angle correction, HEIC/RAW support,
or a replacement for the full CLI. The browser controls supported input
formats. The test labels remain provisional and the test set is small.
