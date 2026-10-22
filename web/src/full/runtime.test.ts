import { describe, expect, it } from "vitest";
import type { EnsembleDecision } from "../core/full-ensemble";
import type { Rgb8Image } from "../core/pillow-resize";
import type { FullInitRequest, WorkerResponse } from "../types";
import type { FullEngine } from "./engine";
import { createFullRuntime } from "./runtime";

const INIT: FullInitRequest = {
  type: "init",
  engine: "full",
  baseUrl: "https://models.example/v2/",
  wasmBaseUrl: "https://example.test/ort/",
};

const DECISION: EnsembleDecision = {
  correction: 3,
  confidence: 0.9,
  probabilities: [0.05, 0.03, 0.02, 0.9],
  generalMargin: 0.85,
  fallbackUsed: false,
};

function fakeEngine(overrides: Partial<FullEngine> = {}): FullEngine {
  return {
    async initialize(onProgress) {
      onProgress?.(10, 20);
      onProgress?.(20, 20);
    },
    prefetchFallback() {},
    async process() {
      return DECISION;
    },
    async dispose() {},
    ...overrides,
  };
}

function setup(
  options: {
    engine?: FullEngine;
    createEngine?: () => Promise<FullEngine>;
    decode?: (file: Blob, turns: number) => Promise<Rgb8Image>;
  } = {},
) {
  const posted: WorkerResponse[] = [];
  const decoded: number[] = [];
  let clock = 0;
  const runtime = createFullRuntime({
    post: (message) => posted.push(message),
    log: () => {},
    now: () => {
      clock += 5;
      return clock;
    },
    createEngine: options.createEngine ?? (async () => options.engine ?? fakeEngine()),
    decode:
      options.decode ??
      (async (_file, turns) => {
        decoded.push(turns);
        return { data: new Uint8Array(3), width: 1, height: 1 };
      }),
  });
  return { runtime, posted, decoded };
}

describe("createFullRuntime", () => {
  it("forwards download progress and reports ready", async () => {
    const { runtime, posted } = setup();
    await runtime.handle(INIT);
    expect(posted).toEqual([
      { type: "load-progress", loaded: 10, total: 20 },
      { type: "load-progress", loaded: 20, total: 20 },
      { type: "ready", loadMs: 5 },
    ]);
  });

  it("starts fetching the fallback model once ready is reported", async () => {
    const order: string[] = [];
    const { runtime, posted } = setup({
      engine: fakeEngine({
        prefetchFallback() {
          order.push(`prefetch after ${posted.length} messages`);
        },
      }),
    });
    await runtime.handle(INIT);
    expect(order).toEqual(["prefetch after 3 messages"]);
  });

  it("refuses the nano protocol", async () => {
    const { runtime, posted } = setup();
    await runtime.handle({
      type: "init",
      engine: "nano",
      models: [],
      wasmBaseUrl: "/ort/",
    });
    expect(posted).toEqual([
      { type: "error", message: "このワーカーは高精度モデル専用です" },
    ]);
  });

  it("reports start-up failures without an id", async () => {
    const japanese = setup({
      createEngine: async () => {
        throw new Error("高精度モデルを取得できませんでした（HTTP 404）");
      },
    });
    await japanese.runtime.handle(INIT);
    expect(japanese.posted).toEqual([
      { type: "error", message: "高精度モデルを取得できませんでした（HTTP 404）" },
    ]);
    const english = setup({
      engine: fakeEngine({
        async initialize() {
          throw new Error("WebGPU device lost");
        },
      }),
    });
    await english.runtime.handle(INIT);
    expect(english.posted).toEqual([
      { type: "error", message: "高精度モデルを準備できませんでした" },
    ]);
  });

  it("rejects photos that arrive before the model is ready", async () => {
    const { runtime, posted } = setup();
    await runtime.handle({
      type: "process",
      id: "p1",
      file: new Blob(),
      simulateRotation: 0,
    });
    expect(posted).toEqual([
      { type: "error", id: "p1", message: "高精度モデルはまだ準備できていません" },
    ]);
  });

  it("turns the photo by the simulated quarters and reports the decision", async () => {
    const { runtime, posted, decoded } = setup();
    await runtime.handle(INIT);
    posted.length = 0;
    for (const [id, degrees] of [
      ["a", 270],
      ["b", -90],
      ["c", 450],
    ] as const) {
      await runtime.handle({
        type: "process",
        id,
        file: new Blob(),
        simulateRotation: degrees,
      });
    }
    expect(decoded).toEqual([3, 3, 1]);
    expect(posted[0]).toEqual({
      type: "result",
      id: "a",
      correctionCw: 270,
      confidence: 0.9,
      probabilities: [0.05, 0.03, 0.02, 0.9],
      inferenceMs: 10,
    });
  });

  it("returns the decision and timings for raw RGB input", async () => {
    const { runtime, posted } = setup();
    await runtime.handle(INIT);
    const outcome = await runtime.processImage("raw", {
      data: new Uint8Array(3),
      width: 1,
      height: 1,
    });
    expect(outcome).toEqual({ decision: DECISION, decodeMs: 5, totalMs: 10 });
    expect(posted.at(-1)).toMatchObject({ type: "result", id: "raw", correctionCw: 270 });
  });

  it("reports per-photo failures with the photo id", async () => {
    const { runtime, posted } = setup({
      decode: async () => {
        throw new Error("画像を読み込めませんでした");
      },
    });
    await runtime.handle(INIT);
    await runtime.handle({
      type: "process",
      id: "broken",
      file: new Blob(),
      simulateRotation: 0,
    });
    expect(posted.at(-1)).toEqual({
      type: "error",
      id: "broken",
      message: "画像を読み込めませんでした",
    });
    const failing = setup({
      engine: fakeEngine({
        async process() {
          throw new RangeError("Model produced non-finite logits");
        },
      }),
    });
    await failing.runtime.handle(INIT);
    await failing.runtime.handle({
      type: "process",
      id: "nan",
      file: new Blob(),
      simulateRotation: 0,
    });
    expect(failing.posted.at(-1)).toEqual({
      type: "error",
      id: "nan",
      message: "向きを判定できませんでした",
    });
  });

  it("starts the engine only once", async () => {
    let created = 0;
    const { runtime, posted } = setup({
      createEngine: async () => {
        created += 1;
        return fakeEngine();
      },
    });
    await Promise.all([runtime.handle(INIT), runtime.handle(INIT)]);
    expect(created).toBe(1);
    expect(posted.filter((message) => message.type === "ready").length).toBe(1);
  });

  it("allows a new start after a failed one", async () => {
    let attempts = 0;
    const { runtime, posted } = setup({
      createEngine: async () => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error("高精度モデルを取得できませんでした（ネットワークに接続できません）");
        }
        return fakeEngine();
      },
    });
    await runtime.handle(INIT);
    await runtime.handle(INIT);
    expect(attempts).toBe(2);
    expect(posted.at(-1)).toMatchObject({ type: "ready" });
  });
});
