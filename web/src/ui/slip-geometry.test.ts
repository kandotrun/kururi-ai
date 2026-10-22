import { describe, expect, it } from "vitest";
import { placeSlip } from "./slip-geometry";

const viewport = { width: 1440, height: 900 };
const size = { width: 360, height: 220 };
const options = { gap: 12, margin: 16, reserveBottom: 80 };

describe("placeSlip", () => {
  it("opens below the anchor when there is room", () => {
    expect(
      placeSlip({ left: 32, top: 300, bottom: 350 }, size, viewport, options),
    ).toEqual({ left: 32, top: 362, side: "below" });
  });

  it("opens above the anchor when the ruler would cover it", () => {
    expect(
      placeSlip({ left: 32, top: 520, bottom: 580 }, size, viewport, options),
    ).toEqual({ left: 32, top: 288, side: "above" });
  });

  it("keeps the slip inside the right edge", () => {
    expect(
      placeSlip({ left: 1300, top: 300, bottom: 350 }, size, viewport, options)
        .left,
    ).toBe(1440 - 16 - 360);
  });

  it("clamps into the viewport when neither side fits", () => {
    const tall = { width: 360, height: 700 };
    const placement = placeSlip(
      { left: 32, top: 400, bottom: 450 },
      tall,
      viewport,
      options,
    );
    expect(placement.top).toBeGreaterThanOrEqual(16);
    expect(placement.top + tall.height).toBeLessThanOrEqual(900 - 80 - 16);
  });

  it("pins to the top margin when the slip is taller than the room", () => {
    const huge = { width: 360, height: 1200 };
    expect(
      placeSlip({ left: 32, top: 400, bottom: 450 }, huge, viewport, options)
        .top,
    ).toBe(16);
  });
});
