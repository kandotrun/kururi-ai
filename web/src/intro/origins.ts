import type { GeoPoint } from "../contracts";
import { type Random, shuffle } from "../core/random";
import { angularDistance, arcLift, latLonToVec3 } from "./geo-math";
import { GATHER } from "./timeline";

export const ARC_STRIDE = 8;

export interface ArcPlan {
  count: number;
  data: Float32Array;
  arrivals: Float32Array;
}

export interface ArcPlanOptions {
  cap: number;
  random: Random;
}

function validPoint(point: GeoPoint): boolean {
  return (
    Number.isFinite(point.lat) &&
    Number.isFinite(point.lon) &&
    Math.abs(point.lat) <= 90
  );
}

function awayFromAntipode(point: GeoPoint, target: GeoPoint): GeoPoint {
  if (angularDistance(point, target) < Math.PI - 0.012) {
    return point;
  }
  const lat = point.lat > 88 ? point.lat - 1.2 : point.lat + 1.2;
  return { lat, lon: point.lon };
}

export function planArcs(
  origins: readonly GeoPoint[],
  target: GeoPoint,
  options: ArcPlanOptions,
): ArcPlan {
  const valid = origins.filter(validPoint);
  const cap = Math.max(0, Math.floor(options.cap));
  const chosen =
    valid.length > cap ? shuffle(valid, options.random).slice(0, cap) : valid;
  const count = chosen.length;
  const data = new Float32Array(count * ARC_STRIDE);
  const arrivals = new Float32Array(count);
  const vector: [number, number, number] = [0, 0, 0];
  const arrivalSpan = GATHER.arrivalEnd - GATHER.arrivalStart;
  for (let index = 0; index < count; index += 1) {
    const origin = awayFromAntipode(chosen[index]!, target);
    const angle = angularDistance(origin, target);
    const reach = angle / Math.PI;
    const travel = 0.55 + 0.85 * reach;
    let arrival =
      GATHER.arrivalStart + arrivalSpan * Math.pow(options.random(), 0.7);
    let launch = arrival - travel;
    if (launch < GATHER.launchStart) {
      launch = GATHER.launchStart + 0.18 * options.random();
      arrival = Math.min(GATHER.arrivalEnd, launch + travel);
      launch = arrival - travel;
    }
    const lead = 0.2 + 0.4 * options.random();
    const light = Math.min(
      launch,
      Math.max(GATHER.lightStart + 0.25 * options.random(), launch - lead),
    );
    latLonToVec3(origin, vector);
    const base = index * ARC_STRIDE;
    data[base] = vector[0];
    data[base + 1] = vector[1];
    data[base + 2] = vector[2];
    data[base + 3] = Math.max(GATHER.lightStart, light);
    data[base + 4] = launch;
    data[base + 5] = travel;
    data[base + 6] = arcLift(angle) * (0.85 + 0.3 * options.random());
    data[base + 7] = options.random();
    arrivals[index] = launch + travel;
  }
  arrivals.sort();
  return { count, data, arrivals };
}

export function arrivedFraction(plan: ArcPlan, time: number): number {
  if (plan.count === 0) {
    return 0;
  }
  let low = 0;
  let high = plan.count;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (plan.arrivals[middle]! <= time) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low / plan.count;
}

export function lightWeights(
  pixels: ArrayLike<number>,
  width: number,
  height: number,
): Float32Array {
  const weights = new Float32Array(width * height);
  for (let index = 0; index < width * height; index += 1) {
    const r = pixels[index * 4]! / 255;
    const g = pixels[index * 4 + 1]! / 255;
    const b = pixels[index * 4 + 2]! / 255;
    const warm = r * 0.62 + g * 0.5 - b * 0.42 - 0.14;
    weights[index] = warm > 0 ? Math.pow(warm, 1.4) : 0;
  }
  return weights;
}

export function sampleWeightedPoints(
  weights: ArrayLike<number>,
  width: number,
  height: number,
  count: number,
  random: Random,
): GeoPoint[] {
  const cumulative = new Float64Array(width * height);
  let total = 0;
  for (let row = 0; row < height; row += 1) {
    const lat = 90 - ((row + 0.5) / height) * 180;
    const area = Math.cos((lat * Math.PI) / 180);
    for (let column = 0; column < width; column += 1) {
      const index = row * width + column;
      total += Math.max(0, weights[index] ?? 0) * area;
      cumulative[index] = total;
    }
  }
  if (!(total > 0)) {
    return [];
  }
  const points: GeoPoint[] = [];
  for (let sample = 0; sample < count; sample += 1) {
    const needle = random() * total;
    let low = 0;
    let high = cumulative.length - 1;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (cumulative[middle]! <= needle) {
        low = middle + 1;
      } else {
        high = middle;
      }
    }
    const row = Math.floor(low / width);
    const column = low - row * width;
    points.push({
      lat: 90 - ((row + random()) / height) * 180,
      lon: ((column + random()) / width) * 360 - 180,
    });
  }
  return points;
}
