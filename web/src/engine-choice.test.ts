import { describe, expect, it, vi } from "vitest";
import type { InferencePool, Prediction } from "./contracts";
import { choosePool } from "./engine-choice";

const prediction: Prediction = {
  correction: 0,
  confidence: 1,
  probabilities: [1, 0, 0, 0],
  inferenceMs: 1,
};

function pool(name: string, ready: Promise<void>) {
  const dispose = vi.fn(() => {});
  const value: InferencePool & { name: string } = {
    name,
    size: 1,
    ready,
    idleCount: () => 1,
    infer: async () => prediction,
    dispose,
  };
  ready.catch(() => {});
  return Object.assign(value, { dispose });
}

describe("choosePool", () => {
  it("starts only the nano engine for the default model", async () => {
    const nano = pool("nano", Promise.resolve());
    const full = vi.fn(() => pool("full", Promise.resolve()));
    const chosen = await choosePool("nano", { nano: async () => nano, full }, () => {});
    expect(chosen).toEqual({ pool: nano, model: "nano" });
    expect(full).not.toHaveBeenCalled();
  });

  it("keeps the full engine once it is ready", async () => {
    const full = pool("full", Promise.resolve());
    const nano = vi.fn(async () => pool("nano", Promise.resolve()));
    const chosen = await choosePool("full", { nano, full: () => full }, () => {});
    expect(chosen).toEqual({ pool: full, model: "full" });
    expect(nano).not.toHaveBeenCalled();
  });

  it("falls back to nano when the full engine cannot start", async () => {
    const failure = new Error("このブラウザでは WebGPU が使えないため、高精度モデルを動かせません");
    const full = pool("full", Promise.reject(failure));
    const nano = pool("nano", Promise.resolve());
    const onFallback = vi.fn();
    const chosen = await choosePool("full", { nano: async () => nano, full: () => full }, onFallback);
    expect(chosen).toEqual({ pool: nano, model: "nano" });
    expect(full.dispose).toHaveBeenCalledOnce();
    expect(onFallback).toHaveBeenCalledWith(failure);
  });

  it("falls back when creating the full engine throws", async () => {
    const nano = pool("nano", Promise.resolve());
    const onFallback = vi.fn();
    const chosen = await choosePool(
      "full",
      {
        nano: async () => nano,
        full: () => {
          throw new Error("worker");
        },
      },
      onFallback,
    );
    expect(chosen).toEqual({ pool: nano, model: "nano" });
    expect(onFallback).toHaveBeenCalledOnce();
  });
});
