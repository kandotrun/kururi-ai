import type { PerspectiveCamera } from "three";
import {
  ARRIVAL_WIDTH,
  DESK_YAW,
  type DeskBounds,
  arrivalView,
  compositionShift,
  fitDistance,
  followMargin,
  shiftedFit,
  viewFov,
} from "../core/layout";
import { type Spring, springSettled, springStep } from "../core/motion";

export type CameraMode = "follow" | "reveal" | "focus" | "user";

export interface DirectorFrame {
  now: number;
  dt: number;
  frontX: number;
  frontZ: number;
  bandMinX: number;
  bandMaxX: number;
  bandMinZ: number;
  bandMaxZ: number;
  bandCount: number;
  prints: number;
  placed: number;
  lastPlacedAt: number;
  bounds: DeskBounds;
  focusX: number;
  focusZ: number;
  hasFocus: boolean;
  holdWide: boolean;
  viewWidth: number;
  viewHeight: number;
}

interface Target {
  x: number;
  z: number;
  distance: number;
  yaw: number;
  pitch: number;
  omega: number;
  radius: number;
  shiftX: number;
  shiftY: number;
}

const DEG = Math.PI / 180;
const FOLLOW_PITCH = 54 * DEG;
const REVEAL_PITCH = 58 * DEG;
const FOCUS_PITCH = 58 * DEG;
const BASE_YAW = DESK_YAW;
const REVEAL_EVERY_PLACED = 300;
const REVEAL_EVERY_SECONDS = 25;
const REVEAL_SECONDS = 6;
const REVEAL_MIN_PLACED = 60;
const IDLE_WIDE_SECONDS = 7;
const USER_IDLE_SECONDS = 8;
const MIN_DISTANCE = 2.2;
const MIN_PITCH = 34 * DEG;
const MAX_PITCH = 80 * DEG;
const MAX_USER_YAW = 40 * DEG;
const ARRIVAL_RADIUS = 2.8;
const ARRIVAL_OMEGA = 1.35;
const FOLLOW_GROWTH = 1.0;
const BAND_FRONT_PAD = 0.3;
const OPEN_FRONT_PAD = 1.1;
const NEAR_MARGIN_SCALE = 1.45;

function spring(value: number): Spring {
  return { value, velocity: 0 };
}

export class CameraDirector {
  readonly camera: PerspectiveCamera;
  mode: CameraMode = "follow";
  private reduced: boolean;
  private readonly x = spring(0);
  private readonly z = spring(0.4);
  private readonly logDistance = spring(Math.log(7));
  private readonly yaw = spring(BASE_YAW);
  private readonly pitch = spring(FOLLOW_PITCH);
  private readonly radius = spring(5);
  private readonly parallaxX = spring(0);
  private readonly parallaxY = spring(0);
  private readonly shiftX = spring(0);
  private readonly shiftY = spring(0);
  private readonly target: Target = {
    x: 0,
    z: 0.4,
    distance: 7,
    yaw: BASE_YAW,
    pitch: FOLLOW_PITCH,
    omega: 1.3,
    radius: 5,
    shiftX: 0,
    shiftY: 0,
  };
  private readonly user: Target = {
    x: 0,
    z: 0,
    distance: 10,
    yaw: BASE_YAW,
    pitch: FOLLOW_PITCH,
    omega: 7,
    radius: 6,
    shiftX: 0,
    shiftY: 0,
  };
  private pointerX = 0;
  private pointerY = 0;
  private revealUntil = 0;
  private lastRevealAt = 0;
  private lastRevealPlaced = 0;
  private lastUserInput = Number.NEGATIVE_INFINITY;
  private heldX = 0;
  private heldZ = 0;
  private heldDistance = 0;
  private lastMode: CameraMode = "follow";
  private maxDistance = 400;
  private lastFov = 0;
  private lastNear = 0;
  private lastAspect = 0;
  private lastShiftX = Number.NaN;
  private lastShiftY = Number.NaN;
  private initialised = false;

  constructor(camera: PerspectiveCamera, reducedMotion: boolean) {
    this.camera = camera;
    this.reduced = reducedMotion;
  }

  setReducedMotion(reduced: boolean): void {
    this.reduced = reduced;
    if (reduced) {
      this.parallaxX.value = 0;
      this.parallaxY.value = 0;
    }
  }

  setMaxDistance(distance: number): void {
    this.maxDistance = distance;
  }

  pointer(normalizedX: number, normalizedY: number): void {
    this.pointerX = normalizedX;
    this.pointerY = normalizedY;
  }

  orbit(deltaX: number, deltaY: number, now: number): void {
    this.enterUser(now);
    this.user.yaw = Math.max(
      BASE_YAW - MAX_USER_YAW,
      Math.min(BASE_YAW + MAX_USER_YAW, this.user.yaw - deltaX * 0.0042),
    );
    this.user.pitch = Math.max(
      MIN_PITCH,
      Math.min(MAX_PITCH, this.user.pitch + deltaY * 0.0036),
    );
  }

  pan(deltaX: number, deltaY: number, now: number): void {
    this.enterUser(now);
    const scale = this.user.distance * 0.0016;
    const cos = Math.cos(this.user.yaw);
    const sin = Math.sin(this.user.yaw);
    this.user.x -= (deltaX * cos + deltaY * sin) * scale;
    this.user.z -= (-deltaX * sin + deltaY * cos) * scale;
  }

  zoom(factor: number, now: number): void {
    this.enterUser(now);
    this.user.distance = Math.max(
      MIN_DISTANCE,
      Math.min(this.maxDistance, this.user.distance * factor),
    );
  }

  resetToAuto(): void {
    this.lastUserInput = Number.NEGATIVE_INFINITY;
    this.mode = "follow";
  }

  secondsUntilNextCue(
    now: number,
    placed: number,
    lastPlacedAt: number,
  ): number | null {
    let next = Number.POSITIVE_INFINITY;
    if (this.mode === "user") {
      next = Math.min(next, this.lastUserInput + USER_IDLE_SECONDS);
    }
    if (this.mode === "reveal" && this.revealUntil > now) {
      next = Math.min(next, this.revealUntil);
    }
    if (this.mode === "follow" && placed > 0) {
      next = Math.min(next, lastPlacedAt + IDLE_WIDE_SECONDS);
    }
    if (!Number.isFinite(next) || next <= now) {
      return null;
    }
    return next - now;
  }

  update(frame: DirectorFrame): boolean {
    const mode = this.chooseMode(frame);
    this.mode = mode;
    this.computeTarget(mode, frame);
    const target = this.target;
    const cut =
      !this.initialised ||
      (this.reduced &&
        mode !== "user" &&
        (mode !== this.lastMode || this.shouldRecut()));
    this.lastMode = mode;
    if (cut) {
      this.snap();
      this.initialised = true;
    }
    const omega = target.omega;
    const dt = frame.dt;
    springStep(this.x, target.x, omega, dt);
    springStep(this.z, target.z, omega, dt);
    springStep(this.logDistance, Math.log(target.distance), omega * 0.9, dt);
    springStep(this.yaw, target.yaw, omega, dt);
    springStep(this.pitch, target.pitch, omega, dt);
    springStep(this.radius, target.radius, omega, dt);
    springStep(this.shiftX, target.shiftX, omega, dt);
    springStep(this.shiftY, target.shiftY, omega, dt);
    const parallaxGoalX = this.reduced ? 0 : this.pointerX;
    const parallaxGoalY = this.reduced ? 0 : this.pointerY;
    springStep(this.parallaxX, parallaxGoalX, 2.6, dt);
    springStep(this.parallaxY, parallaxGoalY, 2.6, dt);
    this.apply(frame.viewWidth, frame.viewHeight);
    const epsilon = 0.0008;
    return !(
      springSettled(this.x, target.x, epsilon * target.distance) &&
      springSettled(this.z, target.z, epsilon * target.distance) &&
      springSettled(this.logDistance, Math.log(target.distance), epsilon) &&
      springSettled(this.yaw, target.yaw, epsilon) &&
      springSettled(this.pitch, target.pitch, epsilon) &&
      springSettled(this.shiftX, target.shiftX, 0.0005) &&
      springSettled(this.shiftY, target.shiftY, 0.0005) &&
      springSettled(this.parallaxX, parallaxGoalX, 0.002) &&
      springSettled(this.parallaxY, parallaxGoalY, 0.002)
    );
  }

  get targetX(): number {
    return this.x.value;
  }

  get targetZ(): number {
    return this.z.value;
  }

  get distance(): number {
    return Math.exp(this.logDistance.value);
  }

  get frameRadius(): number {
    return this.radius.value;
  }

  private enterUser(now: number): void {
    if (this.mode !== "user") {
      this.user.x = this.x.value;
      this.user.z = this.z.value;
      this.user.distance = Math.exp(this.logDistance.value);
      this.user.yaw = this.yaw.value;
      this.user.pitch = this.pitch.value;
    }
    this.mode = "user";
    this.lastUserInput = now;
  }

  private chooseMode(frame: DirectorFrame): CameraMode {
    const { now } = frame;
    if (now - this.lastUserInput < USER_IDLE_SECONDS) {
      return "user";
    }
    if (frame.hasFocus) {
      this.lastRevealAt = Math.max(
        this.lastRevealAt,
        now - REVEAL_EVERY_SECONDS * 0.5,
      );
      return "focus";
    }
    if (frame.holdWide) {
      this.revealUntil = now + 1.5;
      this.lastRevealAt = now;
      this.lastRevealPlaced = frame.placed;
      return "reveal";
    }
    if (now < this.revealUntil) {
      return "reveal";
    }
    const idle =
      frame.placed > 0 &&
      frame.bandCount === 0 &&
      now - frame.lastPlacedAt > IDLE_WIDE_SECONDS;
    if (idle) {
      this.lastRevealAt = now;
      this.lastRevealPlaced = frame.placed;
      return "reveal";
    }
    if (frame.placed < REVEAL_MIN_PLACED) {
      this.lastRevealAt = now;
      this.lastRevealPlaced = frame.placed;
      return "follow";
    }
    const due =
      frame.placed - this.lastRevealPlaced >= REVEAL_EVERY_PLACED ||
      now - this.lastRevealAt >= REVEAL_EVERY_SECONDS;
    if (due) {
      this.revealUntil = now + REVEAL_SECONDS;
      this.lastRevealAt = now + REVEAL_SECONDS;
      this.lastRevealPlaced = frame.placed;
      return "reveal";
    }
    return "follow";
  }

  private aspect(frame: DirectorFrame): number {
    return Math.max(0.2, frame.viewWidth / Math.max(1, frame.viewHeight));
  }

  private fov(aspect: number): number {
    return viewFov(aspect);
  }

  private computeTarget(mode: CameraMode, frame: DirectorFrame): void {
    const target = this.target;
    const aspect = this.aspect(frame);
    const shift = compositionShift(aspect);
    const fit = shiftedFit(aspect, this.fov(aspect), shift);
    const fov = fit.fovY;
    const fitAspect = fit.aspect;
    target.shiftX = shift.x;
    target.shiftY = shift.y;
    if (mode === "user") {
      target.shiftX = this.shiftX.value;
      target.shiftY = this.shiftY.value;
      target.x = this.user.x;
      target.z = this.user.z;
      target.distance = this.user.distance;
      target.yaw = this.user.yaw;
      target.pitch = this.user.pitch;
      target.omega = this.reduced ? 30 : 7;
      target.radius = this.user.distance * 0.42;
      return;
    }
    if (mode === "focus") {
      target.x = frame.focusX;
      target.z = frame.focusZ + 0.05;
      target.pitch = FOCUS_PITCH;
      target.yaw = BASE_YAW * 0.6;
      target.distance = fitDistance(
        aspect < 1 ? 2.4 : 4.2,
        aspect < 1 ? 2.8 : 2.6,
        target.pitch,
        fov,
        fitAspect,
        1,
      );
      target.omega = 2.1;
      target.radius = target.distance * 0.42;
      return;
    }
    if (mode === "reveal") {
      const bounds = frame.bounds;
      const margin = 1.6;
      const width = bounds.maxX - bounds.minX + margin * 2;
      const depth = bounds.maxZ - bounds.minZ + margin * 2;
      target.x = (bounds.minX + bounds.maxX) / 2;
      target.z = (bounds.minZ + bounds.maxZ) / 2 + 0.2;
      target.pitch = REVEAL_PITCH;
      target.yaw = BASE_YAW * 0.5;
      target.distance = Math.max(
        6,
        fitDistance(width, depth, target.pitch, fov, fitAspect, 1.04),
      );
      target.omega = 1.15;
      target.radius = Math.max(4, Math.hypot(width, depth) * 0.44);
      return;
    }
    if (frame.prints === 0) {
      const view = arrivalView(aspect);
      target.shiftX = 0;
      target.shiftY = 0;
      target.x = view.targetX;
      target.z = view.targetZ;
      target.distance = view.distance;
      target.pitch = view.pitch;
      target.yaw = view.yaw;
      target.radius = ARRIVAL_RADIUS;
      target.omega = ARRIVAL_OMEGA;
      return;
    }
    const cssWidth = frame.viewWidth;
    const preferred = Math.max(5.2, Math.min(16.5, cssWidth / 88));
    const growth = ARRIVAL_WIDTH + FOLLOW_GROWTH * Math.sqrt(frame.prints);
    const minimumWidth = Math.min(preferred, growth);
    const bounds = frame.bounds;
    const mosaicX = (bounds.minX + bounds.maxX) / 2;
    const mosaicZ = (bounds.minZ + bounds.maxZ) / 2;
    const inwardX = mosaicX - frame.frontX;
    const inwardZ = mosaicZ - frame.frontZ;
    const inward = Math.hypot(inwardX, inwardZ);
    const reach = Math.min(inward, minimumWidth * 0.3);
    const reachX =
      frame.frontX + (inward > 1e-3 ? (inwardX / inward) * reach : 0);
    const reachZ =
      frame.frontZ + (inward > 1e-3 ? (inwardZ / inward) * reach : 0);
    const hasBand = frame.bandCount > 0;
    const pad = hasBand ? BAND_FRONT_PAD : OPEN_FRONT_PAD;
    const bandMargin = followMargin(aspect);
    const minX = Math.min(
      Math.min(frame.frontX, reachX) - pad,
      hasBand ? frame.bandMinX - bandMargin : Number.POSITIVE_INFINITY,
    );
    const maxX = Math.max(
      Math.max(frame.frontX, reachX) + pad,
      hasBand ? frame.bandMaxX + bandMargin : Number.NEGATIVE_INFINITY,
    );
    const minZ = Math.min(
      Math.min(frame.frontZ, reachZ) - pad,
      hasBand ? frame.bandMinZ - bandMargin : Number.POSITIVE_INFINITY,
    );
    const maxZ = Math.max(
      Math.max(frame.frontZ, reachZ) + pad,
      hasBand
        ? frame.bandMaxZ + bandMargin * NEAR_MARGIN_SCALE
        : Number.NEGATIVE_INFINITY,
    );
    const width = Math.max(maxX - minX, minimumWidth);
    const depth = Math.max(maxZ - minZ, (width / fitAspect) * 0.8, 3.6);
    const directionX = inward > 1e-3 ? inwardX / inward : 0;
    const directionZ = inward > 1e-3 ? inwardZ / inward : 0;
    target.x = (minX + maxX) / 2 + directionX * (width - (maxX - minX)) * 0.5;
    target.z =
      (minZ + maxZ) / 2 + directionZ * (depth - (maxZ - minZ)) * 0.5 + 0.15;
    target.pitch = FOLLOW_PITCH;
    target.yaw = BASE_YAW;
    target.distance = fitDistance(
      width,
      depth,
      target.pitch,
      fov,
      fitAspect,
      1,
    );
    target.radius = Math.max(width, depth * 0.9) * 0.5;
    target.omega = 1.45;
  }

  private shouldRecut(): boolean {
    const target = this.target;
    const drift = Math.hypot(target.x - this.heldX, target.z - this.heldZ);
    const zoom = Math.abs(
      Math.log(target.distance / Math.max(0.1, this.heldDistance)),
    );
    if (drift > target.distance * 0.22 || zoom > 0.25) {
      return true;
    }
    target.x = this.heldX;
    target.z = this.heldZ;
    target.distance = this.heldDistance;
    return false;
  }

  private snap(): void {
    const target = this.target;
    this.x.value = target.x;
    this.z.value = target.z;
    this.logDistance.value = Math.log(target.distance);
    this.yaw.value = target.yaw;
    this.pitch.value = target.pitch;
    this.radius.value = target.radius;
    this.shiftX.value = target.shiftX;
    this.shiftY.value = target.shiftY;
    this.shiftX.velocity = 0;
    this.shiftY.velocity = 0;
    this.radius.velocity = 0;
    this.x.velocity = 0;
    this.z.velocity = 0;
    this.logDistance.velocity = 0;
    this.yaw.velocity = 0;
    this.pitch.velocity = 0;
    this.heldX = target.x;
    this.heldZ = target.z;
    this.heldDistance = target.distance;
  }

  private apply(viewWidth: number, viewHeight: number): void {
    const camera = this.camera;
    const aspect = Math.max(0.2, viewWidth / Math.max(1, viewHeight));
    const distance = Math.exp(this.logDistance.value);
    const yaw = this.yaw.value + this.parallaxX.value * 0.022;
    const pitch = this.pitch.value - this.parallaxY.value * 0.014;
    const horizontal = distance * Math.cos(pitch);
    const targetX = this.x.value;
    const targetZ = this.z.value;
    camera.position.set(
      targetX + Math.sin(yaw) * horizontal,
      distance * Math.sin(pitch),
      targetZ + Math.cos(yaw) * horizontal,
    );
    camera.lookAt(targetX, 0, targetZ);
    const fov = this.fov(aspect) / DEG;
    const near = Math.max(0.08, distance * 0.12);
    const shiftX = this.shiftX.value;
    const shiftY = this.shiftY.value;
    if (
      Math.abs(fov - this.lastFov) > 1e-4 ||
      Math.abs(near - this.lastNear) > near * 0.01 ||
      Math.abs(aspect - this.lastAspect) > 1e-4 ||
      Math.abs(shiftX - this.lastShiftX) > 1e-5 ||
      Math.abs(shiftY - this.lastShiftY) > 1e-5
    ) {
      camera.fov = fov;
      camera.aspect = aspect;
      camera.near = near;
      camera.far = distance * 4 + 80;
      if (Math.abs(shiftX) > 1e-6 || Math.abs(shiftY) > 1e-6) {
        const width = Math.max(1, viewWidth);
        const height = Math.max(1, viewHeight);
        camera.setViewOffset(
          width,
          height,
          -shiftX * width,
          -shiftY * height,
          width,
          height,
        );
      } else {
        camera.clearViewOffset();
      }
      camera.updateProjectionMatrix();
      this.lastFov = fov;
      this.lastNear = near;
      this.lastAspect = aspect;
      this.lastShiftX = shiftX;
      this.lastShiftY = shiftY;
    }
  }
}
