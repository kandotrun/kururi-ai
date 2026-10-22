import { describe, expect, it } from "vitest";
import { mulberry32 } from "../core/random";
import { angularDistance, vec3ToLatLon } from "./geo-math";
import {
  ARC_STRIDE,
  arrivedFraction,
  lightWeights,
  planArcs,
  sampleWeightedPoints,
} from "./origins";
import { GATHER } from "./timeline";

const TOKYO = { lat: 35.6812, lon: 139.7671 };

function randomOrigins(count: number, seed: number) {
  const random = mulberry32(seed);
  return Array.from({ length: count }, () => ({
    lat: random() * 140 - 70,
    lon: random() * 360 - 180,
  }));
}

describe("planArcs", () => {
  it("returns an empty plan without origins", () => {
    const plan = planArcs([], TOKYO, { cap: 100, random: mulberry32(1) });
    expect(plan.count).toBe(0);
    expect(arrivedFraction(plan, 10)).toBe(0);
  });

  it("caps the number of arcs deterministically", () => {
    const origins = randomOrigins(5000, 3);
    const a = planArcs(origins, TOKYO, { cap: 800, random: mulberry32(9) });
    const b = planArcs(origins, TOKYO, { cap: 800, random: mulberry32(9) });
    expect(a.count).toBe(800);
    expect(Array.from(a.data)).toEqual(Array.from(b.data));
    expect(a.data.length).toBe(800 * ARC_STRIDE);
  });

  it("drops invalid coordinates", () => {
    const plan = planArcs(
      [
        { lat: Number.NaN, lon: 0 },
        { lat: 120, lon: 0 },
        { lat: 10, lon: Number.POSITIVE_INFINITY },
        { lat: 48.85, lon: 2.35 },
      ],
      TOKYO,
      { cap: 10, random: mulberry32(2) },
    );
    expect(plan.count).toBe(1);
  });

  it("schedules every arc inside the gather beat", () => {
    const plan = planArcs(randomOrigins(3000, 5), TOKYO, {
      cap: 3000,
      random: mulberry32(4),
    });
    for (let index = 0; index < plan.count; index += 1) {
      const base = index * ARC_STRIDE;
      const x = plan.data[base]!;
      const y = plan.data[base + 1]!;
      const z = plan.data[base + 2]!;
      const light = plan.data[base + 3]!;
      const launch = plan.data[base + 4]!;
      const travel = plan.data[base + 5]!;
      expect(Math.hypot(x, y, z)).toBeCloseTo(1, 5);
      expect(light).toBeGreaterThanOrEqual(GATHER.lightStart - 1e-6);
      expect(light).toBeLessThanOrEqual(launch);
      expect(launch).toBeGreaterThanOrEqual(GATHER.launchStart - 1e-6);
      expect(travel).toBeGreaterThan(0.3);
      expect(launch + travel).toBeLessThanOrEqual(GATHER.arrivalEnd + 1e-5);
    }
    let previous = -Infinity;
    for (const arrival of plan.arrivals) {
      expect(arrival).toBeGreaterThanOrEqual(previous);
      previous = arrival;
    }
  });

  it("keeps many streaks in flight at once so the gathering reads clearly", () => {
    const plan = planArcs(randomOrigins(3000, 5), TOKYO, {
      cap: 3000,
      random: mulberry32(4),
    });
    let flying = 0;
    for (let index = 0; index < plan.count; index += 1) {
      const base = index * ARC_STRIDE;
      const light = plan.data[base + 3]!;
      const launch = plan.data[base + 4]!;
      const travel = plan.data[base + 5]!;
      expect(travel).toBeGreaterThanOrEqual(0.85);
      expect(launch - light).toBeGreaterThanOrEqual(0.12 - 1e-6);
      if (launch <= 2.7 && launch + travel > 2.7) {
        flying += 1;
      }
    }
    expect(flying / plan.count).toBeGreaterThan(0.4);
    expect(arrivedFraction(plan, 2.6)).toBeLessThan(0.25);
    expect(arrivedFraction(plan, 3.6)).toBeGreaterThan(0.6);
  });

  it("moves antipodal origins off the degenerate great circle", () => {
    const antipode = { lat: -TOKYO.lat, lon: TOKYO.lon - 180 };
    const plan = planArcs([antipode], TOKYO, {
      cap: 4,
      random: mulberry32(1),
    });
    const origin = vec3ToLatLon([plan.data[0]!, plan.data[1]!, plan.data[2]!]);
    expect(angularDistance(origin, TOKYO)).toBeLessThan(Math.PI - 0.005);
  });

  it("counts arrivals over time", () => {
    const plan = planArcs(randomOrigins(400, 8), TOKYO, {
      cap: 400,
      random: mulberry32(8),
    });
    expect(arrivedFraction(plan, 0)).toBe(0);
    expect(arrivedFraction(plan, GATHER.arrivalEnd + 0.01)).toBe(1);
    const middle = arrivedFraction(plan, 3);
    expect(middle).toBeGreaterThan(0);
    expect(middle).toBeLessThan(1);
  });
});

describe("fallback origins", () => {
  it("extracts warm city light and ignores the blue moonlit land", () => {
    const pixels = new Uint8ClampedArray([
      40, 45, 90, 255, 250, 220, 160, 255, 5, 5, 12, 255,
    ]);
    const weights = lightWeights(pixels, 3, 1);
    expect(weights[0]).toBe(0);
    expect(weights[1]).toBeGreaterThan(0);
    expect(weights[2]).toBe(0);
  });

  it("samples points inside weighted pixels only", () => {
    const weights = new Float32Array(8 * 4);
    weights[1 * 8 + 6] = 1;
    const points = sampleWeightedPoints(weights, 8, 4, 50, mulberry32(3));
    expect(points).toHaveLength(50);
    for (const point of points) {
      expect(point.lat).toBeLessThanOrEqual(45);
      expect(point.lat).toBeGreaterThanOrEqual(0);
      expect(point.lon).toBeGreaterThanOrEqual(90);
      expect(point.lon).toBeLessThanOrEqual(135);
    }
  });

  it("returns nothing for an empty weight grid", () => {
    expect(
      sampleWeightedPoints(new Float32Array(16), 4, 4, 10, mulberry32(1)),
    ).toEqual([]);
  });
});
