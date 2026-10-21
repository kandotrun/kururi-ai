import type { GeoPoint } from "../contracts";

export type Vec3 = [number, number, number];

export interface LocalFrame {
  east: Vec3;
  north: Vec3;
  up: Vec3;
}

const DEG = Math.PI / 180;

export function latLonToVec3(point: GeoPoint, out: Vec3 = [0, 0, 0]): Vec3 {
  const lat = point.lat * DEG;
  const lon = point.lon * DEG;
  const ring = Math.cos(lat);
  out[0] = ring * Math.cos(lon);
  out[1] = Math.sin(lat);
  out[2] = -ring * Math.sin(lon);
  return out;
}

export function vec3ToLatLon(v: readonly number[]): GeoPoint {
  const x = v[0] ?? 0;
  const y = v[1] ?? 0;
  const z = v[2] ?? 0;
  const radius = Math.hypot(x, y, z) || 1;
  return {
    lat: Math.asin(Math.max(-1, Math.min(1, y / radius))) / DEG,
    lon: Math.atan2(-z, x) / DEG,
  };
}

export function equirectUv(point: GeoPoint): [number, number] {
  return [(point.lon + 180) / 360, (90 - point.lat) / 180];
}

export function angularDistance(a: GeoPoint, b: GeoPoint): number {
  const lat1 = a.lat * DEG;
  const lat2 = b.lat * DEG;
  const dLat = lat2 - lat1;
  const dLon = (b.lon - a.lon) * DEG;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

function anyPerpendicular(a: readonly number[], out: Vec3): Vec3 {
  const ax = Math.abs(a[0]!);
  const ay = Math.abs(a[1]!);
  const az = Math.abs(a[2]!);
  const reference: Vec3 =
    ax <= ay && ax <= az ? [1, 0, 0] : ay <= az ? [0, 1, 0] : [0, 0, 1];
  out[0] = a[1]! * reference[2] - a[2]! * reference[1];
  out[1] = a[2]! * reference[0] - a[0]! * reference[2];
  out[2] = a[0]! * reference[1] - a[1]! * reference[0];
  const length = Math.hypot(out[0], out[1], out[2]) || 1;
  out[0] /= length;
  out[1] /= length;
  out[2] /= length;
  return out;
}

export function slerpUnit(
  a: readonly number[],
  b: readonly number[],
  t: number,
  out: Vec3,
): Vec3 {
  const cosine = Math.max(
    -1,
    Math.min(1, a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!),
  );
  const angle = Math.acos(cosine);
  if (angle < 1e-6) {
    out[0] = a[0]!;
    out[1] = a[1]!;
    out[2] = a[2]!;
    return out;
  }
  if (Math.PI - angle < 1e-6) {
    const axis = anyPerpendicular(a, [0, 0, 0]);
    const phase = Math.PI * t;
    out[0] = a[0]! * Math.cos(phase) + axis[0] * Math.sin(phase);
    out[1] = a[1]! * Math.cos(phase) + axis[1] * Math.sin(phase);
    out[2] = a[2]! * Math.cos(phase) + axis[2] * Math.sin(phase);
    return out;
  }
  const sine = Math.sin(angle);
  const wa = Math.sin((1 - t) * angle) / sine;
  const wb = Math.sin(t * angle) / sine;
  out[0] = a[0]! * wa + b[0]! * wb;
  out[1] = a[1]! * wa + b[1]! * wb;
  out[2] = a[2]! * wa + b[2]! * wb;
  return out;
}

export function greatCircle(
  from: GeoPoint,
  to: GeoPoint,
  steps: number,
): GeoPoint[] {
  const a = latLonToVec3(from);
  const b = latLonToVec3(to);
  const out: Vec3 = [0, 0, 0];
  const points: GeoPoint[] = [];
  const count = Math.max(1, Math.floor(steps));
  for (let index = 0; index <= count; index += 1) {
    if (index === 0) {
      points.push({ lat: from.lat, lon: from.lon });
    } else if (index === count) {
      points.push({ lat: to.lat, lon: to.lon });
    } else {
      points.push(vec3ToLatLon(slerpUnit(a, b, index / count, out)));
    }
  }
  return points;
}

export function arcLift(angle: number): number {
  const reach = Math.max(0, Math.min(1, angle / Math.PI));
  return 0.012 + 0.2 * Math.pow(reach, 0.85);
}

export function localFrame(point: GeoPoint): LocalFrame {
  const lat = point.lat * DEG;
  const lon = point.lon * DEG;
  return {
    east: [-Math.sin(lon), 0, -Math.cos(lon)],
    north: [
      -Math.sin(lat) * Math.cos(lon),
      Math.cos(lat),
      Math.sin(lat) * Math.sin(lon),
    ],
    up: latLonToVec3(point),
  };
}

export function solarElevation(point: GeoPoint, subsolar: GeoPoint): number {
  const a = latLonToVec3(point);
  const b = latLonToVec3(subsolar);
  const cosine = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  return Math.asin(Math.max(-1, Math.min(1, cosine)));
}

function wrapLongitude(lon: number): number {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

export function subsolarForElevation(
  point: GeoPoint,
  elevation: number,
  declination: number,
  side: "evening" | "morning",
): GeoPoint {
  const lat = point.lat * DEG;
  const cosHour =
    (Math.sin(elevation) - Math.sin(lat) * Math.sin(declination)) /
    (Math.cos(lat) * Math.cos(declination));
  const hour = Math.acos(Math.max(-1, Math.min(1, cosHour))) / DEG;
  return {
    lat: declination / DEG,
    lon: wrapLongitude(side === "evening" ? point.lon - hour : point.lon + hour),
  };
}
