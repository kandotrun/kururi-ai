import { describe, expect, it } from "vitest";
import { detectWebGpu, usableAdapter } from "./webgpu";

describe("usableAdapter", () => {
  it("accepts a hardware adapter", () => {
    expect(usableAdapter({ info: { architecture: "metal-3", vendor: "apple" } })).toBe(true);
    expect(usableAdapter({})).toBe(true);
  });

  it("rejects a missing or software adapter", () => {
    expect(usableAdapter(null)).toBe(false);
    expect(usableAdapter({ info: { isFallbackAdapter: true } })).toBe(false);
    expect(usableAdapter({ isFallbackAdapter: true })).toBe(false);
    expect(
      usableAdapter({ info: { architecture: "swiftshader", vendor: "google" } }),
    ).toBe(false);
  });
});

describe("detectWebGpu", () => {
  it("is false without navigator.gpu", async () => {
    expect(await detectWebGpu(undefined)).toBe(false);
  });

  it("asks for an adapter and checks it", async () => {
    expect(
      await detectWebGpu({ requestAdapter: async () => ({ info: { architecture: "metal-3" } }) }),
    ).toBe(true);
    expect(await detectWebGpu({ requestAdapter: async () => null })).toBe(false);
    expect(
      await detectWebGpu({
        requestAdapter: async () => {
          throw new Error("blocked");
        },
      }),
    ).toBe(false);
  });
});
