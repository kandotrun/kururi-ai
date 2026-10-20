# Local orientation transfer-learning experiment

These scripts use local, canonical upright image copies. No photo upload occurs.
The dataset must be grouped and split **before** right-angle augmentation.
Exact or cross-format duplicates must have `duplicate_of` set; the representative
is retained. Every group must have only one split.

Required manifest: `{"images":[...]}` with each image containing `id`,
`canonical_path`, `group_id`, `split` (`train`, `val`, `test`, or `excluded`),
`duplicate_of` (null for representatives), `format`, `category`, and
`upright_label_status`. Absolute local paths are private and must not be published.
Raw source and pixel hashes are checked across splits when available.

Prepare public pretrained weights (fixed upstream revisions and SHA256 recorded):

```sh
python prepare_pretrained.py
python train.py check --manifest /path/to/manifest.json
```

Train each candidate (never loads test images):

```sh
python train.py train --manifest /path/to/manifest.json \
  --pretrained pretrained/small --output runs/small --device mps
python train.py train --manifest /path/to/manifest.json \
  --pretrained pretrained/medium --output runs/medium --device mps
```

Choose by validation group macro accuracy and latency. Only after selection and
blind verification of test source orientations, evaluate once on the test set:

```sh
python train.py evaluate --manifest /path/to/manifest.json \
  --checkpoint runs/SELECTED/best.pt --split test \
  --output runs/SELECTED/test.json --device mps
```

Inputs: RGB, full-image Pillow bilinear resize to 224×224, ImageNet normalization.
This deliberately keeps all image content, but distorts aspect ratios. There is no
crop or letterboxing in this baseline. Canonical copies must already have EXIF
orientation applied exactly once; `train.py` does not apply it again.
Class order is **clockwise correction** `[0, 90, 180, 270]`. When an upright image
is synthetically rotated clockwise by `r`, the target is `(-r) % 360`.

Each epoch uses all four rotations per source in random shuffled order, with
small brightness/contrast changes. No geometric transform changes the label.
Training loss is inverse-group-size weighted to reduce burst dominance.
Three frozen-backbone head epochs precede up to twelve full fine-tuning epochs;
pretrained BatchNorm running statistics remain fixed. Validation selects the best
checkpoint, using cross-entropy to break ties. Fine-tuning stops after four
non-improving epochs. No test result may be used to choose hyperparameters,
checkpoint, threshold, or architecture.

Metrics distinguish variant accuracy, per-original all-four success, and
group-weighted accuracy. Exploratory confidence intervals resample entire groups.
Reported confidence thresholds are descriptive, not calibrated guarantees.
The source images are mostly upright according to the owner; AI visual review
does not replace owner-confirmed ground truth.

Pretrained model cards declare Apache-2.0. This is transfer learning from timm
ImageNet-1k weights, not training from scratch. Preserve model provenance and
applicable upstream notices when releasing. Neither private images nor
manifests/prediction IDs should be copied into a public release.
