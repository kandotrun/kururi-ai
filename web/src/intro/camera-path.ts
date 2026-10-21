import type { GeoPoint } from "../contracts";
import { HERO_WINDOW, ROOM } from "./city-plan";
import { clamp, monotoneSpline, vectorTrack } from "./easing";
import { type Vec3, latLonToVec3, localFrame } from "./geo-math";

export interface CameraPose {
  position: Vec3;
  target: Vec3;
  up: Vec3;
  fov: number;
  near: number;
  far: number;
}

export interface DeskView {
  targetX: number;
  targetZ: number;
  distance: number;
  pitch: number;
  yaw: number;
}

export interface CameraPath {
  readonly aspect: number;
  globe(time: number, out: CameraPose): CameraPose;
  city(time: number, out: CameraPose): CameraPose;
  room(time: number, out: CameraPose): CameraPose;
}

const DEG = Math.PI / 180;
export const EARTH_RADIUS_M = 6_371_000;
const CITY_SCALE = 3400 / (0.0045 * EARTH_RADIUS_M);
const DESK_PITCH = 54 * DEG;
const DESK_YAW = -7 * DEG;

export function createCameraPose(): CameraPose {
  return {
    position: [0, 0, 1],
    target: [0, 0, 0],
    up: [0, 1, 0],
    fov: 32,
    near: 0.1,
    far: 100,
  };
}

export function fovForAspect(aspect: number): number {
  const portrait = clamp((1.2 - aspect) / 0.75, 0, 1);
  return 32 + portrait * 9;
}

function fitDistance(
  width: number,
  depth: number,
  pitch: number,
  fovY: number,
  aspect: number,
): number {
  const halfTan = Math.tan(fovY / 2);
  const halfDepth = depth / 2;
  const vertical = halfDepth * (Math.sin(pitch) / halfTan + Math.cos(pitch));
  const horizontal =
    width / 2 / (halfTan * Math.max(0.1, aspect)) +
    halfDepth * Math.cos(pitch);
  return Math.max(vertical, horizontal);
}

export function defaultDeskView(aspect: number): DeskView {
  const safeAspect = Math.max(0.2, aspect);
  const width = 6.4;
  const depth = Math.max((width / safeAspect) * 0.8, 3.6);
  return {
    targetX: 0,
    targetZ: 0.4,
    distance: fitDistance(
      width,
      depth,
      DESK_PITCH,
      fovForAspect(safeAspect) * DEG,
      safeAspect,
    ),
    pitch: DESK_PITCH,
    yaw: DESK_YAW,
  };
}

function set(out: Vec3, x: number, y: number, z: number): Vec3 {
  out[0] = x;
  out[1] = y;
  out[2] = z;
  return out;
}

export function deskViewPose(
  view: DeskView,
  aspect: number,
  out: CameraPose,
): CameraPose {
  const horizontal = view.distance * Math.cos(view.pitch);
  set(
    out.position,
    view.targetX + Math.sin(view.yaw) * horizontal,
    view.distance * Math.sin(view.pitch),
    view.targetZ + Math.cos(view.yaw) * horizontal,
  );
  set(out.target, view.targetX, 0, view.targetZ);
  set(out.up, 0, 1, 0);
  out.fov = fovForAspect(aspect);
  out.near = Math.max(0.05, view.distance * 0.04);
  out.far = 400;
  return out;
}

function earthStartDistance(aspect: number, fovDegrees: number): number {
  const halfTan = Math.tan((fovDegrees * DEG) / 2);
  const tanAlpha = Math.min(0.45 * halfTan, 0.8 * halfTan * aspect);
  return 1 / Math.sin(Math.atan(tanAlpha));
}

export function createCameraPath(
  aspect: number,
  target: GeoPoint,
  view: DeskView,
): CameraPath {
  const fov = fovForAspect(aspect);
  const startAltitude =
    (earthStartDistance(aspect, fov) - 1) * EARTH_RADIUS_M;
  const radius = (altitude: number) => Math.log(altitude * EARTH_RADIUS_M);
  const city = (distance: number) => Math.log(distance / CITY_SCALE);
  const logDistance = monotoneSpline([
    { t: 0, v: Math.log(startAltitude) },
    { t: 1.6, v: Math.log(startAltitude) - 0.24 },
    { t: 3.2, v: radius(2.25) },
    { t: 4.2, v: radius(0.42) },
    { t: 4.9, v: radius(0.055) },
    { t: 5.55, v: radius(0.0045) },
    { t: 6.0, v: city(1250) },
    { t: 6.6, v: city(300) },
    { t: 7.0, v: city(55) },
    { t: 7.36, v: city(1.5) },
    { t: 7.7, v: city(0.3) },
  ]);
  const subPoint = vectorTrack([
    { t: 0, v: [-20.2, -23.3] },
    { t: 1.6, v: [-16.7, -17.8] },
    { t: 3.2, v: [-10.2, -7.8] },
    { t: 4.2, v: [-3.9, -1.6] },
    { t: 4.9, v: [-0.98, -0.3] },
    { t: 5.55, v: [-0.26, -0.012] },
    { t: 6.2, v: [-0.1, 0] },
  ]);
  const lookWeight = monotoneSpline([
    { t: 0, v: 0 },
    { t: 1.6, v: 0.1 },
    { t: 3.2, v: 0.55 },
    { t: 4.2, v: 0.93 },
    { t: 4.9, v: 1, slope: 0 },
  ]);
  const elevation = monotoneSpline([
    { t: 5.4, v: 47 },
    { t: 5.55, v: 46 },
    { t: 6.0, v: 31 },
    { t: 6.6, v: 13 },
    { t: 7.0, v: 5 },
    { t: 7.36, v: 1 },
    { t: 7.7, v: 0.5 },
  ]);
  const azimuth = monotoneSpline([
    { t: 5.4, v: 13 },
    { t: 6.0, v: 10 },
    { t: 6.6, v: 6 },
    { t: 7.0, v: 2 },
    { t: 7.36, v: 0 },
  ]);
  const lookAhead = monotoneSpline([
    { t: 5.4, v: 0 },
    { t: 5.55, v: 0 },
    { t: 6.0, v: 380 },
    { t: 6.6, v: 160 },
    { t: 7.0, v: 10 },
    { t: 7.2, v: 0 },
  ]);
  const end = deskViewPose(view, aspect, createCameraPose());
  const [ex, ey, ez] = end.position;
  const [tx, ty, tz] = end.target;
  const roomPosition = vectorTrack([
    { t: 7.3, v: [0.6, 5.0, ROOM.windowZ + 9.5] },
    { t: 7.55, v: [0.25, 5.1, ROOM.windowZ - 1.6] },
    { t: 8.3, v: [ex * 0.55, ey * 0.4 + 5.4 * 0.6, ez * 0.6 + 9.2 * 0.4] },
    { t: 9.0, v: [ex, ey, ez], slope: [0, 0, 0] },
  ]);
  const roomTarget = vectorTrack([
    { t: 7.3, v: [0, 3.0, 0] },
    { t: 7.55, v: [0, 1.8, -0.5] },
    { t: 8.3, v: [tx * 0.7, 0.45, tz * 0.7 - 0.1] },
    { t: 9.0, v: [tx, ty, tz], slope: [0, 0, 0] },
  ]);
  const frame = localFrame(target);
  const focus = latLonToVec3(target);
  const scratch = [0, 0, 0];
  const sub: Vec3 = [0, 0, 0];

  return {
    aspect,
    globe(time, out) {
      const altitude = Math.exp(logDistance(time)) / EARTH_RADIUS_M;
      subPoint(time, scratch);
      latLonToVec3(
        { lat: target.lat + scratch[0]!, lon: target.lon + scratch[1]! },
        sub,
      );
      const distance = 1 + altitude;
      set(out.position, sub[0] * distance, sub[1] * distance, sub[2] * distance);
      const weight = lookWeight(time);
      set(out.target, focus[0] * weight, focus[1] * weight, focus[2] * weight);
      const ux = frame.north[0] * weight;
      const uy = 1 - weight + frame.north[1] * weight;
      const uz = frame.north[2] * weight;
      const length = Math.hypot(ux, uy, uz) || 1;
      set(out.up, ux / length, uy / length, uz / length);
      out.fov = fov;
      out.near = Math.max(2e-6, altitude * 0.05);
      out.far = distance + 3;
      return out;
    },
    city(time, out) {
      const distance = Math.exp(logDistance(time)) * CITY_SCALE;
      const theta = elevation(time) * DEG;
      const psi = azimuth(time) * DEG;
      const flat = distance * Math.cos(theta);
      set(
        out.position,
        HERO_WINDOW.x + flat * Math.sin(psi),
        HERO_WINDOW.y + distance * Math.sin(theta),
        HERO_WINDOW.z + flat * Math.cos(psi),
      );
      set(
        out.target,
        HERO_WINDOW.x,
        HERO_WINDOW.y,
        HERO_WINDOW.z - lookAhead(time),
      );
      set(out.up, 0, 1, 0);
      out.fov = fov;
      out.near = clamp(distance * 0.08, 0.04, 40);
      out.far = 60000;
      return out;
    },
    room(time, out) {
      roomPosition(time, scratch);
      set(out.position, scratch[0]!, scratch[1]!, scratch[2]!);
      roomTarget(time, scratch);
      set(out.target, scratch[0]!, scratch[1]!, scratch[2]!);
      set(out.up, 0, 1, 0);
      out.fov = fov;
      out.near = 0.08;
      out.far = 300;
      return out;
    },
  };
}
