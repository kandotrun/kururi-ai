import { SphereGeometry } from "three";
import { describe, expect, it } from "vitest";
import {
  angularDistance,
  arcLift,
  equirectUv,
  greatCircle,
  latLonToVec3,
  localFrame,
  slerpUnit,
  solarElevation,
  subsolarForElevation,
  vec3ToLatLon,
} from "./geo-math";

const TOKYO = { lat: 35.6812, lon: 139.7671 };
const DEG = Math.PI / 180;

function length(v: readonly number[]): number {
  return Math.hypot(v[0]!, v[1]!, v[2]!);
}

function dot(a: readonly number[], b: readonly number[]): number {
  return a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
}

describe("latLonToVec3", () => {
  it("matches the three.js SphereGeometry uv layout used for equirectangular maps", () => {
    const sphere = new SphereGeometry(1, 36, 18);
    const position = sphere.getAttribute("position");
    const uv = sphere.getAttribute("uv");
    for (let index = 0; index < position.count; index += 1) {
      const lat = (uv.getY(index) - 0.5) * 180;
      if (Math.abs(lat) > 89.9) {
        continue;
      }
      const lon = uv.getX(index) * 360 - 180;
      const v = latLonToVec3({ lat, lon });
      expect(v[0]).toBeCloseTo(position.getX(index), 5);
      expect(v[1]).toBeCloseTo(position.getY(index), 5);
      expect(v[2]).toBeCloseTo(position.getZ(index), 5);
    }
  });

  it("round trips through vec3ToLatLon", () => {
    const point = vec3ToLatLon(latLonToVec3(TOKYO));
    expect(point.lat).toBeCloseTo(TOKYO.lat, 9);
    expect(point.lon).toBeCloseTo(TOKYO.lon, 9);
  });

  it("writes into the given output", () => {
    const out: [number, number, number] = [0, 0, 0];
    expect(latLonToVec3({ lat: 0, lon: 0 }, out)).toBe(out);
    expect(out).toEqual([1, 0, -0]);
  });
});

describe("equirectUv", () => {
  it("puts north at the first texture row", () => {
    expect(equirectUv({ lat: 90, lon: -180 })).toEqual([0, 0]);
    const [u, v] = equirectUv(TOKYO);
    expect(u).toBeCloseTo((139.7671 + 180) / 360, 12);
    expect(v).toBeCloseTo((90 - 35.6812) / 180, 12);
  });
});

describe("great circles", () => {
  const paris = { lat: 48.8566, lon: 2.3522 };

  it("measures the central angle", () => {
    expect(angularDistance(TOKYO, TOKYO)).toBeCloseTo(0, 12);
    expect(angularDistance({ lat: 0, lon: 0 }, { lat: 0, lon: 90 })).toBeCloseTo(
      Math.PI / 2,
      12,
    );
    expect(angularDistance(TOKYO, paris) * 6371).toBeCloseTo(9712, -1);
  });

  it("slerps along the sphere at constant speed", () => {
    const a = latLonToVec3(paris);
    const b = latLonToVec3(TOKYO);
    const out: [number, number, number] = [0, 0, 0];
    const total = Math.acos(dot(a, b));
    for (const t of [0, 0.25, 0.5, 0.9, 1]) {
      slerpUnit(a, b, t, out);
      expect(length(out)).toBeCloseTo(1, 9);
      expect(Math.acos(Math.min(1, dot(a, out)))).toBeCloseTo(total * t, 6);
    }
  });

  it("stays finite for identical and antipodal endpoints", () => {
    const a = latLonToVec3({ lat: 10, lon: 20 });
    const out: [number, number, number] = [0, 0, 0];
    slerpUnit(a, a, 0.5, out);
    expect(out.every(Number.isFinite)).toBe(true);
    const b: [number, number, number] = [-a[0], -a[1], -a[2]];
    slerpUnit(a, b, 0.5, out);
    expect(out.every(Number.isFinite)).toBe(true);
    expect(length(out)).toBeCloseTo(1, 9);
  });

  it("samples a great circle with both endpoints", () => {
    const points = greatCircle(paris, TOKYO, 8);
    expect(points).toHaveLength(9);
    expect(points[0]!.lat).toBeCloseTo(paris.lat, 9);
    expect(points[8]!.lon).toBeCloseTo(TOKYO.lon, 9);
    const step = angularDistance(points[0]!, points[1]!);
    expect(angularDistance(points[4]!, points[5]!)).toBeCloseTo(step, 9);
  });

  it("lifts long arcs higher than short ones", () => {
    expect(arcLift(0)).toBeGreaterThan(0);
    expect(arcLift(Math.PI)).toBeGreaterThan(arcLift(0.3));
    expect(arcLift(Math.PI)).toBeLessThan(0.4);
  });

  it("raises a Europe to Tokyo arc well above the surface", () => {
    const angle = angularDistance(paris, TOKYO);
    expect(arcLift(angle)).toBeGreaterThan(0.14);
    expect(arcLift(angle)).toBeLessThan(0.25);
  });
});

describe("localFrame", () => {
  it("is orthonormal with north towards the pole", () => {
    const frame = localFrame(TOKYO);
    for (const axis of [frame.east, frame.north, frame.up]) {
      expect(length(axis)).toBeCloseTo(1, 9);
    }
    expect(dot(frame.east, frame.north)).toBeCloseTo(0, 9);
    expect(dot(frame.east, frame.up)).toBeCloseTo(0, 9);
    expect(dot(frame.north, frame.up)).toBeCloseTo(0, 9);
    expect(frame.north[1]).toBeGreaterThan(0);
    const east = latLonToVec3({ lat: TOKYO.lat, lon: TOKYO.lon + 0.01 });
    const here = latLonToVec3(TOKYO);
    const delta = [east[0] - here[0], east[1] - here[1], east[2] - here[2]];
    expect(dot(delta, frame.east)).toBeGreaterThan(0);
  });
});

describe("sun placement", () => {
  it("gives ninety degrees under the subsolar point", () => {
    expect(solarElevation(TOKYO, TOKYO)).toBeCloseTo(Math.PI / 2, 9);
  });

  it("solves the subsolar point for an evening twilight in Tokyo", () => {
    const sun = subsolarForElevation(TOKYO, -8 * DEG, -23.44 * DEG, "evening");
    expect(sun.lat).toBeCloseTo(-23.44, 9);
    expect(solarElevation(TOKYO, sun)).toBeCloseTo(-8 * DEG, 9);
    const west = ((TOKYO.lon - sun.lon + 540) % 360) - 180;
    expect(west).toBeGreaterThan(0);
    const morning = subsolarForElevation(
      TOKYO,
      -8 * DEG,
      -23.44 * DEG,
      "morning",
    );
    expect(((morning.lon - TOKYO.lon + 540) % 360) - 180).toBeGreaterThan(0);
  });
});
