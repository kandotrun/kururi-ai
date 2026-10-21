import { describe, expect, it } from "vitest";
import {
  clamp,
  clamp01,
  easeInCubic,
  easeInOutCubic,
  easeInOutSine,
  easeOutCubic,
  envelope,
  lerp,
  monotoneSpline,
  progress,
  smootherstep,
  smoothstep,
  vectorTrack,
} from "./easing";

describe("scalar helpers", () => {
  it("clamps and interpolates", () => {
    expect(clamp(5, 0, 2)).toBe(2);
    expect(clamp(-1, 0, 2)).toBe(0);
    expect(clamp01(Number.NaN)).toBe(0);
    expect(lerp(2, 4, 0.25)).toBeCloseTo(2.5, 12);
  });

  it("maps a time window to a clamped progress", () => {
    expect(progress(1, 2, 4)).toBe(0);
    expect(progress(3, 2, 4)).toBeCloseTo(0.5, 12);
    expect(progress(9, 2, 4)).toBe(1);
    expect(progress(3, 3, 3)).toBe(1);
  });

  it("smoothsteps with flat ends", () => {
    expect(smoothstep(0, 1, 0)).toBe(0);
    expect(smoothstep(0, 1, 1)).toBe(1);
    expect(smoothstep(0, 1, 0.5)).toBeCloseTo(0.5, 12);
    expect(smootherstep(0, 1, 0.5)).toBeCloseTo(0.5, 12);
    expect(smoothstep(1, 0, 0.25)).toBeCloseTo(smoothstep(0, 1, 0.75), 12);
    const h = 1e-5;
    expect((smootherstep(0, 1, h) - smootherstep(0, 1, 0)) / h).toBeLessThan(
      1e-6,
    );
  });

  it("eases start at zero and end at one", () => {
    for (const ease of [
      easeInCubic,
      easeOutCubic,
      easeInOutCubic,
      easeInOutSine,
    ]) {
      expect(ease(0)).toBeCloseTo(0, 12);
      expect(ease(1)).toBeCloseTo(1, 12);
      expect(ease(-1)).toBeCloseTo(0, 12);
      expect(ease(2)).toBeCloseTo(1, 12);
    }
  });

  it("builds a smooth envelope that rises, holds and falls", () => {
    expect(envelope(0, 1, 2, 3, 4)).toBe(0);
    expect(envelope(1.5, 1, 2, 3, 4)).toBeCloseTo(0.5, 12);
    expect(envelope(2.5, 1, 2, 3, 4)).toBe(1);
    expect(envelope(3.5, 1, 2, 3, 4)).toBeCloseTo(0.5, 12);
    expect(envelope(5, 1, 2, 3, 4)).toBe(0);
  });
});

describe("monotoneSpline", () => {
  const keys = [
    { t: 0, v: 10 },
    { t: 1, v: 8 },
    { t: 2, v: 3 },
    { t: 4, v: 2.5 },
    { t: 5, v: 2.5 },
  ];
  const spline = monotoneSpline(keys);

  it("passes through every key and clamps outside", () => {
    for (const key of keys) {
      expect(spline(key.t)).toBeCloseTo(key.v, 12);
    }
    expect(spline(-3)).toBeCloseTo(10, 12);
    expect(spline(9)).toBeCloseTo(2.5, 12);
  });

  it("never overshoots monotone data", () => {
    let previous = spline(0);
    for (let step = 1; step <= 500; step += 1) {
      const value = spline(step / 100);
      expect(value).toBeLessThanOrEqual(previous + 1e-12);
      expect(value).toBeGreaterThanOrEqual(2.5 - 1e-12);
      previous = value;
    }
  });

  it("is C1 continuous across keys", () => {
    const h = 1e-6;
    for (const key of keys.slice(1, -1)) {
      const left = (spline(key.t) - spline(key.t - h)) / h;
      const right = (spline(key.t + h) - spline(key.t)) / h;
      expect(Math.abs(left - right)).toBeLessThan(1e-3);
    }
  });

  it("honours explicit slopes so a move can end at rest", () => {
    const rest = monotoneSpline([
      { t: 0, v: 0 },
      { t: 1, v: 1, slope: 0 },
    ]);
    const h = 1e-6;
    expect((rest(1) - rest(1 - h)) / h).toBeLessThan(1e-4);
    expect(rest(0.5)).toBeGreaterThan(0.4);
  });

  it("keeps local extrema flat instead of overshooting", () => {
    const bump = monotoneSpline([
      { t: 0, v: 0 },
      { t: 1, v: 1 },
      { t: 2, v: 0 },
    ]);
    for (let step = 0; step <= 200; step += 1) {
      expect(bump(step / 100)).toBeLessThanOrEqual(1 + 1e-12);
      expect(bump(step / 100)).toBeGreaterThanOrEqual(-1e-12);
    }
  });

  it("rejects unordered keys", () => {
    expect(() =>
      monotoneSpline([
        { t: 1, v: 0 },
        { t: 0, v: 1 },
      ]),
    ).toThrow();
    expect(() => monotoneSpline([])).toThrow();
  });
});

describe("vectorTrack", () => {
  it("evaluates every component into the output without allocating", () => {
    const track = vectorTrack([
      { t: 0, v: [0, 10, 5] },
      { t: 1, v: [1, 0, 5] },
      { t: 2, v: [2, 0, 5] },
    ]);
    const out = [0, 0, 0];
    const result = track(1, out);
    expect(result).toBe(out);
    expect(out).toEqual([1, 0, 5]);
    track(0.5, out);
    expect(out[0]).toBeCloseTo(0.5, 6);
    expect(out[2]).toBeCloseTo(5, 12);
  });

  it("rejects keys with different sizes", () => {
    expect(() =>
      vectorTrack([
        { t: 0, v: [0, 1] },
        { t: 1, v: [0] },
      ]),
    ).toThrow();
  });
});
