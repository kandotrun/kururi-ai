import { describe, expect, it } from "vitest";
import {
  type Box,
  type InsetLayout,
  ZERO_INSETS,
  computeViewInsets,
  sameInsets,
} from "./view-insets";

function box(left: number, top: number, right: number, bottom: number): Box {
  return { left, top, right, bottom };
}

function desktop(overrides: Partial<InsetLayout> = {}): InsetLayout {
  return {
    width: 1440,
    height: 900,
    compact: false,
    masthead: box(0, 0, 1440, 56),
    headline: [box(32, 80, 300, 120), box(32, 124, 420, 252), box(32, 278, 476, 334)],
    actions: [box(32, 370, 336, 418), box(32, 426, 262, 462), box(32, 478, 498, 540)],
    ruler: box(0, 820, 1440, 900),
    ...overrides,
  };
}

function phone(overrides: Partial<InsetLayout> = {}): InsetLayout {
  return {
    width: 390,
    height: 844,
    compact: true,
    masthead: box(0, 0, 390, 48),
    headline: [box(16, 52, 160, 74), box(16, 76, 194, 132), box(16, 144, 368, 228)],
    actions: [box(0, 575, 390, 776)],
    ruler: box(0, 776, 390, 844),
    ...overrides,
  };
}

describe("computeViewInsets on wide screens", () => {
  it("keeps the desk beside the headline column, below the masthead and above the ruler", () => {
    expect(computeViewInsets(desktop())).toEqual({
      top: 56,
      right: 0,
      bottom: 80,
      left: 498,
    });
  });

  it("rounds every covered edge outwards to whole pixels", () => {
    const insets = computeViewInsets(
      desktop({
        masthead: box(0, 0, 1440, 55.5),
        actions: [box(32, 370, 519.2, 418)],
        ruler: box(0, 819.6, 1440, 900),
      }),
    );
    expect(insets).toEqual({ top: 56, right: 0, bottom: 81, left: 520 });
  });

  it("ignores hidden parts that have no size", () => {
    const insets = computeViewInsets(
      desktop({
        actions: [box(32, 370, 336, 418), box(0, 0, 0, 0), box(900, 400, 900, 460)],
      }),
    );
    expect(insets.left).toBe(476);
  });

  it("moves the free area below the headline when that leaves more room", () => {
    const insets = computeViewInsets(
      desktop({
        width: 768,
        height: 1024,
        masthead: box(0, 0, 768, 56),
        actions: [box(32, 370, 498, 600)],
        ruler: box(0, 944, 768, 1024),
      }),
    );
    expect(insets).toEqual({ top: 600, right: 0, bottom: 80, left: 0 });
  });

  it("only reserves the masthead and ruler when nothing else is shown", () => {
    expect(computeViewInsets(desktop({ headline: [], actions: [] }))).toEqual({
      top: 56,
      right: 0,
      bottom: 80,
      left: 0,
    });
  });

  it("treats missing chrome as uncovered", () => {
    expect(
      computeViewInsets(
        desktop({ masthead: null, ruler: null, headline: [], actions: [] }),
      ),
    ).toEqual(ZERO_INSETS);
  });
});

describe("computeViewInsets on phones", () => {
  it("reserves the headline block on top and the actions plus ruler at the bottom", () => {
    expect(computeViewInsets(phone())).toEqual({
      top: 228,
      right: 0,
      bottom: 269,
      left: 0,
    });
  });

  it("falls back to the ruler when the actions are hidden", () => {
    expect(computeViewInsets(phone({ actions: [] })).bottom).toBe(68);
  });

  it("uses the masthead when the headline is hidden", () => {
    expect(computeViewInsets(phone({ headline: [] })).top).toBe(48);
  });

  it("never reports more than the whole screen", () => {
    const insets = computeViewInsets(
      phone({ height: 500, actions: [box(0, 180, 390, 440)], ruler: box(0, 440, 390, 500) }),
    );
    expect(insets.top).toBe(228);
    expect(insets.top + insets.bottom).toBeLessThanOrEqual(500);
    expect(insets.bottom).toBe(272);
  });
});

describe("sameInsets", () => {
  it("compares every side", () => {
    expect(sameInsets(ZERO_INSETS, { top: 0, right: 0, bottom: 0, left: 0 })).toBe(true);
    expect(sameInsets(ZERO_INSETS, { top: 0, right: 0, bottom: 1, left: 0 })).toBe(false);
    expect(sameInsets({ top: 5, right: 0, bottom: 0, left: 2 }, { top: 5, right: 0, bottom: 0, left: 3 })).toBe(false);
  });
});
