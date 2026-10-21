import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  commonsPageUrl,
  commonsThumbUrl,
  commonsTitle,
  commonsTopicLabel,
  decodeManifest,
} from "../src/core/manifest.ts";
import { normalizeCountryCode, placeLabel } from "../src/core/geo.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const API_URL = "https://commons.wikimedia.org/w/api.php";
const NEARBY_API_URL = "https://en.wikipedia.org/w/api.php";
const USER_AGENT =
  "kururi-ai-web-demo/1.0 (https://github.com/kandotrun/kururi-ai; manifest builder)";
const THUMB_BASE = "https://upload.wikimedia.org/wikipedia/commons/thumb/";
const PAGE_BASE = "https://commons.wikimedia.org/wiki/File:";
const SORT_SALT = "kururi-ai-commons-v1:";
const REQUEST_SPACING_MS = 150;
const THUMB_SPACING_MS = 1000;
const MAX_ATTEMPTS = 8;
const BATCH_SIZE = 50;
const MAX_DEPTH = 6;
const STREAM_WIDTH = 330;
const LARGE_WIDTH = 960;
const AUTHOR_LIMIT = 80;
const COORDINATE_SCALE = 100;
const NEARBY_RADIUS_M = 10_000;
const NEARBY_LIMIT = 20;
const NEARBY_FALLOFF_M = 1000;
const REGION_NAMES = new Intl.DisplayNames(["en"], { type: "region", fallback: "none" });

const TOPICS = [
  {
    key: "birds",
    roots: ["Featured pictures of birds"],
  },
  {
    key: "mammals",
    roots: ["Featured pictures of mammals"],
  },
  {
    key: "insects",
    roots: ["Featured pictures of Arthropoda"],
  },
  {
    key: "reptiles",
    roots: ["Featured pictures of reptiles", "Featured pictures of amphibians"],
  },
  {
    key: "aquatic",
    roots: [
      "Featured pictures of fish",
      "Featured pictures of molluscs",
      "Featured pictures of Cnidaria",
      "Featured pictures of Echinodermata",
    ],
  },
  {
    key: "fungi",
    roots: ["Featured pictures of fungi"],
  },
  {
    key: "food",
    roots: ["Featured pictures of food", "Featured still-life photographs"],
  },
  {
    key: "transport",
    roots: [
      "Featured pictures of vehicles",
      "Featured pictures of aviation",
      "Featured pictures of rail transport",
      "Featured pictures of water transport",
      "Featured pictures of cableways",
    ],
  },
  {
    key: "objects",
    roots: [
      "Featured pictures of objects",
      "Featured pictures of machines",
      "Featured pictures of musical instruments",
      "Featured pictures of optical devices",
      "Featured pictures of wearable objects",
    ],
    skip: /\b(organisms|architectural)\b/i,
  },
  {
    key: "cityscapes",
    roots: ["Featured pictures of cityscapes", "Featured pictures of villages"],
  },
  {
    key: "architecture",
    roots: [
      "Featured pictures of buildings",
      "Featured pictures of architectural structures",
      "Featured pictures of bridges",
      "Featured pictures of windmills",
      "Featured pictures of architecture",
    ],
  },
  {
    key: "landscapes",
    roots: [
      "Featured pictures of landscapes",
      "Featured pictures of landforms",
      "Featured pictures of bodies of water",
      "Featured pictures of natural phenomena",
      "Featured pictures of agriculture",
      "Featured pictures of gardens",
      "Featured pictures of parks",
    ],
    skip: /\b(snowflakes?|snow crystals?|ice crystals?|habitats?|organisms)\b|\b(animals|birds|flowers|plants|insects|mammals|reptiles|nature) (in|of)\b/i,
    leaves: ["Featured pictures of islands"],
  },
  {
    key: "plants",
    roots: ["Featured pictures of plants"],
  },
];

const SKIP_CATEGORY = new RegExp(
  [
    "\\bby\\b",
    "\\bfrom\\b",
    "\\bpeople\\b",
    "\\bportraits?\\b",
    "\\bnudes?\\b",
    "\\bart\\b",
    "\\barts\\b",
    "\\bpaintings?\\b",
    "\\bdrawings?\\b",
    "\\bsculptures?\\b",
    "\\bstatues?\\b",
    "\\breliefs?\\b",
    "\\bmosaics?\\b",
    "\\bstained\\b",
    "\\bprints\\b",
    "\\bposters?\\b",
    "\\bmaps?\\b",
    "\\bdiagrams?\\b",
    "\\bastronomy\\b",
    "\\bspace\\b",
    "\\bspacecraft\\b",
    "\\bsatellites?\\b",
    "\\beclipses?\\b",
    "\\bthe sun\\b",
    "\\bmoon\\b",
    "\\baurora\\b",
    "\\bnight sky\\b",
    "\\bfossils?\\b",
    "\\bbones\\b",
    "\\bminerals?\\b",
    "\\bcrystals?\\b",
    "\\bmixtures\\b",
    "\\bwood\\b",
    "\\bmicro\\w*",
    "\\bmonetary\\b",
    "\\bbanknotes\\b",
    "\\bcoins\\b",
    "\\btoilets\\b",
    "\\bcemeteries\\b",
    "\\bmausoleums\\b",
    "\\bmonuments\\b",
    "\\bmemorials?\\b",
    "\\bholocaust\\b",
    "\\bhistory\\b",
    "\\bmilitary\\b",
    "\\bbunkers\\b",
    "\\bceilings?\\b",
    "\\bdomes?\\b",
    "\\blight painting\\b",
    "\\bcartoons\\b",
    "\\btaken underwater\\b",
    "\\bfire\\b",
    "\\breflections\\b",
    "\\bliquid\\b",
    "\\bgases\\b",
    "\\baltars\\b",
    "\\bspecimens\\b",
    "\\bsports?\\b",
    "\\bshipwrecks\\b",
    "\\btanks\\b",
    "\\bstairs\\b",
    "\\bfloors\\b",
    "\\blouvre\\b",
    "\\bmusée\\b",
    "\\bmuseu\\b",
    "\\bmuseum of\\b",
    "\\b(phthiraptera|siphonaptera|acari)\\b",
    "\\bcycling\\b",
    "\\bamusement rides\\b",
  ].join("|"),
  "i",
);

const SENSITIVE = new RegExp(
  [
    "\\bnud(e|es|ity|ism|ist|ists)\\b",
    "\\bnaked\\b",
    "\\bnaturis\\w*",
    "\\btopless\\b",
    "\\berotic\\w*",
    "\\bsex\\w*",
    "\\bgenital\\w*",
    "\\bbreasts?\\b",
    "\\blingerie\\b",
    "\\bbikinis?\\b",
    "\\bunderwear\\b",
    "\\bcorpses?\\b",
    "\\bcadavers?\\b",
    "\\bdead\\b(?! sea)",
    "\\bdeath\\b(?! valley)",
    "\\bdied\\b",
    "\\bcarcass(es)?\\b",
    "\\bcarrion\\b",
    "\\broadkill\\b",
    "\\bskulls?\\b",
    "\\bskeletons?\\b",
    "\\bbones?\\b",
    "\\bblood\\w*",
    "\\bwound\\w*",
    "\\binjur\\w*",
    "\\bsurg\\w*",
    "\\bautops\\w*",
    "\\bmedical\\b",
    "\\bexecut\\w*",
    "\\bgallows\\b",
    "\\bslaughter\\w*",
    "\\bbutcher\\w*",
    "\\babattoirs?\\b",
    "\\bhunt(ing|ed|er|ers)?\\b",
    "\\btroph(y|ies)\\b",
    "\\btaxiderm\\w*",
    "\\bmumm(y|ies|ified)\\b",
    "\\bgraves?\\b",
    "\\bcemeter\\w*",
    "\\btombs?\\b",
    "\\bfuneral\\w*",
    "\\bwars?\\b",
    "\\bbattles?\\b",
    "\\bweapons?\\b",
    "\\bguns?\\b",
    "\\brifles?\\b",
    "\\bfirearms?\\b",
    "\\bbomb(s|ed|ing|er|ers)?\\b",
    "\\bmilitary\\b",
    "\\bsoldiers?\\b",
    "\\bprison\\w*",
    "\\bholocaust\\b",
    "\\bgenocide\\b",
    "\\bmassacres?\\b",
    "\\btortur\\w*",
    "\\baccidents?\\b",
    "\\bcrash(es|ed)?\\b",
    "\\b\\w*wrecks?\\b",
    "\\bdisasters?\\b",
    "\\bfires?\\b",
    "\\bburning\\b",
    "\\bpredat\\w*",
    "\\bprey\\b",
    "\\bkill(s|ed|ing)?\\b",
    "\\bparasit(e|es|ic|ism|oid|oids)\\b",
    "\\bcopulat\\w*",
    "\\bmating\\b",
    "\\bdiseases?\\b",
    "\\binfect\\w*",
    "\\b(eating|eats|swallowing|swallows|devouring|devours|feeding on)\\s+(an?\\s+|the\\s+)?(frogs?|toads?|lizards?|snakes?|fish|birds?|mice|mouse|rats?|rodents?|uromastyx|insects?|spiders?|crabs?|prey|carcass(es)?|animals?|diptera|hymenoptera|lepidoptera|odonata|orthoptera|coleoptera|mammals?)\\b",
    "\\bbirds on (an? )?sticks?\\b",
    "\\bwarships?\\b",
    "\\bfr(i|é)gates?\\b",
    "\\bdestroyers?\\b",
    "\\bcorvettes?\\b",
    "\\baircraft carriers?\\b",
    "\\bnavy\\b",
    "\\bnaval (ships?|vessels?)\\b",
    "\\briots?\\b",
    "\\bunrest\\b",
    "\\barson\\b",
    "\\b(pig|pigs|goat|goats|sheep|cow|cows|calf|lamb)'?s? heads?\\b",
    "\\bstuffed\\b",
  ].join("|"),
  "i",
);

const OFF_TOPIC = new RegExp(
  [
    "\\bpeople\\b",
    "\\bpersons?\\b",
    "\\bwomen\\b",
    "\\bmen\\b",
    "\\bgirls?\\b",
    "\\bboys?\\b",
    "\\bchildren\\b",
    "\\bselfies?\\b",
    "\\bcrowds?\\b",
    "\\bmonks\\b",
    "\\bnuns\\b",
    "\\bpriests?\\b",
    "\\bdancers?\\b",
    "\\bmusicians?\\b",
    "\\bathletes?\\b",
    "\\bpainting\\w*",
    "\\bdrawing\\w*",
    "\\billustrat\\w*",
    "\\blithograph\\w*",
    "\\bengraving\\w*",
    "\\betchings?\\b",
    "\\bwoodcut\\w*",
    "\\bwatercolo\\w*",
    "\\bsculpture\\w*",
    "\\bstatue\\w*",
    "\\bmaps?\\b",
    "\\bdiagrams?\\b",
    "\\bcharts?\\b",
    "\\bposters?\\b",
    "\\bstamps?\\b",
    "\\bbanknotes?\\b",
    "\\bcoins?\\b",
    "\\bdocuments?\\b",
    "\\bmanuscripts?\\b",
    "\\bcoats? of arms\\b",
    "\\bheraldry\\b",
    "\\bflags?\\b",
    "\\blogos?\\b",
    "\\bmicrograph\\w*",
    "\\bmicroscop\\w*",
    "\\belectron microscop\\w*",
    "\\bx-?rays?\\b",
    "\\bradiograph\\w*",
    "\\bpanoram\\w*",
    "\\b360\\b",
    "\\bequirectangular\\b",
    "\\bspherical\\b",
    "\\bastronom\\w*",
    "\\bnight sky\\b",
    "\\bmilky way\\b",
    "\\bstar trails?\\b",
    "\\bfireworks?\\b",
    "\\babstract\\b",
    "\\btextures?\\b",
    "\\baerial\\b",
    "\\bdrone\\b",
    "\\bsatellite\\b",
    "\\bceilings?\\b",
    "\\bskylights?\\b",
    "\\bdomes?\\b",
    "\\bcupolas?\\b",
    "\\bvaults?\\b",
    "\\bfresco\\w*",
    "\\bstained[- ]glass\\b",
    "\\bvitra(il|ux)\\b",
    "\\b\\w*(?<!gibr)altar(s|e|es|piece|pieces|bild)?\\b",
    "\\bretablos?\\b",
    "\\breredos\\b",
    "\\bicons\\b",
    "\\bchandeliers?\\b",
    "\\blooking up(ward|wards)?\\b",
    "\\bworm'?s[- ]eye\\b",
    "\\bfrom below\\b",
    "\\bpal(a)?eoart\\b",
    "\\blife restorations?\\b",
    "\\bnasa\\b",
    "\\bon mars\\b",
    "\\bmartian\\b",
    "\\bwater reflections?\\b",
    "\\breflections? in (the )?water\\b",
    "\\bmirror(ed|ing|s)?\\b",
    "\\bpilgrim\\w*",
    "\\bhajj\\b",
    "\\brituals?\\b",
    "\\bgoogle art project\\b",
    "\\bmhnt\\b",
    "\\bspecimens?\\b",
    "\\bdecke\\w*",
    "\\bspiral stair\\w*",
    "\\bstaircases?\\b",
    "\\bstairwells?\\b",
    "\\bstairs\\b",
  ].join("|"),
  "i",
);

const BENIGN = /\bbirds? of prey\b|\bdead horse point\b|\bchildren's zoo\b|\bdead ?wood\b|\bdeadnettles?\b|\bfire[ -]?(breasted|tailed|crowned|fronted|capped|throated|bellied|tufted|eye|eyes|bird|birds|fly|flies|salamanders?|bugs?|weed|thorn|wheel)\b/gi;

const EXAMPLE_LIMIT = 40;

const ENTITIES = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  copy: "©",
};

const options = parseArgs({
  options: {
    target: { type: "string", default: "3000" },
    minimum: { type: "string", default: "2000" },
    out: { type: "string", default: resolve(ROOT, "public/commons") },
    cache: { type: "string" },
    check: { type: "string" },
    explore: { type: "boolean", default: false },
  },
}).values;

let lastRequestAt = 0;
let requestCount = 0;

function sleep(ms) {
  return new Promise((done) => setTimeout(done, ms));
}

function sha(value, algorithm = "sha256") {
  return createHash(algorithm).update(value).digest("hex");
}

function log(message) {
  process.stderr.write(`${message}\n`);
}

async function politeFetch(url, init = {}, spacing = REQUEST_SPACING_MS) {
  let delay = 1000;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const wait = lastRequestAt + spacing - Date.now();
    if (wait > 0) {
      await sleep(wait);
    }
    lastRequestAt = Date.now();
    requestCount += 1;
    let response;
    try {
      response = await fetch(url, {
        ...init,
        headers: { "User-Agent": USER_AGENT, ...init.headers },
      });
    } catch (error) {
      log(`network error (${error.message}), retry ${attempt}`);
      await sleep(delay);
      delay = Math.min(delay * 2, 60_000);
      continue;
    }
    if (response.status === 429 || response.status >= 500) {
      const retryAfter = Number(response.headers.get("retry-after"));
      const pause = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : delay;
      log(`HTTP ${response.status}, waiting ${pause} ms (attempt ${attempt})`);
      await response.arrayBuffer().catch(() => undefined);
      await sleep(Math.max(pause, delay));
      delay = Math.min(delay * 2, 60_000);
      continue;
    }
    return response;
  }
  throw new Error(`giving up on ${url}`);
}

async function api(params, endpoint = API_URL) {
  const search = new URLSearchParams({
    action: "query",
    format: "json",
    formatversion: "2",
    maxlag: "5",
    ...params,
  });
  const url = `${endpoint}?${search}`;
  const cacheFile = options.cache ? resolve(options.cache, `${sha(url)}.json`) : null;
  if (cacheFile) {
    try {
      return JSON.parse(await readFile(cacheFile, "utf8"));
    } catch {}
  }
  let delay = 5000;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const response = await politeFetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} for ${url}`);
    }
    const json = await response.json();
    if (json.error?.code === "maxlag") {
      const retryAfter = Number(response.headers.get("retry-after"));
      const pause = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : delay;
      log(`maxlag (${json.error.info}), waiting ${pause} ms`);
      await sleep(pause);
      delay = Math.min(delay * 2, 60_000);
      continue;
    }
    if (json.error) {
      throw new Error(`API error ${json.error.code}: ${json.error.info}`);
    }
    if (cacheFile) {
      await mkdir(options.cache, { recursive: true });
      await writeFile(cacheFile, JSON.stringify(json));
    }
    return json;
  }
  throw new Error(`maxlag did not clear for ${url}`);
}

async function* continued(params, endpoint = API_URL) {
  let token = {};
  for (;;) {
    const json = await api({ ...params, ...token }, endpoint);
    yield json;
    if (!json.continue) {
      return;
    }
    token = json.continue;
  }
}

async function categoryMembers(title) {
  const files = [];
  const subcats = [];
  for await (const json of continued({
    list: "categorymembers",
    cmtitle: title,
    cmtype: "file|subcat",
    cmprop: "title|type",
    cmlimit: "max",
  })) {
    for (const member of json.query?.categorymembers ?? []) {
      if (member.type === "subcat") {
        subcats.push(member.title);
      } else if (member.type === "file") {
        files.push(member.title);
      }
    }
  }
  return { files, subcats };
}

function isJpegTitle(title) {
  return /\.jpe?g$/i.test(title);
}

async function crawlTopics() {
  const visited = new Set();
  const owner = new Map();
  const tree = [];
  const reserved = new Set(TOPICS.flatMap((topic) => topic.roots.map((root) => `Category:${root}`)));
  for (const topic of TOPICS) {
    const queue = topic.roots.map((root) => ({ title: `Category:${root}`, depth: 0 }));
    let categories = 0;
    while (queue.length > 0) {
      const { title, depth } = queue.shift();
      if (visited.has(title)) {
        continue;
      }
      visited.add(title);
      categories += 1;
      const { files, subcats } = await categoryMembers(title);
      let added = 0;
      for (const file of files) {
        if (isJpegTitle(file) && !owner.has(file)) {
          owner.set(file, topic.key);
          added += 1;
        }
      }
      tree.push({ topic: topic.key, title, depth, files: files.length, added });
      if (depth >= MAX_DEPTH || topic.leaves?.includes(title.replace(/^Category:/, ""))) {
        continue;
      }
      for (const subcat of [...subcats].sort()) {
        const name = subcat.replace(/^Category:/, "");
        const blocked = SKIP_CATEGORY.test(name) || topic.skip?.test(name) || reserved.has(subcat);
        if (!blocked && !visited.has(subcat)) {
          queue.push({ title: subcat, depth: depth + 1 });
        }
      }
    }
    log(`crawl ${topic.key}: ${categories} categories`);
  }
  const candidates = new Map(TOPICS.map((topic) => [topic.key, []]));
  for (const [file, topic] of owner) {
    candidates.get(topic).push(file);
  }
  for (const list of candidates.values()) {
    list.sort((left, right) => compare(sortKey(left), sortKey(right)));
  }
  return { candidates, tree };
}

function compare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sortKey(title) {
  return sha(`${SORT_SALT}${title}`, "md5");
}

function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, body) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : Number(body.slice(1));
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return ENTITIES[body.toLowerCase()] ?? match;
  });
}

function plainAuthor(html) {
  const text = decodeEntities(
    html
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]*>/g, " "),
  )
    .replace(/\s+/g, " ")
    .replace(/\s*\((talk|discussion|contribs|disk)\b[^)]*\)/gi, "")
    .replace(/\bUser:/g, "")
    .replace(/\s+([,.;:)])/g, "$1")
    .replace(/\(\s+/g, "(")
    .trim();
  if ([...text].length <= AUTHOR_LIMIT) {
    return text;
  }
  const head = [...text].slice(0, AUTHOR_LIMIT - 1).join("");
  const space = head.lastIndexOf(" ");
  return `${(space > AUTHOR_LIMIT / 2 ? head.slice(0, space) : head).replace(/[\s,;:(-]+$/, "")}…`;
}

function canonicalLicenseUrl(raw) {
  const trimmed = raw.trim();
  if (trimmed === "") {
    return null;
  }
  const url = trimmed.startsWith("//") ? `https:${trimmed}` : trimmed.replace(/^http:/, "https:");
  if (!url.startsWith("https://creativecommons.org/")) {
    return url;
  }
  return `${url.replace(/\/(deed|legalcode)(\.[a-z-]+)?$/i, "").replace(/\/+$/, "")}/`;
}

function licenseOf(meta) {
  const name = (meta.LicenseShortName?.value ?? "").replace(/\s+/g, " ").trim();
  const url = canonicalLicenseUrl(meta.LicenseUrl?.value ?? "");
  if (/^CC0( 1\.0)?$/i.test(name)) {
    return { name: "CC0 1.0", url: url ?? "https://creativecommons.org/publicdomain/zero/1.0/" };
  }
  if (/^public domain$/i.test(name)) {
    return { name: "Public domain", url };
  }
  const cc = /^CC (BY|BY-SA) (\d\.\d)(?: ([a-z]{2,}))?$/i.exec(name);
  if (!cc) {
    return null;
  }
  const kind = cc[1].toUpperCase();
  const port = cc[3]?.toLowerCase();
  return {
    name: `CC ${kind} ${cc[2]}${port ? ` ${port}` : ""}`,
    url: url ?? `https://creativecommons.org/licenses/${kind.toLowerCase()}/${cc[2]}/${port ? `${port}/` : ""}`,
  };
}

function sizeOk(width, height) {
  const aspect = width / height;
  if (aspect < 0.5 || aspect > 2) {
    return false;
  }
  if (width >= height) {
    return width >= 1200 && height >= 800;
  }
  return height >= 1200 && width >= 1000;
}

function dbKey(title) {
  return title.replace(/^File:/, "").replace(/ /g, "_");
}

function stripQuery(url) {
  return url.split("?")[0].split("#")[0];
}

const scratchManifest = {
  version: 1,
  generatedAt: "",
  thumbBase: THUMB_BASE,
  pageBase: PAGE_BASE,
  licenses: [],
  topics: [],
  items: [],
};

function screenText(title) {
  return title
    .replace(/^(File|Category):/, "")
    .replace(/_/g, " ")
    .replace(BENIGN, " ");
}

function firstMatch(pattern, texts) {
  for (const text of texts) {
    const match = pattern.exec(text);
    if (match) {
      return `${match[0]} in ${text}`;
    }
  }
  return null;
}

function judge(page, contentCategories, topic, stats) {
  const reject = (reason, detail = "") => {
    stats[reason] = (stats[reason] ?? 0) + 1;
    if (!stats.examples[reason]) {
      stats.examples[reason] = [];
    }
    if (stats.examples[reason].length < EXAMPLE_LIMIT) {
      stats.examples[reason].push(`${page.title.replace(/^File:/, "")}${detail ? ` [${detail}]` : ""}`);
    }
    return null;
  };
  const info = page.imageinfo?.[0];
  if (!info) {
    return reject("missing-info");
  }
  if (info.mime !== "image/jpeg") {
    return reject("not-jpeg");
  }
  if (!sizeOk(info.width, info.height)) {
    return reject("size-or-aspect");
  }
  const meta = info.extmetadata ?? {};
  const artist = meta.Artist?.value;
  if (typeof artist !== "string" || artist.trim() === "") {
    return reject("no-artist");
  }
  const author = plainAuthor(artist);
  if (author === "") {
    return reject("no-artist");
  }
  const license = licenseOf(meta);
  if (!license) {
    return reject("license", meta.LicenseShortName?.value ?? "none");
  }
  if (/personality/i.test(meta.Restrictions?.value ?? "")) {
    return reject("personality-rights");
  }
  const text = [page.title, ...contentCategories].map(screenText);
  const sensitive = firstMatch(SENSITIVE, text);
  if (sensitive) {
    return reject("sensitive", sensitive);
  }
  const offTopic = firstMatch(OFF_TOPIC, text);
  if (offTopic) {
    return reject("off-topic", offTopic);
  }
  const file = dbKey(page.title);
  const hash = sha(file, "md5").slice(0, 2);
  const apiOriginal = stripQuery(info.url ?? "");
  if (!apiOriginal.includes(`/commons/${hash[0]}/${hash}/`)) {
    return reject("hash-mismatch");
  }
  const apiThumb = stripQuery(info.thumburl ?? "").replace(/^https:\/\/thumb\.wikimedia\.org\//, "https://upload.wikimedia.org/");
  if (info.thumbwidth !== STREAM_WIDTH || !apiThumb.startsWith(THUMB_BASE)) {
    return reject("thumb-missing");
  }
  const thumbSegment = apiThumb.slice(apiThumb.lastIndexOf("/") + 1);
  const prefix = `${STREAM_WIDTH}px-`;
  if (!thumbSegment.startsWith(prefix)) {
    return reject("thumb-unreproducible");
  }
  const apiThumbName = decodeURIComponent(thumbSegment.slice(prefix.length));
  const entry = {
    file,
    hash,
    width: info.width,
    height: info.height,
    author,
    license: 0,
    topic,
    thumbName: apiThumbName === file ? null : apiThumbName,
  };
  if (commonsThumbUrl(scratchManifest, entry, STREAM_WIDTH) !== apiThumb) {
    return reject("thumb-unreproducible");
  }
  if (stripQuery(info.descriptionurl ?? "") !== commonsPageUrl(scratchManifest, entry)) {
    stats.pageUrlDiffers = (stats.pageUrlDiffers ?? 0) + 1;
  }
  return { entry, license };
}

async function fetchDetails(titles) {
  const pages = new Map();
  for await (const json of continued({
    prop: "imageinfo|categories",
    iiprop: "url|size|mime|extmetadata",
    iiurlwidth: String(STREAM_WIDTH),
    iiextmetadatafilter: "Artist|LicenseShortName|LicenseUrl|Restrictions",
    iiextmetadatalanguage: "en",
    clshow: "!hidden",
    cllimit: "max",
    titles: titles.join("|"),
  })) {
    for (const page of json.query?.pages ?? []) {
      const current = pages.get(page.title) ?? { title: page.title, categories: [] };
      if (page.imageinfo) {
        current.imageinfo = page.imageinfo;
      }
      if (page.missing) {
        current.missing = true;
      }
      for (const category of page.categories ?? []) {
        current.categories.push(category.title);
      }
      pages.set(page.title, current);
    }
  }
  return pages;
}

function knownCountry(raw) {
  if (typeof raw !== "string") {
    return null;
  }
  const code = normalizeCountryCode(raw);
  return code !== null && REGION_NAMES.of(code) !== undefined ? code : null;
}

function roundCoordinate(value) {
  return Math.round(value * COORDINATE_SCALE) / COORDINATE_SCALE + 0;
}

function usableCoordinate(coordinate) {
  if ((coordinate.globe ?? "earth") !== "earth") {
    return false;
  }
  const lat = roundCoordinate(coordinate.lat);
  const lon = roundCoordinate(coordinate.lon);
  return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0);
}

function pickCoordinate(coordinates) {
  const usable = coordinates.filter(usableCoordinate);
  return usable.find((coordinate) => coordinate.primary) ?? usable.find((coordinate) => coordinate.type === "object") ?? usable[0] ?? null;
}

async function fetchCoordinates(files) {
  const found = new Map(files.map((file) => [file, []]));
  for (let start = 0; start < files.length; start += BATCH_SIZE) {
    const batch = files.slice(start, start + BATCH_SIZE);
    for await (const json of continued({
      prop: "coordinates",
      coprimary: "all",
      coprop: "type|country|region|globe",
      colimit: "max",
      titles: batch.map((file) => `File:${file.replace(/_/g, " ")}`).join("|"),
    })) {
      for (const page of json.query?.pages ?? []) {
        found.get(dbKey(page.title))?.push(...(page.coordinates ?? []));
      }
    }
  }
  return found;
}

async function nearbyCountry(lat, lon) {
  const json = await api(
    {
      list: "geosearch",
      gscoord: `${lat}|${lon}`,
      gsradius: String(NEARBY_RADIUS_M),
      gslimit: String(NEARBY_LIMIT),
      gsprop: "country",
      gsnamespace: "0",
    },
    NEARBY_API_URL,
  );
  const votes = new Map();
  for (const place of json.query?.geosearch ?? []) {
    const code = knownCountry(place.country);
    if (code !== null) {
      votes.set(code, (votes.get(code) ?? 0) + 1 / (1 + place.dist / NEARBY_FALLOFF_M));
    }
  }
  return [...votes].sort((left, right) => right[1] - left[1] || compare(left[0], right[0]))[0]?.[0] ?? null;
}

async function locate(selected) {
  const coordinates = await fetchCoordinates(selected.map(({ entry }) => entry.file));
  const stats = { camera: 0, object: 0, none: 0, fromCommons: 0, fromNearby: 0, noCountry: 0, agree: 0, disagree: [] };
  const nearby = new Map();
  for (const { entry } of selected) {
    const picked = pickCoordinate(coordinates.get(entry.file) ?? []);
    if (!picked) {
      entry.location = null;
      stats.none += 1;
      continue;
    }
    stats[picked.primary ? "camera" : "object"] += 1;
    const lat = roundCoordinate(picked.lat);
    const lon = roundCoordinate(picked.lon);
    const key = `${lat}|${lon}`;
    if (!nearby.has(key)) {
      nearby.set(key, await nearbyCountry(lat, lon));
      if (nearby.size % 100 === 0) {
        log(`geo nearby lookups ${nearby.size}`);
      }
    }
    const fromCommons = knownCountry(picked.country);
    const fromNearby = nearby.get(key);
    if (fromCommons !== null && fromNearby !== null) {
      if (fromCommons === fromNearby) {
        stats.agree += 1;
      } else {
        stats.disagree.push(`${entry.file} [commons ${fromCommons}, nearby ${fromNearby}]`);
      }
    }
    const country = fromCommons ?? fromNearby;
    stats[fromCommons !== null ? "fromCommons" : fromNearby !== null ? "fromNearby" : "noCountry"] += 1;
    entry.location = { lat, lon, country };
  }
  stats.lookups = nearby.size;
  return stats;
}

function waterFill(counts, target) {
  const total = counts.reduce((sum, count) => sum + count, 0);
  if (total <= target) {
    return Math.max(0, ...counts);
  }
  let low = 0;
  let high = Math.max(...counts);
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    const filled = counts.reduce((sum, count) => sum + Math.min(count, middle), 0);
    if (filled >= target) {
      high = middle;
    } else {
      low = middle + 1;
    }
  }
  return low;
}

async function collect(candidates, target) {
  const stats = { examples: {} };
  const state = new Map(
    TOPICS.map((topic) => [topic.key, { next: 0, accepted: [], exhausted: false }]),
  );
  let bound = Math.ceil(target / TOPICS.length);
  for (;;) {
    for (const topic of TOPICS) {
      const current = state.get(topic.key);
      const list = candidates.get(topic.key);
      while (!current.exhausted && current.accepted.length < bound) {
        const titles = list.slice(current.next, current.next + BATCH_SIZE);
        if (titles.length === 0) {
          current.exhausted = true;
          break;
        }
        current.next += titles.length;
        const pages = await fetchDetails(titles);
        for (const title of titles) {
          const page = pages.get(title);
          if (!page || page.missing) {
            stats["missing-info"] = (stats["missing-info"] ?? 0) + 1;
            continue;
          }
          const result = judge(page, page.categories, topic.key, stats);
          if (result) {
            current.accepted.push(result);
          }
        }
      }
      log(`collect ${topic.key}: ${current.accepted.length} kept from ${current.next}/${list.length}${current.exhausted ? " (all)" : ""}`);
    }
    const counts = TOPICS.map((topic) => state.get(topic.key).accepted.length);
    const cap = waterFill(counts, target);
    const short = TOPICS.some((topic) => {
      const current = state.get(topic.key);
      return !current.exhausted && current.accepted.length < cap;
    });
    if (!short) {
      return { state, cap, stats };
    }
    bound = cap;
  }
}

function select(state, cap, target) {
  const lists = TOPICS.map((topic) => state.get(topic.key).accepted);
  const total = lists.reduce((sum, list) => sum + Math.min(list.length, cap), 0);
  let surplus = Math.max(0, total - target);
  const quotas = lists.map((list) => Math.min(list.length, cap));
  for (let round = 0; surplus > 0; round += 1) {
    let trimmed = false;
    for (let index = quotas.length - 1; index >= 0 && surplus > 0; index -= 1) {
      if (quotas[index] === cap - round && quotas[index] > 0) {
        quotas[index] -= 1;
        surplus -= 1;
        trimmed = true;
      }
    }
    if (!trimmed) {
      break;
    }
  }
  return lists.flatMap((list, index) => list.slice(0, quotas[index]));
}

function buildRaw(selected, generatedAt) {
  const licenseKey = (license) => `${license.name}\u0000${license.url ?? ""}`;
  const licenses = [...new Map(selected.map(({ license }) => [licenseKey(license), license])).values()].sort(
    (left, right) => compare(licenseKey(left), licenseKey(right)),
  );
  const licenseIndex = new Map(licenses.map((license, index) => [licenseKey(license), index]));
  const topics = TOPICS.map((topic) => topic.key).filter((key) => selected.some(({ entry }) => entry.topic === key));
  const topicIndex = new Map(topics.map((key, index) => [key, index]));
  const authors = [...new Set(selected.map(({ entry }) => entry.author))].sort(compare);
  const authorIndex = new Map(authors.map((author, index) => [author, index]));
  const countries = [...new Set(selected.flatMap(({ entry }) => (entry.location?.country ? [entry.location.country] : [])))].sort(compare);
  const countryIndex = new Map(countries.map((country, index) => [country, index]));
  const rows = [...selected]
    .sort((left, right) => topicIndex.get(left.entry.topic) - topicIndex.get(right.entry.topic) || compare(left.entry.file, right.entry.file))
    .map(({ entry, license }) => {
      const row = [
        entry.file,
        entry.hash,
        entry.width,
        entry.height,
        authorIndex.get(entry.author),
        licenseIndex.get(licenseKey(license)),
        topicIndex.get(entry.topic),
      ];
      const location = entry.location ?? null;
      if (entry.thumbName !== null || location !== null) {
        row.push(entry.thumbName);
      }
      if (location !== null) {
        row.push(location.lat, location.lon);
        if (location.country !== null) {
          row.push(countryIndex.get(location.country));
        }
      }
      return row;
    });
  return {
    version: 1,
    generatedAt,
    thumbBase: THUMB_BASE,
    pageBase: PAGE_BASE,
    licenses: licenses.map((license) => [license.name, license.url]),
    topics,
    authors,
    countries,
    items: rows,
  };
}

function serialize(raw) {
  const lines = [
    "{",
    `"version":${raw.version},`,
    `"generatedAt":${JSON.stringify(raw.generatedAt)},`,
    `"thumbBase":${JSON.stringify(raw.thumbBase)},`,
    `"pageBase":${JSON.stringify(raw.pageBase)},`,
    `"licenses":${JSON.stringify(raw.licenses)},`,
    `"topics":${JSON.stringify(raw.topics)},`,
    `"authors":${JSON.stringify(raw.authors)},`,
    `"countries":${JSON.stringify(raw.countries)},`,
    `"items":[`,
    raw.items.map((row) => JSON.stringify(row)).join(",\n"),
    "]}",
  ];
  return `${lines.join("\n")}\n`;
}

function escapeHtml(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatCount(value) {
  return value.toLocaleString("en-US");
}

function creditsHtml(manifest) {
  const groups = manifest.topics.map((topic) => ({
    topic,
    items: manifest.items
      .filter((entry) => entry.topic === topic)
      .map((entry) => ({ entry, title: commonsTitle(entry.file) }))
      .sort((left, right) => compare(left.title, right.title)),
  }));
  const date = manifest.generatedAt.slice(0, 10);
  const located = manifest.items.filter((entry) => entry.location).length;
  const nav = groups
    .map(({ topic, items }) => `<li><a href="#${escapeHtml(topic)}">${escapeHtml(commonsTopicLabel(topic))}</a> <span>${formatCount(items.length)}</span></li>`)
    .join("\n");
  const sections = groups
    .map(({ topic, items }) => {
      const rows = items
        .map(({ entry, title }) => {
          const license = manifest.licenses[entry.license];
          const licenseHtml = license.url
            ? `<a href="${escapeHtml(license.url)}" rel="license noopener">${escapeHtml(license.name)}</a>`
            : escapeHtml(license.name);
          const place = placeLabel(entry.location);
          const placeHtml = place === null ? "" : `<span>撮影地 ${escapeHtml(place)}</span>`;
          return `<li><a class="file" href="${escapeHtml(commonsPageUrl(manifest, entry))}" rel="noopener">${escapeHtml(title)}</a><span class="meta"><span>作者 ${escapeHtml(entry.author)}</span><span>${licenseHtml}</span>${placeHtml}</span></li>`;
        })
        .join("\n");
      return `<section id="${escapeHtml(topic)}" aria-labelledby="h-${escapeHtml(topic)}">\n<h2 id="h-${escapeHtml(topic)}">${escapeHtml(commonsTopicLabel(topic))}<span>${formatCount(items.length)}枚</span></h2>\n<ol>\n${rows}\n</ol>\n</section>`;
    })
    .join("\n");
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<title>デモ写真のクレジット</title>
<style>
:root {
  --mat: #2B5A4A;
  --mat-deep: #173A30;
  --mat-line: #8DB8A6;
  --paper: #F7F5EF;
  --chalk: #E9F0EC;
  --chalk-soft: #A9C7BA;
  --sans: "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", system-ui, sans-serif;
}
* { box-sizing: border-box; }
html { background: var(--mat-deep); }
body {
  margin: 0;
  background: var(--mat-deep);
  color: var(--chalk);
  font: 15px/1.8 var(--sans);
  -webkit-text-size-adjust: 100%;
}
main {
  max-width: 46rem;
  margin: 0 auto;
  padding: 48px 16px 80px;
}
a { color: var(--paper); text-decoration-color: rgba(247, 245, 239, 0.45); text-underline-offset: 3px; }
a:hover { text-decoration-color: var(--paper); }
a:focus-visible { outline: 2px solid var(--paper); outline-offset: 2px; border-radius: 1px; }
.back { display: inline-block; margin-bottom: 28px; font-size: 14px; }
h1 { margin: 0 0 16px; font-size: clamp(26px, 5vw, 36px); line-height: 1.35; font-weight: 700; letter-spacing: 0.02em; }
.intro { margin: 0 0 12px; max-width: 34em; }
.note { margin: 0 0 32px; color: var(--chalk-soft); font-size: 13px; font-variant-numeric: tabular-nums; }
.note + .note { margin-top: -20px; }
nav ul { display: flex; flex-wrap: wrap; gap: 8px 20px; margin: 0 0 40px; padding: 16px 0; list-style: none; border-top: 1px solid rgba(141, 184, 166, 0.35); border-bottom: 1px solid rgba(141, 184, 166, 0.35); }
nav li { white-space: nowrap; }
nav span { color: var(--chalk-soft); font-size: 13px; font-variant-numeric: tabular-nums; }
section { margin: 0 0 48px; }
h2 { display: flex; align-items: baseline; gap: 12px; margin: 0 0 12px; font-size: 20px; line-height: 1.4; font-weight: 700; }
h2 span { color: var(--chalk-soft); font-size: 13px; font-weight: 400; font-variant-numeric: tabular-nums; }
ol { margin: 0; padding: 0; list-style: none; }
ol > li { padding: 10px 0; border-bottom: 1px solid rgba(141, 184, 166, 0.18); overflow-wrap: anywhere; }
.file { display: block; }
.meta { display: flex; flex-wrap: wrap; gap: 0 16px; color: var(--chalk-soft); font-size: 13px; line-height: 1.6; }
.meta a { color: var(--chalk-soft); }
@media (min-width: 720px) {
  main { padding-top: 72px; }
}
</style>
</head>
<body>
<main>
<a class="back" href="../">デモに戻る</a>
<h1>デモ写真のクレジット</h1>
<p class="intro">デモの机に並ぶ写真は、Wikimedia Commons の秀逸な画像（Featured pictures）から選んだものです。ページを開いたときに Wikimedia Commons から直接読み込み、それぞれの写真に付いたライセンスに従って使っています。写真の名前を押すと、Commons の説明ページで詳しい情報を確認できます。</p>
<p class="note">全${formatCount(manifest.items.length)}枚。うち${formatCount(located)}枚は撮影地が分かります。${date} に一覧を作成しました。</p>
<p class="note">撮影地は Commons に記録された位置（撮影した地点、なければ写っているものの位置）を約1 km 単位に丸めたものです。国名は記録された国、なければ近くにある Wikipedia の記事の国から決めています。国が分からない写真は緯度と経度で示します。</p>
<nav aria-label="分類">
<ul>
${nav}
</ul>
</nav>
${sections}
</main>
</body>
</html>
`;
}

function jpegSize(bytes) {
  let offset = 2;
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return null;
  }
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return {
        height: (bytes[offset + 5] << 8) | bytes[offset + 6],
        width: (bytes[offset + 7] << 8) | bytes[offset + 8],
      };
    }
    offset += 2 + length;
  }
  return null;
}

async function check(count) {
  const manifest = decodeManifest(JSON.parse(await readFile(resolve(options.out, "manifest.json"), "utf8")));
  const picked = [...manifest.items]
    .map((entry) => ({ entry, key: sortKey(`check:${Date.now()}:${entry.file}`) }))
    .sort((left, right) => compare(left.key, right.key))
    .slice(0, count)
    .map(({ entry }) => entry);
  let failures = 0;
  for (const entry of picked) {
    const small = commonsThumbUrl(manifest, entry, STREAM_WIDTH);
    const large = commonsThumbUrl(manifest, entry, LARGE_WIDTH);
    const smallResponse = await politeFetch(small, { headers: { Origin: "http://127.0.0.1:5173" } }, THUMB_SPACING_MS);
    const bytes = new Uint8Array(await smallResponse.arrayBuffer());
    const size = jpegSize(bytes);
    const largeResponse = await politeFetch(large, { method: "HEAD", headers: { Origin: "http://127.0.0.1:5173" } }, THUMB_SPACING_MS);
    const expected = entry.width / entry.height;
    const actual = size ? size.width / size.height : Number.NaN;
    const problems = [];
    for (const [label, response] of [["330", smallResponse], ["960", largeResponse]]) {
      if (response.status !== 200) {
        problems.push(`${label} HTTP ${response.status}`);
      }
      if (response.headers.get("access-control-allow-origin") !== "*") {
        problems.push(`${label} CORS ${response.headers.get("access-control-allow-origin")}`);
      }
      if (!(response.headers.get("content-type") ?? "").startsWith("image/jpeg")) {
        problems.push(`${label} type ${response.headers.get("content-type")}`);
      }
    }
    if (!size || size.width !== STREAM_WIDTH || Math.abs(actual - expected) > 0.02 * expected) {
      problems.push(`330 size ${size ? `${size.width}x${size.height}` : "unreadable"} vs ${entry.width}x${entry.height}`);
    }
    if (problems.length > 0) {
      failures += 1;
    }
    log(`${problems.length === 0 ? "ok  " : "FAIL"} ${entry.topic.padEnd(12)} ${entry.thumbName ? "[thumbName] " : ""}${entry.file}${problems.length ? ` :: ${problems.join(", ")}` : ""}`);
  }
  log(`checked ${picked.length}, failures ${failures}, requests ${requestCount}`);
  if (failures > 0) {
    process.exitCode = 1;
  }
}

async function build() {
  const target = Number(options.target);
  const minimum = Number(options.minimum);
  const { candidates, tree } = await crawlTopics();
  for (const topic of TOPICS) {
    log(`candidates ${topic.key}: ${candidates.get(topic.key).length}`);
  }
  if (options.explore) {
    for (const node of tree) {
      log(`${node.topic.padEnd(12)} ${"  ".repeat(node.depth)}${node.title.replace("Category:Featured pictures ", "")} (${node.files}/${node.added})`);
    }
    log(`requests ${requestCount}`);
    return;
  }
  const { state, cap, stats } = await collect(candidates, target);
  const selected = select(state, cap, target);
  if (selected.length < minimum) {
    throw new Error(`only ${selected.length} files passed the filters (minimum ${minimum})`);
  }
  const geo = await locate(selected);
  const epoch = Number(process.env.SOURCE_DATE_EPOCH);
  const generatedAt = new Date(Number.isFinite(epoch) && epoch > 0 ? epoch * 1000 : Date.now()).toISOString().slice(0, 10) + "T00:00:00.000Z";
  const raw = buildRaw(selected, generatedAt);
  const text = serialize(raw);
  const manifest = decodeManifest(JSON.parse(text));
  await mkdir(options.out, { recursive: true });
  await writeFile(resolve(options.out, "manifest.json"), text);
  await writeFile(resolve(options.out, "credits.html"), creditsHtml(manifest));
  const { examples, ...counts } = stats;
  log(`rejections ${JSON.stringify(counts)}`);
  for (const [reason, titles] of Object.entries(examples)) {
    log(`  ${reason}: ${titles.join(" | ")}`);
  }
  for (const topic of manifest.topics) {
    log(`final ${topic}: ${manifest.items.filter((entry) => entry.topic === topic).length}`);
  }
  log(`cap ${cap}, total ${manifest.items.length}, licenses ${manifest.licenses.length}, authors ${raw.authors.length}, thumbName ${manifest.items.filter((entry) => entry.thumbName !== null).length}`);
  const { disagree, ...geoCounts } = geo;
  log(`geo ${JSON.stringify({ ...geoCounts, disagree: disagree.length })}`);
  for (const example of disagree.slice(0, EXAMPLE_LIMIT)) {
    log(`  geo disagree: ${example}`);
  }
  for (const topic of manifest.topics) {
    const items = manifest.items.filter((entry) => entry.topic === topic);
    const located = items.filter((entry) => entry.location).length;
    const named = items.filter((entry) => entry.location?.country).length;
    log(`geo ${topic}: located ${located}/${items.length}, country ${named}/${items.length}`);
  }
  const perCountry = new Map();
  for (const entry of manifest.items) {
    const country = entry.location?.country;
    if (country) {
      perCountry.set(country, (perCountry.get(country) ?? 0) + 1);
    }
  }
  log(`geo countries ${raw.countries.length}: ${[...perCountry].sort((left, right) => right[1] - left[1]).map(([country, count]) => `${country} ${count}`).join(", ")}`);
  log(`manifest ${Buffer.byteLength(text)} bytes, requests ${requestCount}`);
}

if (options.check) {
  await check(Number(options.check));
} else {
  await build();
}
