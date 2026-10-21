import { afterEach, describe, expect, it, vi } from "vitest";
import type { PhotoSource } from "../contracts";
import { createImageLoader, RateLimitedError } from "./image-loader";

interface FakeBitmap extends ImageBitmap {
  readonly closed: boolean;
  readonly label: string;
}

function bitmap(width: number, height: number, label: string): FakeBitmap {
  let closed = false;
  return {
    width,
    height,
    label,
    get closed() {
      return closed;
    },
    close() {
      closed = true;
    },
  };
}

function source(overrides: Partial<PhotoSource> = {}): PhotoSource {
  return {
    id: "c1",
    kind: "commons",
    title: "湖",
    aspect: 1.5,
    thumbUrl: "https://upload.example.test/lake.jpg",
    largeUrl: null,
    file: null,
    attribution: null,
    uprightFix: 0,
    ...overrides,
  };
}

function imageResponse(type = "image/jpeg", status = 200): Response {
  return new Response(new Uint8Array([1, 2, 3]), {
    status,
    headers: { "content-type": type },
  });
}

function tooManyRequests(retryAfter: string | null): Response {
  const headers = new Headers({ "content-type": "text/html" });
  if (retryAfter !== null) {
    headers.set("retry-after", retryAfter);
  }
  return new Response("slow down", { status: 429, headers });
}

const NOW = Date.UTC(2026, 9, 21, 5, 0, 0);

async function rateLimitFor(retryAfter: string | null): Promise<unknown> {
  const loader = createImageLoader({
    tileSize: 120,
    timeoutMs: 1_000,
    fetcher: async () => tooManyRequests(retryAfter),
    decode: decoder(10, 10).decode,
    now: () => NOW,
  });
  return loader.load(source()).then(
    () => null,
    (error: unknown) => error,
  );
}

async function retryAfterMs(retryAfter: string | null): Promise<number> {
  const error = await rateLimitFor(retryAfter);
  if (!(error instanceof RateLimitedError)) {
    throw new Error(`expected a rate limit, got ${String(error)}`);
  }
  return error.retryAfterMs;
}

function decoder(width: number, height: number) {
  const decoded: FakeBitmap[] = [];
  const decode = vi.fn(async (_blob: Blob, _options?: ImageBitmapOptions) => {
    const result = bitmap(width, height, "decoded");
    decoded.push(result);
    return result;
  });
  const resized: FakeBitmap[] = [];
  const resize = vi.fn(
    async (_image: ImageBitmap, options: ImageBitmapOptions) => {
      const result = bitmap(
        options.resizeWidth ?? 0,
        options.resizeHeight ?? 0,
        "resized",
      );
      resized.push(result);
      return result;
    },
  );
  return { decode, resize, decoded, resized };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("createImageLoader", () => {
  it("fetches a Commons thumbnail, applies EXIF and downsizes it to the tile", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => imageResponse());
    const { decode, resize, decoded, resized } = decoder(660, 330);
    const loader = createImageLoader({
      tileSize: 120,
      timeoutMs: 5_000,
      fetcher,
      decode,
      resize,
    });
    const result = await loader.load(source());
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe("https://upload.example.test/lake.jpg");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(decode).toHaveBeenCalledWith(result.blob, {
      imageOrientation: "from-image",
    });
    expect(resize).toHaveBeenCalledWith(decoded[0], {
      resizeWidth: 120,
      resizeHeight: 60,
      resizeQuality: "high",
    });
    expect(decoded[0]?.closed).toBe(true);
    expect(result.bitmap).toBe(resized[0]);
    expect(resized[0]?.closed).toBe(false);
    expect(result.aspect).toBe(2);
    expect(result.blob.type).toBe("image/jpeg");
    expect(result.blob.size).toBe(3);
  });

  it("downsizes portrait images by their long side", async () => {
    const { decode, resize } = decoder(300, 400);
    const loader = createImageLoader({
      tileSize: 96,
      timeoutMs: 1_000,
      fetcher: async () => imageResponse(),
      decode,
      resize,
    });
    const result = await loader.load(source({ kind: "sample" }));
    expect(resize).toHaveBeenCalledWith(expect.anything(), {
      resizeWidth: 72,
      resizeHeight: 96,
      resizeQuality: "high",
    });
    expect(result.aspect).toBe(0.75);
  });

  it("keeps images that already fit the tile", async () => {
    const { decode, resize, decoded } = decoder(100, 80);
    const loader = createImageLoader({
      tileSize: 120,
      timeoutMs: 1_000,
      fetcher: async () => imageResponse(),
      decode,
      resize,
    });
    const result = await loader.load(source());
    expect(resize).not.toHaveBeenCalled();
    expect(result.bitmap).toBe(decoded[0]);
    expect(decoded[0]?.closed).toBe(false);
    expect(result.aspect).toBe(1.25);
  });

  it("reads visitors' files locally without fetching", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => imageResponse());
    const { decode, resize } = decoder(400, 300);
    const file = new File([new Uint8Array([7, 7])], "mine.jpg", {
      type: "image/jpeg",
    });
    const loader = createImageLoader({
      tileSize: 120,
      timeoutMs: 1_000,
      fetcher,
      decode,
      resize,
    });
    const result = await loader.load(
      source({ kind: "user", file, thumbUrl: null, uprightFix: null }),
    );
    expect(fetcher).not.toHaveBeenCalled();
    expect(result.blob).toBe(file);
    expect(decode).toHaveBeenCalledWith(file, {
      imageOrientation: "from-image",
    });
    expect(result.aspect).toBeCloseTo(4 / 3);
  });

  it("decodes without options when the browser rejects them", async () => {
    const plain = bitmap(50, 50, "plain");
    const decode = vi.fn(async (_blob: Blob, options?: ImageBitmapOptions) => {
      if (options) {
        throw new TypeError("unsupported option");
      }
      return plain;
    });
    const loader = createImageLoader({
      tileSize: 120,
      timeoutMs: 1_000,
      fetcher: async () => imageResponse(),
      decode,
    });
    const result = await loader.load(source());
    expect(decode).toHaveBeenCalledTimes(2);
    expect(decode.mock.calls[1]?.[1]).toBeUndefined();
    expect(result.bitmap).toBe(plain);
  });

  it("rejects when the image cannot be decoded at all", async () => {
    const loader = createImageLoader({
      tileSize: 120,
      timeoutMs: 1_000,
      fetcher: async () => imageResponse(),
      decode: async () => {
        throw new Error("bad data");
      },
    });
    await expect(loader.load(source())).rejects.toThrow(/画像/);
  });

  it("rejects HTTP failures", async () => {
    const loader = createImageLoader({
      tileSize: 120,
      timeoutMs: 1_000,
      fetcher: async () => imageResponse("text/html", 404),
      decode: decoder(1, 1).decode,
    });
    await expect(loader.load(source())).rejects.toThrow(/404/);
  });

  it("reports HTTP 429 as a rate limit without decoding", async () => {
    const { decode } = decoder(10, 10);
    const loader = createImageLoader({
      tileSize: 120,
      timeoutMs: 1_000,
      fetcher: async () => tooManyRequests("30"),
      decode,
    });
    const error = await loader.load(source()).then(
      () => null,
      (reason: unknown) => reason,
    );
    expect(error).toBeInstanceOf(RateLimitedError);
    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({
      name: "RateLimitedError",
      retryAfterMs: 30_000,
    });
    expect(String(error)).toMatch(/429/);
    expect(decode).not.toHaveBeenCalled();
  });

  it("reads Retry-After as seconds", async () => {
    expect(await retryAfterMs("0")).toBe(0);
    expect(await retryAfterMs("7")).toBe(7_000);
    expect(await retryAfterMs(" 120 ")).toBe(120_000);
  });

  it("reads Retry-After as an HTTP date", async () => {
    expect(await retryAfterMs("Wed, 21 Oct 2026 05:00:45 GMT")).toBe(45_000);
    expect(await retryAfterMs("Wed, 21 Oct 2026 04:59:00 GMT")).toBe(0);
  });

  it("waits twelve seconds when Retry-After is missing or unreadable", async () => {
    expect(await retryAfterMs(null)).toBe(12_000);
    expect(await retryAfterMs("")).toBe(12_000);
    expect(await retryAfterMs("soon")).toBe(12_000);
    expect(await retryAfterMs("1.5")).toBe(12_000);
    expect(await retryAfterMs("-3")).toBe(12_000);
  });

  it("keeps other HTTP failures as plain errors", async () => {
    const loader = createImageLoader({
      tileSize: 120,
      timeoutMs: 1_000,
      fetcher: async () => imageResponse("text/html", 503),
      decode: decoder(1, 1).decode,
    });
    const error = await loader.load(source()).then(
      () => null,
      (reason: unknown) => reason,
    );
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(RateLimitedError);
  });

  it("rejects responses that are not images", async () => {
    const { decode } = decoder(10, 10);
    const loader = createImageLoader({
      tileSize: 120,
      timeoutMs: 1_000,
      fetcher: async () => imageResponse("text/html"),
      decode,
    });
    await expect(loader.load(source())).rejects.toThrow(Error);
    expect(decode).not.toHaveBeenCalled();
  });

  it("rejects sources without anything to load", async () => {
    const loader = createImageLoader({
      tileSize: 120,
      timeoutMs: 1_000,
      fetcher: async () => imageResponse(),
      decode: decoder(10, 10).decode,
    });
    await expect(loader.load(source({ thumbUrl: null }))).rejects.toThrow(
      Error,
    );
    await expect(
      loader.load(source({ kind: "user", file: null, thumbUrl: null })),
    ).rejects.toThrow(Error);
  });

  it("gives up after the timeout and aborts the request", async () => {
    vi.useFakeTimers();
    let seen: AbortSignal | undefined;
    const fetcher = vi.fn<typeof fetch>(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          seen = init?.signal ?? undefined;
          seen?.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"));
          });
        }),
    );
    const loader = createImageLoader({
      tileSize: 120,
      timeoutMs: 2_000,
      fetcher,
      decode: decoder(10, 10).decode,
    });
    const result = loader.load(source());
    const assertion = expect(result).rejects.toThrow(/時間/);
    await vi.advanceTimersByTimeAsync(1_999);
    expect(seen?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(seen?.aborted).toBe(true);
    await assertion;
  });

  it("stops when the caller aborts", async () => {
    let seen: AbortSignal | undefined;
    const fetcher = vi.fn<typeof fetch>(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          seen = init?.signal ?? undefined;
          seen?.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"));
          });
        }),
    );
    const controller = new AbortController();
    const loader = createImageLoader({
      tileSize: 120,
      timeoutMs: 60_000,
      fetcher,
      decode: decoder(10, 10).decode,
    });
    const result = loader.load(source(), controller.signal);
    controller.abort();
    await expect(result).rejects.toThrow();
    expect(seen?.aborted).toBe(true);
  });

  it("closes decoded bitmaps when aborted during decoding", async () => {
    const controller = new AbortController();
    const decodedBitmap = bitmap(600, 400, "decoded");
    const loader = createImageLoader({
      tileSize: 120,
      timeoutMs: 60_000,
      fetcher: async () => imageResponse(),
      decode: async () => {
        controller.abort();
        return decodedBitmap;
      },
      resize: async () => bitmap(120, 80, "resized"),
    });
    await expect(loader.load(source(), controller.signal)).rejects.toThrow();
    expect(decodedBitmap.closed).toBe(true);
  });
});
