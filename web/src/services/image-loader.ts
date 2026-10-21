import type { ImageLoader, LoadedImage, PhotoSource } from "../contracts";
import { classifyPhotoFile } from "../core/photo-files";
import {
  findTiffPreview,
  orientationToApply,
  type TiffPreview,
} from "../core/tiff-preview";
import {
  BROWSER_RENDER_PORTS,
  fitWithin,
  renderImage,
  type RenderImage,
  type RenderPlan,
  type RenderPorts,
} from "./render-image";

export type { OrientedImage } from "./render-image";

export interface ImageLoaderOptions {
  tileSize: number;
  timeoutMs: number;
  fetcher?: typeof fetch;
  decode?: RenderPorts["decode"];
  resize?: RenderPorts["resize"];
  orient?: RenderPorts["orient"];
  render?: RenderImage;
  now?: () => number;
  readBytes?: (
    blob: Blob,
    offset: number,
    length: number,
  ) => Promise<Uint8Array>;
  heavyDecodes?: number;
  rawMaxSide?: number;
}

const DEFAULT_RETRY_AFTER_MS = 12_000;
const DEFAULT_HEAVY_DECODES = 2;
const DEFAULT_RAW_MAX_SIDE = 2_048;
const NO_PREVIEW =
  "この RAW ファイルにはブラウザで表示できるプレビュー画像がありません";
const RAW_UNREADABLE = "RAW ファイルのプレビュー画像を読み取れませんでした";
const FILE_UNREADABLE = "写真のファイルを読み込めませんでした";
const HEIC_UNSUPPORTED = "HEIC 形式の写真はこのブラウザでは読み込めません";
const FORMAT_UNSUPPORTED = "この形式の画像はこのブラウザでは読み込めません";

class LoadError extends Error {}

export class RateLimitedError extends LoadError {
  readonly retryAfterMs: number;

  constructor(retryAfterMs: number) {
    super("写真の読み込みが混み合っています（HTTP 429）");
    this.name = "RateLimitedError";
    this.retryAfterMs = retryAfterMs;
  }
}

function retryAfterMs(header: string | null, now: number): number {
  const value = header?.trim() ?? "";
  if (/^\d+$/.test(value)) {
    return Number(value) * 1_000;
  }
  const date = /[a-z]/i.test(value) ? Date.parse(value) : Number.NaN;
  if (Number.isNaN(date)) {
    return DEFAULT_RETRY_AFTER_MS;
  }
  return Math.max(0, date - now);
}

function aborted(): DOMException {
  return new DOMException("写真の読み込みを中止しました", "AbortError");
}

async function defaultReadBytes(
  blob: Blob,
  offset: number,
  length: number,
): Promise<Uint8Array> {
  return new Uint8Array(
    await blob.slice(offset, offset + length).arrayBuffer(),
  );
}

function isHeic(file: File): boolean {
  return (
    /\.hei[cf]$/i.test(file.name) || /^image\/hei[cf]/i.test(file.type.trim())
  );
}

function createLimiter(max: number): <T>(task: () => Promise<T>) => Promise<T> {
  let running = 0;
  const queue: Array<() => void> = [];
  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (running >= max) {
      await new Promise<void>((resolve) => queue.push(resolve));
    } else {
      running += 1;
    }
    try {
      return await task();
    } finally {
      const next = queue.shift();
      if (next) {
        next();
      } else {
        running -= 1;
      }
    }
  };
}

export function createImageLoader(options: ImageLoaderOptions): ImageLoader {
  const fetcher: typeof fetch =
    options.fetcher ?? ((input, init) => fetch(input, init));
  const ports: RenderPorts = {
    decode: options.decode ?? BROWSER_RENDER_PORTS.decode,
    resize: options.resize ?? BROWSER_RENDER_PORTS.resize,
    orient: options.orient ?? BROWSER_RENDER_PORTS.orient,
  };
  const render: RenderImage =
    options.render ?? ((source, plan) => renderImage(source, plan, ports));
  const now = options.now ?? (() => Date.now());
  const readBytes = options.readBytes ?? defaultReadBytes;
  const rawMaxSide = options.rawMaxSide ?? DEFAULT_RAW_MAX_SIDE;
  const heavy = createLimiter(
    Math.max(1, options.heavyDecodes ?? DEFAULT_HEAVY_DECODES),
  );

  async function download(url: string, signal?: AbortSignal): Promise<Blob> {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, options.timeoutMs);
    const forwardAbort = () => controller.abort();
    if (signal?.aborted) {
      forwardAbort();
    } else {
      signal?.addEventListener("abort", forwardAbort, { once: true });
    }
    try {
      const response = await fetcher(url, { signal: controller.signal });
      if (response.status === 429) {
        throw new RateLimitedError(
          retryAfterMs(response.headers.get("retry-after"), now()),
        );
      }
      if (!response.ok) {
        throw new LoadError(
          `写真を読み込めませんでした（HTTP ${response.status}）`,
        );
      }
      const type = response.headers.get("content-type");
      if (type !== null && !type.trim().toLowerCase().startsWith("image/")) {
        throw new LoadError("画像ではないデータが届きました");
      }
      return await response.blob();
    } catch (error) {
      if (timedOut) {
        throw new LoadError("写真の読み込みが時間切れになりました");
      }
      if (signal?.aborted) {
        throw aborted();
      }
      if (error instanceof LoadError) {
        throw error;
      }
      throw new LoadError("写真を読み込めませんでした（ネットワーク）");
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", forwardAbort);
    }
  }

  async function decodeUpright(blob: Blob): Promise<ImageBitmap> {
    try {
      return await ports.decode(blob, { imageOrientation: "from-image" });
    } catch {
      try {
        return await ports.decode(blob);
      } catch {
        throw new LoadError("画像を読み取れませんでした");
      }
    }
  }

  async function fit(
    image: ImageBitmap,
    signal?: AbortSignal,
  ): Promise<ImageBitmap> {
    const target = fitWithin(image.width, image.height, options.tileSize);
    if (!target) {
      return image;
    }
    let resized: ImageBitmap;
    try {
      resized = await ports.resize(image, {
        resizeWidth: target.width,
        resizeHeight: target.height,
        resizeQuality: "high",
      });
    } finally {
      image.close();
    }
    if (signal?.aborted) {
      resized.close();
      throw aborted();
    }
    return resized;
  }

  function checkAbort(signal: AbortSignal | undefined): void {
    if (signal?.aborted) {
      throw aborted();
    }
  }

  async function previewOf(file: File): Promise<TiffPreview> {
    let found: TiffPreview | null;
    try {
      found = await findTiffPreview(
        (offset, length) => readBytes(file, offset, length),
        file.size,
      );
    } catch {
      throw new LoadError(FILE_UNREADABLE);
    }
    if (!found) {
      throw new LoadError(NO_PREVIEW);
    }
    return found;
  }

  function rawPlan(found: TiffPreview): RenderPlan {
    const { jpeg } = found;
    const target =
      (jpeg.orientation ?? 1) === 1
        ? fitWithin(jpeg.width, jpeg.height, rawMaxSide)
        : null;
    return {
      decode: target
        ? {
            imageOrientation: "from-image",
            resizeWidth: target.width,
            resizeHeight: target.height,
            resizeQuality: "high",
          }
        : { imageOrientation: "from-image" },
      maxSide: rawMaxSide,
      orientation: orientationToApply(found),
      tileSize: options.tileSize,
      encode: true,
    };
  }

  async function renderVisitor(
    source: Blob,
    plan: RenderPlan,
    failure: string,
    signal?: AbortSignal,
  ): Promise<LoadedImage> {
    let rendered: Awaited<ReturnType<RenderImage>>;
    try {
      rendered = await heavy(() => {
        checkAbort(signal);
        return render(source, plan);
      });
    } catch (error) {
      if (signal?.aborted) {
        throw aborted();
      }
      throw error instanceof LoadError ? error : new LoadError(failure);
    }
    if (signal?.aborted) {
      rendered.tile.close();
      throw aborted();
    }
    return {
      bitmap: rendered.tile,
      blob: rendered.blob ?? source,
      aspect: rendered.aspect,
    };
  }

  async function loadRaw(
    file: File,
    signal?: AbortSignal,
  ): Promise<LoadedImage> {
    const found = await previewOf(file);
    checkAbort(signal);
    const { offset, length } = found.jpeg;
    const preview = file.slice(offset, offset + length, "image/jpeg");
    return renderVisitor(preview, rawPlan(found), RAW_UNREADABLE, signal);
  }

  function loadVisitorImage(
    file: File,
    signal?: AbortSignal,
  ): Promise<LoadedImage> {
    return renderVisitor(
      file,
      {
        decode: { imageOrientation: "from-image" },
        maxSide: Number.POSITIVE_INFINITY,
        orientation: 1,
        tileSize: options.tileSize,
        encode: false,
      },
      isHeic(file) ? HEIC_UNSUPPORTED : FORMAT_UNSUPPORTED,
      signal,
    );
  }

  async function blobFor(
    source: PhotoSource,
    signal?: AbortSignal,
  ): Promise<Blob> {
    if (source.kind === "user") {
      if (!source.file) {
        throw new LoadError("写真のファイルが見つかりません");
      }
      return source.file;
    }
    if (!source.thumbUrl) {
      throw new LoadError("写真の場所がわかりません");
    }
    return download(source.thumbUrl, signal);
  }

  return {
    async load(source, signal): Promise<LoadedImage> {
      const file = source.kind === "user" ? source.file : null;
      if (file) {
        return classifyPhotoFile(file.name, file.type) === "raw"
          ? loadRaw(file, signal)
          : loadVisitorImage(file, signal);
      }
      const blob = await blobFor(source, signal);
      const image = await decodeUpright(blob);
      if (signal?.aborted || image.width <= 0 || image.height <= 0) {
        image.close();
        throw signal?.aborted
          ? aborted()
          : new LoadError("画像の大きさを読み取れませんでした");
      }
      const aspect = image.width / image.height;
      const bitmap = await fit(image, signal);
      return { bitmap, blob, aspect };
    },
  };
}

export type VisitorPreviewOptions = Pick<
  ImageLoaderOptions,
  "decode" | "resize" | "orient" | "render" | "readBytes"
>;

export async function visitorPreviewBlob(
  file: File,
  maxSide: number,
  options: VisitorPreviewOptions = {},
): Promise<Blob> {
  if (classifyPhotoFile(file.name, file.type) !== "raw") {
    return file;
  }
  const loader = createImageLoader({
    ...options,
    tileSize: maxSide,
    timeoutMs: 0,
    rawMaxSide: maxSide,
    heavyDecodes: 1,
  });
  const loaded = await loader.load({
    id: "visitor-preview",
    kind: "user",
    title: file.name,
    aspect: null,
    thumbUrl: null,
    largeUrl: null,
    file,
    attribution: null,
    uprightFix: null,
  });
  loaded.bitmap.close();
  return loaded.blob;
}
