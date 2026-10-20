# Train and evaluate a v2 candidate

Training is local. The scripts download public pretrained weights but do not
upload input images. Keep datasets and manifests outside the public checkout.

## Environment

Use Python 3.12 and the pinned dependencies:

```sh
python3.12 -m venv .venv-training
.venv-training/bin/python -m pip install -r training/requirements-training.txt
```

Run the remaining Python commands from `training/` with that interpreter:

```sh
cd training
../.venv-training/bin/python prepare_pretrained.py
```

Pretrained downloads are tied to upstream revisions and SHA256 values. Preserve
`pretrained/<candidate>/provenance.json` and the corresponding model cards.

## Prepare labels and groups

Read original files without modifying them. Apply EXIF orientation once, then
save canonical upright copies in a private working directory. Record whether
uprightness was owner-confirmed, visually reviewed by AI, or only assumed.
Exclude images whose canonical orientation cannot be assigned reliably.

Create a manifest with an `images` list. Each entry requires `id`,
`canonical_path`, `group_id`, `split`, `duplicate_of`, `format`, `category` and
`upright_label_status`. Use `train`, `val`, `test` or `excluded` for `split`;
representative images use `null` for `duplicate_of`. Add raw source and canonical
pixel hashes where available so overlap checks can use them.

Put exact duplicates, format variants, burst sequences and close scene variants
in the same group and split. Decide the split before augmentation. Neither four
rotations nor repeated screenshots create independent source evidence.

```sh
../.venv-training/bin/python train.py check \
  --manifest /path/to/private/manifest.json
```

The trainer expects canonical pixels and does not reapply EXIF. Each source
contributes all four rotations in shuffled order each epoch. If an upright
source is rotated clockwise by 90°, its target correction is 270° clockwise.
The source upright label is therefore an assumption behind all four generated
labels; synthetic rotations cannot repair a wrong source label.

## Train and choose

```sh
../.venv-training/bin/python train.py train \
  --manifest /path/to/private/manifest.json \
  --pretrained pretrained/small --output runs/small --device mps

../.venv-training/bin/python train.py train \
  --manifest /path/to/private/manifest.json \
  --pretrained pretrained/medium --output runs/medium --device mps
```

Use `cpu` on a CPU-only Linux host. Record the hardware and actual package
versions; matching seeds do not guarantee identical MPS kernels or results.
Training uses ImageNet initialization, not random initialization.
The additional ConvNeXt candidate uses `--pretrained pretrained/convnext` with
its own output directory. Preserve each run's exact hyperparameters, source
snapshot and initialization/continuation lineage; the examples above describe
the initial MobileNetV4 runs, not every later experiment.

Choose the architecture and checkpoint using validation groups, then freeze
them. Compare latency as a constraint after selecting an acceptable accuracy
level. Choose any confidence threshold on validation data. Do not inspect test
results to choose the architecture, checkpoint, threshold or training schedule.
If comparing `--views 1` with `--views 4`, select this runtime setting on
validation data too; the latter performs four forwards per prediction.

For `v2.0.0-rc.1`, ConvNeXt Tiny was selected using validation only. Four-view
validation group macro accuracy was 99.03%; single-view validation group macro
accuracy was 68.60%. The test set was opened only after freezing the checkpoint
and four-view setting. The final test point estimate was lower than v1, so the
candidate remains experimental.

## Final evaluation

Replace `SELECTED` with the candidate chosen using validation only:

```sh
../.venv-training/bin/python train.py evaluate \
  --manifest /path/to/private/manifest.json \
  --checkpoint runs/SELECTED/best.pt --split test \
  --output runs/SELECTED/test.json --device mps
```

Run v1 and v2 on the same held-out sources and all four rotations. Report rotated
variant accuracy, per-source all-four success, group macro accuracy, and errors
on originally upright inputs. Estimate uncertainty at group level, preserving
paired v1/v2 predictions within a resample.

If test findings drive another revision, those results are development
evidence. Set aside new independent groups for the next final evaluation.
Report AI-reviewed labels as provisional, not human-verified truth.

## Export and native validation

Install the separately pinned export dependencies and run from the repository
root:

```sh
.venv-training/bin/python -m pip install -r native/requirements-native.txt
.venv-training/bin/python native/export_onnx.py \
  --checkpoint training/runs/SELECTED/best.pt \
  --output models/kururi-orient-v2.onnx \
  --preprocess v2-whole224-bilinear-imagenet \
  --recommended-views 4
```

The exporter validates the ONNX graph and checks PyTorch/ONNX Runtime parity on
one tensor. This does not validate the complete image pipeline. Also compare
real held-out input tensors, logits, final classes, EXIF handling and saved
orientation through the Rust executable. Report any changed predictions caused
by image decoding and resampling.

The selected v2 model supports JPEG, PNG, WebP, TIFF and BMP inputs in the
native runtime. Training used canonical conversions of HEIC and RAW previews;
those original containers require a separate decode/preview stage and are not
part of the native codec result.

Measure fresh-process wall time externally for prediction-only and saved-copy
modes. Keep warm inference timing separate. Record model file bytes, runtime
library bytes, input image sizes/formats, thread count and storage/cache state.

Publish code, configuration, artifact hashes and aggregate results only. Keep
source images, private manifests, per-photo IDs and individual prediction logs
local. Public users can repeat the procedure with their own data; the exact
private-dataset accuracy cannot be independently reproduced from public files.
