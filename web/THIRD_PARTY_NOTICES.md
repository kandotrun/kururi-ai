# Web demo third-party notices

- ONNX Runtime Web 1.23.2: Microsoft Corporation, MIT. `scripts/copy-assets.mjs`
  copies the runtime `LICENSE` and the ONNX Runtime `ThirdPartyNotices.txt`
  from the repository's `licenses/onnxruntime/` into the build as
  `ort/onnxruntime-web-LICENSE` and `ort/onnxruntime-ThirdPartyNotices.txt`.
  That notices file comes from the ONNX Runtime 1.31.0 distribution used by
  the native CLI; the list for the exact web release is
  [ThirdPartyNotices.txt at v1.23.2](https://github.com/microsoft/onnxruntime/blob/v1.23.2/ThirdPartyNotices.txt).
- MobileNetV4 Conv Small and Conv Medium derivatives (v2-nano): Apache-2.0.
  Upstream model cards, configs, and provenance are under
  `public/model/upstream-*` and `public/model/provenance.json`; the license
  text ships as `public/licenses/Apache-2.0.txt`.
- ConvNeXt derivatives (full v2.0.0, optional):
  [convnext_base.fb_in22k_ft_in1k](https://huggingface.co/timm/convnext_base.fb_in22k_ft_in1k)
  and
  [convnext_small.fb_in22k_ft_in1k](https://huggingface.co/timm/convnext_small.fb_in22k_ft_in1k)
  (ImageNet-22k pretraining and ImageNet-1k fine-tuning by Meta/Facebook
  Research, timm conversion), Apache-2.0. Kururi AI contributors replaced the
  classification heads with four orientation classes, fine-tuned the weights,
  exported three models to ONNX and combined them in a weighted cascade. The
  weights are not part of the build: the Worker in `src/edge/` serves them
  from R2 under `/models/v2.0.0/`, next to the Apache-2.0 text (`LICENSE`), the
  release `THIRD_PARTY_NOTICES.md` and `MODEL_CARD.md`, and the upstream model
  cards, configs and provenance (`upstream/convnext-base/`,
  `upstream/convnext-small/`). `scripts/publish-full-model.sh` uploads all of
  them from the release archive.
- three.js 0.186.1: three.js authors, MIT. The license ships as
  `public/licenses/three.js-MIT.txt`.
- Shippori Mincho B1 font: The Shippori Mincho Project Authors
  (https://github.com/fontdasu/ShipporiMincho), SIL Open Font License 1.1,
  distributed by Fontsource. The license ships as
  `public/licenses/ShipporiMinchoB1-OFL-1.1.txt`.
- Intro Earth and Japan textures: NASA Visible Earth imagery (Blue Marble Next
  Generation, Black Marble 2016 and Blue Marble clouds), public domain, credit
  NASA Earth Observatory. Sources are listed in `public/intro/README.md`.
- Vite, TypeScript, Vitest, Playwright, Wrangler and ast-grep are build-time
  development dependencies.

## Demo photos

The demo streams Wikimedia Commons featured pictures at runtime from
`upload.wikimedia.org`. The photos are not stored in this repository or in the
built site. `public/commons/manifest.json` lists each file with its full
author credit as written on Commons (e-mail addresses removed) and its license,
and `public/commons/credits.html` presents the same credits for visitors. Each
photo is used under its own license (CC0, public domain, CC BY, or CC BY-SA).

The five photos in `public/samples/` belong to this repository and are covered
by its MIT license.

The model archives do not redistribute the Wikimedia or iNaturalist training
photos. Their source manifests remain in the private training workspace.
