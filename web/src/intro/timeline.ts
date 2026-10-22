import { envelope, smoothstep } from "./easing";

export type IntroPhase =
  | "space"
  | "gather"
  | "descent"
  | "city"
  | "room"
  | "handoff"
  | "done";

export const INTRO_DURATION_MS = 10000;
export const INTRO_SECONDS = INTRO_DURATION_MS / 1000;
export const HANDOFF_START = 9.4;
export const SKIP_FADE_SECONDS = 0.36;

export const PHASE_STARTS: readonly (readonly [IntroPhase, number])[] = [
  ["space", 0],
  ["gather", 0.9],
  ["descent", 3.9],
  ["city", 5.9],
  ["room", 7.7],
  ["handoff", HANDOFF_START],
  ["done", INTRO_SECONDS],
];

export const GATHER = {
  lightStart: 0.75,
  lightEnd: 2.1,
  launchStart: 1.1,
  arrivalStart: 2.15,
  arrivalEnd: 3.85,
} as const;

export const CLOUD_PASS = {
  riseStart: 5.3,
  riseEnd: 5.86,
  fallStart: 6.12,
  fallEnd: 6.6,
  peak: 0.92,
} as const;

export const WINDOW_PASS = {
  riseStart: 7.97,
  riseEnd: 8.08,
  fallStart: 8.13,
  fallEnd: 8.34,
  peak: 0.3,
} as const;

export const CITY_IN: readonly [number, number] = [5.93, 6.09];
export const PORTAL: readonly [number, number] = [7.12, 7.32];
export const ROOM_IN: readonly [number, number] = [7.88, 7.94];

export function phaseAt(time: number): IntroPhase {
  let current: IntroPhase = "space";
  for (const [phase, start] of PHASE_STARTS) {
    if (time >= start) {
      current = phase;
    }
  }
  return current;
}

export function phasesBetween(from: number, to: number): IntroPhase[] {
  const crossed: IntroPhase[] = [];
  for (const [phase, start] of PHASE_STARTS) {
    if (start > from && start <= to) {
      crossed.push(phase);
    }
  }
  return crossed;
}

export interface StageMix {
  globe: number;
  city: number;
  room: number;
  portal: number;
  opening: number;
  clouds: number;
  glow: number;
  fade: number;
  intro: number;
  exposure: number;
}

export function createStageMix(): StageMix {
  return {
    globe: 1,
    city: 0,
    room: 0,
    portal: 0,
    opening: 0,
    clouds: 0,
    glow: 0,
    fade: 1,
    intro: 0,
    exposure: 1,
  };
}

export function stageMix(time: number, out: StageMix): StageMix {
  const city = smoothstep(CITY_IN[0], CITY_IN[1], time);
  const room = smoothstep(ROOM_IN[0], ROOM_IN[1], time);
  out.globe = 1 - city;
  out.city = city * (1 - room);
  out.room = room;
  out.opening = smoothstep(PORTAL[0], PORTAL[1], time);
  out.portal = out.opening * out.city;
  out.clouds =
    CLOUD_PASS.peak *
    envelope(
      time,
      CLOUD_PASS.riseStart,
      CLOUD_PASS.riseEnd,
      CLOUD_PASS.fallStart,
      CLOUD_PASS.fallEnd,
    );
  out.glow =
    WINDOW_PASS.peak *
    envelope(
      time,
      WINDOW_PASS.riseStart,
      WINDOW_PASS.riseEnd,
      WINDOW_PASS.fallStart,
      WINDOW_PASS.fallEnd,
    );
  out.fade = 1 - smoothstep(HANDOFF_START, INTRO_SECONDS, time);
  out.intro = smoothstep(0, 0.7, time);
  out.exposure = 1;
  return out;
}
