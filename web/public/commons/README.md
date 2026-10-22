# Wikimedia Commons photo set

The web demo sorts 2,809 Wikimedia Commons
[featured pictures](https://commons.wikimedia.org/wiki/Commons:Featured_pictures).
This folder holds only metadata; no photo is stored in the repository.
Thumbnails are loaded at runtime from `upload.wikimedia.org`.

| File | Purpose |
|---|---|
| `manifest.json` | Compact list of the selected files and, where known, where each photo was taken. Decoded by `src/core/manifest.ts` (`decodeManifest`). |
| `credits.html` | Self-contained credits page (Japanese): every file with its author, license, Commons page and place. |
| `README.md` | This document. |

Both `manifest.json` and `credits.html` are generated. Do not edit them by hand.

## Regenerating

```sh
cd web
node scripts/build-commons-manifest.mjs
```

Requirements: Node.js 24 or newer (the script imports `src/core/manifest.ts` and
`src/core/geo.ts` directly through Node's built-in type stripping, so the runtime URL
builders, place labels and the generator can never disagree). No npm dependencies.

Options:

| Option | Default | Meaning |
|---|---|---|
| `--target <n>` | `3000` | Number of files to select before the reviewed exclusions are removed. |
| `--minimum <n>` | `2000` | Fail instead of writing when fewer files pass the filters. |
| `--out <dir>` | `public/commons` | Output folder for `manifest.json` and `credits.html`. |
| `--cache <dir>` | none | Store raw API responses on disk and reuse them on the next run. Useful while tuning filters. |
| `--exclude <file>` | `scripts/commons-exclude.json` | Reviewed list of files removed after balancing (see [Selection rules](#selection-rules), step 4). |
| `--explore` | off | Crawl the category tree, print it with per-category file counts, and stop. |
| `--check <n>` | off | Do not build. Pick `n` random entries from the existing manifest and verify that both runtime thumbnail URLs (330 px and 960 px) answer `200`, `image/jpeg` and `access-control-allow-origin: *`, and that the 330 px JPEG has the expected aspect ratio. |

`generatedAt` is the build date (UTC midnight). Set `SOURCE_DATE_EPOCH` to pin it.
With the same API answers the output is byte-for-byte identical: every list is
sorted, and the "random" choice inside a topic is the order of
`md5("kururi-ai-commons-v1:" + title)`.

A full run without cache makes about 1,200 API requests for the selection plus
about 1,500 for the locations (see [Locations](#locations)) and takes 15 to 25 minutes.

### Being polite to the API

- `User-Agent: kururi-ai-web-demo/1.0 (https://github.com/kandotrun/kururi-ai; manifest builder)`
- `maxlag=5` on every request; a `maxlag` error waits for `Retry-After` (or 5 s, doubling) and retries.
- Strictly serial requests, at least 150 ms apart, shared by `commons.wikimedia.org` and `en.wikipedia.org`.
- HTTP 429 and 5xx are retried with exponential backoff (1 s doubling, capped at 60 s, at most 8 attempts), honouring `Retry-After`.
- Continuation tokens are followed for every list and property query.
- Metadata is only fetched for as many files as each topic needs (see below), not for every candidate.

## Selection rules

1. **Crawl.** Each topic starts from a few topical subcategories of
   `Category:Featured pictures by subject` and walks their subcategories breadth first
   (depth ≤ 6). The topics, in priority order, are:

   | key | label | roots (`Featured pictures of …`) |
   |---|---|---|
   | `birds` | 鳥 | birds |
   | `mammals` | 哺乳類 | mammals |
   | `insects` | 虫 | Arthropoda |
   | `reptiles` | 爬虫類と両生類 | reptiles, amphibians |
   | `aquatic` | 魚と水の生き物 | fish, molluscs, Cnidaria, Echinodermata |
   | `fungi` | きのこ | fungi |
   | `food` | 食べ物 | food, and `Featured still-life photographs` |
   | `transport` | 乗り物 | vehicles, aviation, rail transport, water transport, cableways |
   | `objects` | 道具と品物 | objects, machines, musical instruments, optical devices, wearable objects |
   | `cityscapes` | 街並み | cityscapes, villages |
   | `architecture` | 建物 | buildings, architectural structures, bridges, windmills, architecture |
   | `landscapes` | 風景 | landscapes, landforms, bodies of water, natural phenomena, agriculture, gardens, parks |
   | `plants` | 植物 | plants |

   A file found by several topics belongs to the first one. A category that is a root
   of one topic is never entered from another topic. Subcategories are skipped when
   their name contains `by` / `from` (cross-indexes by country, user or source) or
   points at subjects without a natural "up" or with sensitive content: people,
   portraits, nudes, art, paintings, drawings, sculptures, statues, reliefs, mosaics,
   stained glass, prints, posters, maps, diagrams, astronomy, space, satellites,
   eclipses, the Sun, the Moon, aurora, fossils, bones, minerals, crystals, micro-
   photography, money, cemeteries, mausoleums, monuments and memorials, history,
   the Holocaust, military, bunkers, ceilings, domes, altars, stairs, floors,
   reflections, underwater photography, fire, light painting, specimens, sports,
   cycling, amusement rides, shipwrecks, tanks, museum collections and a few
   parasites. `Featured pictures of islands` is read without descending into its
   per-island subcategories, because those hold every kind of photo of a place.

2. **Per-file filters.** A file is kept only when all of these hold:
   - MIME type `image/jpeg`.
   - Landscape: width ≥ 1200 and height ≥ 800. Portrait: height ≥ 1200 and width ≥ 1000
     (so the 960 px thumbnail is a real downscale).
   - Aspect ratio width / height within [0.5, 2.0] (drops panoramas).
   - `extmetadata.Artist` is present. The author is the whole Artist HTML reduced to
     plain text: entities decoded, `(talk)`-style links, `mailto:` links and e-mail
     addresses removed, whitespace collapsed. It is never shortened, because CC BY
     and CC BY-SA credits include what the author asked for (co-attribution,
     derivative-work and retouching credits, the name to use). When the text names
     nobody and the HTML links only a `User talk:` page, that user name is put in
     front (`Böhringer: Feel free to use my photos…`). The build stops if an author
     ends in `…` or still contains `@`. Only the demo's UI shortens long credits on
     screen; `credits.html` always shows them whole.
   - `extmetadata.LicenseShortName` is CC0, Public domain, CC BY or CC BY-SA (any
     version or port). GFDL-only, FAL and other licenses are dropped.
   - `extmetadata.Restrictions` does not contain `personality` (identifiable people).
   - Neither the title nor any non-hidden category matches the sensitive-keyword
     pattern (nudity, sexual content, mating, corpses, dead animals, carcasses,
     skulls, bones, blood, wounds, surgery, medical, executions, slaughter, hunting,
     prey, animals eating other animals, trophies, taxidermy, stuffed animals, graves,
     cemeteries, funerals, war, weapons, military, warships, prisons, riots,
     disasters, accidents, fire, parasites, disease, and similar).
     A few harmless phrases are let through: "birds of prey", "Dead Sea",
     "Death Valley", "Dead Horse Point", "fire-breasted" and other species names.
   - Neither the title nor any non-hidden category matches the off-topic pattern
     (people, crowds, illustrations, paintings, drawings, lithographs, engravings,
     sculptures, statues, frescoes, stained glass, altars and altarpieces, icons,
     paleoart, Google Art Project scans, maps, diagrams, charts, posters, stamps,
     coins, documents, heraldry, flags, logos, micrographs, X-rays, museum
     specimens, panoramas, 360° / equirectangular, astronomy, NASA and Mars images,
     fireworks, abstract, textures, aerial and drone photos, pilgrimages and rituals).
     Views without a natural "up" are also dropped when the title or a category says
     so: ceilings (including German `Decke`), domes, cupolas, vaults, skylights,
     chandeliers, staircases, "looking up" / worm's-eye views, water reflections and
     mirrors.
   - The thumbnail URL can be reproduced (see below).

3. **Balance.** Candidates of each topic are ordered by the salted md5 above and judged
   in batches of 50 until the topic has enough accepted files. The per-topic cap is the
   smallest value `c` with `Σ min(accepted_t, c) ≥ target` (water filling), so small
   topics keep everything and large topics are cut evenly. The last few surplus files
   are removed from the largest topics so the balanced selection is exactly the target.
4. **Review exclusions.** Every thumbnail of the balanced selection was looked at on
   contact sheets (`reviewed` and `method` in `scripts/commons-exclude.json`, last on
   2026-10-21). Files without a natural upright direction (163, for example top-down
   textures, bark, specimen plates) or unsuitable for a family-friendly demo (28:
   dead or injured animals, nudity, weapons, non-photos, an identifiable close-up and
   other disturbing scenes) are listed there with a reason and a note, and are removed
   after balancing. The shipped total is therefore the target minus the 191 reviewed
   exclusions: 2,809 of 3,000.

The build prints the rejection counts with up to 40 example titles per reason.
Read them after changing a filter. The patterns were tuned by looking at contact
sheets of about 480 randomly sampled thumbnails across all topics. Keyword filters
are not perfect: a few ceiling shots and religious interiors without telling
categories still pass.

## Locations

The locations are looked up after the selection, so they never change which files are
kept or their order.

1. **Coordinates.** For the kept files, in batches of 50, the generator asks Commons'
   GeoData for `prop=coordinates&coprimary=all&coprop=type|country|region|globe&colimit=max`.
   It takes the primary coordinates (the camera location from `{{Location}}`), and
   when there are none, the first secondary `object` coordinates (`{{Object location}}`).
   Coordinates on another globe, outside the valid range, or at exactly 0, 0 are ignored.
   Latitude and longitude are rounded to 2 decimals (about 1.1 km), which is all the
   demo needs and does not pin a photographer's exact spot.
2. **Country.** The ISO 3166-1 alpha-2 code from the coordinates' own `country`
   (the `region:` parameter of the template), when it names a real country
   (`normalizeCountryCode` in `src/core/geo.ts` plus `Intl.DisplayNames`).
   Most Commons coordinates have no region, so otherwise the generator asks
   `en.wikipedia.org` for up to 20 geotagged articles within 10 km of the rounded point
   (`list=geosearch&gsprop=country`) and picks the country with the largest weight
   `Σ 1 / (1 + distance / 1 km)` (ties by code). One lookup per distinct rounded point.
   With no article in range (open sea, remote areas) the country stays unknown and the
   demo shows the coordinates instead (`placeLabel`).

Coverage of the current manifest:

| topic | photos | with coordinates | with country |
|---|---:|---:|---:|
| `birds` | 266 | 215 | 175 |
| `mammals` | 261 | 154 | 127 |
| `insects` | 255 | 196 | 189 |
| `reptiles` | 257 | 172 | 140 |
| `aquatic` | 211 | 38 | 37 |
| `fungi` | 56 | 41 | 41 |
| `food` | 118 | 69 | 69 |
| `transport` | 260 | 190 | 181 |
| `objects` | 179 | 116 | 113 |
| `cityscapes` | 204 | 160 | 158 |
| `architecture` | 254 | 181 | 179 |
| `landscapes` | 256 | 197 | 188 |
| `plants` | 232 | 163 | 162 |
| total | 2,809 | 1,892 (67 %) | 1,759 (63 %) |

Of the 1,892 coordinates, 1,794 are camera locations and 98 object locations. The
country came from the coordinates themselves for 283 photos and from nearby articles for
1,476; 133 stay without a country. Where both sources exist they agree for 267 of 271
photos (the four others are on borders or in overseas territories, and the coordinates'
own code wins). The lookup takes 57 GeoData batches of 50 titles and 1,390 geosearch
requests (one per distinct rounded point). The manifest is 280 KB (114 KB gzipped).
Aquarium and underwater photos rarely carry coordinates, which is why `aquatic` is low.

Retired ISO codes are mapped when the successor is unambiguous (`BU`, `DD`, `FX`, `TP`,
`ZR`) and ignored when the country split (`AN`, `CS`, `NT`, `SU`, `YU`), so the nearby
articles decide instead. The build log prints the per-topic coverage, the per-country
counts and up to 40 disagreements.

## URLs and the thumbnail check

Runtime URLs are built by `src/core/manifest.ts`:

- Thumbnail: `thumbBase + h[0] + "/" + h + "/" + enc(file) + "/" + width + "px-" + enc(thumbName ?? file)`,
  where `h` is the first two hex digits of `md5(file)` and `enc` is `encodeURIComponent`
  plus `! ' ( ) *` escaped (the same strict encoding MediaWiki uses for thumbnails).
- Commons page: `pageBase + file`, encoded like MediaWiki's `wfUrlencode` (`( ) , : ; @ $ ! * ~` stay readable, `'` becomes `%27`).
- Only the standard widths 330 (stream) and 960 (pinned loupe) are used.

For every kept file the generator asks the API for `iiurlwidth=330`, strips the query
string, rewrites the host `thumb.wikimedia.org` to `upload.wikimedia.org`, and compares
it with the URL built by `commonsThumbUrl`. When MediaWiki shortens the thumbnail name
(file names longer than about 160 bytes become `330px-thumbnail.jpg`), the shortened
name is stored as `thumbName`. A file whose URL still differs, or whose md5 folder
does not match the original's URL, is dropped. The page URL is also compared with
`descriptionurl`; differences are only counted.

After regenerating, run `node scripts/build-commons-manifest.mjs --check 40`.
The check paces thumbnail requests one second apart.

### Thumbnail rate limits

Most 330 px and 960 px thumbnails of these files are not in Wikimedia's CDN cache
(about 92 % misses in a sample of 300), so the first request renders them.
`upload.wikimedia.org` answered HTTP 429 (with `Retry-After` of about 11 s) when
uncached thumbnails were requested serially at roughly 1 to 2 per second from one
IP; at about 0.7 per second no 429 appeared. Clients should keep few Commons
requests in flight, honour `Retry-After`, and treat 429 as "slow down", not as
"Commons is unreachable".

## Manifest format

```jsonc
{
  "version": 1,
  "generatedAt": "2026-10-21T00:00:00.000Z",
  "thumbBase": "https://upload.wikimedia.org/wikipedia/commons/thumb/",
  "pageBase": "https://commons.wikimedia.org/wiki/File:",
  "licenses": [["CC BY-SA 4.0", "https://creativecommons.org/licenses/by-sa/4.0/"], ["Public domain", null]],
  "topics": ["birds", "mammals"],
  "authors": ["Charles J. Sharp", "Diego Delso"],
  "countries": ["JP", "KE"],
  "items": [
    ["Some_file_name.jpg", "a3", 4693, 3129, 0, 0, 1],
    ["A_very_long_file_name….jpg", "4f", 5183, 3063, 1, 0, 0, "thumbnail.jpg"],
    ["Photo_in_Kenya.jpg", "5c", 4000, 2667, 0, 1, 0, null, -1.29, 36.82, 1],
    ["Photo_far_from_land.jpg", "e1", 4000, 2667, 1, 1, 0, null, -45.32, -30.14]
  ]
}
```

Each item row is
`[file, md5 prefix, width, height, author index, license index, topic index, thumbName?, lat?, lon?, country index?]`,
so a row has 7, 8, 10 or 11 fields. `thumbName` is `null` when a location follows and the
thumbnail keeps the file name. `lat` / `lon` are degrees rounded to 2 decimals; the country
index points into `countries` (ISO 3166-1 alpha-2 codes, sorted). Rows without a location
decode with `location: null`, and `countries` may be missing, so manifests written before
the locations were added still decode.
`file` is the Commons database key (spaces as underscores, no `File:` prefix).
`decodeManifest` validates every field and expands the rows into `CommonsEntry` objects
(`src/contracts.ts`); `commonsSource` copies the location into `PhotoSource.location`.

## Licenses and credit

Each photo stays under its own license; the demo does not relicense anything. The
license, its URL, the author and the Commons page are kept for every file and shown in
the demo's loupe, list view and `credits.html`. CC BY and CC BY-SA require attribution,
which is why the author and license travel with every `PhotoSource`. Public domain files
have no license URL (`null`). Several featured pictures are dual-licensed with GFDL; only
the first license reported by Commons (`LicenseShortName`) is considered.

Some public photos may overlap with the model's training data, so the accuracy shown by
the demo is a live indication, not a benchmark.
