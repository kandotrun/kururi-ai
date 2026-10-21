import { describe, expect, it } from "vitest";
import { mulberry32 } from "../core/random";
import {
  BUILDING_STRIDE,
  CORRIDOR,
  EXPRESSWAYS,
  HERO,
  HERO_WINDOW,
  STREETS,
  aviationBeacons,
  buildCity,
  expresswayDistance,
  sampleExpressway,
  shorelineZ,
  streetDistance,
} from "./city-plan";

function building(data: Float32Array, index: number) {
  const base = index * BUILDING_STRIDE;
  return {
    x: data[base]!,
    z: data[base + 1]!,
    width: data[base + 2]!,
    depth: data[base + 3]!,
    height: data[base + 4]!,
    style: data[base + 5]!,
    seed: data[base + 6]!,
    lit: data[base + 7]!,
  };
}

describe("hero building", () => {
  it("has the target window on its south face", () => {
    expect(HERO_WINDOW.z).toBeGreaterThan(HERO.maxZ - 0.01);
    expect(HERO_WINDOW.z).toBeLessThan(HERO.maxZ + 0.5);
    expect(HERO_WINDOW.x).toBeGreaterThan(HERO.minX);
    expect(HERO_WINDOW.x).toBeLessThan(HERO.maxX);
    expect(HERO_WINDOW.y).toBeLessThan(HERO.height);
  });

  it("faces an open street, not another block", () => {
    expect(streetDistance(HERO_WINDOW.x, HERO.maxZ + 10)).toBeLessThan(
      STREETS.avenueWidth / 2,
    );
  });
});

describe("shoreline", () => {
  it("puts the bay ahead of the hero window, beyond the towers", () => {
    for (let x = -3000; x <= 3000; x += 50) {
      expect(shorelineZ(x)).toBeLessThan(-1500);
      expect(shorelineZ(x)).toBeGreaterThan(-2600);
    }
  });
});

describe("expressways", () => {
  it("stay clear of the hero building and the approach corridor", () => {
    expect(EXPRESSWAYS.length).toBeGreaterThan(0);
    expect(expresswayDistance(HERO_WINDOW.x, HERO_WINDOW.z)).toBeGreaterThan(80);
    for (let x = CORRIDOR.minX; x <= CORRIDOR.maxX; x += 10) {
      for (let z = CORRIDOR.minZ; z <= CORRIDOR.maxZ; z += 10) {
        expect(expresswayDistance(x, z)).toBeGreaterThan(30);
      }
    }
  });

  it("samples a smooth elevated deck", () => {
    for (const road of EXPRESSWAYS) {
      const points = sampleExpressway(road, 200);
      expect(points.length).toBe(201);
      for (let index = 1; index < points.length; index += 1) {
        const a = points[index - 1]!;
        const b = points[index]!;
        expect(Math.hypot(b.x - a.x, b.z - a.z)).toBeGreaterThan(1);
        expect(b.y).toBeGreaterThan(8);
        expect(Math.abs(b.y - a.y)).toBeLessThan(2);
      }
    }
  });
});

describe("buildCity", () => {
  const city = buildCity(mulberry32(7), { radius: 2400, maxBuildings: 9000 });

  it("starts with the hero building", () => {
    const hero = building(city.data, 0);
    expect(hero.x).toBeCloseTo((HERO.minX + HERO.maxX) / 2, 6);
    expect(hero.z).toBeCloseTo((HERO.minZ + HERO.maxZ) / 2, 6);
    expect(hero.height).toBeCloseTo(HERO.height, 4);
    expect(hero.style).toBe(3);
  });

  it("is deterministic and capped", () => {
    const again = buildCity(mulberry32(7), { radius: 2400, maxBuildings: 9000 });
    expect(Array.from(again.data)).toEqual(Array.from(city.data));
    const small = buildCity(mulberry32(7), { radius: 2400, maxBuildings: 500 });
    expect(small.count).toBe(500);
    expect(city.count).toBeGreaterThan(2000);
  });

  it("keeps streets, water and the approach corridor free", () => {
    for (let index = 1; index < city.count; index += 1) {
      const b = building(city.data, index);
      const minX = b.x - b.width / 2;
      const maxX = b.x + b.width / 2;
      const minZ = b.z - b.depth / 2;
      const maxZ = b.z + b.depth / 2;
      expect(minZ).toBeGreaterThan(shorelineZ(b.x) + 10);
      expect(expresswayDistance(b.x, b.z)).toBeGreaterThan(Math.hypot(b.width, b.depth) / 2);
      expect(streetDistance(b.x, b.z)).toBeGreaterThan(STREETS.width / 2);
      const inCorridor = maxX > -110 && minX < 150 && maxZ > 0 && minZ < 420;
      if (inCorridor) {
        expect(b.height).toBeLessThan(14);
      }
      const touchesHero =
        maxX > HERO.minX && minX < HERO.maxX && maxZ > HERO.minZ && minZ < HERO.maxZ;
      expect(touchesHero).toBe(false);
      expect(b.width).toBeGreaterThan(4);
      expect(b.depth).toBeGreaterThan(4);
      expect(b.height).toBeGreaterThan(5);
      expect(b.lit).toBeGreaterThanOrEqual(0);
      expect(b.lit).toBeLessThanOrEqual(1);
    }
  });
});

describe("night lighting plan", () => {
  const city = buildCity(mulberry32(11), { radius: 2400, maxBuildings: 9000 });

  it("keeps most windows dark with a few nearly dark buildings", () => {
    let total = 0;
    let dark = 0;
    for (let index = 1; index < city.count; index += 1) {
      const lit = building(city.data, index).lit;
      total += lit;
      if (lit < 0.06) {
        dark += 1;
      }
    }
    const average = total / (city.count - 1);
    expect(average).toBeGreaterThan(0.05);
    expect(average).toBeLessThan(0.25);
    expect(dark / (city.count - 1)).toBeGreaterThan(0.1);
  });

  it("puts blinking aviation lights only on tall buildings", () => {
    const beacons = aviationBeacons(city);
    expect(beacons.count).toBeGreaterThan(20);
    for (let index = 0; index < beacons.count; index += 1) {
      expect(beacons.data[index * 4 + 1]!).toBeGreaterThan(70);
    }
  });
});
