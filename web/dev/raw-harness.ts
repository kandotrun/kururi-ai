import type {
  InferencePool,
  LoadedImage,
  StreamStatus,
} from "../src/contracts";
import {
  classifyPhotoFile,
  splitPhotoFiles,
  type PhotoFileKind,
} from "../src/core/photo-files";
import { mulberry32 } from "../src/core/random";
import { userSource } from "../src/core/sources";
import { createStore, initialDeskState } from "../src/core/store";
import {
  findTiffPreview,
  orientationMatrix,
  orientedSize,
  type ExifOrientation,
} from "../src/core/tiff-preview";
import { buildTiff, TIFF_TYPE } from "../src/core/tiff-preview.fixtures";
import { createImageLoader } from "../src/services/image-loader";
import { browserRenderWorkers } from "../src/services/render-workers";
import { createInferencePool, poolSize } from "../src/services/inference-pool";
import { loadModels } from "../src/services/model-loader";
import { detectPhotoSupport } from "../src/services/photo-support";
import { createStream } from "../src/services/stream";

type Rgb = readonly [number, number, number];

interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
}

interface FileRecord {
  key: string;
  ext: string;
  kind: PhotoFileKind;
  ok: boolean;
  error: string | null;
  loadMs: number;
  aspect: number | null;
  tileWidth: number | null;
  tileHeight: number | null;
  blobBytes: number | null;
  blobType: string | null;
  tiffOrientation: number | null;
  ownOrientation: number | null;
  previewWidth: number | null;
  previewHeight: number | null;
  bytesRead: number | null;
  reads: number | null;
  correction: number | null;
  confidence: number | null;
  inferenceMs: number | null;
}

interface FolderReport {
  found: number;
  accepted: number;
  skipped: number;
  heic: boolean;
  byExtension: Record<string, { found: number; kind: PhotoFileKind }>;
  records: FileRecord[];
  loadSeconds: number;
  totalSeconds: number;
  workers: number;
  sheetGroups: string[];
}

interface RawHarness {
  selftest(): Promise<CheckResult[]>;
  folder: FolderReport | null;
  done: boolean;
  error: string | null;
}

const QUADRANTS: readonly Rgb[] = [
  [230, 30, 30],
  [30, 200, 30],
  [30, 30, 230],
  [240, 240, 30],
];
const SAMPLE_POINTS: ReadonlyArray<readonly [number, number]> = [
  [0.25, 0.25],
  [0.75, 0.25],
  [0.25, 0.75],
  [0.75, 0.75],
];
const ORIENTATIONS: readonly ExifOrientation[] = [1, 2, 3, 4, 5, 6, 7, 8];
const TILES_PER_GROUP = 8;
const TILE = 96;

const params = new URLSearchParams(window.location.search);
const statusLine = document.querySelector<HTMLElement>("#status")!;
const sheet = document.querySelector<HTMLCanvasElement>("#sheet")!;
const picker = document.querySelector<HTMLInputElement>("#pick")!;

const harness: RawHarness = {
  selftest,
  folder: null,
  done: false,
  error: null,
};
(window as Window & { __raw?: RawHarness }).__raw = harness;

function status(text: string): void {
  statusLine.textContent = text;
}

function concat(parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    result.set(part, at);
    at += part.length;
  }
  return result;
}

async function quadrantJpeg(
  width: number,
  height: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d")!;
  const halfW = Math.floor(width / 2);
  const halfH = Math.floor(height / 2);
  QUADRANTS.forEach(([r, g, b], index) => {
    context.fillStyle = `rgb(${r}, ${g}, ${b})`;
    const x = index % 2 === 0 ? 0 : halfW;
    const y = index < 2 ? 0 : halfH;
    context.fillRect(
      x,
      y,
      index % 2 === 0 ? halfW : width - halfW,
      index < 2 ? halfH : height - halfH,
    );
  });
  const blob = await canvas.convertToBlob({
    type: "image/jpeg",
    quality: 0.95,
  });
  return new Uint8Array(await blob.arrayBuffer());
}

function withExif(
  jpeg: Uint8Array,
  orientation: number,
): Uint8Array<ArrayBuffer> {
  const tiff = buildTiff({
    endian: "MM",
    first: 8,
    size: 8 + 2 + 12 + 4,
    ifds: [
      {
        at: 8,
        entries: [
          { tag: 0x0112, type: TIFF_TYPE.short, values: [orientation] },
        ],
      },
    ],
  });
  const payload = concat([
    new Uint8Array([0x45, 0x78, 0x69, 0x66, 0, 0]),
    tiff,
  ]);
  const length = payload.length + 2;
  const segment = concat([
    new Uint8Array([0xff, 0xe1, (length >> 8) & 0xff, length & 0xff]),
    payload,
  ]);
  return concat([jpeg.subarray(0, 2), segment, jpeg.subarray(2)]);
}

function sample(image: ImageBitmap | OffscreenCanvas): Rgb[] {
  const canvas = new OffscreenCanvas(image.width, image.height);
  const context = canvas.getContext("2d", { willReadFrequently: true })!;
  context.drawImage(image, 0, 0);
  return SAMPLE_POINTS.map(([fx, fy]) => {
    const data = context.getImageData(
      Math.floor(fx * image.width),
      Math.floor(fy * image.height),
      1,
      1,
    ).data;
    return [data[0] ?? 0, data[1] ?? 0, data[2] ?? 0] as const;
  });
}

function orientWithMatrix(
  image: ImageBitmap,
  orientation: ExifOrientation,
): OffscreenCanvas {
  const size = orientedSize(image.width, image.height, orientation);
  const canvas = new OffscreenCanvas(size.width, size.height);
  const context = canvas.getContext("2d")!;
  context.setTransform(
    ...orientationMatrix(orientation, image.width, image.height),
  );
  context.drawImage(image, 0, 0);
  return canvas;
}

function nearest(color: Rgb): number {
  let best = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  QUADRANTS.forEach((reference, index) => {
    const distance =
      (reference[0] - color[0]) ** 2 +
      (reference[1] - color[1]) ** 2 +
      (reference[2] - color[2]) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  });
  return best;
}

function layout(colors: readonly Rgb[]): string {
  return colors.map((color) => "RGBY"[nearest(color)]).join("");
}

function syntheticDng(
  jpeg: Uint8Array,
  width: number,
  height: number,
  orientation: number,
): Uint8Array<ArrayBuffer> {
  const at = 4_096;
  const head = buildTiff({
    endian: "MM",
    first: 8,
    size: at,
    ifds: [
      {
        at: 8,
        entries: [
          { tag: 0x00fe, type: TIFF_TYPE.long, values: [1] },
          { tag: 0x0100, type: TIFF_TYPE.long, values: [width] },
          { tag: 0x0101, type: TIFF_TYPE.long, values: [height] },
          { tag: 0x0103, type: TIFF_TYPE.short, values: [7] },
          { tag: 0x0106, type: TIFF_TYPE.short, values: [6] },
          { tag: 0x0111, type: TIFF_TYPE.long, values: [at] },
          { tag: 0x0112, type: TIFF_TYPE.short, values: [orientation] },
          { tag: 0x0117, type: TIFF_TYPE.long, values: [jpeg.length] },
        ],
      },
    ],
  });
  return concat([head, jpeg, new Uint8Array(2_000)]);
}

function syntheticNef(
  jpeg: Uint8Array,
  orientation: number,
): Uint8Array<ArrayBuffer> {
  const at = 4_096;
  const head = buildTiff({
    endian: "II",
    first: 8,
    size: at,
    ifds: [
      {
        at: 8,
        entries: [
          { tag: 0x0112, type: TIFF_TYPE.short, values: [orientation] },
          { tag: 0x014a, type: TIFF_TYPE.long, values: [512] },
        ],
      },
      {
        at: 512,
        entries: [
          { tag: 0x0103, type: TIFF_TYPE.short, values: [6] },
          { tag: 0x0201, type: TIFF_TYPE.long, values: [at] },
          { tag: 0x0202, type: TIFF_TYPE.long, values: [jpeg.length] },
        ],
      },
    ],
  });
  return concat([head, jpeg, new Uint8Array(2_000)]);
}

async function decodeBlob(blob: Blob): Promise<ImageBitmap> {
  return createImageBitmap(blob, { imageOrientation: "from-image" });
}

function drawChecks(
  entries: ReadonlyArray<{ label: string; tile: ImageBitmap; ok: boolean }>,
): void {
  const columns = 7;
  const cell = TILE + 40;
  sheet.width = columns * cell + 16;
  sheet.height = Math.ceil(entries.length / columns) * (cell + 8) + 16;
  const context = sheet.getContext("2d")!;
  context.fillStyle = "#2b5a4a";
  context.fillRect(0, 0, sheet.width, sheet.height);
  context.font = "12px system-ui";
  entries.forEach(({ label, tile, ok }, index) => {
    const x = 8 + (index % columns) * cell;
    const y = 8 + Math.floor(index / columns) * (cell + 8);
    const scale = TILE / Math.max(tile.width, tile.height);
    context.drawImage(tile, x, y, tile.width * scale, tile.height * scale);
    context.fillStyle = ok ? "#e9f0ec" : "#d9372b";
    context.fillText(label, x, y + TILE + 18);
    tile.close();
  });
}

async function selftest(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  const drawn: Array<{ label: string; tile: ImageBitmap; ok: boolean }> = [];
  const base = await quadrantJpeg(64, 48);
  const plain = await createImageBitmap(
    new Blob([base], { type: "image/jpeg" }),
  );
  for (const orientation of ORIENTATIONS) {
    const browser = await decodeBlob(
      new Blob([withExif(base, orientation)], { type: "image/jpeg" }),
    );
    const mine = orientWithMatrix(plain, orientation);
    const ok =
      browser.width === mine.width &&
      browser.height === mine.height &&
      layout(sample(browser)) === layout(sample(mine));
    results.push({
      name: `matrix matches browser EXIF orientation ${orientation}`,
      ok,
      detail: `browser ${browser.width}x${browser.height} ${layout(sample(browser))} mine ${mine.width}x${mine.height} ${layout(sample(mine))}`,
    });
    browser.close();
  }
  const resized = await createImageBitmap(
    new Blob([withExif(base, 6)], { type: "image/jpeg" }),
    {
      imageOrientation: "from-image",
      resizeWidth: 24,
      resizeHeight: 32,
      resizeQuality: "high",
    },
  );
  const reference = orientWithMatrix(plain, 6);
  results.push({
    name: "resize options refer to the EXIF-oriented size",
    ok:
      resized.width === 24 &&
      resized.height === 32 &&
      layout(sample(resized)) === layout(sample(reference)),
    detail: `${resized.width}x${resized.height} ${layout(sample(resized))} vs ${layout(sample(reference))}`,
  });
  resized.close();

  const workers = browserRenderWorkers(2);
  const loaders = [
    {
      label: "page",
      loader: createImageLoader({ tileSize: 120, timeoutMs: 5_000 }),
    },
    {
      label: "worker",
      loader: createImageLoader({
        tileSize: 120,
        timeoutMs: 5_000,
        render: workers.render,
      }),
    },
  ];
  const cases: Array<{
    name: string;
    bytes: Uint8Array<ArrayBuffer>;
    fileName: string;
    expect: ExifOrientation;
    width: number;
    height: number;
  }> = [];
  for (const orientation of ORIENTATIONS) {
    cases.push({
      name: `synthetic DNG orientation ${orientation}`,
      bytes: syntheticDng(base, 64, 48, orientation),
      fileName: `synthetic-${orientation}.DNG`,
      expect: orientation,
      width: 64,
      height: 48,
    });
  }
  for (const orientation of [1, 6, 8, 3] as const) {
    cases.push({
      name: `synthetic NEF orientation ${orientation}`,
      bytes: syntheticNef(base, orientation),
      fileName: `synthetic-${orientation}.NEF`,
      expect: orientation,
      width: 64,
      height: 48,
    });
  }
  cases.push({
    name: "synthetic DNG whose preview has its own EXIF orientation 6",
    bytes: syntheticDng(withExif(base, 6), 64, 48, 6),
    fileName: "synthetic-own.DNG",
    expect: 6,
    width: 64,
    height: 48,
  });
  const large = await quadrantJpeg(3_000, 2_000);
  cases.push({
    name: "synthetic 3000x2000 DNG orientation 8 is fitted to 2048",
    bytes: syntheticDng(large, 3_000, 2_000, 8),
    fileName: "synthetic-large.DNG",
    expect: 8,
    width: 3_000,
    height: 2_000,
  });
  for (const { label, loader } of loaders) {
    for (const testCase of cases) {
      const source = userSource(
        new File([testCase.bytes], testCase.fileName),
        testCase.fileName,
      );
      try {
        const loaded = await loader.load(source);
        const expected = orientWithMatrix(plain, testCase.expect);
        const fromBlob = await decodeBlob(loaded.blob);
        const expectedSize = orientedSize(
          testCase.width,
          testCase.height,
          testCase.expect,
        );
        const scale = Math.min(
          1,
          2_048 / Math.max(testCase.width, testCase.height),
        );
        const ok =
          layout(sample(loaded.bitmap)) === layout(sample(expected)) &&
          layout(sample(fromBlob)) === layout(sample(expected)) &&
          Math.abs(fromBlob.width - Math.round(expectedSize.width * scale)) <=
            1 &&
          Math.abs(fromBlob.height - Math.round(expectedSize.height * scale)) <=
            1 &&
          Math.abs(loaded.aspect - expectedSize.width / expectedSize.height) <
            0.01;
        results.push({
          name: `${label}: ${testCase.name}`,
          ok,
          detail: `tile ${loaded.bitmap.width}x${loaded.bitmap.height} ${layout(sample(loaded.bitmap))} blob ${fromBlob.width}x${fromBlob.height} ${layout(sample(fromBlob))} ${loaded.blob.type} expected ${layout(sample(expected))}`,
        });
        fromBlob.close();
        drawn.push({
          label: `${label} ${testCase.fileName.replace(/^synthetic-/, "")}`,
          tile: loaded.bitmap,
          ok,
        });
      } catch (error) {
        results.push({
          name: `${label}: ${testCase.name}`,
          ok: false,
          detail: String(error),
        });
      }
    }
  }
  workers.dispose();
  drawChecks(drawn);
  const heic = await detectPhotoSupport();
  results.push({ name: "HEIC probe", ok: true, detail: `heic=${heic.heic}` });
  return results;
}

async function hashOf(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-1",
    new TextEncoder().encode(text),
  );
  return Array.from(new Uint8Array(digest).subarray(0, 8), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "(none)" : name.slice(dot + 1).toLowerCase();
}

async function nanoPool(): Promise<InferencePool> {
  const base = new URL("/", window.location.href);
  const models = await loadModels(
    [
      {
        url: new URL("model/kururi-ai-v2-nano-small.onnx", base).href,
        weight: 0.18,
      },
      { url: new URL("model/kururi-ai-v2-nano.onnx", base).href, weight: 0.82 },
    ],
    () => {},
  );
  const pool = createInferencePool({
    size: poolSize(navigator.hardwareConcurrency, undefined, false),
    createWorker: () =>
      new Worker(new URL("../src/worker.ts", import.meta.url), {
        type: "module",
      }),
    initMessage: () => {
      const copies = models.map((model) => ({
        bytes: model.bytes.slice(0),
        weight: model.weight,
      }));
      return {
        message: {
          type: "init",
          engine: "nano",
          models: copies,
          wasmBaseUrl: new URL("ort/", base).href,
        },
        transfer: copies.map((model) => model.bytes),
      };
    },
  });
  await pool.ready;
  return pool;
}

function groupOf(record: FileRecord): string {
  return record.kind === "raw"
    ? `${record.ext} o${record.tiffOrientation ?? "?"}`
    : record.ext;
}

function drawSheet(
  groups: Map<string, Array<{ tile: ImageBitmap; record: FileRecord }>>,
): string[] {
  const names = [...groups.keys()].sort();
  const columns = TILES_PER_GROUP;
  const rowHeight = TILE + 22;
  sheet.width = 140 + columns * (TILE + 8);
  sheet.height = Math.max(40, names.length * rowHeight + 8);
  const context = sheet.getContext("2d")!;
  context.fillStyle = "#2b5a4a";
  context.fillRect(0, 0, sheet.width, sheet.height);
  context.font = "13px system-ui";
  names.forEach((name, row) => {
    const y = 8 + row * rowHeight;
    context.fillStyle = "#e9f0ec";
    context.fillText(name, 8, y + TILE / 2);
    groups.get(name)!.forEach(({ tile, record }, column) => {
      const x = 140 + column * (TILE + 8);
      const scale = TILE / Math.max(tile.width, tile.height);
      const width = tile.width * scale;
      const height = tile.height * scale;
      context.drawImage(
        tile,
        x + (TILE - width) / 2,
        y + (TILE - height) / 2,
        width,
        height,
      );
      context.fillStyle = record.correction === 0 ? "#a9c7ba" : "#d9372b";
      context.fillText(
        record.correction === null ? "-" : `${record.correction * 90}°`,
        x + 2,
        y + TILE + 14,
      );
    });
  });
  return names;
}

async function runFolder(files: File[]): Promise<void> {
  const started = performance.now();
  const infer = params.get("infer") === "1";
  const limit = Number(params.get("limit") ?? "0");
  const support = await detectPhotoSupport();
  const split = splitPhotoFiles(files, support);
  const byExtension: Record<string, { found: number; kind: PhotoFileKind }> =
    {};
  for (const file of files) {
    const ext = extensionOf(file.name);
    const entry = byExtension[ext] ?? {
      found: 0,
      kind: classifyPhotoFile(
        file.webkitRelativePath || file.name,
        file.type,
        support,
      ),
    };
    entry.found += 1;
    byExtension[ext] = entry;
  }
  const photos = limit > 0 ? split.photos.slice(0, limit) : split.photos;
  const pool = infer ? await nanoPool() : null;
  const workerCount = Number(params.get("workers") ?? "0");
  const renderWorkers =
    workerCount > 0 ? browserRenderWorkers(workerCount) : null;
  const loader = createImageLoader({
    tileSize: 120,
    timeoutMs: 15_000,
    heavyDecodes: Number(params.get("heavy") ?? `${Math.max(2, workerCount)}`),
    render: renderWorkers?.render,
  });
  const records: FileRecord[] = [];
  const inferences: Promise<void>[] = [];
  const groups = new Map<
    string,
    Array<{ tile: ImageBitmap; record: FileRecord }>
  >();
  let next = 0;
  let finished = 0;
  const loadStarted = performance.now();

  async function handle(file: File, index: number): Promise<void> {
    const path = file.webkitRelativePath || file.name;
    const kind = classifyPhotoFile(path, file.type, support);
    const record: FileRecord = {
      key: await hashOf(path),
      ext: extensionOf(file.name),
      kind,
      ok: false,
      error: null,
      loadMs: 0,
      aspect: null,
      tileWidth: null,
      tileHeight: null,
      blobBytes: null,
      blobType: null,
      tiffOrientation: null,
      ownOrientation: null,
      previewWidth: null,
      previewHeight: null,
      bytesRead: null,
      reads: null,
      correction: null,
      confidence: null,
      inferenceMs: null,
    };
    records.push(record);
    if (kind === "raw") {
      let bytesRead = 0;
      let reads = 0;
      const diag = await findTiffPreview(async (offset, length) => {
        bytesRead += length;
        reads += 1;
        return new Uint8Array(
          await file.slice(offset, offset + length).arrayBuffer(),
        );
      }, file.size).catch(() => null);
      record.bytesRead = bytesRead;
      record.reads = reads;
      record.tiffOrientation = diag?.orientation ?? null;
      record.ownOrientation = diag?.jpeg.orientation ?? null;
      record.previewWidth = diag?.jpeg.width ?? null;
      record.previewHeight = diag?.jpeg.height ?? null;
    }
    const loadAt = performance.now();
    let loaded: LoadedImage;
    try {
      loaded = await loader.load(userSource(file, `f${index}`));
    } catch (error) {
      record.error = error instanceof Error ? error.message : String(error);
      record.loadMs = performance.now() - loadAt;
      return;
    }
    record.ok = true;
    record.loadMs = performance.now() - loadAt;
    record.aspect = loaded.aspect;
    record.tileWidth = loaded.bitmap.width;
    record.tileHeight = loaded.bitmap.height;
    record.blobBytes = loaded.blob.size;
    record.blobType = loaded.blob.type;
    const group = groupOf(record);
    const members = groups.get(group) ?? [];
    if (members.length < TILES_PER_GROUP) {
      members.push({ tile: loaded.bitmap, record });
      groups.set(group, members);
    } else {
      loaded.bitmap.close();
    }
    if (pool) {
      inferences.push(
        pool.infer(`f${index}`, loaded.blob, 0).then(
          (prediction) => {
            record.correction = prediction.correction;
            record.confidence = prediction.confidence;
            record.inferenceMs = prediction.inferenceMs;
          },
          (error: unknown) => {
            record.error = `infer: ${error instanceof Error ? error.message : String(error)}`;
          },
        ),
      );
    }
  }

  async function lane(): Promise<void> {
    while (next < photos.length) {
      const index = next;
      next += 1;
      await handle(photos[index]!, index);
      finished += 1;
      if (finished % 10 === 0) {
        status(`読み込み ${finished} / ${photos.length}`);
      }
    }
  }

  await Promise.all(Array.from({ length: 6 }, () => lane()));
  const loadSeconds = (performance.now() - loadStarted) / 1_000;
  status(`推論待ち ${inferences.length}`);
  await Promise.all(inferences);
  const sheetGroups = drawSheet(groups);
  harness.folder = {
    found: files.length,
    accepted: split.photos.length,
    skipped: split.skipped,
    heic: support.heic,
    byExtension,
    records,
    loadSeconds,
    totalSeconds: (performance.now() - started) / 1_000,
    workers: pool?.size ?? 0,
    sheetGroups,
  };
  pool?.dispose();
  renderWorkers?.dispose();
  status(`完了 ${records.length}`);
}

async function profileStages(files: File[]): Promise<Record<string, number[]>> {
  const stages: Record<string, number[]> = {};
  const note = (name: string, started: number) => {
    (stages[name] ??= []).push(Math.round(performance.now() - started));
  };
  const count = Number(params.get("profile") ?? "0");
  const { photos } = splitPhotoFiles(files);
  const raws = photos
    .filter((file) => classifyPhotoFile(file.name, file.type) === "raw")
    .slice(0, count);
  const images = photos
    .filter((file) => classifyPhotoFile(file.name, file.type) === "image")
    .slice(0, count);
  for (const file of raws) {
    let at = performance.now();
    const preview = await findTiffPreview(
      async (offset, length) =>
        new Uint8Array(await file.slice(offset, offset + length).arrayBuffer()),
      file.size,
    );
    note("raw: find preview", at);
    if (!preview) {
      continue;
    }
    const slice = file.slice(
      preview.jpeg.offset,
      preview.jpeg.offset + preview.jpeg.length,
      "image/jpeg",
    );
    at = performance.now();
    const bytes = await slice.arrayBuffer();
    note("raw: read preview bytes", at);
    const inMemory = new Blob([bytes], { type: "image/jpeg" });
    const scale = 2_048 / Math.max(preview.jpeg.width, preview.jpeg.height);
    const decodeOptions: ImageBitmapOptions = {
      imageOrientation: "from-image",
      resizeWidth: Math.round(preview.jpeg.width * scale),
      resizeHeight: Math.round(preview.jpeg.height * scale),
      resizeQuality: "high",
    };
    at = performance.now();
    const fromMemory = await createImageBitmap(inMemory, decodeOptions);
    note("raw: decode from memory", at);
    fromMemory.close();
    at = performance.now();
    const fromFile = await createImageBitmap(slice, decodeOptions);
    note("raw: decode from file slice", at);
    at = performance.now();
    const canvas = orientWithMatrix(fromFile, preview.orientation);
    await canvas.convertToBlob({ type: "image/jpeg", quality: 0.92 });
    note("raw: orient and encode", at);
    fromFile.close();
  }
  for (const file of images) {
    let at = performance.now();
    const bytes = await file.arrayBuffer();
    note("image: read file", at);
    at = performance.now();
    const fromMemory = await createImageBitmap(
      new Blob([bytes], { type: file.type }),
      { imageOrientation: "from-image" },
    );
    note("image: decode from memory", at);
    fromMemory.close();
    at = performance.now();
    const fromFile = await createImageBitmap(file, {
      imageOrientation: "from-image",
    });
    note("image: decode from file", at);
    fromFile.close();
  }
  return stages;
}

interface StreamReport {
  accepted: number;
  placed: number;
  failed: Record<string, number>;
  corrections: Record<string, number>;
  seconds: number;
  notices: Array<string | null>;
  statuses: StreamStatus[];
  peakInFlight: number;
}

async function runStream(files: File[]): Promise<StreamReport> {
  const support = await detectPhotoSupport();
  const { photos } = splitPhotoFiles(files, support);
  const workerCount = Number(params.get("workers") ?? "0");
  const renderWorkers =
    workerCount > 0 ? browserRenderWorkers(workerCount) : null;
  const loader = createImageLoader({
    tileSize: 120,
    timeoutMs: 15_000,
    heavyDecodes: Math.max(2, workerCount),
    render: renderWorkers?.render,
  });
  const pool = await nanoPool();
  const store = createStore(initialDeskState(0));
  const notices: Array<string | null> = [];
  const statuses: StreamStatus[] = [];
  let peakInFlight = 0;
  store.subscribe((state) => {
    let inFlight = 0;
    for (const record of state.records.values()) {
      if (record.phase !== "placed" && record.phase !== "failed") {
        inFlight += 1;
      }
    }
    peakInFlight = Math.max(peakInFlight, inFlight);
  });
  const started = performance.now();
  const finished = new Promise<void>((resolve) => {
    const stream = createStream({
      sources: [],
      makeUserSource: userSource,
      loader,
      pool,
      store,
      scene: {
        addPrint: async (print) => print.image.close(),
        setScanning: () => {},
        decide: () => {},
        place: async () => {},
        focus: () => {},
        removePrint: () => {},
      },
      random: mulberry32(1),
      now: () => performance.now(),
      wait: (ms) => new Promise((done) => window.setTimeout(done, ms)),
      simulateUser: () => false,
      reducedMotion: () => true,
      limits: {
        maxPile: 24,
        maxLoading: 6,
        maxPrints: Number(params.get("capacity") ?? "3200"),
        openingBatch: 36,
        openingHoldMs: 0,
      },
      onStatus: (status) => {
        statuses.push(status);
        if (status === "finished") {
          resolve();
        }
      },
      onNotice: (message) => notices.push(message),
    });
    stream.addUserFiles(photos);
    stream.start();
  });
  await finished;
  const seconds = (performance.now() - started) / 1_000;
  const failed: Record<string, number> = {};
  const corrections: Record<string, number> = {};
  let placed = 0;
  for (const record of store.getState().records.values()) {
    if (record.phase === "placed") {
      placed += 1;
      const key = `${(record.prediction?.correction ?? 0) * 90}`;
      corrections[key] = (corrections[key] ?? 0) + 1;
    } else if (record.phase === "failed") {
      failed[record.error ?? "?"] = (failed[record.error ?? "?"] ?? 0) + 1;
    }
  }
  pool.dispose();
  renderWorkers?.dispose();
  return {
    accepted: photos.length,
    placed,
    failed,
    corrections,
    seconds,
    notices,
    statuses,
    peakInFlight,
  };
}

picker.addEventListener("change", () => {
  if (params.get("stream")) {
    runStream(Array.from(picker.files ?? [])).then(
      (report) => {
        (window as Window & { __stream?: StreamReport }).__stream = report;
        harness.done = true;
      },
      (error: unknown) => {
        harness.error = String(error);
        harness.done = true;
      },
    );
    return;
  }
  if (params.get("profile")) {
    profileStages(Array.from(picker.files ?? [])).then((stages) => {
      (window as Window & { __profile?: Record<string, number[]> }).__profile =
        stages;
      harness.done = true;
    });
    return;
  }
  const files = Array.from(picker.files ?? []);
  harness.done = false;
  runFolder(files).then(
    () => {
      harness.done = true;
    },
    (error: unknown) => {
      harness.error = String(error);
      harness.done = true;
    },
  );
});

status("準備完了");
