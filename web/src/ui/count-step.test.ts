import { describe, expect, it } from "vitest";
import { stepCount } from "./count-step";

describe("stepCount", () => {
  it("moves toward the target without reaching it in one short frame", () => {
    const next = stepCount(0, 100, 16, 280);
    expect(next).toBeGreaterThan(0);
    expect(next).toBeLessThan(100);
  });

  it("never overshoots", () => {
    let value = 0;
    for (let frame = 0; frame < 200; frame += 1) {
      value = stepCount(value, 50, 16, 280);
      expect(value).toBeLessThanOrEqual(50);
    }
    expect(value).toBe(50);
  });

  it("snaps when it is within half a step", () => {
    expect(stepCount(99.7, 100, 16, 280)).toBe(100);
  });

  it("keeps the value when no time has passed", () => {
    expect(stepCount(10, 100, 0, 280)).toBe(10);
  });

  it("jumps after a long pause", () => {
    expect(stepCount(10, 1000, 60_000, 280)).toBe(1000);
  });

  it("follows a lower target too", () => {
    const next = stepCount(100, 0, 16, 280);
    expect(next).toBeLessThan(100);
    expect(next).toBeGreaterThan(0);
  });

  it("jumps immediately when the time constant is zero", () => {
    expect(stepCount(10, 100, 16, 0)).toBe(100);
  });
});
