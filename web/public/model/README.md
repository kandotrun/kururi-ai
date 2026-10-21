# v2-nano model files

`kururi-ai-v2-nano-small.onnx` and `kururi-ai-v2-nano.onnx` are the two QDQ INT8
models used by the browser demo. See `metadata.json` for hashes, weights,
preprocessing, and aggregate evaluation.

The weights are derivatives of Apache-2.0 timm MobileNetV4 models. Upstream
cards and provenance are in `upstream-small/` and `upstream-medium/`.
