import type { Random } from "../core/random";

export const BUILDING_STRIDE = 8;

export const STREETS = {
  pitchX: 112,
  pitchZ: 96,
  originX: 56,
  originZ: 16,
  width: 14,
  avenueWidth: 30,
  avenueEvery: 4,
} as const;

export const FLOOR_HEIGHT = 3.7;

export const HERO = {
  minX: -16,
  maxX: 16,
  minZ: -24,
  maxZ: 0,
  height: 14 * FLOOR_HEIGHT,
  bay: 3.2,
} as const;

export const PORTAL_SCALE = 4.8;
export const HERO_FRAME = 0.1;

export const HERO_GLASS = {
  width: 13 / PORTAL_SCALE,
  height: 9.6 / PORTAL_SCALE,
} as const;

export const HERO_WINDOW = {
  x: 1.6,
  y: 7 * FLOOR_HEIGHT + FLOOR_HEIGHT * 0.5,
  z: HERO.maxZ + 0.04,
  width: HERO_GLASS.width + 2 * HERO_FRAME,
  height: HERO_GLASS.height + 2 * HERO_FRAME,
} as const;

export const CORRIDOR = {
  minX: -110,
  maxX: 150,
  minZ: 0,
  maxZ: 420,
  maxHeight: 12,
} as const;

export interface CityLayout {
  count: number;
  data: Float32Array;
}

export interface CityOptions {
  radius: number;
  maxBuildings: number;
}

export function shorelineZ(x: number): number {
  return (
    -1950 + 240 * Math.sin(x * 0.0009 + 0.4) + 70 * Math.sin(x * 0.004 + 1.1)
  );
}

export interface ExpresswayPoint {
  x: number;
  y: number;
  z: number;
}

export interface Expressway {
  width: number;
  points: readonly ExpresswayPoint[];
}

export const EXPRESSWAYS: readonly Expressway[] = [
  {
    width: 18,
    points: [
      { x: -2700, y: 15, z: -230 },
      { x: -1500, y: 15, z: -330 },
      { x: -700, y: 17, z: -190 },
      { x: -150, y: 18, z: -150 },
      { x: 420, y: 18, z: -300 },
      { x: 1100, y: 16, z: -620 },
      { x: 2600, y: 15, z: -980 },
    ],
  },
  {
    width: 16,
    points: [
      { x: -1000, y: 13, z: 1700 },
      { x: -820, y: 13, z: 900 },
      { x: -690, y: 15, z: 250 },
      { x: -520, y: 16, z: -500 },
      { x: -380, y: 15, z: -1200 },
      { x: -300, y: 22, z: -1750 },
      { x: -150, y: 34, z: -2300 },
    ],
  },
];

function catmullRom(a: number, b: number, c: number, d: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    0.5 *
    (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3)
  );
}

export function sampleExpressway(road: Expressway, steps: number): ExpresswayPoint[] {
  const points = road.points;
  const count = Math.max(1, Math.floor(steps));
  const segments = points.length - 1;
  const samples: ExpresswayPoint[] = [];
  for (let index = 0; index <= count; index += 1) {
    const u = (index / count) * segments;
    const segment = Math.min(segments - 1, Math.floor(u));
    const t = u - segment;
    const p0 = points[Math.max(0, segment - 1)]!;
    const p1 = points[segment]!;
    const p2 = points[segment + 1]!;
    const p3 = points[Math.min(points.length - 1, segment + 2)]!;
    samples.push({
      x: catmullRom(p0.x, p1.x, p2.x, p3.x, t),
      y: catmullRom(p0.y, p1.y, p2.y, p3.y, t),
      z: catmullRom(p0.z, p1.z, p2.z, p3.z, t),
    });
  }
  return samples;
}

const EXPRESSWAY_SAMPLES = EXPRESSWAYS.map((road) => ({
  width: road.width,
  points: sampleExpressway(road, 240),
}));

export function expresswayDistance(x: number, z: number): number {
  let best = Number.POSITIVE_INFINITY;
  for (const road of EXPRESSWAY_SAMPLES) {
    for (let index = 1; index < road.points.length; index += 1) {
      const a = road.points[index - 1]!;
      const b = road.points[index]!;
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const length2 = dx * dx + dz * dz;
      const t = length2 > 0 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / length2)) : 0;
      const distance = Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t)) - road.width / 2;
      best = Math.min(best, distance);
    }
  }
  return best;
}

function streetWidth(index: number): number {
  return index % STREETS.avenueEvery === 0
    ? STREETS.avenueWidth
    : STREETS.width;
}

export function streetDistance(x: number, z: number): number {
  const ix = Math.round((x - STREETS.originX) / STREETS.pitchX);
  const iz = Math.round((z - STREETS.originZ) / STREETS.pitchZ);
  const dx = Math.abs(x - (STREETS.originX + ix * STREETS.pitchX));
  const dz = Math.abs(z - (STREETS.originZ + iz * STREETS.pitchZ));
  return Math.min(dx, dz);
}

function hash2(x: number, z: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(z | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function valueNoise(x: number, z: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz);
  const b = hash2(ix + 1, iz);
  const c = hash2(ix, iz + 1);
  const d = hash2(ix + 1, iz + 1);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}

const CLUSTERS: readonly (readonly [number, number, number, number])[] = [
  [-700, -820, 430, 1.0],
  [620, -1180, 380, 0.85],
  [-220, -420, 260, 0.55],
  [1450, -560, 460, 0.5],
];

function density(x: number, z: number): number {
  let value = 0.22 + 0.35 * valueNoise(x / 650 + 11, z / 650 + 3);
  for (const [cx, cz, radius, weight] of CLUSTERS) {
    const dx = (x - cx) / radius;
    const dz = (z - cz) / radius;
    value += weight * Math.exp(-(dx * dx + dz * dz));
  }
  return Math.min(1.4, value);
}

interface Lot {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

function splitLots(lot: Lot, random: Random, out: Lot[], depth = 0): void {
  const width = lot.maxX - lot.minX;
  const length = lot.maxZ - lot.minZ;
  const target = 22 + 30 * random();
  if ((width < target && length < target) || depth > 5) {
    out.push(lot);
    return;
  }
  const ratio = 0.36 + 0.28 * random();
  if (width >= length) {
    const cut = lot.minX + width * ratio;
    splitLots({ ...lot, maxX: cut }, random, out, depth + 1);
    splitLots({ ...lot, minX: cut }, random, out, depth + 1);
  } else {
    const cut = lot.minZ + length * ratio;
    splitLots({ ...lot, maxZ: cut }, random, out, depth + 1);
    splitLots({ ...lot, minZ: cut }, random, out, depth + 1);
  }
}

function overlapsHero(lot: Lot, gap: number): boolean {
  return (
    lot.maxX > HERO.minX - gap &&
    lot.minX < HERO.maxX + gap &&
    lot.maxZ > HERO.minZ - gap &&
    lot.minZ < HERO.maxZ + gap
  );
}

function inCorridor(lot: Lot): boolean {
  return (
    lot.maxX > CORRIDOR.minX &&
    lot.minX < CORRIDOR.maxX &&
    lot.maxZ > CORRIDOR.minZ &&
    lot.minZ < CORRIDOR.maxZ
  );
}

function pickHeight(x: number, z: number, random: Random): number {
  const d = density(x, z);
  const roll = random();
  if (roll < 0.05 * d * d) {
    return 110 + 130 * random();
  }
  if (roll < 0.22 * d) {
    return 45 + 60 * random();
  }
  if (roll < 0.6) {
    return 14 + 30 * d * random();
  }
  return 7 + 14 * random();
}

export function buildCity(random: Random, options: CityOptions): CityLayout {
  const rows: number[][] = [
    [
      (HERO.minX + HERO.maxX) / 2,
      (HERO.minZ + HERO.maxZ) / 2,
      HERO.maxX - HERO.minX,
      HERO.maxZ - HERO.minZ,
      HERO.height,
      3,
      0.5,
      0.3,
    ],
  ];
  const radius = options.radius;
  const firstX = Math.floor((-radius - STREETS.originX) / STREETS.pitchX);
  const lastX = Math.ceil((radius - STREETS.originX) / STREETS.pitchX);
  const firstZ = Math.floor((-2700 - STREETS.originZ) / STREETS.pitchZ);
  const lastZ = Math.ceil((1600 - STREETS.originZ) / STREETS.pitchZ);
  const lots: Lot[] = [];
  for (let ix = firstX; ix < lastX; ix += 1) {
    const left = STREETS.originX + ix * STREETS.pitchX + streetWidth(ix) / 2;
    const right =
      STREETS.originX + (ix + 1) * STREETS.pitchX - streetWidth(ix + 1) / 2;
    for (let iz = firstZ; iz < lastZ; iz += 1) {
      const top = STREETS.originZ + iz * STREETS.pitchZ + streetWidth(iz) / 2;
      const bottom =
        STREETS.originZ + (iz + 1) * STREETS.pitchZ - streetWidth(iz + 1) / 2;
      const centreX = (left + right) / 2;
      const centreZ = (top + bottom) / 2;
      if (Math.hypot(centreX, centreZ * 0.8) > radius) {
        continue;
      }
      lots.length = 0;
      splitLots(
        { minX: left, maxX: right, minZ: top, maxZ: bottom },
        random,
        lots,
      );
      for (const lot of lots) {
        if (overlapsHero(lot, 2) || random() < 0.07) {
          continue;
        }
        const setback = 1.2 + 3 * random();
        const minX = lot.minX + setback;
        const maxX = lot.maxX - setback;
        const minZ = lot.minZ + setback;
        const maxZ = lot.maxZ - setback;
        const width = maxX - minX;
        const depth = maxZ - minZ;
        if (width < 6 || depth < 6) {
          continue;
        }
        const x = (minX + maxX) / 2;
        const z = (minZ + maxZ) / 2;
        if (minZ < shorelineZ(x) + 14 || minZ < shorelineZ(minX) + 14 || minZ < shorelineZ(maxX) + 14) {
          continue;
        }
        if (expresswayDistance(x, z) < Math.hypot(width, depth) / 2 + 4) {
          continue;
        }
        const corridor = inCorridor({ minX, maxX, minZ, maxZ });
        if (corridor && random() < 0.55) {
          continue;
        }
        let height = pickHeight(x, z, random);
        if (corridor) {
          height = 6 + (CORRIDOR.maxHeight - 6) * random();
        }
        const tall = height > 45;
        const style = height < 9 && random() < 0.4 ? 2 : tall || random() < 0.45 ? 0 : 1;
        const dark = random() < 0.16;
        const lit = dark
          ? 0.01 + 0.03 * random()
          : style === 2
            ? 0.03 + 0.07 * random()
            : style === 0
              ? 0.07 + 0.3 * Math.pow(random(), 1.6)
              : 0.06 + 0.2 * random();
        rows.push([x, z, width, depth, height, style, random(), lit]);
      }
    }
  }
  const hero = rows[0]!;
  const rest = rows.slice(1);
  rest.sort((a, b) => Math.hypot(a[0]!, a[1]!) - Math.hypot(b[0]!, b[1]!));
  const kept = [hero, ...rest].slice(0, Math.max(1, options.maxBuildings));
  const data = new Float32Array(kept.length * BUILDING_STRIDE);
  kept.forEach((row, index) => {
    data.set(row, index * BUILDING_STRIDE);
  });
  return { count: kept.length, data };
}

export interface BeaconLayout {
  count: number;
  data: Float32Array;
}

export function aviationBeacons(layout: CityLayout): BeaconLayout {
  const rows: number[] = [];
  for (let index = 1; index < layout.count; index += 1) {
    const base = index * BUILDING_STRIDE;
    const height = layout.data[base + 4]!;
    if (height < 72) {
      continue;
    }
    const x = layout.data[base]!;
    const z = layout.data[base + 1]!;
    const width = layout.data[base + 2]!;
    const depth = layout.data[base + 3]!;
    const seed = layout.data[base + 6]!;
    rows.push(x - width * 0.4, height + 1.2, z - depth * 0.4, seed);
    if (height > 120) {
      rows.push(x + width * 0.4, height + 1.2, z + depth * 0.4, seed + 0.5);
    }
  }
  return { count: rows.length / 4, data: new Float32Array(rows) };
}
