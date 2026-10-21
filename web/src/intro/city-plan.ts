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

export const HERO_WINDOW = {
  x: 1.6,
  y: 7 * FLOOR_HEIGHT + FLOOR_HEIGHT * 0.5,
  z: HERO.maxZ + 0.04,
  width: 2.5,
  height: 2.2,
} as const;

export const ROOM = {
  deskHalfWidth: 11,
  deskHalfDepth: 7.5,
  deskThickness: 0.6,
  matHalfWidth: 10,
  matHalfDepth: 6.5,
  floorY: -5.2,
  ceilingY: 14,
  halfWidth: 24,
  backZ: -18,
  windowZ: 14,
  wallThickness: 1.4,
  windowHalfWidth: 6.5,
  windowBottom: 0.6,
  windowTop: 9.6,
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
    660 + 170 * Math.sin(x * 0.00105 + 0.6) + 55 * Math.sin(x * 0.0047 + 1.3)
  );
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
  [-950, -1450, 520, 1.0],
  [260, -520, 380, 0.75],
  [1300, -900, 420, 0.6],
  [-300, -2600, 700, 0.55],
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
      0.82,
    ],
  ];
  const radius = options.radius;
  const firstX = Math.floor((-radius - STREETS.originX) / STREETS.pitchX);
  const lastX = Math.ceil((radius - STREETS.originX) / STREETS.pitchX);
  const firstZ = Math.floor((-radius - STREETS.originZ) / STREETS.pitchZ);
  const lastZ = Math.ceil((900 - STREETS.originZ) / STREETS.pitchZ);
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
      if (Math.hypot(centreX, centreZ) > radius) {
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
        if (maxZ > shorelineZ(x) - 14 || maxZ > shorelineZ(minX) - 14 || maxZ > shorelineZ(maxX) - 14) {
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
        const lit =
          style === 2 ? 0.04 + 0.08 * random() : 0.22 + 0.5 * random();
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
