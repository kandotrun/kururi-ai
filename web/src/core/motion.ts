import type { DeskPose, Quarter } from "../contracts";
import { range, type Random } from "./random";
import { quarterToYaw, turnDelta } from "./rotation";

export interface Spring {
  value: number;
  velocity: number;
}

export const FALL_SECONDS = 0.75;
export const FLIGHT_SECONDS = 1.0;
export const STRAIGHTEN_SECONDS = 0.7;
export const STRAIGHTEN_LIFT = 0.24;
export const UNSETTLE_SECONDS = 0.55;
export const UNSETTLE_LIFT = 0.14;
export const REDUCED_FADE_SECONDS = 0.2;
export const REDUCED_SLIDE_SECONDS = 0.3;
export const REPLAY_STAGGER_SECONDS = 0.0006;
export const REPLAY_MAX_SECONDS = 4;

const FALL_TOUCHDOWN = 0.86;
const FLIGHT_TOUCHDOWN = 0.9;
const FLIGHT_TILT = 0.2;
const FLIGHT_ROLL = 0.07;
const TURN_OVERSHOOT = 1.5;
const IN_PLACE_RISE = 0.3;
const IN_PLACE_DROP_START = 0.56;
const IN_PLACE_DROP_SPAN = 0.32;
const IN_PLACE_TOUCHDOWN = 0.9;
const IN_PLACE_TURN_START = 0.1;
const IN_PLACE_TURN_SPAN = 0.62;
const IN_PLACE_SLIDE_START = 0.06;
const IN_PLACE_SLIDE_SPAN = 0.7;
const CORNER_TILT = 0.11;
const CORNER_ROLL = 0.06;

export function clamp01(value: number): number {
  if (!(value > 0)) {
    return 0;
  }
  return value < 1 ? value : 1;
}

export function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

export function easeOutCubic(t: number): number {
  const inverse = 1 - clamp01(t);
  return 1 - inverse * inverse * inverse;
}

export function easeInOutCubic(t: number): number {
  const value = clamp01(t);
  if (value < 0.5) {
    return 4 * value * value * value;
  }
  const inverse = -2 * value + 2;
  return 1 - (inverse * inverse * inverse) / 2;
}

function smoothstep(t: number): number {
  const value = clamp01(t);
  return value * value * (3 - 2 * value);
}

export function easeOutBack(t: number, overshoot = 1.70158): number {
  const shifted = clamp01(t) - 1;
  return (
    1 +
    (overshoot + 1) * shifted * shifted * shifted +
    overshoot * shifted * shifted
  );
}

export function springStep(
  spring: Spring,
  target: number,
  omega: number,
  dt: number,
): void {
  if (!(dt > 0)) {
    return;
  }
  const offset = spring.value - target;
  const decay = Math.exp(-omega * dt);
  const drive = (spring.velocity + omega * offset) * dt;
  spring.value = target + (offset + drive) * decay;
  spring.velocity = (spring.velocity - omega * drive) * decay;
}

export function springSettled(
  spring: Spring,
  target: number,
  epsilon: number,
): boolean {
  return (
    Math.abs(spring.value - target) < epsilon &&
    Math.abs(spring.velocity) < epsilon * 4
  );
}

export function createPose(): DeskPose {
  return { x: 0, y: 0, z: 0, yaw: 0, tiltX: 0, tiltZ: 0, scale: 1 };
}

export function copyPose(out: DeskPose, from: DeskPose): DeskPose {
  out.x = from.x;
  out.y = from.y;
  out.z = from.z;
  out.yaw = from.yaw;
  out.tiltX = from.tiltX;
  out.tiltZ = from.tiltZ;
  out.scale = from.scale;
  return out;
}

export function placedYaw(simulated: Quarter, correction: Quarter): number {
  return quarterToYaw(simulated) + turnDelta(correction);
}

export function fallStart(
  out: DeskPose,
  rest: DeskPose,
  random: Random,
): DeskPose {
  const tiltSign = random() < 0.5 ? -1 : 1;
  out.x = rest.x + range(random, -0.4, 0.4);
  out.y = rest.y + range(random, 2.0, 2.6);
  out.z = rest.z + range(random, -0.45, 0.2);
  out.yaw = rest.yaw + range(random, -0.9, 0.9);
  out.tiltX = tiltSign * range(random, 0.25, 0.6);
  out.tiltZ = range(random, -0.5, 0.5);
  out.scale = rest.scale;
  return out;
}

export function fallPose(
  out: DeskPose,
  t: number,
  from: DeskPose,
  to: DeskPose,
): DeskPose {
  if (!(t > 0)) {
    return copyPose(out, from);
  }
  if (t >= 1) {
    return copyPose(out, to);
  }
  const u = clamp01(t / FALL_TOUCHDOWN);
  const smooth = u * u * (3 - 2 * u);
  const descend = 0.35 * u + 0.65 * smooth;
  const glide = 1 - (1 - u) * (1 - u);
  const settle =
    t > FALL_TOUCHDOWN
      ? 0.008 *
        Math.sin((Math.PI * (t - FALL_TOUCHDOWN)) / (1 - FALL_TOUCHDOWN))
      : 0;
  const flutter = Math.pow(1 - u, 1.2);
  out.x = lerp(from.x, to.x, glide);
  out.y = lerp(from.y, to.y, descend) + settle;
  out.z = lerp(from.z, to.z, glide);
  out.yaw = lerp(from.yaw, to.yaw, easeOutCubic(u));
  out.tiltX = from.tiltX * flutter * Math.cos(2 * Math.PI * 1.6 * t);
  out.tiltZ = from.tiltZ * flutter * Math.cos(2 * Math.PI * 1.15 * t);
  out.scale = lerp(from.scale, to.scale, glide);
  return out;
}

export function flightArc(distance: number): number {
  const safe = Number.isFinite(distance) ? Math.max(0, distance) : 0;
  return Math.min(0.85, Math.max(0.36, 0.42 + 0.05 * safe));
}

export function flightPose(
  out: DeskPose,
  t: number,
  from: DeskPose,
  to: DeskPose,
  arc: number,
): DeskPose {
  if (!(t > 0)) {
    return copyPose(out, from);
  }
  if (t >= 1) {
    return copyPose(out, to);
  }
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const length = Math.hypot(dx, dz);
  const directionX = length > 1e-6 ? dx / length : 0;
  const directionZ = length > 1e-6 ? dz / length : -1;
  const u = clamp01(t / FLIGHT_TOUCHDOWN);
  const travel = easeInOutCubic((t - 0.06) / 0.8);
  const lift = arc * Math.pow(Math.sin(Math.PI * u), 1.35);
  const settle =
    t > FLIGHT_TOUCHDOWN
      ? 0.006 *
        Math.sin((Math.PI * (t - FLIGHT_TOUCHDOWN)) / (1 - FLIGHT_TOUCHDOWN))
      : 0;
  const carry = Math.sin(Math.PI * u);
  const bell = carry * carry;
  const turn = easeOutBack((t - 0.1) / 0.62, TURN_OVERSHOOT);
  out.x = lerp(from.x, to.x, travel);
  out.y = lerp(from.y, to.y, travel) + lift + settle;
  out.z = lerp(from.z, to.z, travel);
  out.yaw = lerp(from.yaw, to.yaw, turn);
  out.tiltX =
    lerp(from.tiltX, to.tiltX, travel) +
    bell * (FLIGHT_TILT * -directionZ + FLIGHT_ROLL * -directionX);
  out.tiltZ =
    lerp(from.tiltZ, to.tiltZ, travel) +
    bell * (FLIGHT_TILT * directionX + FLIGHT_ROLL * -directionZ);
  out.scale = lerp(from.scale, to.scale, travel);
  return out;
}

export function slidePose(
  out: DeskPose,
  t: number,
  from: DeskPose,
  to: DeskPose,
): DeskPose {
  if (t >= 1) {
    return copyPose(out, to);
  }
  const value = clamp01(t);
  out.x = lerp(from.x, to.x, value);
  out.y = lerp(from.y, to.y, value);
  out.z = lerp(from.z, to.z, value);
  out.yaw = lerp(from.yaw, to.yaw, value);
  out.tiltX = lerp(from.tiltX, to.tiltX, value);
  out.tiltZ = lerp(from.tiltZ, to.tiltZ, value);
  out.scale = lerp(from.scale, to.scale, value);
  return out;
}

export function turnInPlacePose(
  out: DeskPose,
  t: number,
  from: DeskPose,
  to: DeskPose,
  lift: number,
): DeskPose {
  if (!(t > 0)) {
    return copyPose(out, from);
  }
  if (t >= 1) {
    return copyPose(out, to);
  }
  const height = Number.isFinite(lift) ? Math.max(0, lift) : 0;
  const raised =
    easeOutCubic(t / IN_PLACE_RISE) *
    (1 - smoothstep((t - IN_PLACE_DROP_START) / IN_PLACE_DROP_SPAN));
  const settle =
    t > IN_PLACE_TOUCHDOWN && height > 0
      ? 0.004 *
        Math.sin((Math.PI * (t - IN_PLACE_TOUCHDOWN)) / (1 - IN_PLACE_TOUCHDOWN))
      : 0;
  const slide = easeInOutCubic(
    (t - IN_PLACE_SLIDE_START) / IN_PLACE_SLIDE_SPAN,
  );
  const turn = easeOutBack(
    (t - IN_PLACE_TURN_START) / IN_PLACE_TURN_SPAN,
    TURN_OVERSHOOT,
  );
  const corner = raised * Math.min(1, height / STRAIGHTEN_LIFT);
  const direction = to.yaw < from.yaw ? -1 : 1;
  out.x = lerp(from.x, to.x, slide);
  out.y = lerp(from.y, to.y, slide) + height * raised + settle;
  out.z = lerp(from.z, to.z, slide);
  out.yaw = lerp(from.yaw, to.yaw, turn);
  out.tiltX = lerp(from.tiltX, to.tiltX, slide) + corner * CORNER_TILT;
  out.tiltZ =
    lerp(from.tiltZ, to.tiltZ, slide) + corner * CORNER_ROLL * direction;
  out.scale = lerp(from.scale, to.scale, slide);
  return out;
}

export function replayDelay(
  rank: number,
  count: number,
  flightSeconds: number,
  maxSeconds = REPLAY_MAX_SECONDS,
): number {
  const budget = Math.max(0, maxSeconds - flightSeconds);
  const stagger = Math.min(
    REPLAY_STAGGER_SECONDS,
    budget / Math.max(1, count - 1),
  );
  return Math.max(0, rank) * stagger;
}
