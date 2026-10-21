# Web demo third-party notices

- ONNX Runtime Web 1.23.2: Microsoft Corporation, MIT. The runtime license and
  notices are copied into the build from `licenses/onnxruntime/`.
- MobileNetV4 Conv Small and Conv Medium derivatives: Apache-2.0. Upstream
  model cards, configs, and provenance are under `public/model/upstream-*`.
- three.js 0.186.1: three.js authors, MIT. The license ships as
  `public/licenses/three.js-MIT.txt`.
- Shippori Mincho B1 font: The Shippori Mincho Project Authors
  (https://github.com/fontdasu/ShipporiMincho), SIL Open Font License 1.1,
  distributed by Fontsource. The license ships as
  `public/licenses/ShipporiMinchoB1-OFL-1.1.txt`.
- Vite, TypeScript, Vitest, and Playwright are build-time development
  dependencies.

## Demo photos

The demo streams Wikimedia Commons featured pictures at runtime from
`upload.wikimedia.org`. The photos are not stored in this repository or in the
built site. `public/commons/manifest.json` lists each file with its author and
license, and `public/commons/credits.html` presents the same credits for
visitors. Each photo is used under its own license (CC0, public domain,
CC BY, or CC BY-SA).

The five photos in `public/samples/` belong to this repository and are covered
by its MIT license.

The model archive does not redistribute the Wikimedia or iNaturalist training
photos. Their source manifests remain in the private training workspace.
