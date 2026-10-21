import { describe, expect, it } from "vitest";
import { readAppConfig, type DeviceHints } from "./app-config";

const desktop: DeviceHints = {
  randomSeed: 1234,
  prefersReducedMotion: false,
  coarsePointer: false,
  shortestScreenSide: 1080,
  deviceMemory: 16,
  hardwareConcurrency: 10,
};

describe("readAppConfig", () => {
  it("uses device defaults without query parameters", () => {
    expect(readAppConfig("", desktop)).toEqual({
      seed: 1234,
      limit: null,
      commons: true,
      reducedMotion: false,
      lowPower: false,
      workers: null,
      model: "nano",
    });
  });

  it("selects the full model only when asked by name", () => {
    expect(readAppConfig("?model=full", desktop).model).toBe("full");
    expect(readAppConfig("?model=nano", desktop).model).toBe("nano");
    expect(readAppConfig("?model=huge", desktop).model).toBe("nano");
  });

  it("reads reproducibility switches from the query", () => {
    const config = readAppConfig("?seed=7&limit=24&commons=off&motion=reduce&workers=2", desktop);
    expect(config).toEqual({
      seed: 7,
      limit: 24,
      commons: false,
      reducedMotion: true,
      lowPower: false,
      workers: 2,
      model: "nano",
    });
  });

  it("ignores malformed numbers", () => {
    const config = readAppConfig("?seed=abc&limit=-3&workers=0", desktop);
    expect(config.seed).toBe(1234);
    expect(config.limit).toBeNull();
    expect(config.workers).toBeNull();
  });

  it("caps worker overrides", () => {
    expect(readAppConfig("?workers=99", desktop).workers).toBe(8);
  });

  it("follows the reduced motion preference", () => {
    expect(readAppConfig("", { ...desktop, prefersReducedMotion: true }).reducedMotion).toBe(true);
  });

  it("treats phones and small-memory devices as low power", () => {
    expect(readAppConfig("", { ...desktop, coarsePointer: true, shortestScreenSide: 390 }).lowPower).toBe(true);
    expect(readAppConfig("", { ...desktop, deviceMemory: 4 }).lowPower).toBe(true);
    expect(readAppConfig("", { ...desktop, coarsePointer: true, shortestScreenSide: 1024 }).lowPower).toBe(false);
    expect(readAppConfig("", { ...desktop, deviceMemory: undefined }).lowPower).toBe(false);
  });
});
