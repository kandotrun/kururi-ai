# Third-party notices

This file describes which notices belong in the final distribution. It is not
a substitute for the actual license texts and notices from the exact model and
runtime versions shipped.

## Project code and legacy model

Kururi AI project code is distributed under the repository's MIT `LICENSE`.
Retain the legacy v1 model's original attribution to
[Yuki Arano / 新野ユキ](https://github.com/ObuchiYuki).

Do not apply the old README's blanket “code and packaged model are MIT” statement
to new v2 weights or third-party runtime dependencies.

## v2 pretrained weights and modifications

The v2 release asset contains a derivative of
[convnext_tiny.fb_in22k_ft_in1k](https://huggingface.co/timm/convnext_tiny.fb_in22k_ft_in1k/blob/bc48a87f119bae1b06418f5340bfa97ef75d4609/README.md),
revision `bc48a87f119bae1b06418f5340bfa97ef75d4609`. Its card attributes
ImageNet-22k pretraining and ImageNet-1k fine-tuning to the paper authors
(Meta/Facebook Research), with a timm conversion, and declares Apache-2.0.
Include the selected upstream model card, provenance JSON, and
[Apache-2.0 license](licenses/Apache-2.0.txt) with redistributed derivative
weights. Preserve any applicable upstream notices.

Kururi AI contributors replaced the ImageNet classification head with four
orientation classes, fine-tuned the weights on privately held images, and
exported the resulting model to ONNX. These are modifications to the upstream
weights. Dataset images are not part of the model distribution and are not
licensed by this repository.

ConvNeXt is described in
[A ConvNet for the 2020s](https://arxiv.org/abs/2201.03545).
The timm implementation is maintained in
[pytorch-image-models](https://github.com/huggingface/pytorch-image-models).
MobileNetV4 was evaluated during development but is not included in the v2
release asset.

## Native runtime

- ONNX Runtime `1.31.0`: Microsoft Corporation, MIT.
  Include the actual runtime `LICENSE` and `ThirdPartyNotices.txt` from the
  runtime distribution that supplies the shipped shared library.
  [Upstream license](https://github.com/microsoft/onnxruntime/blob/v1.31.0/LICENSE).
- `ort` `2.0.0-rc.15`: retain its applicable Apache-2.0/MIT license choice and
  notices from the locked Cargo source.
  [Upstream repository](https://github.com/pykeio/ort/tree/v2.0.0-rc.15).
- Include the applicable licenses/notices of every redistributed Rust dependency
  and any bundled native library, using the exact `Cargo.lock` resolution.

The binary archive license inventory is incomplete until all shipped components
have been identified and their actual license texts bundled. A reference link
alone does not replace a license text required for redistribution.
