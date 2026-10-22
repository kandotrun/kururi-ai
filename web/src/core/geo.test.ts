import { afterEach, describe, expect, it, vi } from "vitest";
import type { GeoPoint } from "../contracts";
import {
  angularDistance,
  coordinateLabel,
  countryName,
  greatCircle,
  normalizeCountryCode,
  placeLabel,
} from "./geo";

const TOKYO: GeoPoint = { lat: 35.6812, lon: 139.7671 };
const NAIROBI: GeoPoint = { lat: -1.2864, lon: 36.8172 };

function point(points: readonly GeoPoint[], index: number): GeoPoint {
  const found = points[index];
  if (!found) {
    throw new Error(`missing point ${index}`);
  }
  return found;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("normalizeCountryCode", () => {
  it("upper-cases and trims ISO 3166-1 alpha-2 codes", () => {
    expect(normalizeCountryCode("jp")).toBe("JP");
    expect(normalizeCountryCode(" ke ")).toBe("KE");
    expect(normalizeCountryCode("XK")).toBe("XK");
  });

  it("maps the common UK alias and unambiguous retired codes", () => {
    expect(normalizeCountryCode("uk")).toBe("GB");
    expect(normalizeCountryCode("BU")).toBe("MM");
    expect(normalizeCountryCode("DD")).toBe("DE");
    expect(normalizeCountryCode("FX")).toBe("FR");
    expect(normalizeCountryCode("TP")).toBe("TL");
    expect(normalizeCountryCode("ZR")).toBe("CD");
  });

  it("rejects retired codes that split into several countries", () => {
    for (const raw of ["AN", "CS", "NT", "SU", "YU"]) {
      expect(normalizeCountryCode(raw)).toBeNull();
    }
  });

  it("rejects malformed and non-country codes", () => {
    for (const raw of ["", "J", "JPN", "12", "J1", "ZZ", "EU", "EZ", "UN", "QO", "XA", "XB"]) {
      expect(normalizeCountryCode(raw)).toBeNull();
    }
  });
});

describe("countryName", () => {
  it("names countries in Japanese by default", () => {
    expect(countryName("KE")).toBe("ケニア");
    expect(countryName("JP")).toBe("日本");
    expect(countryName("US")).toBe("アメリカ");
  });

  it("uses the short common names", () => {
    expect(countryName("HK")).toBe("香港");
    expect(countryName("GB")).toBe("英国");
  });

  it("accepts lower-case codes and other locales", () => {
    expect(countryName("ke")).toBe("ケニア");
    expect(countryName("JP", "en")).toBe("Japan");
  });

  it("falls back to the upper-case code when the name is unknown", () => {
    expect(countryName("qq")).toBe("QQ");
    expect(countryName("zz")).toBe("ZZ");
    expect(countryName("12")).toBe("12");
    expect(countryName(" ")).toBe(" ");
    expect(countryName("KE", "not a locale!")).toBe("KE");
  });

  it("falls back to the code without Intl.DisplayNames", () => {
    vi.stubGlobal("Intl", { ...Intl, DisplayNames: undefined });
    expect(countryName("KE", "fr")).toBe("KE");
  });
});

describe("coordinateLabel", () => {
  it("writes latitude before longitude with two decimals", () => {
    expect(coordinateLabel({ lat: 51.5, lon: -0.12 })).toBe(
      "北緯 51.50° 西経 0.12°",
    );
  });
});

describe("placeLabel", () => {
  it("is null without a place", () => {
    expect(placeLabel(null)).toBeNull();
    expect(placeLabel(undefined)).toBeNull();
  });

  it("prefers the country name", () => {
    expect(placeLabel({ ...NAIROBI, country: "KE" })).toBe("ケニア");
    expect(placeLabel({ lat: -77.85, lon: 166.67, country: "AQ" })).toBe(
      "南極",
    );
  });

  it("writes northern and eastern coordinates", () => {
    expect(placeLabel({ ...TOKYO, country: null })).toBe(
      "北緯 35.68° 東経 139.77°",
    );
  });

  it("writes southern and western coordinates", () => {
    expect(placeLabel({ lat: -33.4372, lon: -70.6506, country: null })).toBe(
      "南緯 33.44° 西経 70.65°",
    );
  });

  it("does not put a hemisphere on rounded zeros", () => {
    expect(placeLabel({ lat: -0.001, lon: -0.004, country: null })).toBe(
      "北緯 0.00° 東経 0.00°",
    );
    expect(placeLabel({ lat: 0.004, lon: 180, country: null })).toBe(
      "北緯 0.00° 東経 180.00°",
    );
  });

  it("uses coordinates when the country cannot be named", () => {
    expect(placeLabel({ lat: 64.13, lon: -21.9, country: "QQ" })).toBe(
      "北緯 64.13° 西経 21.90°",
    );
  });
});

describe("angularDistance", () => {
  it("measures central angles in radians", () => {
    expect(angularDistance({ lat: 0, lon: 0 }, { lat: 0, lon: 0 })).toBe(0);
    expect(angularDistance({ lat: 0, lon: 0 }, { lat: 0, lon: 90 })).toBeCloseTo(
      Math.PI / 2,
      12,
    );
    expect(
      angularDistance({ lat: 90, lon: 0 }, { lat: -90, lon: 45 }),
    ).toBeCloseTo(Math.PI, 12);
    expect(
      angularDistance({ lat: 10, lon: 179 }, { lat: 10, lon: -179 }),
    ).toBeCloseTo(angularDistance({ lat: 10, lon: 1 }, { lat: 10, lon: -1 }), 12);
  });

  it("matches the known distance between Nairobi and Tokyo", () => {
    expect(angularDistance(NAIROBI, TOKYO) * 6371).toBeCloseTo(11280, -2);
  });
});

describe("greatCircle", () => {
  it("returns steps + 1 points that start and end at the endpoints", () => {
    const path = greatCircle(NAIROBI, TOKYO, 16);
    expect(path).toHaveLength(17);
    expect(point(path, 0)).toEqual(NAIROBI);
    expect(point(path, 16)).toEqual(TOKYO);
  });

  it("spaces the points evenly along the shortest arc", () => {
    const path = greatCircle(NAIROBI, TOKYO, 16);
    const total = angularDistance(NAIROBI, TOKYO);
    for (let index = 1; index < path.length; index += 1) {
      expect(
        angularDistance(point(path, index - 1), point(path, index)),
      ).toBeCloseTo(total / 16, 9);
    }
  });

  it("follows the equator and meridians", () => {
    const equator = greatCircle({ lat: 0, lon: 0 }, { lat: 0, lon: 90 }, 2);
    expect(point(equator, 1).lat).toBeCloseTo(0, 12);
    expect(point(equator, 1).lon).toBeCloseTo(45, 12);
    const meridian = greatCircle({ lat: 60, lon: 0 }, { lat: 60, lon: 180 }, 2);
    expect(point(meridian, 1).lat).toBeCloseTo(90, 9);
  });

  it("crosses the antimeridian with longitudes in (-180, 180]", () => {
    const path = greatCircle({ lat: 0, lon: 170 }, { lat: 0, lon: -170 }, 4);
    expect(path.map((step) => Math.round(step.lon))).toEqual([
      170, 175, 180, -175, -170,
    ]);
    for (const step of path) {
      expect(step.lon).toBeGreaterThan(-180);
      expect(step.lon).toBeLessThanOrEqual(180);
    }
  });

  it("repeats a point when both ends coincide", () => {
    expect(greatCircle(TOKYO, { ...TOKYO }, 3)).toEqual([
      TOKYO,
      TOKYO,
      TOKYO,
      TOKYO,
    ]);
  });

  it("still draws an even half circle between antipodes", () => {
    const from = { lat: 0, lon: 0 };
    const to = { lat: 0, lon: 180 };
    const path = greatCircle(from, to, 4);
    expect(path).toHaveLength(5);
    for (let index = 1; index < path.length; index += 1) {
      expect(
        angularDistance(point(path, index - 1), point(path, index)),
      ).toBeCloseTo(Math.PI / 4, 9);
      expect(angularDistance(from, point(path, index))).toBeCloseTo(
        (Math.PI / 4) * index,
        9,
      );
    }
  });

  it("rejects step counts that are not positive integers", () => {
    expect(() => greatCircle(NAIROBI, TOKYO, 0)).toThrow(RangeError);
    expect(() => greatCircle(NAIROBI, TOKYO, 2.5)).toThrow(RangeError);
    expect(() => greatCircle(NAIROBI, TOKYO, Number.NaN)).toThrow(RangeError);
  });
});
