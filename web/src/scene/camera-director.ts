import type { PerspectiveCamera } from "three";
import type { ViewInsets } from "../contracts";
import {
  ARRIVAL_DEPTH,
  ARRIVAL_OMEGA,
  ARRIVAL_WIDTH,
  type AreaSize,
  type BandBox,
  type CameraView,
  DESK_YAW,
  type DeskBounds,
  type FrameSubject,
  type GridCell,
  type ViewFrame,
  arrivalFrame,
  focusArea,
  followArea,
  frameArea,
  leadAnchor,
  screenExtent,
  spiralPoint,
  viewFrame,
} from "../core/layout";
import { type Spring, springSettled, springStep } from "../core/motion";

export type CameraMode = "follow" | "reveal" | "focus" | "user";

export interface DirectorFrame {
  now: number;
  dt: number;
  front: DeskBounds;
  band: BandBox;
  visitors: BandBox;
  action: BandAnchor;
  visitorAction: BandAnchor;
  placeRate: number;
  falling: number;
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
  insets: ViewInsets;
  settled: boolean;
}

export interface BandAnchor extends GridCell {
  count: number;
  slot: number;
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
const REVEAL_MARGIN = 0.9;
const REVEAL_PADDING = 1.03;
const IDLE_WIDE_SECONDS = 7;
const SETTLED_WIDE_SECONDS = 0.35;
const INSET_SETTLE_SECONDS = 1.0;
const INSET_OMEGA = 6;
const SETTLED_OMEGA = 3.2;
const USER_IDLE_SECONDS = 8;
const MIN_DISTANCE = 2.2;
const MIN_PITCH = 34 * DEG;
const MAX_PITCH = 80 * DEG;
const MAX_USER_YAW = 40 * DEG;
const FOLLOW_OMEGA = 1.8;
const FOCUS_OMEGA = 2.1;
const VISITOR_OMEGA = 1.6;
const REVEAL_OMEGA = 1.5;
const FOLLOW_GROWTH = 0.6;
const FOLLOW_PX_PER_UNIT = 104;
const FOLLOW_MIN_WIDTH = 4.6;
const FOLLOW_MAX_WIDTH = 12;
const FOLLOW_DEPTH_RATIO = 0.55;
const LEGIBLE_PX_PER_UNIT = 52;
const LEGIBLE_DEPTH_SCALE = 0.8;
const BAND_MARGIN = 0.7;
const SMALL_BAND_MARGIN = 0.55;
const HOLD_BAND_MARGIN = 0.5;
const FOCUS_MARGIN = 0.62;
const FOCUS_MIN_WIDTH = 3.1;
const FOCUS_MIN_DEPTH = 2.3;
const RECUT_SHIFT = 0.01;
const RECUT_SPILL = 1.02;
const RECUT_ZOOM = 0.3;
const REDUCED_HEADROOM = 1.12;
const MAX_LEAD_SLOTS = 14;
const LEAD_GAIN = 1.4;

function centre(box: DeskBounds): GridCell {
  return { x: (box.minX + box.maxX) / 2, z: (box.minZ + box.maxZ) / 2 };
}

function spring(value: number): Spring {
  return { value, velocity: 0 };
}

const NO_INSETS: ViewInsets = { top: 0, right: 0, bottom: 0, left: 0 };

export class CameraDirector {
  readonly camera: PerspectiveCamera;
  mode: CameraMode = "follow";
  private reduced: boolean;
  private readonly x = spring(0);
  private readonly z = spring(0);
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
    z: 0,
    distance: 7,
    yaw: BASE_YAW,
    pitch: FOLLOW_PITCH,
    omega: FOLLOW_OMEGA,
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
  private settledReveal = false;
  private quickUntil = Number.NEGATIVE_INFINITY;
  private readonly lastInsets: ViewInsets = { top: 0, right: 0, bottom: 0, left: 0 };
  private lastUserInput = Number.NEGATIVE_INFINITY;
  private heldX = 0;
  private heldZ = 0;
  private heldDistance = 0;
  private heldShiftX = 0;
  private heldShiftY = 0;
  private lastMode: CameraMode = "follow";
  private maxDistance = 400;
  private lastFov = 0;
  private lastNear = 0;
  private lastAspect = 0;
  private lastShiftX = Number.NaN;
  private lastShiftY = Number.NaN;
  private lastWidth = 0;
  private lastHeight = 0;
  private initialised = false;
  private frame: ViewFrame = viewFrame(1, 1, NO_INSETS);
  private readonly wanted: DeskBounds = { minX: 0, maxX: 0, minZ: 0, maxZ: 0 };
  private readonly held: CameraView = {
    targetX: 0,
    targetZ: 0,
    distance: 1,
    pitch: FOLLOW_PITCH,
    yaw: BASE_YAW,
  };
  private readonly followSubject: FrameSubject = {
    band: { count: 0, minX: 0, maxX: 0, minZ: 0, maxZ: 0 },
    include: { minX: 0, maxX: 0, minZ: 0, maxZ: 0 },
    anchor: { x: 0, z: 0 },
  };
  private readonly focusSubject: FrameSubject = {
    band: { count: 0, minX: 0, maxX: 0, minZ: 0, maxZ: 0 },
    include: { minX: 0, maxX: 0, minZ: 0, maxZ: 0 },
    anchor: { x: 0, z: 0 },
  };

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
    settled: boolean,
  ): number | null {
    let next = Number.POSITIVE_INFINITY;
    if (this.mode === "user") {
      next = Math.min(next, this.lastUserInput + USER_IDLE_SECONDS);
    }
    if (this.mode === "reveal" && this.revealUntil > now) {
      next = Math.min(next, this.revealUntil);
    }
    if (this.mode === "follow" && placed > 0) {
      next = Math.min(
        next,
        lastPlacedAt + (settled ? SETTLED_WIDE_SECONDS : IDLE_WIDE_SECONDS),
      );
    }
    if (!Number.isFinite(next) || next <= now) {
      return null;
    }
    return next - now;
  }

  update(frame: DirectorFrame): boolean {
    this.frame = viewFrame(frame.viewWidth, frame.viewHeight, frame.insets);
    if (this.noteInsets(frame.insets) && this.initialised) {
      this.quickUntil = frame.now + INSET_SETTLE_SECONDS;
    }
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
      if (this.initialised) {
        target.distance *= REDUCED_HEADROOM;
      }
      this.snap();
      this.initialised = true;
    }
    const omega =
      frame.now < this.quickUntil
        ? Math.max(target.omega, INSET_OMEGA)
        : target.omega;
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

  get wantedArea(): DeskBounds {
    return this.wanted;
  }

  get viewShiftX(): number {
    return this.shiftX.value;
  }

  get viewShiftY(): number {
    return this.shiftY.value;
  }

  private noteInsets(insets: ViewInsets): boolean {
    const last = this.lastInsets;
    const changed =
      last.top !== insets.top ||
      last.right !== insets.right ||
      last.bottom !== insets.bottom ||
      last.left !== insets.left;
    last.top = insets.top;
    last.right = insets.right;
    last.bottom = insets.bottom;
    last.left = insets.left;
    return changed;
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
    const quiet = frame.placed > 0 && frame.band.count === 0;
    if (!quiet || !frame.settled) {
      this.settledReveal = false;
    }
    if (now < this.revealUntil || (quiet && this.mode === "reveal")) {
      return "reveal";
    }
    const wait = frame.settled ? SETTLED_WIDE_SECONDS : IDLE_WIDE_SECONDS;
    const idle =
      quiet && frame.falling === 0 && now - frame.lastPlacedAt > wait;
    if (idle) {
      this.settledReveal = frame.settled;
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

  private aim(
    view: CameraView,
    area: DeskBounds,
    omega: number,
    radius: number,
  ): void {
    const target = this.target;
    const wanted = this.wanted;
    wanted.minX = area.minX;
    wanted.maxX = area.maxX;
    wanted.minZ = area.minZ;
    wanted.maxZ = area.maxZ;
    target.x = view.targetX;
    target.z = view.targetZ;
    target.distance = view.distance;
    target.pitch = view.pitch;
    target.yaw = view.yaw;
    target.omega = omega;
    target.radius = radius;
  }

  private legibleWidth(): number {
    return this.frame.width / LEGIBLE_PX_PER_UNIT;
  }

  private legibleDepth(): number {
    return this.frame.height / (LEGIBLE_PX_PER_UNIT * LEGIBLE_DEPTH_SCALE);
  }

  private bandMargin(): number {
    const roomy = Math.max(0, Math.min(1, (this.frame.width - 400) / 500));
    return SMALL_BAND_MARGIN + (BAND_MARGIN - SMALL_BAND_MARGIN) * roomy;
  }

  private followSize(frame: DirectorFrame): AreaSize {
    const prints = frame.prints;
    const holding = frame.placed === 0 && frame.falling === 0;
    const preferred = Math.max(
      FOLLOW_MIN_WIDTH,
      Math.min(FOLLOW_MAX_WIDTH, this.frame.width / FOLLOW_PX_PER_UNIT),
    );
    const growth = ARRIVAL_WIDTH + FOLLOW_GROWTH * Math.sqrt(prints);
    const minWidth = Math.min(preferred, growth);
    const margin = holding ? HOLD_BAND_MARGIN : this.bandMargin();
    const band = frame.band;
    const bandWidth = band.count > 0 ? band.maxX - band.minX + 2 * margin : 0;
    const bandDepth = band.count > 0 ? band.maxZ - band.minZ + 2 * margin : 0;
    return {
      margin,
      minWidth,
      minDepth: Math.max(ARRIVAL_DEPTH, minWidth * FOLLOW_DEPTH_RATIO),
      maxWidth: Math.max(minWidth, this.legibleWidth(), bandWidth),
      maxDepth: Math.max(ARRIVAL_DEPTH, this.legibleDepth(), bandDepth),
    };
  }

  private focusSize(): AreaSize {
    return {
      margin: FOCUS_MARGIN,
      minWidth: FOCUS_MIN_WIDTH,
      minDepth: FOCUS_MIN_DEPTH,
      maxWidth: Math.max(FOCUS_MIN_WIDTH, this.legibleWidth()),
      maxDepth: Math.max(FOCUS_MIN_DEPTH, this.legibleDepth()),
    };
  }

  private follow(frame: DirectorFrame, size: AreaSize): FrameSubject {
    const subject = this.followSubject;
    subject.band = frame.band;
    subject.include = frame.front;
    subject.anchor =
      frame.band.count > 0
        ? leadAnchor(
            frame.action,
            this.ahead(frame.action, frame.placeRate, FOLLOW_OMEGA),
            frame.front,
            size,
          )
        : centre(frame.front);
    return subject;
  }

  private ahead(action: BandAnchor, rate: number, omega: number): GridCell {
    const lead = Math.min(MAX_LEAD_SLOTS, Math.max(0, rate) * (LEAD_GAIN / omega));
    return lead > 0 ? spiralPoint(action.slot + lead) : action;
  }

  private visitorFocus(frame: DirectorFrame, size: AreaSize): FrameSubject {
    const subject = this.focusSubject;
    const include = subject.include;
    include.minX = frame.focusX;
    include.maxX = frame.focusX;
    include.minZ = frame.focusZ;
    include.maxZ = frame.focusZ;
    subject.band = frame.visitors;
    if (frame.visitors.count > 1) {
      const front = frame.front;
      include.minX = Math.min(include.minX, front.minX);
      include.maxX = Math.max(include.maxX, front.maxX);
      include.minZ = Math.min(include.minZ, front.minZ);
      include.maxZ = Math.max(include.maxZ, front.maxZ);
      subject.anchor = leadAnchor(
        frame.visitorAction,
        this.ahead(frame.visitorAction, frame.placeRate, VISITOR_OMEGA),
        frame.front,
        size,
      );
    } else {
      subject.anchor = { x: frame.focusX, z: frame.focusZ };
    }
    return subject;
  }

  private computeTarget(mode: CameraMode, frame: DirectorFrame): void {
    const target = this.target;
    const view = this.frame;
    target.shiftX = view.shiftX;
    target.shiftY = view.shiftY;
    if (mode === "user") {
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
      const size = this.focusSize();
      const area = focusArea(this.visitorFocus(frame, size), size);
      const shot = frameArea(
        area,
        FOCUS_PITCH,
        BASE_YAW * 0.6,
        view.fovY,
        view.aspect,
      );
      this.aim(
        shot,
        area,
        frame.visitors.count > 1 ? VISITOR_OMEGA : FOCUS_OMEGA,
        Math.max(shot.distance * 0.42, this.areaRadius(area)),
      );
      return;
    }
    if (mode === "reveal") {
      const bounds = frame.bounds;
      const area = {
        minX: bounds.minX - REVEAL_MARGIN,
        maxX: bounds.maxX + REVEAL_MARGIN,
        minZ: bounds.minZ - REVEAL_MARGIN,
        maxZ: bounds.maxZ + REVEAL_MARGIN,
      };
      const shot = frameArea(
        area,
        REVEAL_PITCH,
        BASE_YAW * 0.5,
        view.fovY,
        view.aspect,
        REVEAL_PADDING,
      );
      shot.distance = Math.max(6, shot.distance);
      this.aim(
        shot,
        area,
        this.settledReveal ? SETTLED_OMEGA : REVEAL_OMEGA,
        Math.max(4, this.areaRadius(area) * 0.88),
      );
      return;
    }
    if (frame.prints === 0) {
      const area = {
        minX: -ARRIVAL_WIDTH / 2,
        maxX: ARRIVAL_WIDTH / 2,
        minZ: -ARRIVAL_DEPTH / 2,
        maxZ: ARRIVAL_DEPTH / 2,
      };
      const shot = arrivalFrame(
        frame.viewWidth,
        frame.viewHeight,
        frame.insets,
      ).view;
      this.aim(shot, area, ARRIVAL_OMEGA, this.areaRadius(area) * 1.32);
      return;
    }
    const size = this.followSize(frame);
    const area = followArea(this.follow(frame, size), frame.bounds, size);
    const shot = frameArea(
      area,
      FOLLOW_PITCH,
      BASE_YAW,
      view.fovY,
      view.aspect,
    );
    this.aim(shot, area, FOLLOW_OMEGA, this.areaRadius(area));
  }

  private areaRadius(area: DeskBounds): number {
    const width = area.maxX - area.minX;
    const depth = area.maxZ - area.minZ;
    return Math.max(width, depth * 0.9) * 0.5;
  }

  private shouldRecut(): boolean {
    const target = this.target;
    const shifted =
      Math.abs(target.shiftX - this.heldShiftX) > RECUT_SHIFT ||
      Math.abs(target.shiftY - this.heldShiftY) > RECUT_SHIFT;
    const zoom = Math.log(target.distance / Math.max(0.1, this.heldDistance));
    const held = this.held;
    held.targetX = this.heldX;
    held.targetZ = this.heldZ;
    held.distance = this.heldDistance;
    held.pitch = target.pitch;
    held.yaw = target.yaw;
    const extent = screenExtent(
      this.wanted,
      held,
      this.frame.fovY,
      this.frame.aspect,
    );
    const spills =
      extent.minX < -RECUT_SPILL ||
      extent.maxX > RECUT_SPILL ||
      extent.minY < -RECUT_SPILL ||
      extent.maxY > RECUT_SPILL;
    if (shifted || spills || zoom < -RECUT_ZOOM) {
      return true;
    }
    target.x = this.heldX;
    target.z = this.heldZ;
    target.distance = this.heldDistance;
    target.shiftX = this.heldShiftX;
    target.shiftY = this.heldShiftY;
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
    this.heldShiftX = target.shiftX;
    this.heldShiftY = target.shiftY;
  }

  private apply(viewWidth: number, viewHeight: number): void {
    const camera = this.camera;
    const width = Math.max(1, viewWidth);
    const height = Math.max(1, viewHeight);
    const aspect = Math.max(0.2, width / height);
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
    const fov = this.frame.cameraFovY / DEG;
    const near = Math.max(0.08, distance * 0.12);
    const shiftX = this.shiftX.value;
    const shiftY = this.shiftY.value;
    if (
      Math.abs(fov - this.lastFov) > 1e-4 ||
      Math.abs(near - this.lastNear) > near * 0.01 ||
      Math.abs(aspect - this.lastAspect) > 1e-4 ||
      Math.abs(shiftX - this.lastShiftX) > 1e-5 ||
      Math.abs(shiftY - this.lastShiftY) > 1e-5 ||
      width !== this.lastWidth ||
      height !== this.lastHeight
    ) {
      camera.fov = fov;
      camera.aspect = aspect;
      camera.near = near;
      camera.far = distance * 4 + 80;
      if (Math.abs(shiftX) > 1e-6 || Math.abs(shiftY) > 1e-6) {
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
      this.lastWidth = width;
      this.lastHeight = height;
    }
  }
}
