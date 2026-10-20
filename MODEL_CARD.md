# Kururi orientation v2 model card

## Status and intended use

This model card describes the experimental `2.0.0-rc.1` candidate. The selected
checkpoint is `convnext_tiny.fb_in22k_ft_in1k`, chosen using validation data
before the frozen test set was evaluated. The final test point estimate was
lower than v1, so this is an opt-in prerelease rather than a stable replacement.

The model predicts right-angle correction for ordinary images. It does not
estimate arbitrary tilt angles, camera pose, subject orientation or the intended
reading order of every image. A screenshot containing a rotated photograph can
have two different notions of upright. Abstract patterns, overhead views,
symmetry and unusual compositions may have no unique correct orientation.

## Input and output contract

- Input: float32 RGB NCHW `[1,3,224,224]`.
- Apply EXIF orientation once to the decoded source pixels.
- Resize the full image to 224×224. Training uses Pillow bilinear; record the
  selected native resizer implementation from the CLI's `resampler` field.
  Aspect ratio is distorted, and nothing is cropped. Native decoding/resampling
  differences require measured validation.
- Divide RGB values by 255, then normalize with mean
  `[0.485,0.456,0.406]` and standard deviation `[0.229,0.224,0.225]`.
- Output: four logits in clockwise correction order `[0,90,180,270]`.
- For a canonical upright source synthetically rotated clockwise by `r`,
  the correction target is `(-r) % 360`.
- Softmax scores are uncalibrated. An abstention threshold must be chosen on
  validation data and evaluated separately for coverage and accepted accuracy.
- The selected model embeds a four-view recommendation. It averages
  correction-aligned probabilities from four rotated input tensors and performs
  four forwards per image. Single-view prediction is an experimental override.

## Provenance

The selected model is transfer learning, not training from random initialization.
The four-class head replaces the original ImageNet classifier, and orientation
fine-tuning changes the pretrained weights. ONNX export is another modification.
No legacy v1 orientation weights or teacher labels are used by this baseline.

Backbones downloaded for comparison:

| Candidate | Upstream revision | Upstream weights SHA256 |
|---|---|---|
| `mobilenetv4_conv_small.e2400_r224_in1k` | `331fb803779522b685cf942e15f914fb6741c1eb` | `7a7102ec18f62bbfb555b6fe829bbb5af749516b84174926c29ffdfdfc03aec4` |
| `mobilenetv4_conv_medium.e500_r224_in1k` | `02a09fbfb82b289e871ba8255f9da58c056fb13b` | `10f9f8057d574f71d22c52d31cadab8af0bc325841fd93939c86d45d20998cad` |
| `convnext_tiny.fb_in22k_ft_in1k` | `bc48a87f119bae1b06418f5340bfa97ef75d4609` | `77b619e187de71bce58721689da0c009e84cc20677293d7d43105307e34d868a` |

The MobileNetV4 model cards declare Apache-2.0 and ImageNet-1k pretraining by
Ross Wightman / timm:
[small](https://huggingface.co/timm/mobilenetv4_conv_small.e2400_r224_in1k/blob/331fb803779522b685cf942e15f914fb6741c1eb/README.md),
[medium](https://huggingface.co/timm/mobilenetv4_conv_medium.e500_r224_in1k/blob/02a09fbfb82b289e871ba8255f9da58c056fb13b/README.md).
The [ConvNeXt card](https://huggingface.co/timm/convnext_tiny.fb_in22k_ft_in1k/blob/bc48a87f119bae1b06418f5340bfa97ef75d4609/README.md)
also declares Apache-2.0; its paper authors pretrained on ImageNet-22k and
fine-tuned on ImageNet-1k, with a timm conversion.
Only the ConvNeXt checkpoint is part of the v2 release asset. Its upstream card,
provenance JSON and Apache-2.0 license accompany the distributed derivative.

## Dataset and labels

Fine-tuning and evaluation use a bounded sample from one private, owner-provided
image collection. The owner reported that most source images were already
upright. Provisional orientation labels use this premise and independent AI
visual review; they are not all owner-confirmed or independently human-annotated.
Evaluation against them is conditional on their correctness.

The sample is not a random sample of all photography and may contain correlated
scenes, captures, formats and repeated subjects. Source images and identifying
image content are not public. Public reports contain aggregate statistics only.

The split is made by source groups before rotation augmentation. Exact and
cross-format duplicates share a representative; related variants remain within
one split. This prevents the four rotations of a photograph from crossing
training and evaluation. Grouping remains a heuristic and cannot rule out every
semantic near-duplicate.

| Dataset property | Value for selected release |
|---|---|
| Converted source images | 762; 91 PNG, 54 JPEG, 564 DNG, 43 HEIC, 10 NEF |
| Usable representative sources and groups | 721 sources across 315 scene groups |
| Train / validation / test sources | 536 / 107 / 78 |
| Train / validation / test groups | 251 / 35 / 29 |
| Exclusions | 36 exact or cross-format duplicates and 5 ambiguous originals |
| Usable format count | 560 DNG, 89 PNG, 41 HEIC, 31 JPEG |
| Category count | 103 scene, 85 screen, 64 people, 17 closeup, 8 document, 2 food, 1 graphic, 441 uncategorized training originals |
| Label review | Validation and test: 185 independently AI-reviewed (180 high, 5 medium confidence). Training: 95 AI-reviewed and 441 provisional from the owner's mostly-upright premise. No label is described as human verified. |
| Canonical pixels | EXIF-transposed RGB JPEG, maximum dimension 1024, EXIF removed; RAW sources use embedded JPEG previews |
| Frozen manifest SHA256 | `9817683ccce0dc2367429cee4ddf9ec02591c9620f637b70a22fbd88596146d0` |
| Leakage controls | Duplicate representatives removed; exact and cross-format duplicates grouped; scene groups do not cross splits |

## Training and selection

Training contributes all four rotations of every source each epoch in shuffled
order, with brightness and contrast changes of up to 10%. Inverse group-size
weights reduce the influence of repeated captures. The selected ConvNeXt run
used seed `20261020`, batch size 32, three classifier-only epochs, at most
15 epochs, classifier head learning rate `0.001`, backbone learning rate
`0.00001`, classifier fine-tuning rate `0.0001`, weight decay `0.01`, label
smoothing `0.03`, and frozen BatchNorm running statistics. Group macro accuracy
selected epoch 12; cross-entropy broke ties and patience was four epochs.

The selected checkpoint has SHA256
`b7097cbbf39c13b989ee7ee1d6dad3fa365946e17322ba5537de27fa437df52a`
and is 111,340,831 bytes. PyTorch and native ONNX execution both use four
correction-aligned views selected on validation data.

The test split is reserved for the final selected candidate. Architecture,
checkpoint, hyperparameters and confidence threshold must not be selected from
test results. If a test result informs a later model revision, it becomes
development evidence and a new independent final test is required.

Seeds, package versions, upstream revisions and input hashes are recorded.
Hardware kernels, particularly MPS, may prevent bit-for-bit reproduction across
versions or machines. Since the source dataset is private, third parties can
reproduce the procedure with their own data but cannot independently reproduce
the exact reported accuracy from the public repository alone.

## Evaluation evidence

Report v1 and the selected v2 on the same held-out groups and same provisional
labels. Also report the native v2 result, because a converted model's Python
accuracy alone does not establish the distributed CLI's accuracy.

| Metric | v1 baseline | Selected v2 PyTorch | Selected v2 native |
|---|---|---|---|
| Correct rotated variants / total | 298 / 312 (95.51%) | 292 / 312 (93.59%) | 292 / 312 (93.59%) |
| Group macro accuracy | 90.95% | 88.72% | 88.72% |
| Sources correct on all four rotations | 71 / 78 (91.03%) | 73 / 78 (93.59%) | 73 / 78 (93.59%) |
| Initially upright inputs wrongly rotated | 3 / 78 | 5 / 78 | 5 / 78 |
| High-confidence-label sensitivity | 286 / 300 (95.33%) | 280 / 300 (93.33%) | 280 / 300 (93.33%) |
| Default coverage and accuracy | 312 / 312, 95.51% | 312 / 312, 93.59% | 312 / 312, 93.59% |

The paired scene-group bootstrap difference for v2 minus v1 was -1.92 percentage
points for rotated variants (95% interval -7.27 to +3.82), -2.23 points for group
macro accuracy (interval -11.96 to +6.39), and +2.56 points for the all-four
success fraction (interval -4.55 to +13.11). The intervals include zero and are
conditional on this private sample and provisional labels.

The native run produced all 312 final classes identically to PyTorch. Its largest
absolute probability difference from the Python four-view result was `0.01864`.
This establishes implementation parity for the frozen PNG inputs; it does not
add independent accuracy evidence.

Four variants from one source are not four independent images. Confidence
intervals must resample groups, not individual rotations. Small or correlated
test sets make estimates uncertain; neither accuracy improvement nor broad
generalization follows from a high point estimate alone.

Single-view v2 scored 206/312 (66.03%) on the same test, so the reported v2
accuracy depends on four-view aggregation. The four-view softmax maximum is not
calibrated. No confidence threshold was selected from the test set; the shipped
default is zero.

| Latency or packaging property | Value |
|---|---|
| Machine, CPU, OS and runtime | Apple M4 Max, 128 GiB RAM, macOS 27.0.1 ARM64; ONNX Runtime 1.31.0, API 31; `ort` 2.0.0-rc.15 |
| v1 CPU process, 4032×3024 JPEG | Median 3,932 ms, p95 4,420 ms, 5 trials |
| v1 CPU process, 8064×6048 JPEG | Median 4,126 ms, p95 4,338 ms, 3 trials |
| v2 CPU process, prediction only, 4032×3024 JPEG | Median 173.3 ms, p95 178.8 ms, 20 trials |
| v2 CPU process, prediction only, 8064×6048 JPEG | Median 451.2 ms, p95 459.5 ms, 10 trials |
| v2 CPU process including corrected JPEG copy, 4032×3024 | Median 246.8 ms, p95 256.8 ms, 10 trials |
| Warm four-view inference only | Median 53.2 ms, p95 60.2 ms, 10 timed runs after 2 warmups |
| Storage and cache conditions | Source images on a NAS; OS file cache warm and uncontrolled; not a cold-storage measurement |
| Model bytes including external data | 112,063,961 bytes (`718,297` graph + `111,345,664` data) |
| Native binary and runtime library bytes | 2,208,880 + 33,037,336 bytes |
| Runtime configuration | Four views, eight intra-op threads, one inter-op thread, ONNX Runtime CPU provider |
| macOS ARM64 checks | Format, Clippy, 7 unit tests, synthetic runtime checks, synthetic relocation and full-model runs passed |
| Linux x86-64 checks | Format, Clippy, 7 unit tests, release build, synthetic runtime checks and a relocated full-model run passed under Docker/OrbStack emulation on the same Apple host; no native Linux latency benchmark |

Fresh-process timing may reuse the OS file cache. Do not call it an uncached
disk measurement unless caches were actually controlled. Mac and Linux results
are separate measurements; a Linux container on Apple Silicon does not
establish Linux x86-64 performance.

## Artifact identity

Selected model and pipeline:

- Backbone: `convnext_tiny.fb_in22k_ft_in1k`, upstream revision
  `bc48a87f119bae1b06418f5340bfa97ef75d4609`.
- Checkpoint SHA256:
  `b7097cbbf39c13b989ee7ee1d6dad3fa365946e17322ba5537de27fa437df52a`.
- ONNX graph SHA256:
  `955d810ac1f221bd115db36a8f60d9840bb65cffdb3a3f90c30eed815338bbc5`.
- ONNX external data SHA256:
  `4db19793432d0b7790875151a1031b60f1573dc28ba94bf368639ea3b30b72a6`.
- Training manifest SHA256:
  `9817683ccce0dc2367429cee4ddf9ec02591c9620f637b70a22fbd88596146d0`.
- Python exporter versions: PyTorch 2.14.1, timm 1.0.30, ONNX 1.23.2,
  ONNX Runtime 1.31.0, ONNXScript 0.7.2.

Publication still needs the release source commit, packaged archive hashes and CI
run links. Keep private source paths, image IDs and per-photo predictions out of
public artifacts.

## Limits and safe use

This model can turn an already upright image incorrectly. Use prediction-only
mode to inspect results, or write new copies. Saving currently omits original
EXIF/ICC metadata and re-encodes JPEG. Model confidence does not establish
correctness, and the training sample does not establish accuracy across all
cameras, domains, image styles or accessibility needs.

The native candidate decodes JPEG, PNG, WebP, TIFF and BMP. It does not decode
HEIC, DNG, NEF or other RAW containers. Test canonical images were converted
from those sources before evaluation, so the classifier accuracy result does
not replace codec support testing for the original files.
