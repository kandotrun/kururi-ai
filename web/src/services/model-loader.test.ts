import { describe, expect, it, vi } from "vitest";
import type { ModelProgress } from "../contracts";
import { loadModels } from "./model-loader";

function chunked(chunks: readonly number[][], length: boolean): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(new Uint8Array(chunk));
      }
      controller.close();
    },
  });
  const size = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  return new Response(body, {
    status: 200,
    headers: length ? { "content-length": String(size) } : {},
  });
}

function fakeFetch(responses: Record<string, () => Response | Promise<Response>>) {
  return vi.fn<typeof fetch>(async (input) => {
    const url = typeof input === "string" ? input : input.toString();
    const respond = responses[url];
    if (!respond) {
      throw new TypeError("network down");
    }
    return respond();
  });
}

function bytes(buffer: ArrayBuffer): number[] {
  return [...new Uint8Array(buffer)];
}

describe("loadModels", () => {
  it("fetches every model once and returns their bytes with weights", async () => {
    const fetcher = fakeFetch({
      "/small.onnx": () => chunked([[1, 2], [3]], true),
      "/large.onnx": () => chunked([[4, 5, 6, 7]], true),
    });
    const models = await loadModels(
      [
        { url: "/small.onnx", weight: 0.18 },
        { url: "/large.onnx", weight: 0.82 },
      ],
      () => {},
      fetcher,
    );
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(models.map((model) => model.weight)).toEqual([0.18, 0.82]);
    expect(models.map((model) => bytes(model.bytes))).toEqual([
      [1, 2, 3],
      [4, 5, 6, 7],
    ]);
    expect(models.every((model) => model.bytes instanceof ArrayBuffer)).toBe(
      true,
    );
  });

  it("reports combined progress across all models", async () => {
    const progress: ModelProgress[] = [];
    await loadModels(
      [
        { url: "/a", weight: 0.5 },
        { url: "/b", weight: 0.5 },
      ],
      (update) => progress.push(update),
      fakeFetch({
        "/a": () => chunked([[1, 2], [3, 4]], true),
        "/b": () => chunked([[5, 6, 7, 8, 9, 10]], true),
      }),
    );
    const last = progress.at(-1);
    expect(last).toEqual({ loaded: 10, total: 10, ready: true });
    expect(progress.filter((update) => update.ready)).toHaveLength(1);
    const loadedSeries = progress.map((update) => update.loaded);
    expect([...loadedSeries].sort((left, right) => left - right)).toEqual(
      loadedSeries,
    );
    const withTotal = progress.filter((update) => update.total > 0);
    expect(withTotal.every((update) => update.total === 10)).toBe(true);
    expect(progress.some((update) => !update.ready && update.loaded > 0)).toBe(
      true,
    );
    expect(progress.every((update) => update.loaded <= 10)).toBe(true);
  });

  it("reports loaded bytes only when a size is unknown", async () => {
    const progress: ModelProgress[] = [];
    await loadModels(
      [
        { url: "/a", weight: 0.5 },
        { url: "/b", weight: 0.5 },
      ],
      (update) => progress.push(update),
      fakeFetch({
        "/a": () => chunked([[1, 2, 3]], true),
        "/b": () => chunked([[4], [5]], false),
      }),
    );
    const pending = progress.filter((update) => !update.ready);
    expect(pending.length).toBeGreaterThan(0);
    expect(pending.every((update) => update.total === 0)).toBe(true);
    expect(progress.at(-1)).toEqual({ loaded: 5, total: 5, ready: true });
  });

  it("reads responses without a stream body", async () => {
    const response = new Response(new Uint8Array([9, 8, 7]), { status: 200 });
    Object.defineProperty(response, "body", { value: null });
    const models = await loadModels(
      [{ url: "/a", weight: 1 }],
      () => {},
      fakeFetch({ "/a": () => response }),
    );
    expect(bytes(models[0]!.bytes)).toEqual([9, 8, 7]);
  });

  it("rejects with a Japanese message on HTTP failure", async () => {
    const result = loadModels(
      [{ url: "/missing", weight: 1 }],
      () => {},
      fakeFetch({ "/missing": () => new Response("no", { status: 404 }) }),
    );
    await expect(result).rejects.toThrow(/モデル.*404/);
  });

  it("rejects with a Japanese message when the network fails", async () => {
    const result = loadModels(
      [{ url: "/offline", weight: 1 }],
      () => {},
      fakeFetch({}),
    );
    await expect(result).rejects.toThrow(/モデル/);
  });
});
