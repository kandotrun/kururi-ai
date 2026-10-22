import { afterEach, describe, expect, it, vi } from "vitest";
import type { PhotoSource } from "../contracts";
import type { ExifOrientation } from "../core/tiff-preview";
import {
  buildJpeg,
  buildTiff,
  nefLikeRaw,
  proRawLikeDng,
  TIFF_TYPE,
} from "../core/tiff-preview.fixtures";
import {
  createImageLoader,
  createVisitorPreviews,
  RateLimitedError,
  visitorPreviewBlob,
} from "./image-loader";

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

function userFile(
  bytes: Uint8Array<ArrayBuffer>,
  name: string,
  type = "",
): File {
  return new File([bytes], name, { type });
}

function userSourceOf(file: File): PhotoSource {
  return source({
    id: "user-1",
    kind: "user",
    file,
    thumbUrl: null,
    uprightFix: null,
    title: file.name,
  });
}

function rawDecoder(width: number, height: number) {
  const calls: Array<{ blob: Blob; options: ImageBitmapOptions | undefined }> =
    [];
  const decoded: FakeBitmap[] = [];
  const decode = vi.fn(async (blob: Blob, options?: ImageBitmapOptions) => {
    calls.push({ blob, options });
    const result = bitmap(
      options?.resizeWidth ?? width,
      options?.resizeHeight ?? height,
      "decoded",
    );
    decoded.push(result);
    return result;
  });
  return { decode, calls, decoded };
}

function orienter() {
  const made: Array<{ bitmap: FakeBitmap; blob: Blob }> = [];
  const orient = vi.fn(
    async (image: ImageBitmap, orientation: ExifOrientation) => {
      const turned = orientation >= 5;
      const result = {
        bitmap: bitmap(
          turned ? image.height : image.width,
          turned ? image.width : image.height,
          "oriented",
        ),
        blob: new Blob([new Uint8Array([0xff, 0xd8, orientation])], {
          type: "image/jpeg",
        }),
      };
      made.push(result);
      return result;
    },
  );
  return { orient, made };
}

function sizedResize() {
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
  return { resize, resized };
}

function loggedBytes() {
  const calls: Array<{ offset: number; length: number }> = [];
  const readBytes = vi.fn(
    async (blob: Blob, offset: number, length: number) => {
      calls.push({ offset, length });
      return new Uint8Array(
        await blob.slice(offset, offset + length).arrayBuffer(),
      );
    },
  );
  return {
    readBytes,
    calls,
    total: () => calls.reduce((sum, call) => sum + call.length, 0),
  };
}

async function bytesOf(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

describe("createImageLoader with visitors' RAW files", () => {
  const SMALL_DNG = { size: 3_000_000, rawAt: 1_000_000 };

  it("decodes the embedded preview of a ProRAW DNG and turns it upright", async () => {
    const dng = proRawLikeDng({ orientation: 6, ...SMALL_DNG });
    const file = userFile(dng.file.bytesAt(0, dng.file.size), "photo-0001.DNG");
    const { decode, calls, decoded } = rawDecoder(4032, 3024);
    const { orient, made } = orienter();
    const { resize, resized } = sizedResize();
    const bytes = loggedBytes();
    const loader = createImageLoader({
      tileSize: 120,
      timeoutMs: 1_000,
      decode,
      resize,
      orient,
      readBytes: bytes.readBytes,
    });
    const result = await loader.load(userSourceOf(file));
    expect(calls).toHaveLength(1);
    expect(calls[0]?.options).toEqual({
      imageOrientation: "from-image",
      resizeWidth: 2048,
      resizeHeight: 1536,
      resizeQuality: "high",
    });
    const preview = await bytesOf(calls[0]!.blob);
    expect(preview.length).toBe(dng.previewLength);
    expect([...preview.subarray(0, 2)]).toEqual([0xff, 0xd8]);
    expect(calls[0]?.blob.type).toBe("image/jpeg");
    expect(orient).toHaveBeenCalledWith(decoded[0], 6);
    expect(decoded[0]?.closed).toBe(true);
    expect(resize).toHaveBeenCalledWith(made[0]?.bitmap, {
      resizeWidth: 90,
      resizeHeight: 120,
      resizeQuality: "high",
    });
    expect(made[0]?.bitmap.closed).toBe(true);
    expect(result.bitmap).toBe(resized[0]);
    expect(result.blob).toBe(made[0]?.blob);
    expect(result.aspect).toBe(0.75);
    expect(bytes.total()).toBeLessThan(256 * 1_024);
    expect(
      bytes.calls.every((call) => call.offset + call.length <= dng.rawAt),
    ).toBe(true);
  });

  it("uses the full-size JpgFromRaw of a NEF and re-encodes it at 2048 pixels", async () => {
    const nef = nefLikeRaw({
      orientation: 1,
      size: 3_500_000,
      rawAt: 3_000_000,
    });
    const file = userFile(nef.file.bytesAt(0, nef.file.size), "frame-0001.NEF");
    const { decode, calls, decoded } = rawDecoder(6048, 4032);
    const { orient, made } = orienter();
    const loader = createImageLoader({
      tileSize: 120,
      timeoutMs: 1_000,
      decode,
      resize: sizedResize().resize,
      orient,
    });
    const result = await loader.load(userSourceOf(file));
    expect(calls[0]?.options).toMatchObject({
      resizeWidth: 2048,
      resizeHeight: 1365,
    });
    expect((await bytesOf(calls[0]!.blob)).length).toBe(nef.previewLength);
    expect(orient).toHaveBeenCalledWith(decoded[0], 1);
    expect(result.blob).toBe(made[0]?.blob);
    expect(result.aspect).toBeCloseTo(2048 / 1365);
  });

  it("lets the decoder apply the preview's own EXIF orientation only once", async () => {
    const jpeg = buildJpeg({ width: 1616, height: 1080, exifOrientation: 6 });
    const tiff = buildTiff({
      endian: "II",
      first: 8,
      size: 512,
      ifds: [
        {
          at: 8,
          entries: [
            { tag: 0x0112, type: TIFF_TYPE.short, values: [6] },
            { tag: 0x0201, type: TIFF_TYPE.long, values: [512] },
            { tag: 0x0202, type: TIFF_TYPE.long, values: [jpeg.length] },
          ],
        },
      ],
    });
    const bytes = new Uint8Array(512 + jpeg.length);
    bytes.set(tiff);
    bytes.set(jpeg, 512);
    const { decode, calls } = rawDecoder(1080, 1616);
    const { orient } = orienter();
    const loader = createImageLoader({
      tileSize: 120,
      timeoutMs: 1_000,
      decode,
      resize: sizedResize().resize,
      orient,
    });
    const result = await loader.load(
      userSourceOf(userFile(bytes, "frame-0001.ARW")),
    );
    expect(calls[0]?.options).toEqual({ imageOrientation: "from-image" });
    expect(orient).not.toHaveBeenCalled();
    expect(await bytesOf(result.blob)).toEqual(jpeg);
    expect(result.aspect).toBeCloseTo(1080 / 1616);
  });

  it("fits a large preview with its own orientation after decoding", async () => {
    const jpeg = buildJpeg({ width: 6000, height: 4000, exifOrientation: 8 });
    const tiff = buildTiff({
      endian: "MM",
      first: 8,
      size: 512,
      ifds: [
        {
          at: 8,
          entries: [
            { tag: 0x0201, type: TIFF_TYPE.long, values: [512] },
            { tag: 0x0202, type: TIFF_TYPE.long, values: [jpeg.length] },
          ],
        },
      ],
    });
    const bytes = new Uint8Array(512 + jpeg.length);
    bytes.set(tiff);
    bytes.set(jpeg, 512);
    const { decode, calls, decoded } = rawDecoder(4000, 6000);
    const { orient } = orienter();
    const { resize, resized } = sizedResize();
    const loader = createImageLoader({
      tileSize: 120,
      timeoutMs: 1_000,
      decode,
      resize,
      orient,
    });
    const result = await loader.load(
      userSourceOf(userFile(bytes, "photo-1.CR2")),
    );
    expect(calls[0]?.options).toEqual({ imageOrientation: "from-image" });
    expect(resize).toHaveBeenNthCalledWith(1, decoded[0], {
      resizeWidth: 1365,
      resizeHeight: 2048,
      resizeQuality: "high",
    });
    expect(orient).toHaveBeenCalledWith(resized[0], 1);
    expect(result.aspect).toBeCloseTo(1365 / 2048);
  });

  it("explains when a RAW file has no preview the browser can show", async () => {
    const tiff = buildTiff({
      endian: "II",
      first: 8,
      size: 4_096,
      ifds: [
        {
          at: 8,
          entries: [{ tag: 0x0112, type: TIFF_TYPE.short, values: [6] }],
        },
      ],
    });
    const { decode } = rawDecoder(10, 10);
    const loader = createImageLoader({
      tileSize: 120,
      timeoutMs: 1_000,
      decode,
    });
    await expect(
      loader.load(userSourceOf(userFile(tiff, "broken.DNG"))),
    ).rejects.toThrow(
      "この RAW ファイルにはブラウザで表示できるプレビュー画像がありません",
    );
    await expect(
      loader.load(
        userSourceOf(userFile(new TextEncoder().encode("garbage"), "x.NEF")),
      ),
    ).rejects.toThrow(/プレビュー画像/);
    expect(decode).not.toHaveBeenCalled();
  });

  it("explains when the RAW preview cannot be decoded", async () => {
    const dng = proRawLikeDng(SMALL_DNG);
    const loader = createImageLoader({
      tileSize: 120,
      timeoutMs: 1_000,
      decode: async () => {
        throw new Error("bad jpeg");
      },
      orient: orienter().orient,
    });
    await expect(
      loader.load(
        userSourceOf(userFile(dng.file.bytesAt(0, dng.file.size), "a.DNG")),
      ),
    ).rejects.toThrow("RAW ファイルのプレビュー画像を読み取れませんでした");
  });

  it("reports a file that can no longer be read", async () => {
    const loader = createImageLoader({
      tileSize: 120,
      timeoutMs: 1_000,
      decode: rawDecoder(10, 10).decode,
      readBytes: async () => {
        throw new DOMException("gone", "NotReadableError");
      },
    });
    await expect(
      loader.load(userSourceOf(userFile(new Uint8Array(64), "a.DNG"))),
    ).rejects.toThrow("写真のファイルを読み込めませんでした");
  });

  it("reads RAW files with Blob.slice by default", async () => {
    const dng = proRawLikeDng({ orientation: 3, ...SMALL_DNG });
    const file = userFile(dng.file.bytesAt(0, dng.file.size), "photo-0002.dng");
    const slice = vi.spyOn(file, "slice");
    const { decode } = rawDecoder(4032, 3024);
    const { orient } = orienter();
    const loader = createImageLoader({
      tileSize: 120,
      timeoutMs: 1_000,
      decode,
      resize: sizedResize().resize,
      orient,
    });
    await loader.load(userSourceOf(file));
    expect(orient).toHaveBeenCalledWith(expect.anything(), 3);
    const ranges = slice.mock.calls.map(([start, end]) => ({
      start: start ?? 0,
      end: end ?? file.size,
    }));
    const previewSlices = ranges.filter(
      (range) =>
        range.start === dng.previewAt &&
        range.end === dng.previewAt + dng.previewLength,
    );
    const reads = ranges.filter((range) => !previewSlices.includes(range));
    expect(previewSlices).toHaveLength(1);
    expect(reads.length).toBeGreaterThan(0);
    expect(reads.every((range) => range.end - range.start <= 64 * 1_024)).toBe(
      true,
    );
    expect(reads.every((range) => range.end <= dng.rawAt)).toBe(true);
    expect(
      reads.reduce((sum, range) => sum + range.end - range.start, 0),
    ).toBeLessThan(256 * 1_024);
  });

  it("decodes at most two visitors' photos at a time", async () => {
    const dng = proRawLikeDng(SMALL_DNG);
    const bytes = dng.file.bytesAt(0, dng.file.size);
    const gates: Array<() => void> = [];
    let active = 0;
    let peak = 0;
    const decode = vi.fn(
      (_blob: Blob, options?: ImageBitmapOptions) =>
        new Promise<ImageBitmap>((resolve) => {
          active += 1;
          peak = Math.max(peak, active);
          gates.push(() => {
            active -= 1;
            resolve(
              bitmap(
                options?.resizeWidth ?? 100,
                options?.resizeHeight ?? 80,
                "d",
              ),
            );
          });
        }),
    );
    const loader = createImageLoader({
      tileSize: 120,
      timeoutMs: 1_000,
      decode,
      resize: sizedResize().resize,
      orient: orienter().orient,
    });
    const loads = [
      ...Array.from({ length: 3 }, (_, index) =>
        loader.load(userSourceOf(userFile(bytes, `r${index}.DNG`))),
      ),
      ...Array.from({ length: 2 }, (_, index) =>
        loader.load(
          userSourceOf(
            userFile(new Uint8Array([1]), `p${index}.jpg`, "image/jpeg"),
          ),
        ),
      ),
    ];
    for (
      let round = 0;
      round < 20 && gates.length + decode.mock.calls.length < 10;
      round += 1
    ) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      expect(active).toBeLessThanOrEqual(2);
      gates.shift()?.();
    }
    while (gates.length > 0 || decode.mock.calls.length < 5) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      gates.shift()?.();
    }
    await Promise.all(loads);
    expect(decode).toHaveBeenCalledTimes(5);
    expect(peak).toBe(2);
  });

  it("names HEIC when the browser cannot decode it", async () => {
    const loader = createImageLoader({
      tileSize: 120,
      timeoutMs: 1_000,
      decode: async () => {
        throw new Error("unsupported");
      },
    });
    await expect(
      loader.load(
        userSourceOf(
          userFile(new Uint8Array([1]), "photo-0003.HEIC", "image/heic"),
        ),
      ),
    ).rejects.toThrow("HEIC 形式の写真はこのブラウザでは読み込めません");
    await expect(
      loader.load(
        userSourceOf(userFile(new Uint8Array([1]), "scan.tiff", "image/tiff")),
      ),
    ).rejects.toThrow("この形式の画像はこのブラウザでは読み込めません");
  });

  it("closes what it decoded when the caller aborts during a RAW load", async () => {
    const dng = proRawLikeDng(SMALL_DNG);
    const controller = new AbortController();
    const decoded: FakeBitmap[] = [];
    const made: FakeBitmap[] = [];
    const loader = createImageLoader({
      tileSize: 120,
      timeoutMs: 1_000,
      decode: async (_blob, options) => {
        const result = bitmap(
          options?.resizeWidth ?? 1,
          options?.resizeHeight ?? 1,
          "d",
        );
        decoded.push(result);
        return result;
      },
      orient: async (image) => {
        controller.abort();
        const result = bitmap(image.width, image.height, "o");
        made.push(result);
        return { bitmap: result, blob: new Blob([]) };
      },
    });
    await expect(
      loader.load(
        userSourceOf(userFile(dng.file.bytesAt(0, dng.file.size), "a.DNG")),
        controller.signal,
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(decoded[0]?.closed).toBe(true);
    expect(made[0]?.closed).toBe(true);
  });
});

function rawPhoto(name: string): File {
  const dng = proRawLikeDng({ orientation: 8, size: 3_000_000, rawAt: 1_000_000 });
  return userFile(dng.file.bytesAt(0, dng.file.size), name);
}

function gatedDecoder() {
  const waiting: Array<() => void> = [];
  const state = { active: 0, peak: 0 };
  const decode = vi.fn(async (_blob: Blob, options?: ImageBitmapOptions) => {
    state.active += 1;
    state.peak = Math.max(state.peak, state.active);
    await new Promise<void>((resolve) => waiting.push(resolve));
    state.active -= 1;
    return bitmap(options?.resizeWidth ?? 4032, options?.resizeHeight ?? 3024, "decoded");
  });
  const release = () => {
    for (const next of waiting.splice(0)) {
      next();
    }
  };
  return { decode, release, state };
}

async function flush(): Promise<void> {
  for (let index = 0; index < 20; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

describe("createVisitorPreviews", () => {
  it("returns ordinary photos unchanged", async () => {
    const file = userFile(new Uint8Array([1, 2]), "a.jpg", "image/jpeg");
    const decode = vi.fn();
    const preview = createVisitorPreviews({ maxSide: 960, decode });
    expect(await preview(file)).toBe(file);
    expect(decode).not.toHaveBeenCalled();
  });

  it("renders an upright JPEG of a RAW file at the requested size", async () => {
    const file = rawPhoto("photo-0009.DNG");
    const { decode, calls } = rawDecoder(4032, 3024);
    const { orient, made } = orienter();
    const preview = createVisitorPreviews({
      maxSide: 960,
      decode,
      orient,
      resize: sizedResize().resize,
    });
    const blob = await preview(file);
    expect(calls[0]?.options).toMatchObject({
      resizeWidth: 960,
      resizeHeight: 720,
    });
    expect(orient).toHaveBeenCalledWith(expect.anything(), 8);
    expect(blob).toBe(made[0]?.blob);
    expect(made[0]?.bitmap.closed).toBe(true);
  });

  it("passes loading errors on", async () => {
    const file = userFile(new TextEncoder().encode("nope"), "x.NEF");
    const preview = createVisitorPreviews({ maxSide: 960 });
    await expect(preview(file)).rejects.toThrow(/プレビュー画像/);
  });

  it("decodes at most two RAW previews at a time however many are asked for", async () => {
    const { decode, release, state } = gatedDecoder();
    const preview = createVisitorPreviews({
      maxSide: 960,
      decode,
      orient: orienter().orient,
      resize: sizedResize().resize,
    });
    const pending = Array.from({ length: 7 }, (_, index) =>
      preview(rawPhoto(`photo-${index}.DNG`)),
    );
    await flush();
    expect(decode).toHaveBeenCalledTimes(2);
    while (decode.mock.calls.length < 7 || state.active > 0) {
      release();
      await flush();
    }
    const blobs = await Promise.all(pending);
    expect(blobs).toHaveLength(7);
    expect(state.peak).toBe(2);
  });

  it("frees its place when a preview fails", async () => {
    const decode = vi.fn(async () => {
      throw new Error("decode failed");
    });
    const preview = createVisitorPreviews({ maxSide: 960, decode, concurrency: 1 });
    const outcomes = await Promise.allSettled(
      ["a.DNG", "b.DNG", "c.DNG"].map((name) => preview(rawPhoto(name))),
    );
    expect(outcomes.map((outcome) => outcome.status)).toEqual([
      "rejected",
      "rejected",
      "rejected",
    ]);
    expect(decode.mock.calls.length).toBeGreaterThanOrEqual(3);
  });
});

class GatedFile extends File {
  static readonly started = new Set<string>();
  static readonly waiting: Array<() => void> = [];

  static release(): void {
    for (const next of GatedFile.waiting.splice(0)) {
      next();
    }
  }

  override slice(start?: number, end?: number, type?: string): Blob {
    const inner = super.slice(start, end, type);
    const name = this.name;
    const gated = new Blob([inner], { type: inner.type });
    const read = gated.arrayBuffer.bind(gated);
    Object.defineProperty(gated, "arrayBuffer", {
      value: async () => {
        GatedFile.started.add(name);
        await new Promise<void>((resolve) => GatedFile.waiting.push(resolve));
        return read();
      },
    });
    return gated;
  }
}

function gatedRaw(name: string): File {
  const dng = proRawLikeDng({ size: 3_000_000, rawAt: 1_000_000 });
  return new GatedFile([dng.file.bytesAt(0, dng.file.size)], name);
}

describe("visitorPreviewBlob", () => {
  it("returns ordinary photos unchanged", async () => {
    const file = userFile(new Uint8Array([1, 2]), "a.jpg", "image/jpeg");
    expect(await visitorPreviewBlob(file, 960)).toBe(file);
  });

  it("shares one small limit across every caller and size", async () => {
    const names = ["a.DNG", "b.DNG", "c.DNG", "d.DNG", "e.DNG"];
    const pending = names.map((name, index) =>
      visitorPreviewBlob(gatedRaw(name), index % 2 === 0 ? 960 : 480).then(
        () => "done",
        () => "failed",
      ),
    );
    await flush();
    expect([...GatedFile.started].sort()).toEqual(["a.DNG", "b.DNG"]);
    let settled = 0;
    void Promise.all(pending).then(() => {
      settled = names.length;
    });
    while (settled < names.length) {
      GatedFile.release();
      await flush();
    }
    expect(GatedFile.started.size).toBe(names.length);
  });
});
