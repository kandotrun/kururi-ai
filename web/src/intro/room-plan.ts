import type { CameraPose, DeskView } from "./camera-path";
import type { Vec3 } from "./geo-math";

export interface Rect {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export const ROOM = {
  floorY: -5.2,
  ceilingY: 14,
  halfWidth: 17,
  backZ: -15.5,
  entryZ: 16,
  wallThickness: 1.2,
  desk: { minX: -8, maxX: 8, minZ: -10.5, maxZ: 7, top: -0.03, thickness: 0.45 },
  mat: { minX: -6.2, maxX: 6.2, minZ: -8.6, maxZ: 5.6, margin: 1.2, radius: 0.35 },
  entryWindow: { centerX: 0.4, halfWidth: 6.5, bottom: 0.8, top: 10.4 },
  backWindow: { centerX: 0, halfWidth: 9.5, bottom: 1.4, top: 11.8 },
} as const;

function normalized(v: Vec3): Vec3 {
  const length = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / length, v[1] / length, v[2] / length];
}

const LAMP_HEAD: Vec3 = [-2.8, 7.4, -2.6];

export const LAMP = {
  base: [-7.0, 0, -8.9] as Vec3,
  elbow: [-6.1, 9.4, -6.9] as Vec3,
  head: LAMP_HEAD,
  direction: normalized([-LAMP_HEAD[0], -LAMP_HEAD[1], -LAMP_HEAD[2]]),
} as const;

export type PropKind = "prints" | "loupe" | "mug" | "box";

export interface Prop {
  kind: PropKind;
  position: Vec3;
  turn: number;
}

export const PROPS: readonly Prop[] = [
  { kind: "prints", position: [7.0, 0.3, -3.6], turn: 0.32 },
  { kind: "prints", position: [6.8, 0.2, -6.4], turn: -0.18 },
  { kind: "prints", position: [-5.0, 0.2, 3.5], turn: 0.55 },
  { kind: "prints", position: [4.7, 0.2, -7.6], turn: -0.4 },
  { kind: "loupe", position: [-4.5, 0.45, -5.7], turn: 0 },
  { kind: "mug", position: [6.9, 0.8, 2.6], turn: 0 },
  { kind: "box", position: [3.6, 1.6, -9.6], turn: 0.05 },
];

export function matGridRect(): Rect {
  const mat = ROOM.mat;
  return {
    minX: mat.minX + mat.margin,
    maxX: mat.maxX - mat.margin,
    minZ: mat.minZ + mat.margin,
    maxZ: mat.maxZ - mat.margin,
  };
}

interface Basis {
  forward: Vec3;
  right: Vec3;
  up: Vec3;
  halfTan: number;
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function basis(pose: CameraPose): Basis {
  const forward = normalized([
    pose.target[0] - pose.position[0],
    pose.target[1] - pose.position[1],
    pose.target[2] - pose.position[2],
  ]);
  const right = normalized(cross(forward, pose.up));
  const up = cross(right, forward);
  return { forward, right, up, halfTan: Math.tan((pose.fov * Math.PI) / 360) };
}

export function groundFootprint(
  pose: CameraPose,
  aspect: number,
): [number, number][] {
  const { forward, right, up, halfTan } = basis(pose);
  const corners: [number, number][] = [];
  for (const [sx, sy] of [
    [-1, 1],
    [1, 1],
    [1, -1],
    [-1, -1],
  ] as const) {
    const direction: Vec3 = [0, 0, 0];
    for (let axis = 0; axis < 3; axis += 1) {
      direction[axis] =
        forward[axis]! +
        right[axis]! * sx * halfTan * aspect +
        up[axis]! * sy * halfTan;
    }
    const reach =
      direction[1] < -1e-9 ? -pose.position[1] / direction[1] : 1e6;
    corners.push([
      pose.position[0] + direction[0] * reach,
      pose.position[2] + direction[2] * reach,
    ]);
  }
  return corners;
}

export function projectPoint(
  pose: CameraPose,
  aspect: number,
  point: Vec3,
): Vec3 {
  const { forward, right, up, halfTan } = basis(pose);
  const offset: Vec3 = [
    point[0] - pose.position[0],
    point[1] - pose.position[1],
    point[2] - pose.position[2],
  ];
  const depth =
    offset[0] * forward[0] + offset[1] * forward[1] + offset[2] * forward[2];
  if (depth <= 1e-9) {
    return [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, depth];
  }
  const x = offset[0] * right[0] + offset[1] * right[1] + offset[2] * right[2];
  const y = offset[0] * up[0] + offset[1] * up[1] + offset[2] * up[2];
  return [x / (depth * halfTan * aspect), y / (depth * halfTan), depth];
}

export interface DeskLighting {
  lampCenter: [number, number];
  lampRadius: number;
  fogCenter: [number, number];
  fogRange: [number, number];
  satin: Vec3;
}

export const ARRIVAL_FRAME_RADIUS = 1.5 * 1.32;

export function deskArrivalLighting(view: DeskView): DeskLighting {
  const radius = ARRIVAL_FRAME_RADIUS;
  const distance = view.distance;
  return {
    lampCenter: [view.targetX - radius * 0.22, view.targetZ - radius * 0.16],
    lampRadius: radius * 0.95,
    fogCenter: [view.targetX, view.targetZ - radius * 0.1],
    fogRange: [radius * 0.95, radius * 2.3],
    satin: [
      view.targetX - distance * 0.2,
      distance * 0.72,
      view.targetZ - distance * 0.16,
    ],
  };
}
