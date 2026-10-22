import type { DeskPose, Quarter, ViewInsets } from "../contracts";
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

export interface ViewFrame {
  width: number;
  height: number;
  aspect: number;
  fovY: number;
  cameraFovY: number;
  shiftX: number;
  shiftY: number;
}

export interface BandBox {
  count: number;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface AreaSize {
  margin: number;
  minWidth: number;
  minDepth: number;
  maxWidth: number;
  maxDepth: number;
}

export interface FrameSubject {
  band: BandBox;
  include: DeskBounds;
  anchor: GridCell;
}

export interface ScreenBox {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface ViewProjection {
  x: number;
  y: number;
  depth: number;
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
export const MIN_FREE_FRACTION = 0.3;
export const ARRIVAL_OMEGA = 1.35;

const MIN_ASPECT = 0.25;
const MAX_ASPECT = 4;
const MIN_FRAMED_SIZE = 0.5;
const FRAME_ITERATIONS = 60;
const FRAME_TOLERANCE = 1e-6;
const PRINT_HALF = PRINT_LONG_SIDE / 2;
const INWARD_SHARE = 0.8;
const INWARD_THRESHOLD = 0.75;
const LEAD_SHARE = 0.5;
const LEAD_LIMIT = 0.3;

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

export function spiralPoint(slot: number): GridCell {
  if (!(slot > 0)) {
    return { x: 0, z: 0 };
  }
  const base = Math.floor(slot);
  const from = spiralCell(base);
  const fraction = slot - base;
  if (fraction <= 0) {
    return from;
  }
  const to = spiralCell(base + 1);
  return {
    x: from.x + (to.x - from.x) * fraction,
    z: from.z + (to.z - from.z) * fraction,
  };
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
  const safe = Number.isFinite(aspect) ? Math.max(0.2, aspect) : 1.6;
  return frameArea(
    {
      minX: -ARRIVAL_WIDTH / 2,
      maxX: ARRIVAL_WIDTH / 2,
      minZ: -ARRIVAL_DEPTH / 2,
      maxZ: ARRIVAL_DEPTH / 2,
    },
    ARRIVAL_PITCH,
    DESK_YAW,
    viewFov(safe),
    safe,
    1,
  );
}

function positive(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function freeSpan(total: number, start: number, end: number): [number, number] {
  const covered = start + end;
  const allowed = total * (1 - MIN_FREE_FRACTION);
  if (covered <= allowed) {
    return [start, end];
  }
  const scale = allowed / covered;
  return [start * scale, end * scale];
}

export function viewFrame(
  viewWidth: number,
  viewHeight: number,
  insets: ViewInsets,
): ViewFrame {
  const width = Number.isFinite(viewWidth) ? Math.max(1, viewWidth) : 1;
  const height = Number.isFinite(viewHeight) ? Math.max(1, viewHeight) : 1;
  const [left, right] = freeSpan(
    width,
    positive(insets.left),
    positive(insets.right),
  );
  const [top, bottom] = freeSpan(
    height,
    positive(insets.top),
    positive(insets.bottom),
  );
  const freeWidth = width - left - right;
  const freeHeight = height - top - bottom;
  const cameraFovY = viewFov(width / height);
  return {
    width: freeWidth,
    height: freeHeight,
    aspect: freeWidth / freeHeight,
    fovY: 2 * Math.atan(Math.tan(cameraFovY / 2) * (freeHeight / height)),
    cameraFovY,
    shiftX: (left - right) / 2 / width,
    shiftY: (top - bottom) / 2 / height,
  };
}

export interface ArrivalFrame {
  view: CameraView;
  fovY: number;
  shiftX: number;
  shiftY: number;
}

export function arrivalFrame(
  viewWidth: number,
  viewHeight: number,
  insets: ViewInsets,
): ArrivalFrame {
  const frame = viewFrame(viewWidth, viewHeight, insets);
  return {
    view: frameArea(
      {
        minX: -ARRIVAL_WIDTH / 2,
        maxX: ARRIVAL_WIDTH / 2,
        minZ: -ARRIVAL_DEPTH / 2,
        maxZ: ARRIVAL_DEPTH / 2,
      },
      ARRIVAL_PITCH,
      DESK_YAW,
      frame.fovY,
      frame.aspect,
    ),
    fovY: frame.cameraFovY,
    shiftX: frame.shiftX,
    shiftY: frame.shiftY,
  };
}

export function projectDeskPoint(
  view: CameraView,
  x: number,
  z: number,
  fovY: number,
  aspect: number,
): ViewProjection {
  const cosPitch = Math.cos(view.pitch);
  const sinPitch = Math.sin(view.pitch);
  const cosYaw = Math.cos(view.yaw);
  const sinYaw = Math.sin(view.yaw);
  const horizontal = view.distance * cosPitch;
  const dx = x - (view.targetX + sinYaw * horizontal);
  const dy = -view.distance * sinPitch;
  const dz = z - (view.targetZ + cosYaw * horizontal);
  const depth = -sinYaw * cosPitch * dx - sinPitch * dy - cosYaw * cosPitch * dz;
  const right = cosYaw * dx - sinYaw * dz;
  const up = -sinYaw * sinPitch * dx + cosPitch * dy - cosYaw * sinPitch * dz;
  const halfTan = Math.tan(fovY / 2);
  const safeDepth = Math.abs(depth) > 1e-9 ? depth : 1e-9;
  return {
    x: right / (safeDepth * halfTan * Math.max(0.1, aspect)),
    y: up / (safeDepth * halfTan),
    depth,
  };
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function orderedSpan(
  low: number,
  high: number,
  minimum: number,
): [number, number] {
  const first = finiteOr(low, finiteOr(high, 0));
  const second = finiteOr(high, first);
  const min = Math.min(first, second);
  const max = Math.max(first, second);
  const extra = Math.max(0, minimum - (max - min)) / 2;
  return [min - extra, max + extra];
}

export function frameArea(
  area: DeskBounds,
  pitch: number,
  yaw: number,
  fovY: number,
  aspect: number,
  padding = 1,
): CameraView {
  const [minX, maxX] = orderedSpan(area.minX, area.maxX, MIN_FRAMED_SIZE);
  const [minZ, maxZ] = orderedSpan(area.minZ, area.maxZ, MIN_FRAMED_SIZE);
  const safeAspect = Math.max(0.1, finiteOr(aspect, 1));
  const pad = Math.max(0.2, finiteOr(padding, 1));
  const halfTan = Math.tan(fovY / 2);
  const sinPitch = Math.sin(pitch);
  const cosPitch = Math.cos(pitch);
  const cosYaw = Math.cos(yaw);
  const sinYaw = Math.sin(yaw);
  const view: CameraView = {
    targetX: (minX + maxX) / 2,
    targetZ: (minZ + maxZ) / 2,
    distance: Math.max(
      MIN_FRAMED_SIZE,
      fitDistance(maxX - minX, maxZ - minZ, pitch, fovY, safeAspect, pad),
    ),
    pitch,
    yaw,
  };
  const xs = [minX, maxX, minX, maxX];
  const zs = [minZ, minZ, maxZ, maxZ];
  for (let iteration = 0; iteration < FRAME_ITERATIONS; iteration += 1) {
    let low = Number.POSITIVE_INFINITY;
    let high = Number.NEGATIVE_INFINITY;
    let bottom = Number.POSITIVE_INFINITY;
    let top = Number.NEGATIVE_INFINITY;
    let behind = false;
    for (let corner = 0; corner < 4; corner += 1) {
      const point = projectDeskPoint(
        view,
        xs[corner] ?? 0,
        zs[corner] ?? 0,
        fovY,
        safeAspect,
      );
      if (point.depth <= 1e-6) {
        behind = true;
        break;
      }
      low = Math.min(low, point.x);
      high = Math.max(high, point.x);
      bottom = Math.min(bottom, point.y);
      top = Math.max(top, point.y);
    }
    if (behind) {
      view.distance *= 1.5;
      continue;
    }
    const middleX = (low + high) / 2;
    const middleY = (bottom + top) / 2;
    const extent = Math.max((high - low) / 2, (top - bottom) / 2) * pad;
    const sideways = middleX * view.distance * halfTan * safeAspect;
    const ahead =
      (middleY * view.distance * halfTan) /
      Math.max(0.05, sinPitch - middleY * halfTan * cosPitch);
    view.targetX += cosYaw * sideways - sinYaw * ahead;
    view.targetZ += -sinYaw * sideways - cosYaw * ahead;
    view.distance *= extent;
    if (
      Math.abs(middleX) < FRAME_TOLERANCE &&
      Math.abs(middleY) < FRAME_TOLERANCE &&
      Math.abs(extent - 1) < FRAME_TOLERANCE
    ) {
      break;
    }
  }
  return view;
}

function growSpan(
  low: number,
  high: number,
  minimum: number,
  toward: number,
): [number, number] {
  const extra = minimum - (high - low);
  if (!(extra > 0)) {
    return [low, high];
  }
  const offset = toward - (low + high) / 2;
  const inward =
    Math.abs(offset) < INWARD_THRESHOLD ? 0.5 : INWARD_SHARE;
  return offset < 0
    ? [low - extra * inward, high + extra * (1 - inward)]
    : [low - extra * (1 - inward), high + extra * inward];
}

function clipSpan(
  low: number,
  high: number,
  maximum: number,
  anchor: number,
): [number, number] {
  if (!(high - low > maximum) || !Number.isFinite(maximum)) {
    return [low, high];
  }
  const start = Math.max(
    low,
    Math.min(high - maximum, anchor - maximum / 2),
  );
  return [start, start + maximum];
}

function fitSpan(
  low: number,
  high: number,
  size: [number, number],
  anchor: number,
  toward: number,
): [number, number] {
  const [minimum, maximum] = size;
  const [start, end] = clipSpan(low, high, maximum, anchor);
  return growSpan(start, end, Math.min(minimum, maximum), toward);
}

function hasBand(band: BandBox): boolean {
  return (
    band.count > 0 &&
    Number.isFinite(band.minX) &&
    Number.isFinite(band.maxX) &&
    Number.isFinite(band.minZ) &&
    Number.isFinite(band.maxZ)
  );
}

export function frontCells(first: number, count: number): DeskBounds {
  const start = safeSlot(first);
  const cell = spiralCell(start);
  const box = { minX: cell.x, maxX: cell.x, minZ: cell.z, maxZ: cell.z };
  const total = Number.isFinite(count) ? Math.max(1, Math.floor(count)) : 1;
  for (let slot = start + 1; slot < start + total; slot += 1) {
    const next = spiralCell(slot);
    box.minX = Math.min(box.minX, next.x);
    box.maxX = Math.max(box.maxX, next.x);
    box.minZ = Math.min(box.minZ, next.z);
    box.maxZ = Math.max(box.maxZ, next.z);
  }
  return box;
}

function unionBand(
  area: DeskBounds,
  band: BandBox,
  margin: number,
): DeskBounds {
  if (!hasBand(band)) {
    return area;
  }
  return {
    minX: Math.min(area.minX, band.minX - margin),
    maxX: Math.max(area.maxX, band.maxX + margin),
    minZ: Math.min(area.minZ, band.minZ - margin),
    maxZ: Math.max(area.maxZ, band.maxZ + margin),
  };
}

function fitArea(
  area: DeskBounds,
  size: AreaSize,
  anchor: GridCell,
  toward: GridCell,
): DeskBounds {
  const [minX, maxX] = fitSpan(
    area.minX,
    area.maxX,
    [size.minWidth, size.maxWidth],
    anchor.x,
    toward.x,
  );
  const [minZ, maxZ] = fitSpan(
    area.minZ,
    area.maxZ,
    [size.minDepth, size.maxDepth],
    anchor.z,
    toward.z,
  );
  return { minX, maxX, minZ, maxZ };
}

export function followArea(
  subject: FrameSubject,
  bounds: DeskBounds,
  size: AreaSize,
): DeskBounds {
  const include = subject.include;
  const area = unionBand(
    {
      minX: include.minX - 0.5,
      maxX: include.maxX + 0.5,
      minZ: include.minZ - 0.5,
      maxZ: include.maxZ + 0.5,
    },
    subject.band,
    size.margin,
  );
  return fitArea(area, size, subject.anchor, {
    x: (bounds.minX + bounds.maxX) / 2,
    z: (bounds.minZ + bounds.maxZ) / 2,
  });
}

export function focusArea(subject: FrameSubject, size: AreaSize): DeskBounds {
  const include = subject.include;
  const reach = Math.max(PRINT_HALF, size.margin);
  const area = unionBand(
    {
      minX: include.minX - reach,
      maxX: include.maxX + reach,
      minZ: include.minZ - reach,
      maxZ: include.maxZ + reach,
    },
    subject.band,
    size.margin,
  );
  return fitArea(area, size, subject.anchor, {
    x: (include.minX + include.maxX) / 2,
    z: (include.minZ + include.maxZ) / 2,
  });
}

function clampAround(value: number, centre: number, window: number): number {
  if (!Number.isFinite(window)) {
    return value;
  }
  const limit = window * LEAD_LIMIT;
  return Math.max(centre - limit, Math.min(centre + limit, value));
}

export function leadAnchor(
  action: GridCell,
  ahead: GridCell,
  front: DeskBounds,
  size: AreaSize,
): GridCell {
  const frontX = (front.minX + front.maxX) / 2;
  const frontZ = (front.minZ + front.maxZ) / 2;
  const goalX = ahead.x + (frontX - ahead.x) * LEAD_SHARE;
  const goalZ = ahead.z + (frontZ - ahead.z) * LEAD_SHARE;
  return {
    x: clampAround(goalX, action.x, size.maxWidth),
    z: clampAround(goalZ, action.z, size.maxDepth),
  };
}

export function screenExtent(
  area: DeskBounds,
  view: CameraView,
  fovY: number,
  aspect: number,
): ScreenBox {
  const box: ScreenBox = {
    minX: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
  };
  const xs = [area.minX, area.maxX];
  const zs = [area.minZ, area.maxZ];
  for (const x of xs) {
    for (const z of zs) {
      const point = projectDeskPoint(view, x, z, fovY, aspect);
      if (!(point.depth > 1e-6)) {
        return {
          minX: Number.NEGATIVE_INFINITY,
          maxX: Number.POSITIVE_INFINITY,
          minY: Number.NEGATIVE_INFINITY,
          maxY: Number.POSITIVE_INFINITY,
        };
      }
      box.minX = Math.min(box.minX, point.x);
      box.maxX = Math.max(box.maxX, point.x);
      box.minY = Math.min(box.minY, point.y);
      box.maxY = Math.max(box.maxY, point.y);
    }
  }
  return box;
}
