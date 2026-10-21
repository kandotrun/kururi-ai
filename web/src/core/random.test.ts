import { describe, expect, it } from "vitest";
import { mulberry32, range, shuffle } from "./random";

describe("mulberry32", () => {
  it("is deterministic for a seed", () => {
    const left = mulberry32(42);
    const right = mulberry32(42);
    const a = [left(), left(), left()];
    const b = [right(), right(), right()];
    expect(a).toEqual(b);
  });

  it("differs between seeds", () => {
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
  });

  it("stays inside [0, 1)", () => {
    const random = mulberry32(7);
    for (let index = 0; index < 10_000; index += 1) {
      const value = random();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe("range", () => {
  it("maps the unit interval onto the given bounds", () => {
    expect(range(() => 0, -2, 4)).toBe(-2);
    expect(range(() => 0.5, -2, 4)).toBe(1);
  });
});

describe("shuffle", () => {
  it("returns a permutation without touching the input", () => {
    const input = [1, 2, 3, 4, 5, 6, 7, 8];
    const output = shuffle(input, mulberry32(3));
    expect(input).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect([...output].sort((left, right) => left - right)).toEqual(input);
    expect(output).not.toEqual(input);
  });

  it("is reproducible for a seed", () => {
    const input = Array.from({ length: 20 }, (_, index) => index);
    expect(shuffle(input, mulberry32(9))).toEqual(shuffle(input, mulberry32(9)));
  });
});
