import { describe, expect, it } from "vitest";
import {
  FULL_FALLBACK_BYTES,
  FULL_GENERAL_BYTES,
  NANO_BYTES,
  modelOptions,
  resolveModel,
} from "./model-profiles";

describe("model sizes", () => {
  it("match the shipped artifacts", () => {
    expect(NANO_BYTES).toBe(2_788_640 + 9_119_801);
    expect(FULL_GENERAL_BYTES).toBe(1_390_721 + 350_355_456 + 1_390_842 + 197_918_720);
    expect(FULL_FALLBACK_BYTES).toBe(1_390_842 + 197_918_720);
  });
});

describe("modelOptions", () => {
  it("offers only the nano model when the full model is not hosted", () => {
    const options = modelOptions({ webgpu: true, fullBaseUrl: null });
    expect(options.map((option) => option.id)).toEqual(["nano"]);
    expect(options[0]).toMatchObject({
      label: "軽量",
      version: "v2-nano",
      sizeBytes: NANO_BYTES,
      testAccuracy: 0.8182,
      needsWebGPU: false,
      available: true,
      unavailableReason: null,
    });
  });

  it("offers the full model when it is hosted and WebGPU works", () => {
    const options = modelOptions({ webgpu: true, fullBaseUrl: "https://models.example/v2.0.0/" });
    expect(options.map((option) => option.id)).toEqual(["nano", "full"]);
    expect(options[1]).toMatchObject({
      label: "高精度",
      version: "v2.0.0",
      sizeBytes: FULL_GENERAL_BYTES,
      testAccuracy: 0.9943,
      needsWebGPU: true,
      available: true,
      unavailableReason: null,
    });
  });

  it("explains why the full model cannot run without WebGPU", () => {
    const options = modelOptions({ webgpu: false, fullBaseUrl: "/full/" });
    expect(options[1]).toMatchObject({
      available: false,
      unavailableReason: "このブラウザは WebGPU に対応していないため使えません。",
    });
  });
});

describe("resolveModel", () => {
  const hosted = modelOptions({ webgpu: true, fullBaseUrl: "/full/" });
  const noGpu = modelOptions({ webgpu: false, fullBaseUrl: "/full/" });
  const unhosted = modelOptions({ webgpu: true, fullBaseUrl: null });

  it("keeps an available request", () => {
    expect(resolveModel("full", hosted)).toEqual({ model: "full", notice: null });
    expect(resolveModel("nano", hosted)).toEqual({ model: "nano", notice: null });
  });

  it("falls back to nano with the reason when the full model cannot run", () => {
    expect(resolveModel("full", noGpu)).toEqual({
      model: "nano",
      notice: "高精度モデルは使えないため、軽量モデルで判定します。このブラウザは WebGPU に対応していないため使えません。",
    });
  });

  it("falls back quietly when the full model is not offered at all", () => {
    expect(resolveModel("full", unhosted)).toEqual({
      model: "nano",
      notice: "高精度モデルは公開準備中のため、軽量モデルで判定します。",
    });
  });
});
