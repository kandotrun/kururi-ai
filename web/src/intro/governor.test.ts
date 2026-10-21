import { describe, expect, it } from "vitest";
import { createGovernor, initialPixelRatio } from "./governor";

describe("initialPixelRatio", () => {
  it("caps by device ratio, power mode and pixel budget", () => {
    expect(initialPixelRatio(3, 1440, 900, false)).toBe(2);
    expect(initialPixelRatio(1, 1440, 900, false)).toBe(1);
    expect(initialPixelRatio(3, 390, 844, true)).toBeCloseTo(1.5, 9);
    const big = initialPixelRatio(2, 3840, 2160, false);
    expect(3840 * 2160 * big * big).toBeLessThanOrEqual(5.4e6 + 1);
    expect(initialPixelRatio(0, 0, 0, false)).toBeGreaterThan(0);
  });
});

describe("createGovernor", () => {
  it("keeps the ratio while frames are fast", () => {
    const governor = createGovernor(2);
    for (let frame = 0; frame < 600; frame += 1) {
      governor.sample(16.7);
    }
    expect(governor.ratio).toBe(2);
  });

  it("ignores a single long frame", () => {
    const governor = createGovernor(2);
    governor.sample(16.7);
    governor.sample(120);
    for (let frame = 0; frame < 30; frame += 1) {
      governor.sample(16.7);
    }
    expect(governor.ratio).toBe(2);
  });

  it("steps down after sustained slow frames and stops at the floor", () => {
    const governor = createGovernor(2);
    let changes = 0;
    for (let frame = 0; frame < 2000; frame += 1) {
      if (governor.sample(40)) {
        changes += 1;
      }
    }
    expect(changes).toBeGreaterThan(1);
    expect(governor.ratio).toBeCloseTo(0.75, 9);
  });

  it("waits between steps so the new size can settle", () => {
    const governor = createGovernor(2);
    let first = -1;
    let second = -1;
    for (let frame = 0; frame < 200; frame += 1) {
      if (governor.sample(30)) {
        if (first < 0) {
          first = frame;
        } else if (second < 0) {
          second = frame;
        }
      }
    }
    expect(first).toBeGreaterThan(10);
    expect(second - first).toBeGreaterThan(20);
  });
});
