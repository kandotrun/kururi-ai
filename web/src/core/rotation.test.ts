import { describe, expect, it } from "vitest";
import {
  expectedCorrection,
  finalQuarter,
  isCorrect,
  isUpright,
  markSide,
  normalizeQuarter,
  pickSimulated,
  quarterToYaw,
  turnDelta,
} from "./rotation";

describe("normalizeQuarter", () => {
  it("wraps any integer into 0..3", () => {
    expect(normalizeQuarter(0)).toBe(0);
    expect(normalizeQuarter(5)).toBe(1);
    expect(normalizeQuarter(-1)).toBe(3);
    expect(normalizeQuarter(-6)).toBe(2);
  });

  it("accepts degrees through quarter division", () => {
    expect(normalizeQuarter(270 / 90)).toBe(3);
  });
});

describe("quarterToYaw", () => {
  it("maps clockwise quarters to negative yaw", () => {
    expect(quarterToYaw(0)).toBe(0);
    expect(quarterToYaw(1)).toBeCloseTo(-Math.PI / 2);
    expect(quarterToYaw(2)).toBeCloseTo(-Math.PI);
    expect(quarterToYaw(3)).toBeCloseTo((-3 * Math.PI) / 2);
  });
});

describe("finalQuarter and isUpright", () => {
  it("adds the simulated rotation and the predicted correction", () => {
    expect(finalQuarter(1, 3)).toBe(0);
    expect(finalQuarter(2, 1)).toBe(3);
    expect(isUpright(1, 3)).toBe(true);
    expect(isUpright(2, 2)).toBe(true);
    expect(isUpright(2, 1)).toBe(false);
  });
});

describe("markSide", () => {
  it("is the local top when the prediction is correct", () => {
    expect(markSide(1, 3)).toBe(0);
    expect(markSide(0, 0)).toBe(0);
  });

  it("points at the local side the model believes is the top", () => {
    expect(markSide(0, 1)).toBe(3);
    expect(markSide(1, 0)).toBe(3);
    expect(markSide(2, 0)).toBe(2);
    expect(markSide(0, 3)).toBe(1);
  });
});

describe("turnDelta", () => {
  it("turns along the shortest visual path", () => {
    expect(turnDelta(0)).toBe(0);
    expect(turnDelta(1)).toBeCloseTo(-Math.PI / 2);
    expect(turnDelta(2)).toBeCloseTo(-Math.PI);
    expect(turnDelta(3)).toBeCloseTo(Math.PI / 2);
  });
});

describe("pickSimulated", () => {
  it("returns zero for the low end of the distribution", () => {
    expect(pickSimulated(() => 0)).toBe(0);
  });

  it("favours visible rotations", () => {
    const counts = [0, 0, 0, 0];
    for (let index = 0; index < 1000; index += 1) {
      counts[pickSimulated(() => (index + 0.5) / 1000)]! += 1;
    }
    expect(counts[0]).toBe(100);
    expect(counts[1]).toBe(300);
    expect(counts[2]).toBe(300);
    expect(counts[3]).toBe(300);
  });

  it("never escapes the quarter range at the top end", () => {
    expect(pickSimulated(() => 0.999999)).toBe(3);
  });
});

describe("expectedCorrection", () => {
  it("undoes the simulated rotation for upright sources", () => {
    expect(expectedCorrection(0, 0)).toBe(0);
    expect(expectedCorrection(0, 1)).toBe(3);
    expect(expectedCorrection(0, 2)).toBe(2);
  });

  it("adds the fix a crooked source already needs", () => {
    expect(expectedCorrection(3, 0)).toBe(3);
    expect(expectedCorrection(1, 1)).toBe(0);
    expect(expectedCorrection(2, 3)).toBe(3);
  });
});

describe("isCorrect", () => {
  it("is null when the source orientation is unknown", () => {
    expect(isCorrect(null, 1, 3)).toBeNull();
  });

  it("compares the prediction with the expected correction", () => {
    expect(isCorrect(0, 1, 3)).toBe(true);
    expect(isCorrect(0, 1, 1)).toBe(false);
    expect(isCorrect(3, 0, 3)).toBe(true);
  });
});
