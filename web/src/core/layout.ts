import type { DeskPose, Quarter } from "../contracts";
import { range, type Random } from "./random";
import { quarterToYaw } from "./rotation";

export interface GridCell {
  x: number;
  z: number;
}

export interface DeskBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface PrintSize {
  width: number;
  depth: number;
}

export interface ViewShift {
  x: number;
  y: number;
}

export interface ShiftedFit {
  aspect: number;
  fovY: number;
}

export interface CameraView {
  targetX: number;
  targetZ: number;
  distance: number;
  pitch: number;
  yaw: number;
}

const DEG = Math.PI / 180;

export const PRINT_LONG_SIDE = 0.9;
export const BORDER_RATIO = 0.05;
export const CROOKED_YAW_JITTER = 0.12;
export const CROOKED_OFFSET_JITTER = 0.1;
export const CROOKED_LAYERS = 9;
export const DESK_YAW = -7 * DEG;
export const ARRIVAL_PITCH = 54 * DEG;
export const ARRIVAL_WIDTH = 3;
export const ARRIVAL_DEPTH = 3;

const MIN_ASPECT = 0.25;
const MAX_ASPECT = 4;
const WIDE_SHIFT = 0.12;
const TALL_SHIFT = 0.05;
const WIDE_MARGIN = 0.95;
const TALL_MARGIN = 0.62;

function ringOf(slot: number): number {
  let ring = Math.ceil((Math.sqrt(slot + 1) - 1) / 2);
  while (ring > 0 && (2 * ring - 1) ** 2 > slot) {
    ring -= 1;
  }
  while ((2 * ring + 1) ** 2 <= slot) {
    ring += 1;
  }
  return ring;
}

interface RingPosition {
  ring: number;
  side: number;
  step: number;
}

function ringPosition(slot: number): RingPosition {
  const ring = ringOf(slot);
  if (ring === 0) {
    return { ring: 0, side: 3, step: 0 };
  }
  const offset = slot - (2 * ring - 1) ** 2;
  const edge = 2 * ring;
  return { ring, side: Math.floor(offset / edge), step: offset % edge };
}

export function spiralCell(slot: number): GridCell {
  const index = Math.max(0, Math.floor(slot));
  const { ring, side, step } = ringPosition(index);
  if (ring === 0) {
    return { x: 0, z: 0 };
  }
  if (side === 0) {
    return { x: ring, z: ring - 1 - step };
  }
  if (side === 1) {
    return { x: ring - 1 - step, z: -ring };
  }
  if (side === 2) {
    return { x: -ring, z: -(ring - 1) + step };
  }
  return { x: -(ring - 1) + step, z: ring };
}

export function cellSlot(worldX: number, worldZ: number): number {
  const x = Math.round(worldX);
  const z = Math.round(worldZ);
  const ring = Math.max(Math.abs(x), Math.abs(z));
  if (ring === 0) {
    return 0;
  }
  const start = (2 * ring - 1) ** 2;
  const edge = 2 * ring;
  if (x === ring && z < ring) {
    return start + (ring - 1 - z);
  }
  if (z === -ring) {
    return start + edge + (ring - 1 - x);
  }
  if (x === -ring) {
    return start + 2 * edge + (z + ring - 1);
  }
  return start + 3 * edge + (x + ring - 1);
}

export function slotPose(slot: number): DeskPose {
  const cell = spiralCell(slot);
  return { x: cell.x, y: 0, z: cell.z, yaw: 0, tiltX: 0, tiltZ: 0, scale: 1 };
}

export function mosaicBounds(count: number): DeskBounds {
  const filled = Math.max(1, Math.floor(count));
  const last = filled - 1;
  const { ring, side } = ringPosition(last);
  const inner = Math.max(0, ring - 1);
  let minX = -inner;
  let maxX = inner;
  let minZ = -inner;
  let maxZ = inner;
  if (ring > 0) {
    const cell = spiralCell(last);
    maxX = ring;
    if (side === 0) {
      minZ = Math.min(minZ, cell.z);
    } else {
      minZ = -ring;
    }
    if (side === 1) {
      minX = Math.min(minX, cell.x);
    } else if (side > 1) {
      minX = -ring;
    }
    if (side === 2) {
      maxZ = Math.max(maxZ, cell.z);
    } else if (side === 3) {
      maxZ = ring;
    }
  }
  return {
    minX: minX - 0.5,
    maxX: maxX + 0.5,
    minZ: minZ - 0.5,
    maxZ: maxZ + 0.5,
  };
}

export function printSize(aspect: number): PrintSize {
  const safe = Number.isFinite(aspect)
    ? Math.min(MAX_ASPECT, Math.max(MIN_ASPECT, aspect))
    : 1;
  if (safe >= 1) {
    return { width: PRINT_LONG_SIDE, depth: PRINT_LONG_SIDE / safe };
  }
  return { width: PRINT_LONG_SIDE * safe, depth: PRINT_LONG_SIDE };
}

export function borderWidth(size: PrintSize): number {
  return Math.min(size.width, size.depth) * BORDER_RATIO;
}

function safeSlot(slot: number): number {
  return Number.isFinite(slot) ? Math.max(0, Math.floor(slot)) : 0;
}

export function crookedPose(
  slot: number,
  simulated: Quarter,
  random: Random,
): DeskPose {
  const cell = spiralCell(safeSlot(slot));
  return {
    x: cell.x + range(random, -CROOKED_OFFSET_JITTER, CROOKED_OFFSET_JITTER),
    y: 0,
    z: cell.z + range(random, -CROOKED_OFFSET_JITTER, CROOKED_OFFSET_JITTER),
    yaw:
      quarterToYaw(simulated) +
      range(random, -CROOKED_YAW_JITTER, CROOKED_YAW_JITTER),
    tiltX: 0,
    tiltZ: 0,
    scale: 1,
  };
}

function modulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

export function crookedLayer(slot: number): number {
  const cell = spiralCell(safeSlot(slot));
  return modulo(cell.x, 3) * 3 + modulo(cell.z, 3);
}

export function fitDistance(
  width: number,
  depth: number,
  pitch: number,
  fovY: number,
  aspect: number,
  padding = 1.08,
): number {
  const halfTan = Math.tan(fovY / 2);
  const halfDepth = depth / 2;
  const vertical = halfDepth * (Math.sin(pitch) / halfTan + Math.cos(pitch));
  const horizontal =
    width / 2 / (halfTan * Math.max(0.1, aspect)) + halfDepth * Math.cos(pitch);
  return Math.max(vertical, horizontal) * padding;
}

export function matHalfSize(capacity: number): number {
  const bounds = mosaicBounds(capacity);
  const reach = Math.max(bounds.maxX, -bounds.minX, bounds.maxZ, -bounds.minZ);
  return Math.ceil(reach + 3);
}

export function viewFov(aspect: number): number {
  const portrait = Math.max(0, Math.min(1, (1.2 - aspect) / 0.75));
  return (32 + portrait * 9) * DEG;
}

export function arrivalView(aspect: number): CameraView {
  const safe = Math.max(0.2, aspect);
  return {
    targetX: 0,
    targetZ: 0,
    distance: fitDistance(
      ARRIVAL_WIDTH,
      ARRIVAL_DEPTH,
      ARRIVAL_PITCH,
      viewFov(safe),
      safe,
      1,
    ),
    pitch: ARRIVAL_PITCH,
    yaw: DESK_YAW,
  };
}

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function compositionShift(aspect: number): ViewShift {
  if (!Number.isFinite(aspect)) {
    return { x: 0, y: 0 };
  }
  return {
    x: WIDE_SHIFT * clampUnit((aspect - 0.9) / 0.5),
    y: TALL_SHIFT * clampUnit((0.9 - aspect) / 0.4),
  };
}

export function shiftedFit(
  aspect: number,
  fovY: number,
  shift: ViewShift,
): ShiftedFit {
  const keepX = Math.max(0.2, 1 - 2 * shift.x);
  const keepY = Math.max(0.2, 1 - 2 * shift.y);
  return {
    aspect: aspect * keepX,
    fovY: 2 * Math.atan(Math.tan(fovY / 2) * keepY),
  };
}

export function followMargin(aspect: number): number {
  if (!Number.isFinite(aspect)) {
    return WIDE_MARGIN;
  }
  const wide = clampUnit((aspect - 0.5) / 0.6);
  return TALL_MARGIN + (WIDE_MARGIN - TALL_MARGIN) * wide;
}
