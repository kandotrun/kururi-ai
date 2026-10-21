import { envelope, smoothstep } from "./easing";

export type IntroPhase =
  | "space"
  | "gather"
  | "descent"
  | "city"
  | "room"
  | "handoff"
  | "done";

export const INTRO_DURATION_MS = 9600;
export const INTRO_SECONDS = INTRO_DURATION_MS / 1000;
export const HANDOFF_START = 9.0;
export const SKIP_FADE_SECONDS = 0.36;

export const PHASE_STARTS: readonly (readonly [IntroPhase, number])[] = [
  ["space", 0],
  ["gather", 1.0],
  ["descent", 3.2],
  ["city", 5.4],
  ["room", 7.2],
  ["handoff", HANDOFF_START],
  ["done", INTRO_SECONDS],
];

export const GATHER = {
  lightStart: 1.0,
  lightEnd: 2.3,
  launchStart: 1.25,
  arrivalStart: 2.25,
  arrivalEnd: 3.65,
} as const;

export const CLOUD_PASS = {
  riseStart: 4.92,
  riseEnd: 5.4,
  fallStart: 5.7,
  fallEnd: 6.22,
  peak: 0.97,
} as const;

export const WINDOW_PASS = {
  riseStart: 7.04,
  riseEnd: 7.3,
  fallStart: 7.44,
  fallEnd: 7.9,
  peak: 0.96,
} as const;

export const CITY_IN: readonly [number, number] = [5.47, 5.63];
export const ROOM_IN: readonly [number, number] = [7.33, 7.41];

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
  out.exposure = 1 + 0.5 * room * (1 - smoothstep(7.4, 8.2, time));
  return out;
}
