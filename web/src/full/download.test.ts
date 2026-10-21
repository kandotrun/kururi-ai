import { describe, expect, it } from "vitest";
import type { AssetCache } from "./cache";
import { downloadAssets, sha256Hex } from "./download";
import type { EnsembleAsset } from "./ensemble-manifest";

const BASE = "https://models.example/v2/";

interface Served {
  chunks: Uint8Array[];
  status?: number;
}

function bytes(...values: number[]): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(values);
}

function streamed(chunks: readonly Uint8Array[], status = 200): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk);
      }
      controller.close();
    },
  });
  return new Response(body, { status });
}

function server(files: Record<string, Served>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetcher = async (url: string, init: RequestInit): Promise<Response> => {
    calls.push({ url, init });
    const served = files[url];
    if (!served) {
      return new Response(null, { status: 404 });
    }
    return streamed(served.chunks, served.status ?? 200);
  };
  return { calls, fetcher };
}

class MemoryCache implements AssetCache {
  readonly entries = new Map<string, Uint8Array>();
  readonly deleted: string[] = [];
  writable = true;
  failPuts = false;

  async match(url: string): Promise<Response | undefined> {
    const stored = this.entries.get(url);
    return stored ? new Response(stored.slice()) : undefined;
  }

  async put(url: string, response: Response): Promise<boolean> {
    if (!this.writable || this.failPuts) {
      return false;
    }
    this.entries.set(url, new Uint8Array(await response.arrayBuffer()));
    return true;
  }

  async delete(url: string): Promise<void> {
    this.deleted.push(url);
    this.entries.delete(url);
  }
}

async function asset(file: string, data: Uint8Array<ArrayBuffer>): Promise<EnsembleAsset> {
  return { file, bytes: data.length, sha256: await sha256Hex(data) };
}

const graphBytes = bytes(1, 2, 3, 4);
const weightBytes = bytes(5, 6, 7, 8, 9, 10);

async function release() {
  return [
    await asset("model.onnx", graphBytes),
    await asset("model.onnx.data", weightBytes),
  ];
}

function publishedFiles(): Record<string, Served> {
  return {
    [`${BASE}model.onnx`]: { chunks: [bytes(1, 2), bytes(3, 4)] },
    [`${BASE}model.onnx.data`]: {
      chunks: [bytes(5, 6, 7), bytes(8), bytes(9, 10)],
    },
  };
}

describe("sha256Hex", () => {
  it("returns the lowercase hex digest", async () => {
    expect(await sha256Hex(new TextEncoder().encode("abc"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});

describe("downloadAssets", () => {
  it("streams every file and reports one combined progress", async () => {
    const { calls, fetcher } = server(publishedFiles());
    const reports: Array<[number, number]> = [];
    const result = await downloadAssets(
      await release(),
      BASE,
      { fetcher, cache: null, digest: sha256Hex },
      (loaded, total) => reports.push([loaded, total]),
    );
    expect(Array.from(result.files.get("model.onnx")!)).toEqual([1, 2, 3, 4]);
    expect(Array.from(result.files.get("model.onnx.data")!)).toEqual([
      5, 6, 7, 8, 9, 10,
    ]);
    expect(calls.map((call) => call.url)).toEqual([
      `${BASE}model.onnx`,
      `${BASE}model.onnx.data`,
    ]);
    expect(reports[0]).toEqual([0, 10]);
    expect(reports.at(-1)).toEqual([10, 10]);
    for (let index = 1; index < reports.length; index += 1) {
      expect(reports[index]![0]).toBeGreaterThanOrEqual(reports[index - 1]![0]);
    }
    expect(result.fromCache).toEqual([]);
  });

  it("stores verified downloads and skips the HTTP cache while doing so", async () => {
    const { calls, fetcher } = server(publishedFiles());
    const cache = new MemoryCache();
    const result = await downloadAssets(
      await release(),
      BASE,
      { fetcher, cache, digest: sha256Hex },
      null,
    );
    expect(Array.from(cache.entries.get(`${BASE}model.onnx.data`)!)).toEqual([
      5, 6, 7, 8, 9, 10,
    ]);
    expect(result.stored).toEqual(["model.onnx", "model.onnx.data"]);
    expect(calls.every((call) => call.init.cache === "no-store")).toBe(true);
  });

  it("loads verified cached copies without the network", async () => {
    const { calls, fetcher } = server({});
    const cache = new MemoryCache();
    cache.entries.set(`${BASE}model.onnx`, graphBytes);
    cache.entries.set(`${BASE}model.onnx.data`, weightBytes);
    const reports: Array<[number, number]> = [];
    const result = await downloadAssets(
      await release(),
      BASE,
      { fetcher, cache, digest: sha256Hex },
      (loaded, total) => reports.push([loaded, total]),
    );
    expect(calls).toEqual([]);
    expect(result.fromCache).toEqual(["model.onnx", "model.onnx.data"]);
    expect(Array.from(result.files.get("model.onnx")!)).toEqual([1, 2, 3, 4]);
    expect(reports.at(-1)).toEqual([10, 10]);
  });

  it("drops a corrupted cached copy and downloads it again", async () => {
    const { calls, fetcher } = server(publishedFiles());
    const cache = new MemoryCache();
    cache.entries.set(`${BASE}model.onnx`, bytes(9, 9, 9, 9));
    cache.entries.set(`${BASE}model.onnx.data`, weightBytes);
    const result = await downloadAssets(
      await release(),
      BASE,
      { fetcher, cache, digest: sha256Hex },
      null,
    );
    expect(cache.deleted).toEqual([`${BASE}model.onnx`]);
    expect(calls.map((call) => call.url)).toEqual([`${BASE}model.onnx`]);
    expect(Array.from(cache.entries.get(`${BASE}model.onnx`)!)).toEqual([
      1, 2, 3, 4,
    ]);
    expect(result.fromCache).toEqual(["model.onnx.data"]);
  });

  it("rejects a file whose digest does not match and keeps it out of the cache", async () => {
    const files = publishedFiles();
    files[`${BASE}model.onnx.data`] = { chunks: [bytes(5, 6, 7, 8, 9, 0)] };
    const { fetcher } = server(files);
    const cache = new MemoryCache();
    await expect(
      downloadAssets(
        await release(),
        BASE,
        { fetcher, cache, digest: sha256Hex },
        null,
      ),
    ).rejects.toThrow("高精度モデルのファイルが壊れています（model.onnx.data）");
    expect(cache.entries.has(`${BASE}model.onnx.data`)).toBe(false);
  });

  it("rejects a file that is longer or shorter than declared", async () => {
    for (const chunks of [[bytes(1, 2, 3, 4, 5)], [bytes(1, 2, 3)]]) {
      const files = publishedFiles();
      files[`${BASE}model.onnx`] = { chunks };
      const { fetcher } = server(files);
      await expect(
        downloadAssets(
          await release(),
          BASE,
          { fetcher, cache: null, digest: sha256Hex },
          null,
        ),
      ).rejects.toThrow("高精度モデルのファイルサイズが合いません（model.onnx）");
    }
  });

  it("keeps going without a cache when storing fails", async () => {
    const { fetcher } = server(publishedFiles());
    const cache = new MemoryCache();
    cache.failPuts = true;
    const result = await downloadAssets(
      await release(),
      BASE,
      { fetcher, cache, digest: sha256Hex },
      null,
    );
    expect(result.files.size).toBe(2);
    expect(result.stored).toEqual([]);
  });

  it("uses the normal HTTP cache when nothing can be stored", async () => {
    const { calls, fetcher } = server(publishedFiles());
    const cache = new MemoryCache();
    cache.writable = false;
    await downloadAssets(
      await release(),
      BASE,
      { fetcher, cache, digest: sha256Hex },
      null,
    );
    expect(calls.every((call) => call.init.cache === undefined)).toBe(true);
  });

  it("explains network and HTTP failures in Japanese", async () => {
    const offline = async (): Promise<Response> => {
      throw new TypeError("Failed to fetch");
    };
    await expect(
      downloadAssets(
        await release(),
        BASE,
        { fetcher: offline, cache: null, digest: sha256Hex },
        null,
      ),
    ).rejects.toThrow(
      "高精度モデルを取得できませんでした（ネットワークに接続できません）",
    );
    const { fetcher } = server({});
    await expect(
      downloadAssets(
        await release(),
        BASE,
        { fetcher, cache: null, digest: sha256Hex },
        null,
      ),
    ).rejects.toThrow("高精度モデルを取得できませんでした（HTTP 404）");
  });

  it("aborts the other downloads after the first failure", async () => {
    const signals: AbortSignal[] = [];
    const fetcher = async (url: string, init: RequestInit): Promise<Response> => {
      if (init.signal) {
        signals.push(init.signal);
      }
      if (url.endsWith(".data")) {
        return new Response(null, { status: 500 });
      }
      return streamed([graphBytes]);
    };
    await expect(
      downloadAssets(
        await release(),
        BASE,
        { fetcher, cache: null, digest: sha256Hex },
        null,
      ),
    ).rejects.toThrow("HTTP 500");
    expect(signals.length).toBe(2);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
  });
});
