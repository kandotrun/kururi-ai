import type { GeoPlace, GeoPoint } from "../contracts";

type Vector = readonly [number, number, number];

const DEFAULT_LOCALE = "ja";
const CODE_PATTERN = /^[A-Z]{2}$/;
const CODE_ALIASES: Readonly<Record<string, string>> = {
  BU: "MM",
  DD: "DE",
  FX: "FR",
  TP: "TL",
  UK: "GB",
  ZR: "CD",
};
const NOT_COUNTRIES: ReadonlySet<string> = new Set([
  "AN",
  "CS",
  "EU",
  "EZ",
  "NT",
  "QO",
  "SU",
  "UN",
  "XA",
  "XB",
  "YU",
  "ZZ",
]);
const RADIANS = Math.PI / 180;
const EPSILON = 1e-9;
const namers = new Map<string, Intl.DisplayNames | null>();

export function normalizeCountryCode(raw: string): string | null {
  const upper = raw.trim().toUpperCase();
  const code = CODE_ALIASES[upper] ?? upper;
  if (!CODE_PATTERN.test(code) || NOT_COUNTRIES.has(code)) {
    return null;
  }
  return code;
}

function namer(locale: string): Intl.DisplayNames | null {
  const cached = namers.get(locale);
  if (cached !== undefined) {
    return cached;
  }
  let created: Intl.DisplayNames | null = null;
  try {
    if (typeof Intl.DisplayNames === "function") {
      created = new Intl.DisplayNames([locale], {
        type: "region",
        style: "short",
        fallback: "none",
      });
    }
  } catch {
    created = null;
  }
  namers.set(locale, created);
  return created;
}

function resolveCountryName(code: string, locale: string): string | null {
  const normalized = normalizeCountryCode(code);
  if (normalized === null) {
    return null;
  }
  try {
    return namer(locale)?.of(normalized) ?? null;
  } catch {
    return null;
  }
}

export function countryName(code: string, locale = DEFAULT_LOCALE): string {
  return resolveCountryName(code, locale) ?? code.toUpperCase();
}

function hemisphere(value: number, positive: string, negative: string): string {
  const degrees = Math.abs(value).toFixed(2);
  const prefix = value < 0 && Number(degrees) !== 0 ? negative : positive;
  return `${prefix} ${degrees}°`;
}

export function coordinateLabel(point: GeoPoint): string {
  return `${hemisphere(point.lat, "北緯", "南緯")} ${hemisphere(point.lon, "東経", "西経")}`;
}

export function placeLabel(place: GeoPlace | null | undefined): string | null {
  if (!place) {
    return null;
  }
  const name =
    place.country === null
      ? null
      : resolveCountryName(place.country, DEFAULT_LOCALE);
  return name ?? coordinateLabel(place);
}

function toVector(point: GeoPoint): Vector {
  const lat = point.lat * RADIANS;
  const lon = point.lon * RADIANS;
  return [
    Math.cos(lat) * Math.cos(lon),
    Math.cos(lat) * Math.sin(lon),
    Math.sin(lat),
  ];
}

function toPoint(vector: Vector): GeoPoint {
  const [x, y, z] = vector;
  const lon = Math.atan2(y, x) / RADIANS;
  return {
    lat: Math.atan2(z, Math.hypot(x, y)) / RADIANS,
    lon: lon <= -180 + EPSILON ? Math.min(180, lon + 360) : lon,
  };
}

function cross(left: Vector, right: Vector): Vector {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
}

function dot(left: Vector, right: Vector): number {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

function length(vector: Vector): number {
  return Math.hypot(vector[0], vector[1], vector[2]);
}

function scale(vector: Vector, factor: number): Vector {
  return [vector[0] * factor, vector[1] * factor, vector[2] * factor];
}

function rotationAxis(from: Vector, to: Vector): Vector {
  const axis = cross(from, to);
  const size = length(axis);
  if (size > EPSILON) {
    return scale(axis, 1 / size);
  }
  const helper: Vector = Math.abs(from[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const fallback = cross(from, helper);
  return scale(fallback, 1 / length(fallback));
}

export function angularDistance(from: GeoPoint, to: GeoPoint): number {
  const start = toVector(from);
  const end = toVector(to);
  return Math.atan2(length(cross(start, end)), dot(start, end));
}

export function greatCircle(
  from: GeoPoint,
  to: GeoPoint,
  steps: number,
): GeoPoint[] {
  if (!Number.isInteger(steps) || steps < 1) {
    throw new RangeError(`greatCircle needs a positive integer step count, got ${steps}`);
  }
  const start = toVector(from);
  const angle = angularDistance(from, to);
  const first: GeoPoint = { lat: from.lat, lon: from.lon };
  const last: GeoPoint = { lat: to.lat, lon: to.lon };
  if (angle < EPSILON) {
    return Array.from({ length: steps + 1 }, () => ({ ...first }));
  }
  const axis = rotationAxis(start, toVector(to));
  const normal = cross(axis, start);
  const points: GeoPoint[] = [first];
  for (let index = 1; index < steps; index += 1) {
    const turn = (angle * index) / steps;
    const cos = Math.cos(turn);
    const sin = Math.sin(turn);
    points.push(
      toPoint([
        start[0] * cos + normal[0] * sin,
        start[1] * cos + normal[1] * sin,
        start[2] * cos + normal[2] * sin,
      ]),
    );
  }
  points.push(last);
  return points;
}
