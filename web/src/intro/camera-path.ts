import type { GeoPoint } from "../contracts";
import { arrivalView, viewFov } from "../core/layout";
import { HERO_WINDOW } from "./city-plan";
import { clamp, monotoneSpline, smootherstep, vectorTrack } from "./easing";
import { type Vec3, latLonToVec3, localFrame } from "./geo-math";
import { ROOM } from "./room-plan";

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
const ROOM_WIDEN = 20;
const ROOM_NARROW: readonly [number, number] = [8.45, 9.3];

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
  return viewFov(aspect) / DEG;
}

export function defaultDeskView(aspect: number): DeskView {
  const view = arrivalView(aspect);
  return {
    targetX: view.targetX,
    targetZ: view.targetZ,
    distance: view.distance,
    pitch: view.pitch,
    yaw: view.yaw,
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

export function earthFrameDistance(
  aspect: number,
  fovDegrees: number,
  heightFraction: number,
  widthFraction: number,
): number {
  const halfTan = Math.tan((fovDegrees * DEG) / 2);
  const tanAlpha = Math.min(
    heightFraction * halfTan,
    widthFraction * halfTan * aspect,
  );
  return 1 / Math.sin(Math.atan(tanAlpha));
}

export function createCameraPath(
  aspect: number,
  target: GeoPoint,
  view: DeskView,
): CameraPath {
  const fov = fovForAspect(aspect);
  const framed = (height: number, width: number) =>
    Math.log(
      (earthFrameDistance(aspect, fov, height, width) - 1) * EARTH_RADIUS_M,
    );
  const radius = (altitude: number) => Math.log(altitude * EARTH_RADIUS_M);
  const city = (distance: number) => Math.log(distance / CITY_SCALE);
  const logDistance = monotoneSpline([
    { t: 0, v: framed(0.46, 0.8) },
    { t: 1.0, v: framed(0.5, 0.84) },
    { t: 2.4, v: framed(0.58, 0.9) },
    { t: 3.5, v: framed(0.7, 1.0) },
    { t: 4.3, v: radius(1.1) },
    { t: 4.95, v: radius(0.3) },
    { t: 5.45, v: radius(0.05) },
    { t: 6.0, v: radius(0.0045) },
    { t: 6.45, v: city(1250) },
    { t: 7.05, v: city(300) },
    { t: 7.45, v: city(55) },
    { t: 7.82, v: city(1.5) },
    { t: 8.15, v: city(0.3) },
  ]);
  const subPoint = vectorTrack([
    { t: 0, v: [10.3, -53.8] },
    { t: 1.0, v: [9.6, -48.5] },
    { t: 2.4, v: [7.6, -37] },
    { t: 3.5, v: [3.6, -21] },
    { t: 4.3, v: [-1.4, -7.5] },
    { t: 4.95, v: [-0.9, -1.3] },
    { t: 5.45, v: [-0.32, -0.08] },
    { t: 6.0, v: [-0.26, -0.012] },
    { t: 6.6, v: [-0.1, 0] },
  ]);
  const lookWeight = monotoneSpline([
    { t: 0, v: 0 },
    { t: 3.0, v: 0.04 },
    { t: 3.6, v: 0.3 },
    { t: 4.3, v: 0.88 },
    { t: 4.95, v: 1, slope: 0 },
  ]);
  const raise = monotoneSpline([
    { t: 0, v: 0.08 },
    { t: 2.6, v: 0.1 },
    { t: 3.6, v: 0.05 },
    { t: 4.3, v: 0, slope: 0 },
  ]);
  const elevation = monotoneSpline([
    { t: 5.9, v: 47 },
    { t: 6.05, v: 46 },
    { t: 6.5, v: 31 },
    { t: 7.1, v: 13 },
    { t: 7.45, v: 5 },
    { t: 7.82, v: 1 },
    { t: 8.15, v: 0.5 },
  ]);
  const azimuth = monotoneSpline([
    { t: 5.9, v: 13 },
    { t: 6.5, v: 10 },
    { t: 7.1, v: 6 },
    { t: 7.45, v: 2 },
    { t: 7.82, v: 0 },
  ]);
  const lookAhead = monotoneSpline([
    { t: 5.9, v: 0 },
    { t: 6.05, v: 0 },
    { t: 6.5, v: 380 },
    { t: 7.1, v: 160 },
    { t: 7.45, v: 10 },
    { t: 7.65, v: 0 },
  ]);
  const end = deskViewPose(view, aspect, createCameraPose());
  const [ex, ey, ez] = end.position;
  const [tx, ty, tz] = end.target;
  const entryX = ROOM.entryWindow.centerX;
  const roomPosition = vectorTrack([
    { t: 7.78, v: [entryX + 0.2, 8.6, ROOM.entryZ + 6.5] },
    { t: 8.04, v: [entryX, 8.5, ROOM.entryZ - 2.0] },
    { t: 8.5, v: [entryX * 0.5, 8.0, ROOM.entryZ - 4.4] },
    { t: 8.98, v: [ex * 0.7 + 0.05, ey * 0.62 + 6.6 * 0.38, ez * 0.62 + 8.4 * 0.38] },
    { t: 9.4, v: [ex, ey, ez], slope: [0, 0, 0] },
  ]);
  const roomTarget = vectorTrack([
    { t: 7.78, v: [0.2, 1.6, -4.4] },
    { t: 8.04, v: [0.1, 1.1, -4.2] },
    { t: 8.5, v: [0.05, 0.6, -3.5] },
    { t: 8.98, v: [tx * 0.8, 0.08, tz * 0.8 - 0.7] },
    { t: 9.4, v: [tx, ty, tz], slope: [0, 0, 0] },
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
      const lift = raise(time);
      set(
        out.target,
        focus[0] * weight,
        focus[1] * weight + lift,
        focus[2] * weight,
      );
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
      out.fov =
        fov +
        ROOM_WIDEN * (1 - smootherstep(ROOM_NARROW[0], ROOM_NARROW[1], time));
      out.near = 0.08;
      out.far = 300;
      return out;
    },
  };
}
