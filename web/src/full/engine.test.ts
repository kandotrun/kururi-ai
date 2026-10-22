import { describe, expect, it } from "vitest";
import type { Rgb8Image } from "../core/pillow-resize";
import type { AssetBytes } from "./download";
import {
  decodeEnsembleManifest,
  type EnsembleAsset,
  type EnsembleModel,
} from "./ensemble-manifest";
import published from "./__fixtures__/ensemble-2.0.0.json";
import { createFullEngine, type ModelRunner } from "./engine";

const manifest = decodeEnsembleManifest(published);

function peaked(base: number): Float32Array {
  const logits = new Float32Array(16);
  for (let view = 0; view < 4; view += 1) {
    logits[view * 4 + ((base + 4 - view) % 4)] = 8;
  }
  return logits;
}

function photo(width = 8, height = 6): Rgb8Image {
  return { data: new Uint8Array(width * height * 3).fill(90), width, height };
}

interface Harness {
  loads: string[][];
  progress: Array<[number, number]>;
  created: string[];
  runs: Array<{ model: string; side: number; length: number }>;
  released: string[];
  fallbackErrors: unknown[];
  overlap: number;
  visibleFiles: string[][];
}

type Prefetch = (
  assets: readonly EnsembleAsset[],
) => Promise<Map<string, AssetBytes> | null>;

function harness(
  logits: (model: string) => Float32Array,
  options: { failFallback?: number; prefetch?: Prefetch } = {},
) {
  const state: Harness = {
    loads: [],
    progress: [],
    created: [],
    runs: [],
    released: [],
    fallbackErrors: [],
    overlap: 0,
    visibleFiles: [],
  };
  let active = 0;
  let fallbackFailures = options.failFallback ?? 0;
  const engine = createFullEngine({
    manifest,
    prefetchAssets: options.prefetch,
    async loadAssets(assets: readonly EnsembleAsset[], onProgress) {
      state.loads.push(assets.map((asset) => asset.file));
      if (assets.some((asset) => asset.file.startsWith("convnext-small-224"))) {
        if (fallbackFailures > 0) {
          fallbackFailures -= 1;
          throw new Error("offline");
        }
      }
      onProgress?.(1, 2);
      onProgress?.(2, 2);
      return new Map<string, AssetBytes>(
        assets.map((asset) => [asset.file, new Uint8Array(1)]),
      );
    },
    async createRunner(model: EnsembleModel, files) {
      expect(files.has(model.graph.file)).toBe(true);
      state.visibleFiles.push([...files.keys()]);
      state.created.push(model.name);
      const runner: ModelRunner = {
        async run(batch, side) {
          active += 1;
          state.overlap = Math.max(state.overlap, active);
          await new Promise((resolve) => setTimeout(resolve, 1));
          active -= 1;
          state.runs.push({ model: model.name, side, length: batch.length });
          return logits(model.name);
        },
        async release() {
          state.released.push(model.name);
        },
      };
      return runner;
    },
    onFallbackError(error) {
      state.fallbackErrors.push(error);
    },
  });
  return { engine, state };
}

describe("createFullEngine", () => {
  it("loads the general models with combined progress and warms them up", async () => {
    const { engine, state } = harness(() => peaked(1));
    await engine.initialize((loaded, total) => state.progress.push([loaded, total]));
    expect(state.loads).toEqual([
      [
        "convnext-base-224.onnx",
        "convnext-base-224.onnx.data",
        "convnext-small-288.onnx",
        "convnext-small-288.onnx.data",
      ],
    ]);
    expect(state.progress).toEqual([
      [1, 2],
      [2, 2],
    ]);
    expect(state.created).toEqual(["convnext-base-224", "convnext-small-288"]);
    expect(state.runs).toEqual([
      { model: "convnext-base-224", side: 224, length: 4 * 3 * 224 * 224 },
      { model: "convnext-small-288", side: 288, length: 4 * 3 * 288 * 288 },
    ]);
  });

  it("refuses photos before it is ready", async () => {
    const { engine } = harness(() => peaked(1));
    await expect(engine.process(photo())).rejects.toThrow(
      "高精度モデルはまだ準備できていません",
    );
  });

  it("resizes the original photo for each model and keeps confident answers", async () => {
    const { engine, state } = harness((model) =>
      model === "convnext-base-224" ? peaked(1) : peaked(2),
    );
    await engine.initialize(null);
    state.runs.length = 0;
    const decision = await engine.process(photo(30, 20));
    expect(state.runs.map((run) => [run.model, run.side])).toEqual([
      ["convnext-base-224", 224],
      ["convnext-small-288", 288],
    ]);
    expect(decision.correction).toBe(1);
    expect(decision.fallbackUsed).toBe(false);
    expect(state.loads.length).toBe(1);
    const sum = decision.probabilities.reduce((total, value) => total + value, 0);
    expect(sum).toBeCloseTo(1, 6);
  });

  it("loads the fallback once, only when the general models disagree", async () => {
    const { engine, state } = harness((model) =>
      model === "convnext-small-224" ? peaked(2) : new Float32Array(16),
    );
    await engine.initialize(null);
    state.runs.length = 0;
    const first = await engine.process(photo());
    const second = await engine.process(photo());
    expect(first.fallbackUsed).toBe(true);
    expect(first.correction).toBe(2);
    expect(second.correction).toBe(2);
    expect(state.loads).toEqual([
      expect.any(Array),
      ["convnext-small-224.onnx", "convnext-small-224.onnx.data"],
    ]);
    expect(state.created.filter((name) => name === "convnext-small-224")).toEqual([
      "convnext-small-224",
    ]);
    expect(
      state.runs.filter((run) => run.model === "convnext-small-224").map((run) => run.side),
    ).toEqual([224, 224, 224]);
  });

  it("answers with the general models when the fallback cannot load, then retries", async () => {
    const { engine, state } = harness(
      (model) => (model === "convnext-small-224" ? peaked(2) : new Float32Array(16)),
      { failFallback: 1 },
    );
    await engine.initialize(null);
    const first = await engine.process(photo());
    expect(first.fallbackUsed).toBe(false);
    expect(first.correction).toBe(3);
    expect(state.fallbackErrors.length).toBe(1);
    const second = await engine.process(photo());
    expect(second.fallbackUsed).toBe(true);
    expect(second.correction).toBe(2);
  });

  it("prefetches the fallback files in the background without opening a session", async () => {
    const { engine, state } = harness((model) =>
      model === "convnext-small-224" ? peaked(2) : new Float32Array(16),
    );
    await engine.initialize(null);
    engine.prefetchFallback();
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(state.loads[1]).toEqual([
      "convnext-small-224.onnx",
      "convnext-small-224.onnx.data",
    ]);
    expect(state.created).not.toContain("convnext-small-224");
    const decision = await engine.process(photo());
    expect(decision.fallbackUsed).toBe(true);
    expect(state.loads.length).toBe(2);
    expect(state.created.filter((name) => name === "convnext-small-224")).toEqual([
      "convnext-small-224",
    ]);
  });

  it("downloads the fallback again when a background prefetch failed", async () => {
    const { engine, state } = harness(
      (model) => (model === "convnext-small-224" ? peaked(2) : new Float32Array(16)),
      { failFallback: 1 },
    );
    await engine.initialize(null);
    engine.prefetchFallback();
    await new Promise((resolve) => setTimeout(resolve, 5));
    const decision = await engine.process(photo());
    expect(decision.fallbackUsed).toBe(true);
    expect(state.loads.length).toBe(3);
  });

  it("leaves prefetched fallback bytes in the cache and reads them when needed", async () => {
    const prefetched: string[][] = [];
    const { engine, state } = harness(
      (model) => (model === "convnext-small-224" ? peaked(2) : new Float32Array(16)),
      {
        prefetch: async (assets) => {
          prefetched.push(assets.map((asset) => asset.file));
          return null;
        },
      },
    );
    await engine.initialize(null);
    engine.prefetchFallback();
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(prefetched).toEqual([["convnext-small-224.onnx", "convnext-small-224.onnx.data"]]);
    expect(state.loads).toHaveLength(1);
    const decision = await engine.process(photo());
    expect(decision.fallbackUsed).toBe(true);
    expect(state.loads[1]).toEqual(["convnext-small-224.onnx", "convnext-small-224.onnx.data"]);
    expect(state.loads).toHaveLength(2);
  });

  it("keeps prefetched bytes the cache could not hold and uses them", async () => {
    const { engine, state } = harness(
      (model) => (model === "convnext-small-224" ? peaked(2) : new Float32Array(16)),
      {
        prefetch: async (assets) =>
          new Map<string, AssetBytes>(assets.map((asset) => [asset.file, new Uint8Array(1)])),
      },
    );
    await engine.initialize(null);
    engine.prefetchFallback();
    await new Promise((resolve) => setTimeout(resolve, 5));
    const decision = await engine.process(photo());
    expect(decision.fallbackUsed).toBe(true);
    expect(state.loads).toHaveLength(1);
    expect(state.created).toContain("convnext-small-224");
  });

  it("waits for a running prefetch instead of downloading twice", async () => {
    let finish: (value: Map<string, AssetBytes> | null) => void = () => {};
    const { engine, state } = harness(
      (model) => (model === "convnext-small-224" ? peaked(2) : new Float32Array(16)),
      { prefetch: () => new Promise((resolve) => (finish = resolve)) },
    );
    await engine.initialize(null);
    engine.prefetchFallback();
    const pending = engine.process(photo());
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(state.loads).toHaveLength(1);
    finish(null);
    const decision = await pending;
    expect(decision.fallbackUsed).toBe(true);
    expect(state.loads).toHaveLength(2);
  });

  it("downloads the fallback when the prefetch into the cache failed", async () => {
    const { engine, state } = harness(
      (model) => (model === "convnext-small-224" ? peaked(2) : new Float32Array(16)),
      { prefetch: async () => Promise.reject(new Error("quota")) },
    );
    await engine.initialize(null);
    engine.prefetchFallback();
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(state.fallbackErrors).toHaveLength(1);
    const decision = await engine.process(photo());
    expect(decision.fallbackUsed).toBe(true);
    expect(state.loads).toHaveLength(2);
  });

  it("ignores a prefetch before the engine is ready", async () => {
    const { engine, state } = harness(() => peaked(1));
    engine.prefetchFallback();
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(state.loads).toEqual([]);
  });

  it("runs one photo at a time", async () => {
    const { engine, state } = harness(() => peaked(0));
    await engine.initialize(null);
    await Promise.all([engine.process(photo()), engine.process(photo()), engine.process(photo())]);
    expect(state.overlap).toBe(1);
  });

  it("lets go of each model's bytes once its session exists", async () => {
    const { engine, state } = harness(() => peaked(1));
    await engine.initialize(null);
    expect(state.visibleFiles).toEqual([
      [
        "convnext-base-224.onnx",
        "convnext-base-224.onnx.data",
        "convnext-small-288.onnx",
        "convnext-small-288.onnx.data",
      ],
      ["convnext-small-288.onnx", "convnext-small-288.onnx.data"],
    ]);
  });

  it("rejects malformed model output", async () => {
    const { engine } = harness(() => new Float32Array(12));
    await expect(engine.initialize(null)).rejects.toThrow();
  });

  it("releases every session on dispose", async () => {
    const { engine, state } = harness((model) =>
      model === "convnext-small-224" ? peaked(2) : new Float32Array(16),
    );
    await engine.initialize(null);
    await engine.process(photo());
    await engine.dispose();
    expect(state.released.sort()).toEqual([
      "convnext-base-224",
      "convnext-small-224",
      "convnext-small-288",
    ]);
    await expect(engine.process(photo())).rejects.toThrow();
  });
});
