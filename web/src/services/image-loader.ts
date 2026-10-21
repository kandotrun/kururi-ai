import type { ImageLoader, LoadedImage, PhotoSource } from "../contracts";

export interface ImageLoaderOptions {
  tileSize: number;
  timeoutMs: number;
  fetcher?: typeof fetch;
  decode?: (source: Blob, options?: ImageBitmapOptions) => Promise<ImageBitmap>;
  resize?: (
    image: ImageBitmap,
    options: ImageBitmapOptions,
  ) => Promise<ImageBitmap>;
  now?: () => number;
}

const DEFAULT_RETRY_AFTER_MS = 12_000;

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

function defaultDecode(
  source: Blob,
  options?: ImageBitmapOptions,
): Promise<ImageBitmap> {
  return options
    ? createImageBitmap(source, options)
    : createImageBitmap(source);
}

export function createImageLoader(options: ImageLoaderOptions): ImageLoader {
  const fetcher: typeof fetch =
    options.fetcher ?? ((input, init) => fetch(input, init));
  const decode = options.decode ?? defaultDecode;
  const now = options.now ?? (() => Date.now());
  const resize =
    options.resize ??
    ((image: ImageBitmap, resizeOptions: ImageBitmapOptions) =>
      createImageBitmap(image, resizeOptions));

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
      return await decode(blob, { imageOrientation: "from-image" });
    } catch {
      try {
        return await decode(blob);
      } catch {
        throw new LoadError("画像を読み取れませんでした");
      }
    }
  }

  async function fit(
    image: ImageBitmap,
    signal?: AbortSignal,
  ): Promise<ImageBitmap> {
    const longSide = Math.max(image.width, image.height);
    if (longSide <= options.tileSize) {
      return image;
    }
    const scale = options.tileSize / longSide;
    let resized: ImageBitmap;
    try {
      resized = await resize(image, {
        resizeWidth: Math.max(1, Math.round(image.width * scale)),
        resizeHeight: Math.max(1, Math.round(image.height * scale)),
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
