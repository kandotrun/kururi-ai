# Kururi AI v2.0.0 benchmark report

## Outcome

The native Rust/ONNX v2.0.0 ensemble met the requested accuracy threshold on
the frozen private test collection:

| System | Correct rotations | Accuracy | Scene-group macro | All four correct |
|---|---:|---:|---:|---:|
| v1 | 626/704 | 88.92% | 83.35% | 141/176 (80.11%) |
| v2.0.0 native | 700/704 | 99.43% | 99.36% | 175/176 (99.43%) |

The paired scene-group bootstrap differences were:

| Metric | v2 - v1 | 95% interval |
|---|---:|---:|
| Rotation accuracy | +10.51 points | +5.24 to +17.95 |
| Scene-group macro accuracy | +16.01 points | +9.52 to +22.86 |
| All-four-correct source fraction | +19.32 points | +11.17 to +30.66 |

The intervals use 20,000 deterministic scene-group resamples and remain
conditional on this private image collection.

## Evaluation contract

- 176 source images and 78 source groups.
- Four synthetic right-angle rotations per source: 704 cases.
- Exact and cross-format duplicates removed before splitting.
- Canonical inputs are EXIF-transposed RGB pixels with maximum side 1,024.
- The same canonical pixels and rotations were used for v1 and v2.
- Source and scene groups do not cross train, validation, and test.
- Orientation labels use the owner's mostly-upright premise and an independent
  AI visual review. They are provisional, not a fully human-verified gold set.
- The four rotations of one source are not treated as independent observations
  in uncertainty estimates.

## Model selection

The selected configuration was frozen before final native evaluation:

| Role | Model | Input | Weight |
|---|---|---:|---:|
| General | ConvNeXt-Base | 224 | 0.5 |
| General | ConvNeXt-Small | 288 | 0.4 |
| Cascade | ConvNeXt-Small | 224 | 0.1 |

Each model evaluates all four input rotations in one batch. Probabilities are
inverse-aligned to correction classes and averaged within each model. General
model probabilities are then weighted. The Small-224 cascade is invoked only
when the normalized top-one minus top-two margin is below `0.033333333`.

Validation result: 424/428 (99.07%). The cascade fired for 8/428 validation
cases. On test it fired for 24/704 cases (3.41%).

## Errors

The four v2 errors came from one scene group. The remaining 77 test groups were
perfect across all four rotations. By category:

| Category | Correct / Cases |
|---|---:|
| Closeup | 132/136 |
| Document | 16/16 |
| Food | 4/4 |
| People | 164/164 |
| Scene | 208/208 |
| Screen | 176/176 |

This aggregate still does not prove equal performance in unrelated datasets.

## Latency

Hardware and runtime:

- Apple M4 Max, 128 GiB RAM.
- macOS 27.0.1 ARM64.
- ONNX Runtime 1.31.0, API 31.
- `ort` 2.0.0-rc.15, ONNX Runtime CPU provider.
- 12 total model threads; two general models run concurrently.

Single-image wall time starts a fresh process for every trial and includes
executable launch, shared-library loading, model session creation, image decode,
preprocessing, inference, and JSON output.

| Workload | Median | p95 | Trials |
|---|---:|---:|---:|
| v1, 4032×3024 JPEG | 3,932 ms | 4,420 ms | 5 |
| v2, 4032×3024 JPEG | 418.6 ms | 461.5 ms | 7 |

The 704-case native accuracy run reused model sessions:

- Item wall time median: 185.7 ms.
- Item wall time p95: 243.6 ms.
- The first cascade invocation includes lazy model loading.

Source files were on the NAS with a warm operating-system file cache. These are
not cold-storage measurements. Linux x86-64 execution was checked under
emulation; it is functional evidence and not a Linux latency benchmark.

## Public-data experiment

The project additionally collected and validated:

- 1,120 Wikimedia Commons photographs.
- 1,700 iNaturalist observations.
- 1,000 synthetic UI fixtures.

Candidates using expanded public data were trained and evaluated through the
v6-v9 iterations. The final shipped general models remain the validation-selected
v5 models; the public Wikimedia/iNaturalist candidates did not replace them.
The Small-224 cascade includes 958 synthetic UI training fixtures.

## Browser v2-nano experiment

A separate browser model was trained from MobileNetV4 Conv Small and Conv
Medium with QDQ INT8 quantization. The combined artifacts are 11.9MB.

| Metric | v2-nano |
|---|---:|
| Validation rotations | 400/428 (93.46%) |
| Validation scene-group macro | 87.82% |
| Frozen test rotations | 324/396 (81.82%) |
| Frozen test scene-group macro | 75.27% |

The browser uses four aligned views and is intended for interactive
demonstration. It does not replace the full Rust v2.0.0 accuracy result.

## Reproducibility and privacy

The release includes:

- Exact ONNX graphs, external data, metadata, and SHA256 hashes.
- Checkpoint hashes and upstream ConvNeXt provenance.
- Rust source and locked dependencies.
- Synthetic runtime tests for image handling and ensemble weighting.
- Aggregate validation, test, and latency evidence.

Private photographs, paths, source IDs, manifests, and per-photo predictions are
not distributed. A third party can reproduce the procedure with their own data,
but cannot reproduce the exact private test result from public files.
