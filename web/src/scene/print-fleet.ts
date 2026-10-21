import type { DeskPose, NewPrint, Quarter } from "../contracts";
import {
  type BandBox,
  CROOKED_LAYERS,
  type GridCell,
  crookedLayer,
  crookedPose,
  printSize,
  spiralCell,
} from "../core/layout";
import {
  FALL_SECONDS,
  FLIGHT_SECONDS,
  MARK_WRITE_SECONDS,
  REDUCED_FADE_SECONDS,
  REDUCED_SLIDE_SECONDS,
  STRAIGHTEN_LIFT,
  STRAIGHTEN_SECONDS,
  UNSETTLE_LIFT,
  UNSETTLE_SECONDS,
  copyPose,
  createPose,
  fallPose,
  fallStart,
  flightArc,
  flightPose,
  placedYaw,
  replayDelay,
  slidePose,
  straightenStart,
  turnInPlacePose,
} from "../core/motion";
import type { Random } from "../core/random";
import { markSide } from "../core/rotation";
import type { PrintAtlas } from "./atlas";
import type { PrintPages } from "./print-pages";

export type PrintPhase =
  | "falling"
  | "crooked"
  | "straightening"
  | "flying"
  | "placed"
  | "scatter-out"
  | "scattered"
  | "scatter-back";

type MotionKind = "fall" | "turn" | "flight" | "slide" | "appear";

export interface PrintEntry {
  readonly id: string;
  readonly index: number;
  readonly simulated: Quarter;
  readonly emphasis: boolean;
  readonly width: number;
  readonly depth: number;
  readonly seed: number;
  correction: Quarter | null;
  slot: number;
  counted: boolean;
  phase: PrintPhase;
  readonly pose: DeskPose;
  readonly crooked: DeskPose;
  readonly from: DeskPose;
  readonly to: DeskPose;
  motion: MotionKind | null;
  start: number;
  duration: number;
  arc: number;
  activeSlot: number;
  waiter: (() => void) | null;
  landed: (() => void) | null;
  scanning: boolean;
  scanStart: number;
  scanEnd: number;
  fadeStart: number;
  fadeDuration: number;
  markStart: number;
}

export type BandExtent = BandBox;

export interface BandAction extends GridCell {
  count: number;
  oldest: number;
  slot: number;
}

export interface PrintFleetOptions {
  pages: PrintPages;
  atlas: PrintAtlas;
  random: Random;
  now: () => number;
  wake: () => void;
  reducedMotion: boolean;
}

export const PLACED_Y = 0.002;
const CROOKED_BASE_Y = 0.006;
const LAYER_STEP = 0.0016;
const EMPHASIS_SCALE = 1.08;
const UNSETTLE_STAGGER_SECONDS = 0.3;
const SCATTER_HOLD_SECONDS = 0.5;
const REDUCED_SCATTER_HOLD_SECONDS = 0.6;
const RESTRAIGHTEN_LIFT = STRAIGHTEN_LIFT * 0.75;
const SCAN_MIN_SECONDS = 0.8;
const SCAN_FADE_SECONDS = 0.4;
const MARK_EFFECT_SECONDS = MARK_WRITE_SECONDS + 0.1;
const PLACE_INTERVAL_START = 1;
const PLACE_INTERVAL_MIN = 0.02;
const PLACE_INTERVAL_MAX = 3;
const PLACE_INTERVAL_WEIGHT = 0.12;
const MARK_TILT = (6 * Math.PI) / 180;

const BAND_PHASES: ReadonlySet<PrintPhase> = new Set<PrintPhase>([
  "falling",
  "crooked",
  "straightening",
  "flying",
]);

function resetBand(band: BandExtent): void {
  band.count = 0;
  band.minX = Number.POSITIVE_INFINITY;
  band.maxX = Number.NEGATIVE_INFINITY;
  band.minZ = Number.POSITIVE_INFINITY;
  band.maxZ = Number.NEGATIVE_INFINITY;
}

function resetAction(action: BandAction): void {
  action.count = 0;
  action.oldest = Number.POSITIVE_INFINITY;
  action.x = 0;
  action.z = 0;
  action.slot = 0;
}

function noteAction(
  action: BandAction,
  slot: number,
  x: number,
  z: number,
  busy: boolean,
): void {
  if (busy) {
    if (action.count === 0) {
      action.x = 0;
      action.z = 0;
      action.slot = 0;
    }
    action.count += 1;
    action.x += x;
    action.z += z;
    action.slot += slot;
    return;
  }
  if (action.count === 0 && slot < action.oldest) {
    action.oldest = slot;
    action.x = x;
    action.z = z;
    action.slot = slot;
  }
}

function settleAction(action: BandAction): void {
  if (action.count > 0) {
    action.x /= action.count;
    action.z /= action.count;
    action.slot /= action.count;
  }
}

function growBand(band: BandExtent, x: number, z: number): void {
  band.count += 1;
  band.minX = Math.min(band.minX, x);
  band.maxX = Math.max(band.maxX, x);
  band.minZ = Math.min(band.minZ, z);
  band.maxZ = Math.max(band.maxZ, z);
}

export class PrintFleet {
  private readonly pages: PrintPages;
  private readonly atlas: PrintAtlas;
  private readonly random: Random;
  private readonly now: () => number;
  private readonly wake: () => void;
  private readonly entries = new Map<string, PrintEntry>();
  private readonly slots = new Map<number, PrintEntry>();
  private readonly loose = new Set<PrintEntry>();
  private readonly active: PrintEntry[] = [];
  private readonly freeIndices: number[] = [];
  private readonly goal = createPose();
  private nextIndex = 0;
  private scatterRun: Promise<void> | null = null;
  private reduced: boolean;
  private lost = false;
  private disposed = false;
  highestSlot = -1;
  placedCount = 0;
  lastPlacedAt = Number.NEGATIVE_INFINITY;
  private placeInterval = PLACE_INTERVAL_START;
  scanningCount = 0;
  effectsUntil = 0;

  constructor(options: PrintFleetOptions) {
    this.pages = options.pages;
    this.atlas = options.atlas;
    this.random = options.random;
    this.now = options.now;
    this.wake = options.wake;
    this.reduced = options.reducedMotion;
  }

  get size(): number {
    return this.entries.size;
  }

  get activeCount(): number {
    return this.active.length;
  }

  get scattering(): boolean {
    return this.scatterRun !== null;
  }

  get(id: string): PrintEntry | undefined {
    return this.entries.get(id);
  }

  has(entry: PrintEntry): boolean {
    return this.entries.get(entry.id) === entry;
  }

  loosePrints(): ReadonlySet<PrintEntry> {
    return this.loose;
  }

  placedAt(slot: number): PrintEntry | undefined {
    const entry = this.slots.get(slot);
    return entry && entry.phase === "placed" ? entry : undefined;
  }

  setReducedMotion(reduced: boolean): void {
    this.reduced = reduced;
  }

  markLost(): void {
    this.lost = true;
    this.finishAll();
  }

  dispose(): void {
    this.disposed = true;
    this.finishAll();
  }

  bandExtent(
    out: BandExtent,
    visitors: BandExtent,
    action: BandAction,
    visitorAction: BandAction,
  ): number {
    resetBand(out);
    resetBand(visitors);
    resetAction(action);
    resetAction(visitorAction);
    let falling = 0;
    for (const entry of this.loose) {
      if (entry.phase === "falling") {
        falling += 1;
      }
      if (BAND_PHASES.has(entry.phase)) {
        const pose = entry.crooked;
        const busy = entry.scanning || entry.phase === "straightening";
        growBand(out, pose.x, pose.z);
        noteAction(action, entry.slot, pose.x, pose.z, busy);
        if (entry.emphasis) {
          growBand(visitors, pose.x, pose.z);
          noteAction(visitorAction, entry.slot, pose.x, pose.z, busy);
        }
      }
    }
    settleAction(action);
    settleAction(visitorAction);
    return falling;
  }

  add(print: NewPrint): Promise<void> {
    const now = this.now();
    const index = this.freeIndices.pop() ?? this.nextIndex++;
    const size = printSize(print.aspect);
    const random = this.random;
    const slot =
      Number.isFinite(print.slot) && print.slot >= 0
        ? Math.floor(print.slot)
        : this.highestSlot + 1;
    const crooked = this.crookedFor(slot, print.simulated, print.emphasis);
    const entry: PrintEntry = {
      id: print.id,
      index,
      simulated: print.simulated,
      emphasis: print.emphasis,
      width: size.width,
      depth: size.depth,
      seed: random(),
      correction: null,
      slot,
      counted: false,
      phase: "falling",
      pose: createPose(),
      crooked,
      from: createPose(),
      to: createPose(),
      motion: null,
      start: now,
      duration: 0,
      arc: 0,
      activeSlot: -1,
      waiter: null,
      landed: null,
      scanning: false,
      scanStart: 0,
      scanEnd: 0,
      fadeStart: 0,
      fadeDuration: 0,
      markStart: Number.NEGATIVE_INFINITY,
    };
    this.entries.set(entry.id, entry);
    this.loose.add(entry);
    this.claim(entry);
    const pages = this.pages;
    pages.ensure(index);
    pages.writeShape(
      index,
      size.width,
      size.depth,
      0.0035 + entry.seed * 0.0095,
      entry.seed,
    );
    const rect = this.atlas.write(index, print.image, now);
    pages.writeAtlas(
      index,
      rect,
      this.lost ? 0 : this.atlas.readyTime(now, index),
      print.emphasis,
    );
    pages.writeMark(index, -1, 0, 0, 0);
    const landed = new Promise<void>((resolve) => {
      entry.landed = resolve;
    });
    if (this.reduced) {
      copyPose(entry.pose, crooked);
      entry.fadeStart = now;
      entry.fadeDuration = REDUCED_FADE_SECONDS;
      this.writeTimes(entry);
      this.startMotion(entry, "appear", now, REDUCED_FADE_SECONDS, 0, crooked);
    } else {
      fallStart(entry.pose, crooked, random);
      this.writeTimes(entry);
      this.startMotion(entry, "fall", now, FALL_SECONDS, 0, crooked);
    }
    pages.writePose(index, entry.pose, this.shadowY(entry));
    this.settleIfLost();
    return landed;
  }

  setScanning(entry: PrintEntry, scanning: boolean): void {
    if (entry.scanning === scanning) {
      return;
    }
    const now = this.now();
    entry.scanning = scanning;
    if (scanning) {
      this.scanningCount += 1;
      entry.scanStart = now;
      entry.scanEnd = 1e7;
    } else {
      this.scanningCount = Math.max(0, this.scanningCount - 1);
      entry.scanEnd = Math.max(now, entry.scanStart + SCAN_MIN_SECONDS);
      this.effectsUntil = Math.max(
        this.effectsUntil,
        entry.scanEnd + SCAN_FADE_SECONDS,
      );
    }
    this.writeTimes(entry);
  }

  decide(entry: PrintEntry, correction: Quarter): void {
    const now = this.now();
    const random = this.random;
    entry.correction = correction;
    const start = this.reduced ? now - 1 : now + 0.04;
    entry.markStart = start;
    this.pages.writeMark(
      entry.index,
      markSide(entry.simulated, correction),
      start,
      (random() - 0.5) * 2 * MARK_TILT,
      (random() - 0.5) * 2,
    );
    this.effectsUntil = Math.max(
      this.effectsUntil,
      start + MARK_EFFECT_SECONDS,
    );
  }

  place(entry: PrintEntry, slot: number): Promise<void> {
    const target =
      Number.isFinite(slot) && slot >= 0 ? Math.floor(slot) : entry.slot;
    const moved = target !== entry.slot;
    if (moved) {
      this.release(entry);
      entry.slot = target;
      this.claim(entry);
      copyPose(
        entry.crooked,
        this.crookedFor(target, entry.simulated, entry.emphasis),
      );
    }
    const goal = this.slotPose(entry, this.goal);
    entry.phase = moved ? "flying" : "straightening";
    this.loose.add(entry);
    const now = this.now();
    let finished: Promise<void>;
    if (this.reduced) {
      finished = this.startMotion(
        entry,
        "slide",
        now,
        REDUCED_SLIDE_SECONDS,
        0,
        goal,
      );
    } else if (moved) {
      const distance = Math.hypot(
        goal.x - entry.pose.x,
        goal.z - entry.pose.z,
      );
      finished = this.startMotion(
        entry,
        "flight",
        now,
        FLIGHT_SECONDS,
        flightArc(distance),
        goal,
      );
    } else {
      finished = this.startMotion(
        entry,
        "turn",
        straightenStart(now, entry.markStart),
        STRAIGHTEN_SECONDS,
        STRAIGHTEN_LIFT,
        goal,
      );
    }
    this.settleIfLost();
    return finished;
  }

  remove(entry: PrintEntry): void {
    this.stopMotion(entry);
    if (entry.scanning) {
      this.scanningCount = Math.max(0, this.scanningCount - 1);
    }
    this.release(entry);
    if (entry.counted) {
      entry.counted = false;
      this.placedCount = Math.max(0, this.placedCount - 1);
    }
    const landed = entry.landed;
    entry.landed = null;
    landed?.();
    this.entries.delete(entry.id);
    this.loose.delete(entry);
    this.freeIndices.push(entry.index);
    this.pages.hide(entry.index);
  }

  scatterAll(): Promise<void> {
    if (this.scatterRun) {
      return this.scatterRun;
    }
    const group: PrintEntry[] = [];
    for (const entry of this.entries.values()) {
      if (entry.phase === "placed") {
        group.push(entry);
      }
    }
    if (group.length === 0 || this.disposed) {
      return Promise.resolve();
    }
    const run = this.runScatter(group).finally(() => {
      this.scatterRun = null;
      this.wake();
    });
    this.scatterRun = run;
    return run;
  }

  step(now: number): void {
    const active = this.active;
    for (let position = active.length - 1; position >= 0; position -= 1) {
      const entry = active[position];
      if (!entry || entry.motion === null) {
        continue;
      }
      const t = (now - entry.start) / entry.duration;
      if (t < 0) {
        continue;
      }
      if (t >= 1) {
        this.finishMotion(entry, now);
        continue;
      }
      switch (entry.motion) {
        case "fall":
          fallPose(entry.pose, t, entry.from, entry.to);
          break;
        case "turn":
          turnInPlacePose(entry.pose, t, entry.from, entry.to, entry.arc);
          break;
        case "flight":
          flightPose(entry.pose, t, entry.from, entry.to, entry.arc);
          break;
        case "slide":
          slidePose(entry.pose, t, entry.from, entry.to);
          break;
        case "appear":
          copyPose(entry.pose, entry.to);
          break;
      }
      this.pages.writePose(entry.index, entry.pose, this.shadowY(entry));
    }
  }

  finishAll(): void {
    const now = this.now();
    while (this.active.length > 0) {
      const entry = this.active[this.active.length - 1];
      if (!entry) {
        break;
      }
      this.finishMotion(entry, now);
    }
    for (const entry of this.entries.values()) {
      const landed = entry.landed;
      entry.landed = null;
      landed?.();
    }
  }

  placementRate(now: number): number {
    const quiet = now - this.lastPlacedAt;
    const interval = Math.max(this.placeInterval, quiet);
    return interval > PLACE_INTERVAL_MAX ? 0 : 1 / interval;
  }

  private notePlacement(now: number): void {
    const interval = now - this.lastPlacedAt;
    if (Number.isFinite(interval)) {
      const bounded = Math.max(0, Math.min(PLACE_INTERVAL_MAX, interval));
      this.placeInterval +=
        (bounded - this.placeInterval) * PLACE_INTERVAL_WEIGHT;
      this.placeInterval = Math.max(PLACE_INTERVAL_MIN, this.placeInterval);
    }
    this.lastPlacedAt = now;
  }

  private settleIfLost(): void {
    if (this.lost || this.disposed) {
      this.finishAll();
    }
  }

  private crookedFor(
    slot: number,
    simulated: Quarter,
    emphasis: boolean,
  ): DeskPose {
    const pose = crookedPose(slot, simulated, this.random);
    const layer = emphasis ? CROOKED_LAYERS : crookedLayer(slot);
    pose.y = CROOKED_BASE_Y + layer * LAYER_STEP;
    pose.scale = emphasis ? EMPHASIS_SCALE : 1;
    return pose;
  }

  private claim(entry: PrintEntry): void {
    this.slots.set(entry.slot, entry);
    this.highestSlot = Math.max(this.highestSlot, entry.slot);
  }

  private release(entry: PrintEntry): void {
    if (this.slots.get(entry.slot) === entry) {
      this.slots.delete(entry.slot);
    }
  }

  private slotPose(entry: PrintEntry, out: DeskPose): DeskPose {
    const cell = spiralCell(entry.slot);
    out.x = cell.x;
    out.y = PLACED_Y;
    out.z = cell.z;
    out.yaw = placedYaw(entry.simulated, entry.correction ?? 0);
    out.tiltX = 0;
    out.tiltZ = 0;
    out.scale = 1;
    return out;
  }

  private startMotion(
    entry: PrintEntry,
    kind: MotionKind,
    start: number,
    duration: number,
    arc: number,
    target: DeskPose,
  ): Promise<void> {
    const previous = entry.waiter;
    entry.waiter = null;
    if (entry.phase !== "falling" && entry.landed) {
      const landed = entry.landed;
      entry.landed = null;
      landed();
    }
    previous?.();
    copyPose(entry.from, entry.pose);
    if (target !== entry.to) {
      copyPose(entry.to, target);
    }
    entry.motion = kind;
    entry.start = start;
    entry.duration = Math.max(1e-3, duration);
    entry.arc = arc;
    if (entry.activeSlot < 0) {
      entry.activeSlot = this.active.length;
      this.active.push(entry);
    }
    return new Promise<void>((resolve) => {
      entry.waiter = resolve;
    });
  }

  private stopMotion(entry: PrintEntry): void {
    if (entry.activeSlot >= 0) {
      const last = this.active.pop();
      if (last && last !== entry) {
        this.active[entry.activeSlot] = last;
        last.activeSlot = entry.activeSlot;
      }
      entry.activeSlot = -1;
    }
    entry.motion = null;
    const waiter = entry.waiter;
    entry.waiter = null;
    waiter?.();
  }

  private finishMotion(entry: PrintEntry, now: number): void {
    copyPose(entry.pose, entry.to);
    const phase = entry.phase;
    if (phase === "falling") {
      entry.phase = "crooked";
    } else if (
      phase === "straightening" ||
      phase === "flying" ||
      phase === "scatter-back"
    ) {
      entry.phase = "placed";
      this.loose.delete(entry);
      if (!entry.counted) {
        entry.counted = true;
        this.placedCount += 1;
      }
      if (phase !== "scatter-back") {
        this.notePlacement(now);
      }
    } else if (phase === "scatter-out") {
      entry.phase = "scattered";
    }
    this.pages.writePose(entry.index, entry.pose, this.shadowY(entry));
    const landed = entry.landed;
    if (entry.phase === "crooked" && landed) {
      entry.landed = null;
      landed();
    }
    this.stopMotion(entry);
  }

  private async runScatter(group: PrintEntry[]): Promise<void> {
    const random = this.random;
    const reduced = this.reduced;
    const now = this.now();
    const outward: Promise<void>[] = [];
    for (const entry of group) {
      entry.phase = "scatter-out";
      this.loose.add(entry);
      outward.push(
        reduced
          ? this.startMotion(
              entry,
              "slide",
              now,
              REDUCED_SLIDE_SECONDS,
              0,
              entry.crooked,
            )
          : this.startMotion(
              entry,
              "turn",
              now + random() * UNSETTLE_STAGGER_SECONDS,
              UNSETTLE_SECONDS,
              UNSETTLE_LIFT,
              entry.crooked,
            ),
      );
    }
    this.wake();
    this.settleIfLost();
    await Promise.all(outward);
    await this.sleep(
      reduced ? REDUCED_SCATTER_HOLD_SECONDS : SCATTER_HOLD_SECONDS,
    );
    if (this.disposed) {
      return;
    }
    const order = group
      .filter((entry) => this.has(entry) && entry.phase === "scattered")
      .sort(
        (left, right) =>
          left.crooked.x * left.crooked.x +
          left.crooked.z * left.crooked.z -
          (right.crooked.x * right.crooked.x +
            right.crooked.z * right.crooked.z),
      );
    const back = this.now();
    const duration = reduced ? REDUCED_SLIDE_SECONDS : STRAIGHTEN_SECONDS;
    const homeward: Promise<void>[] = [];
    for (let rank = 0; rank < order.length; rank += 1) {
      const entry = order[rank];
      if (!entry) {
        continue;
      }
      const goal = this.slotPose(entry, this.goal);
      entry.phase = "scatter-back";
      const delay = replayDelay(
        rank,
        order.length,
        duration,
        reduced ? 1.5 : 4,
      );
      homeward.push(
        reduced
          ? this.startMotion(entry, "slide", back + delay, duration, 0, goal)
          : this.startMotion(
              entry,
              "turn",
              back + delay,
              duration,
              RESTRAIGHTEN_LIFT,
              goal,
            ),
      );
    }
    this.wake();
    this.settleIfLost();
    await Promise.all(homeward);
  }

  private sleep(seconds: number): Promise<void> {
    if (this.lost || this.disposed) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      setTimeout(resolve, seconds * 1000);
    });
  }

  private shadowY(entry: PrintEntry): number {
    const pose = entry.pose;
    switch (entry.phase) {
      case "placed":
        return 0.0008;
      case "crooked":
      case "scattered":
        return Math.max(0.0008, pose.y - 0.0016);
      case "falling":
        return Math.max(
          0.0008,
          Math.min(entry.crooked.y - 0.0016, pose.y - 0.0012),
        );
      default:
        return Math.max(0.0008, Math.min(0.0036, pose.y - 0.0012));
    }
  }

  private writeTimes(entry: PrintEntry): void {
    this.pages.writeTimes(
      entry.index,
      entry.scanStart,
      entry.scanEnd,
      entry.fadeStart,
      entry.fadeDuration,
    );
  }
}
