# Kururi AI web demo

A 3D photo sorting desk at <https://kururi-ai.2-38.com/>. By default it runs
the `kururi-ai-v2-nano` orientation model in the browser; browsers with WebGPU
can switch to the full v2.0.0 ConvNeXt ensemble. Wikimedia Commons featured
pictures land on a cutting mat, rotated on purpose. Each print is scanned by
the model, marked with a grease-pencil 「天」 on the side the model believes is
the top, and turned in place into a growing mosaic. Visitors can add their own
photos or a whole folder; those are processed in the tab and never uploaded.

## How it works

1. A short intro flies from space to Earth. The capture places of the demo
   photos light up and stream to Tokyo, into one lit window, and down onto the
   desk. `スキップ` ends it at once; `intro=off` or reduced motion leaves it
   out.
2. `public/commons/manifest.json` lists 2,809 Commons featured pictures with
   author, license and, for about two thirds of them, where they were taken.
   The queue is shuffled per visit and mixes in the five repository sample
   photos, which are real crooked shots.
3. Commons thumbnails (330 px) load from `upload.wikimedia.org`. Each photo is
   rotated by a random quarter turn (about 10% stay upright) and lands crooked
   on its own slot of the mosaic.
4. With v2-nano, a pool of WASM workers (up to four, two on phones and
   low-memory devices) runs the four-view, two-model ensemble on every photo.
   Model bytes are fetched once and copied to each worker. With the full model,
   one WebGPU worker runs the ConvNeXt ensemble.
5. When a judgement arrives, the print gets its 「天」 mark and turns into
   place. Wrong predictions stay wrongly oriented in the mosaic.
6. Because the demo applied the rotation itself, the page shows a live
   accuracy for the Commons and sample photos.

Visitors can choose files, choose a folder, or drop either on the desk. Every
photo inside a folder and its subfolders is queued; videos, sidecar files and
hidden files are skipped. When the desk runs out of room, Commons photos that
have not started yet make way for yours; if that is still not enough, the page
says how many were left out. Visitors' photos are judged as they are unless
「自分の写真もわざと回転させる」 is checked. Their correct orientation is
unknown, so they never count toward the live accuracy. RAW files (DNG, NEF,
NRW, ARW, CR2) are not decoded: the demo reads only the JPEG preview embedded
in the file, through byte ranges, and reports files without one as unreadable.
HEIC works only where the browser can decode it.

The live accuracy is not a benchmark. Some public photos may overlap with the
Commons images used to train v2-nano, and Commons featured pictures are easier
than everyday phone photos. See [MODEL_CARD.md](MODEL_CARD.md) and the repository's
[MODEL_CARD.md](../MODEL_CARD.md) for the frozen test results.

## Models

### v2-nano (default)

- MobileNetV4 Conv Small and Conv Medium QDQ INT8 ensemble.
- Model weight `0.18` Small and `0.82` Medium, selected on validation.
- Total model payload: 11.9MB, served with the site from `public/model/`.
- Four input rotations per image, probability alignment and averaging.
- Input size: 224×224, ImageNet normalization.

Validation: 400/428 rotations (93.46%), 87.82% scene-group macro.

Frozen test: 324/396 rotations (81.82%), 75.27% scene-group macro.

This model is intentionally separate from the full release. It trades accuracy
and format coverage for a browser-friendly download. It handles right-angle
rotations only.

### Full v2.0.0 (optional)

Visitors can switch to the full v2.0.0 ConvNeXt ensemble in 「判定モデル」 when
the browser supports WebGPU; `model=full` starts with it. The two general
models are about 551MB. As soon as they are ready, the low-margin fallback
model (about 199MB) is downloaded in the background as well, so a close call
never waits for it; the full model therefore downloads about 750MB in total.
Verified files are kept in the browser's Cache Storage, so later visits skip
the download. While the general models download, the photos wait crooked on
the desk and are turned in one wave once the model is ready.

The ensemble scored 700/704 rotations (99.43%) on its own frozen test. That
test differs from the v2-nano test, so the two numbers are not directly
comparable.

The production build reads the files from the same origin at
`/models/v2.0.0/` (`.env.production`). The derived weights are Apache-2.0, and
their license and provenance are served next to them:

| Path under `/models/v2.0.0/` | Content |
|---|---|
| `LICENSE` | Apache-2.0 text that covers the ConvNeXt-derived weights (also at `licenses/Apache-2.0.txt`) |
| `THIRD_PARTY_NOTICES.md` | Release notices: upstream weights and Kururi AI's modifications |
| `MODEL_CARD.md` | Release model card |
| `upstream/convnext-base/` and `upstream/convnext-small/` | Upstream timm model cards (`README.md`), `config.json` and `provenance.json` |

## Local development

```sh
npm install
npm run dev
```

Unit tests, lint, production build and browser test:

```sh
npm run test:unit
npm run lint
npm run build
npx playwright install chromium
npm test
```

`npm run build` ends with `scripts/check-dist.mjs`. It fails when `dist/`
contains a model file other than the two v2-nano models, a `full-local`
folder, a symbolic link, or a file larger than Cloudflare's 25 MiB static
asset limit.

Query parameters for reproducible runs:

| Parameter | Effect |
|---|---|
| `seed=<n>` | Fixed queue order and simulated rotations |
| `limit=<n>` | Stop after `n` photos |
| `commons=off` | Use only the sample photos and your own photos |
| `motion=reduce` | Force reduced motion (also skips the intro) |
| `intro=off` | Start on the desk without the intro |
| `workers=<n>` | Override the v2-nano worker pool size (max 8) |
| `model=full` | Start with the full v2.0.0 model (WebGPU) |

### Full model in development

Extract `kururi-ai-v2.0.0-model.tar.gz` from the
[v2.0.0 release](https://github.com/kandotrun/kururi-ai/releases/tag/v2.0.0)
anywhere outside the repository and put both lines in
`.env.development.local` (ignored by git), or set them in the shell:

```sh
VITE_FULL_MODEL_BASE_URL=/full-local/
KURURI_FULL_MODEL_DIR=/absolute/path/to/extracted/models
```

Only the dev server (`npm run dev`) serves that folder at `/full-local/`,
through a small middleware in `vite.config.ts`. It answers `GET` and `HEAD`
for exactly the files the production Worker publishes (`PUBLISHED` in
`src/edge/models.ts`), with the same content types and the same mapping of
`LICENSE` to `licenses/Apache-2.0.txt`, and refuses everything else, including
any file that resolves outside the folder. Nothing is copied into `public/` or
`dist/`, so a build or deploy can never include the local model. Do not link
the folder into `public/`.

## Deploying to kururi-ai.2-38.com

The demo runs on Cloudflare Workers with static assets. `src/edge/` serves the
full model and its license files from the private R2 bucket `kururi-ai-models`
under `/models/`, so no public bucket or CORS policy is needed. Everything else
is a static file from `dist/`.

1. `npx wrangler login`
2. `npx wrangler r2 bucket create kururi-ai-models`
3. Extract `kururi-ai-v2.0.0-model.tar.gz` from the v2.0.0 release and upload
   it: `scripts/publish-full-model.sh <extracted>/models`. The script checks
   `SHA256SUMS`, then uploads the license, notices, model card and upstream
   cards, then the weights. Wrangler uploads at most 300MiB per object, so the
   script splits `convnext-base-224.onnx.data` into two parts and the Worker
   joins them when serving. `--documents-only` uploads only the license and
   provenance files, for a bucket that already holds the weights.
4. `npm run deploy` builds the site and deploys the Worker with the custom
   domain `kururi-ai.2-38.com` (the `2-38.com` zone must be in the same
   Cloudflare account).

The GitHub Actions workflow deploys on pushes to `main` when the
`CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` secrets exist. Its actions
are pinned to commit SHAs. The deploy job installs dependencies with
`npm ci --ignore-scripts`, and only the `wrangler deploy` step receives the
Cloudflare secrets; the install and build steps never see them. Keep the API
token limited to this one account and to what `wrangler deploy` needs.
GitHub Pages now only serves `redirect/`, which forwards the old
`kandotrun.github.io/kururi-ai/` address to the new domain.

Regenerate the Commons manifest and credits page with
`node scripts/build-commons-manifest.mjs` (see `public/commons/README.md`).

## Privacy

There is no upload endpoint. Your photos, including every file of a chosen
folder, are read, rotated, scored and rendered in the current tab and are gone
when the page closes. RAW files are read only in the byte ranges needed to find
their embedded preview.

Requests the page makes:

- The site itself and, only after you choose the full model, the model files
  from `kururi-ai.2-38.com`. The site is hosted on Cloudflare Workers, so
  Cloudflare handles every request, like any Cloudflare-hosted site, and the
  owner's dashboard shows aggregate traffic numbers. Workers Logs are turned
  off in `wrangler.jsonc` (`observability.enabled: false`), so the Worker that
  serves `/models/` keeps no per-request log in the owner's account.
- Commons thumbnails from `upload.wikimedia.org`. Wikimedia sees those requests
  like any embedded image. The referrer is limited to the site's origin.

The browser stores only the full model files in Cache Storage, and only after
you choose that model. Removing the site's data in the browser deletes them.

## Limitations

- RAW files are judged from their embedded JPEG preview only; files without a
  usable preview are reported as unreadable. HEIC depends on the browser.
- The desk is visual only; this demo does not export corrected files.
- v2-nano is less accurate than the full v2.0.0 ensemble.
- The full model needs WebGPU and a download of about 750MB.
- Softmax confidence is not calibrated.
- WebGL2 is required for the desk. Without it, results still appear in the
  list view.

See [MODEL_CARD.md](MODEL_CARD.md) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
