# Kururi AI v2-nano web demo

This is a local-first browser demo for correcting many image rotations. The
model and ONNX Runtime Web WASM assets load in the page; selected images are
not uploaded to a server.

## Model

- MobileNetV4 Conv Small and Conv Medium QDQ INT8 ensemble.
- Model weight `0.18` Small and `0.82` Medium, selected on validation.
- Total model payload: 11.9MB.
- Four input rotations per image, probability alignment and averaging.
- Input size: 224×224, ImageNet normalization.

Validation: 400/428 rotations (93.46%), 87.82% scene-group macro.

Frozen test: 324/396 rotations (81.82%), 75.27% scene-group macro.

This model is intentionally separate from the full Rust release. It trades
accuracy and format coverage for a browser-friendly download. It handles
right-angle rotations only.

## Local development

```sh
npm install
npm run dev
```

Production build and browser test:

```sh
npm run build
npx playwright install chromium
npm test
```

The build copies the ONNX Runtime WASM glue, WASM binary, model license, model
files, sample images and installed font assets into `dist/`.

## Privacy

There is no upload endpoint. Image decode, preprocessing, inference and preview
rendering run in the current browser tab. The shipped model still uses a
website origin for loading static assets, so normal web-server logs are outside
the page's control.

## Limitations

- No HEIC or RAW decode beyond what the browser itself supports.
- Corrected previews are visual only; this demo does not export corrected files.
- Accuracy is lower than the full v2.0.0 Rust ensemble.
- Softmax confidence is not calibrated.
- The synthetic validation and test rotations use provisional orientation labels.

See [MODEL_CARD.md](MODEL_CARD.md).
