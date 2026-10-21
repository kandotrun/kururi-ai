import { describe, expect, it, vi } from "vitest";
import type { InferencePool, Prediction, Quarter } from "./contracts";
import { createLazyPool } from "./lazy-pool";

const prediction: Prediction = {
  correction: 1,
  confidence: 0.9,
  probabilities: [0.05, 0.9, 0.03, 0.02],
  inferenceMs: 12,
};

function fakePool() {
  const infer = vi.fn(async (_id: string, _blob: Blob, _simulated: Quarter) => prediction);
  const dispose = vi.fn(() => {});
  const pool: InferencePool = {
    size: 3,
    ready: Promise.resolve(),
    idleCount: () => 2,
    infer,
    dispose,
  };
  return Object.assign(pool, { infer, dispose });
}

describe("createLazyPool", () => {
  it("reports no idle workers until the real pool arrives", async () => {
    let resolvePool: (pool: InferencePool) => void = () => {};
    const lazy = createLazyPool(new Promise((resolve) => (resolvePool = resolve)), 2);
    expect(lazy.size).toBe(2);
    expect(lazy.idleCount()).toBe(0);
    const real = fakePool();
    resolvePool(real);
    await lazy.ready;
    expect(lazy.idleCount()).toBe(2);
  });

  it("forwards inference once ready", async () => {
    const real = fakePool();
    const lazy = createLazyPool(Promise.resolve(real), 3);
    const blob = new Blob(["x"]);
    await expect(lazy.infer("a", blob, 2)).resolves.toBe(prediction);
    expect(real.infer).toHaveBeenCalledWith("a", blob, 2);
  });

  it("rejects inference when the pool fails to start", async () => {
    const lazy = createLazyPool(Promise.reject(new Error("モデルを取得できませんでした")), 1);
    await expect(lazy.ready).rejects.toThrow("モデル");
    await expect(lazy.infer("a", new Blob(["x"]), 0)).rejects.toThrow("モデル");
    expect(lazy.idleCount()).toBe(0);
  });

  it("disposes the real pool even if it arrives late", async () => {
    let resolvePool: (pool: InferencePool) => void = () => {};
    const lazy = createLazyPool(new Promise((resolve) => (resolvePool = resolve)), 1);
    lazy.dispose();
    const real = fakePool();
    resolvePool(real);
    await Promise.resolve();
    await Promise.resolve();
    expect(real.dispose).toHaveBeenCalledOnce();
    expect(lazy.idleCount()).toBe(0);
  });
});
