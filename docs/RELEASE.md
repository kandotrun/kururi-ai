# Release v2.0.0

This checklist keeps local validation, CI, archive creation, GitHub publication,
and stable promotion as separate states.

## Release configuration

- Version and tag: `2.0.0`, `v2.0.0`.
- General models: ConvNeXt-Base 224 at 0.5 and ConvNeXt-Small 288 at 0.4.
- Preprocess: RGB whole-image Pillow bilinear resize, no crop, ImageNet
  normalization with class order `[0,90,180,270]`.
- Cascade: ConvNeXt-Small 224 at 0.1 when normalized top-one minus top-two
  probability margin is below `0.033333333`.
- Every ONNX graph has static batch 4 and recommended views 4.
- ONNX Runtime: 1.31.0, API 31.
- Rust runtime: `kururi-native` v2.0.0 with `ort` 2.0.0-rc.15.

## Required checks

Before publishing:

- Run `cargo fmt --check`.
- Run `cargo clippy --locked --all-targets -- -D warnings`.
- Run `cargo test --locked`.
- Run the synthetic native smoke suite after relocating the binary.
- Run native accuracy validation and frozen test with the exact release models.
- Build on macOS ARM64 and Linux x86-64.
- Extract each final runtime archive into a new directory and run real ensemble
  inference with the extracted binary, launcher, runtime library, and models.
- Verify `SHA256SUMS` for every final archive.
- Inspect archive contents for private photos, source paths, manifests,
  prediction logs, or build-directory leakage.
- Record the source commit and CI result before creating the public tag.

## Accuracy gate

The frozen release result is 700/704 (99.43%). Validation is 424/428 (99.07%).
Do not change model weights, ensemble weights, view count, or cascade threshold
after the final native test without creating a new independent test split.

The labels are provisional AI-reviewed values under the owner's mostly-upright
premise. Public reports contain aggregates only.

## Asset layout

Model archive:

```text
models/
  convnext-base-224.onnx
  convnext-base-224.onnx.data
  convnext-base-224.metadata.json
  convnext-base-224.onnx.export.json
  convnext-small-288.onnx
  convnext-small-288.onnx.data
  convnext-small-288.metadata.json
  convnext-small-288.onnx.export.json
  convnext-small-224.onnx
  convnext-small-224.onnx.data
  convnext-small-224.metadata.json
  convnext-small-224.onnx.export.json
  ensemble.json
  README.md
  MODEL_CARD.md
  BENCHMARK_REPORT.md
  THIRD_PARTY_NOTICES.md
  LICENSE
  licenses/
  upstream/
  SHA256SUMS
```

Platform runtime archive:

```text
kururi
kururi-native
libonnxruntime...
libonnxruntime_providers_shared.so    Linux only
README.md
MODEL_CARD.md
BENCHMARK_REPORT.md
RELEASE_NOTES.md
THIRD_PARTY_NOTICES.md
LICENSE
licenses/
runtime-inventory.json
SHA256SUMS
```

The user extracts one runtime archive and the model archive into the same
parent. The model archive creates `models/`. The `kururi` launcher then applies
the release ensemble automatically.

## Publication

Create GitHub release `v2.0.0` with:

- `kururi-ai-v2.0.0-model.tar.gz`
- `kururi-ai-v2.0.0-macos-arm64.tar.gz`
- `kururi-ai-v2.0.0-linux-x86_64.tar.gz`
- `SHA256SUMS`

Do not label Linux ARM64, Intel macOS, Core ML, CUDA, signing, or notarization as
supported without platform-specific evidence.
