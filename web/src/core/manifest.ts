import type {
  CommonsEntry,
  CommonsLicense,
  CommonsManifest,
  GeoPlace,
  PhotoSource,
} from "../contracts";

export type CommonsThumbWidth = 330 | 960;

const ROW_LENGTHS: readonly number[] = [7, 8, 10, 11];
const LOCATION_FIELD = 8;
const HASH_PATTERN = /^[0-9a-f]{2}$/;
const COUNTRY_PATTERN = /^[A-Z]{2}$/;
const STRICT_ESCAPES: Readonly<Record<string, string>> = {
  "!": "%21",
  "'": "%27",
  "(": "%28",
  ")": "%29",
  "*": "%2A",
};
const PAGE_UNESCAPES: Readonly<Record<string, string>> = {
  "%3B": ";",
  "%40": "@",
  "%24": "$",
  "%2C": ",",
  "%2F": "/",
  "%3A": ":",
};

function fail(path: string, problem: string): never {
  throw new Error(`Invalid Commons manifest: ${path} ${problem}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) {
    fail(path, "must be a non-empty string");
  }
  return value;
}

function readBase(value: unknown, path: string): string {
  const base = readString(value, path);
  if (!base.startsWith("https://") || !/[/:]$/.test(base)) {
    fail(path, "must be an https URL prefix ending in / or :");
  }
  return base;
}

function readArray(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    fail(path, "must be an array");
  }
  return value;
}

function readIndex(value: unknown, size: number, path: string): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 0 ||
    value >= size
  ) {
    fail(path, `must be an index below ${size}`);
  }
  return value;
}

function readDimension(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    fail(path, "must be a positive integer");
  }
  return value;
}

function readLicense(value: unknown, path: string): CommonsLicense {
  const row = readArray(value, path);
  if (row.length !== 2) {
    fail(path, "must be [name, url]");
  }
  const url = row[1];
  if (url !== null && (typeof url !== "string" || !url.startsWith("http"))) {
    fail(`${path}[1]`, "must be an http(s) URL or null");
  }
  return { name: readString(row[0], `${path}[0]`), url };
}

function readFile(value: unknown, path: string): string {
  const file = readString(value, path);
  if (/\s/.test(file) || !/\.[^._]+$/.test(file)) {
    fail(path, "must be a Commons file name with underscores and an extension");
  }
  return file;
}

function readThumbName(value: unknown, path: string): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  return readFile(value, path);
}

function readCountry(value: unknown, path: string): string {
  if (typeof value !== "string" || !COUNTRY_PATTERN.test(value)) {
    fail(path, "must be an ISO 3166-1 alpha-2 code");
  }
  return value;
}

function readCountries(value: unknown): readonly string[] {
  if (value === undefined) {
    return [];
  }
  return readArray(value, "countries").map((code, index) =>
    readCountry(code, `countries[${index}]`),
  );
}

function readCoordinate(value: unknown, limit: number, path: string): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    Math.abs(value) > limit
  ) {
    fail(path, `must be a number between -${limit} and ${limit}`);
  }
  return value;
}

function readLocation(
  row: readonly unknown[],
  path: string,
  countries: readonly string[],
): GeoPlace | null {
  if (row.length <= LOCATION_FIELD) {
    return null;
  }
  const lat = readCoordinate(row[LOCATION_FIELD], 90, `${path} lat`);
  const lon = readCoordinate(row[LOCATION_FIELD + 1], 180, `${path} lon`);
  if (row.length === LOCATION_FIELD + 2) {
    return { lat, lon, country: null };
  }
  const country =
    countries[
      readIndex(row[LOCATION_FIELD + 2], countries.length, `${path} country`)
    ]!;
  return { lat, lon, country };
}

function readItem(
  value: unknown,
  path: string,
  authors: readonly string[],
  licenseCount: number,
  topics: readonly string[],
  countries: readonly string[],
): CommonsEntry {
  const row = readArray(value, path);
  if (!ROW_LENGTHS.includes(row.length)) {
    fail(path, `must have ${ROW_LENGTHS.join(", ")} fields`);
  }
  const hash = row[1];
  if (typeof hash !== "string" || !HASH_PATTERN.test(hash)) {
    fail(`${path} hash`, "must be two lower-case hex digits");
  }
  return {
    file: readFile(row[0], `${path} file`),
    hash,
    width: readDimension(row[2], `${path} width`),
    height: readDimension(row[3], `${path} height`),
    author: authors[readIndex(row[4], authors.length, `${path} author`)]!,
    license: readIndex(row[5], licenseCount, `${path} license`),
    topic: topics[readIndex(row[6], topics.length, `${path} topic`)]!,
    thumbName: readThumbName(row[7], `${path} thumbName`),
    location: readLocation(row, path, countries),
  };
}

export function decodeManifest(json: unknown): CommonsManifest {
  if (!isRecord(json)) {
    fail("manifest", "must be a JSON object");
  }
  if (json.version !== 1) {
    fail("version", "must be 1");
  }
  const generatedAt = readString(json.generatedAt, "generatedAt");
  const thumbBase = readBase(json.thumbBase, "thumbBase");
  const pageBase = readBase(json.pageBase, "pageBase");
  const licenses = readArray(json.licenses, "licenses").map((value, index) =>
    readLicense(value, `licenses[${index}]`),
  );
  const topics = readArray(json.topics, "topics").map((value, index) =>
    readString(value, `topics[${index}]`),
  );
  const authors = readArray(json.authors, "authors").map((value, index) =>
    readString(value, `authors[${index}]`),
  );
  const countries = readCountries(json.countries);
  const items = readArray(json.items, "items").map((value, index) =>
    readItem(
      value,
      `items[${index}]`,
      authors,
      licenses.length,
      topics,
      countries,
    ),
  );
  return {
    version: 1,
    generatedAt,
    thumbBase,
    pageBase,
    licenses,
    topics,
    items,
  };
}

export function encodeThumbSegment(name: string): string {
  return encodeURIComponent(name).replace(
    /[!'()*]/g,
    (character) => STRICT_ESCAPES[character] ?? character,
  );
}

export function encodePageSegment(name: string): string {
  return encodeURIComponent(name)
    .replace(/'/g, "%27")
    .replace(/%(3B|40|24|2C|2F|3A)/g, (escape) => PAGE_UNESCAPES[escape] ?? escape);
}

export function commonsThumbUrl(
  manifest: CommonsManifest,
  entry: CommonsEntry,
  width: CommonsThumbWidth,
): string {
  const folder = `${entry.hash.charAt(0)}/${entry.hash}`;
  const file = encodeThumbSegment(entry.file);
  const thumb = encodeThumbSegment(entry.thumbName ?? entry.file);
  return `${manifest.thumbBase}${folder}/${file}/${width}px-${thumb}`;
}

export function commonsPageUrl(
  manifest: CommonsManifest,
  entry: CommonsEntry,
): string {
  return `${manifest.pageBase}${encodePageSegment(entry.file)}`;
}

export const COMMONS_TOPIC_LABELS: Readonly<Record<string, string>> = {
  birds: "鳥",
  mammals: "哺乳類",
  insects: "虫",
  reptiles: "爬虫類と両生類",
  aquatic: "魚と水の生き物",
  plants: "植物",
  fungi: "きのこ",
  landscapes: "風景",
  architecture: "建物",
  cityscapes: "街並み",
  transport: "乗り物",
  food: "食べ物",
  objects: "道具と品物",
};

export function commonsTopicLabel(topic: string): string {
  return COMMONS_TOPIC_LABELS[topic] ?? topic;
}

export function commonsTitle(file: string): string {
  return file.replace(/\.[^.]+$/, "").replace(/_/g, " ");
}

export function commonsSource(
  manifest: CommonsManifest,
  entry: CommonsEntry,
  id: string,
): PhotoSource {
  const license = manifest.licenses[entry.license];
  if (!license) {
    throw new Error(
      `Commons entry ${entry.file} refers to missing license ${entry.license}`,
    );
  }
  return {
    id,
    kind: "commons",
    title: commonsTitle(entry.file),
    aspect: entry.width / entry.height,
    thumbUrl: commonsThumbUrl(manifest, entry, 330),
    largeUrl: commonsThumbUrl(manifest, entry, 960),
    file: null,
    attribution: {
      author: entry.author,
      license: license.name,
      licenseUrl: license.url,
      pageUrl: commonsPageUrl(manifest, entry),
    },
    uprightFix: 0,
    location: entry.location ?? null,
  };
}
