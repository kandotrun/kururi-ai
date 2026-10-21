# Kururi AI v2-nano web demo

A 3D photo sorting desk that runs the `kururi-ai-v2-nano` orientation model in
the browser. Wikimedia Commons featured pictures stream onto a cutting mat,
rotated on purpose. Each print is scanned by the model, marked with a
grease-pencil 「天」 on the side the model believes is the top, turned, and
placed into a growing mosaic. Visitors can drop their own photos; those are
processed in the tab and never uploaded.

## How it works

1. `public/commons/manifest.json` lists about 3,000 Commons featured pictures
   with author and license. The queue is shuffled per visit and mixes in the
   five repository sample photos, which are real crooked shots.
2. Commons thumbnails (330 px) load from `upload.wikimedia.org`. Each photo is
   rotated by a random quarter turn (10% stay upright) before inference.
3. A pool of WASM workers (up to four, two on phones) runs the four-view,
   two-model ensemble on every photo. Model bytes are fetched once and copied
   to each worker.
4. The three.js scene renders all prints from one texture atlas with instanced
   meshes, soft fake shadows, and pure motion functions.
5. Because the demo applied the rotation itself, the page shows a live
   accuracy. Wrong predictions stay wrongly oriented in the mosaic.

The live accuracy is not a benchmark. Some public photos may overlap with the
model's Commons training images, and Commons featured pictures are easier than
everyday phone photos. See [MODEL_CARD.md](MODEL_CARD.md) for the frozen test
result.

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

Unit tests, production build and browser test:

```sh
npm run test:unit
npm run build
npx playwright install chromium
npm test
```

Query parameters for reproducible runs:

| Parameter | Effect |
|---|---|
| `seed=<n>` | Fixed queue order and simulated rotations |
| `limit=<n>` | Stop after `n` photos |
| `commons=off` | Use only the sample photos and your own photos |
| `motion=reduce` | Force reduced motion |
| `workers=<n>` | Override the worker pool size (max 8) |
| `model=full` | Start with the full v2.0.0 model (WebGPU) |

## Full v2.0.0 model (optional)

Visitors can switch from v2-nano to the full v2.0.0 ConvNeXt ensemble when the
browser supports WebGPU. The general models are about 551MB; the low-margin
fallback model (about 199MB) is fetched only when it is first needed. Verified
files are kept in the browser's Cache Storage, so later visits skip the
download. The production build reads the files from the same origin at
`/models/v2.0.0/` (`.env.production`).

## Deploying to kururi-ai.2-38.com

The demo runs on Cloudflare Workers with static assets. `src/edge/` serves the
full model from the private R2 bucket `kururi-ai-models` under `/models/`, so no
public bucket or CORS policy is needed. Everything else is a static file from
`dist/`.

1. `npx wrangler login`
2. `npx wrangler r2 bucket create kururi-ai-models`
3. Extract `kururi-ai-v2.0.0-model.tar.gz` from the v2.0.0 release and upload
   it: `scripts/publish-full-model.sh <extracted>/models`. Wrangler uploads at
   most 300MiB per object, so the script splits `convnext-base-224.onnx.data`
   into two parts and the Worker joins them when serving.
4. `npm run deploy` builds the site and deploys the Worker with the custom
   domain `kururi-ai.2-38.com` (the `2-38.com` zone must be in the same
   Cloudflare account).

The GitHub Actions workflow deploys on pushes to `main` when the
`CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` secrets exist. GitHub Pages
now only serves `redirect/`, which forwards the old
`kandotrun.github.io/kururi-ai/` address to the new domain.

For local development, put the extracted model folder behind the dev server
(for example a `public/full-local` symlink, which is ignored by git) and set
`VITE_FULL_MODEL_BASE_URL=/full-local/` in `.env.development.local`.

Regenerate the Commons manifest and credits page with
`node scripts/build-commons-manifest.mjs` (see `public/commons/README.md`).

## Privacy

There is no upload endpoint. Your photos are decoded, rotated, scored and
rendered in the current tab. The demo photos come from Wikimedia Commons, so
the browser requests thumbnails from `upload.wikimedia.org`, and Wikimedia sees
those requests like any embedded image. The site itself is static, so normal
web-server logs are outside the page's control.

## Limitations

- No HEIC or RAW decode beyond what the browser itself supports.
- The desk is visual only; this demo does not export corrected files.
- Accuracy is lower than the full v2.0.0 Rust ensemble.
- Softmax confidence is not calibrated.
- WebGL2 is required for the desk. Without it, results still appear in the
  list view.

See [MODEL_CARD.md](MODEL_CARD.md) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
