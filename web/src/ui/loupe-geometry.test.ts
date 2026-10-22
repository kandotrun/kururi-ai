import { describe, expect, it } from "vitest";
import { placeLoupe } from "./loupe-geometry";

const viewport = { width: 1440, height: 900 };
const size = { width: 248, height: 340 };
const options = { gap: 28, margin: 12, lift: 110 };

describe("placeLoupe", () => {
  it("sits to the right of the point and slightly above it", () => {
    expect(placeLoupe({ x: 600, y: 450 }, size, viewport, options)).toEqual({
      left: 628,
      top: 340,
      side: "right",
    });
  });

  it("flips to the left near the right edge", () => {
    expect(placeLoupe({ x: 1300, y: 450 }, size, viewport, options)).toEqual({
      left: 1024,
      top: 340,
      side: "left",
    });
  });

  it("clamps to the top and bottom of the viewport", () => {
    expect(placeLoupe({ x: 600, y: 40 }, size, viewport, options).top).toBe(
      12,
    );
    expect(placeLoupe({ x: 600, y: 880 }, size, viewport, options).top).toBe(
      548,
    );
  });

  it("clamps horizontally when neither side fits", () => {
    const narrow = { width: 400, height: 900 };
    const placed = placeLoupe({ x: 200, y: 450 }, size, narrow, options);
    expect(placed.left).toBeGreaterThanOrEqual(12);
    expect(placed.left + size.width).toBeLessThanOrEqual(388);
  });

  it("returns whole pixels", () => {
    const placed = placeLoupe({ x: 600.4, y: 450.7 }, size, viewport, options);
    expect(Number.isInteger(placed.left)).toBe(true);
    expect(Number.isInteger(placed.top)).toBe(true);
  });

  it("respects a reserved area at the bottom", () => {
    const placed = placeLoupe({ x: 600, y: 880 }, size, viewport, {
      ...options,
      reserveBottom: 80,
    });
    expect(placed.top).toBe(468);
  });

  it("stays clear of a panel reserved on the right", () => {
    const placed = placeLoupe({ x: 806, y: 414 }, size, viewport, {
      ...options,
      reserveRight: 556,
    });
    expect(placed.side).toBe("left");
    expect(placed.left + size.width).toBeLessThanOrEqual(1440 - 556 - 12);
  });

  it("keeps clear of the right panel even when the point sits under it", () => {
    const placed = placeLoupe({ x: 1100, y: 414 }, size, viewport, {
      ...options,
      reserveRight: 556,
    });
    expect(placed.left + size.width).toBeLessThanOrEqual(1440 - 556 - 12);
    expect(placed.left).toBeGreaterThanOrEqual(12);
  });
});
