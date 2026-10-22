const DESKTOP_PIXEL_BUDGET = 5.4e6;
const LOW_POWER_PIXEL_BUDGET = 1.6e6;
const SLOW_FRAME_MS = 22;
const SLOW_SECONDS = 0.8;
const STEP = 0.8;
const FLOOR = 0.75;
const SMOOTHING = 0.1;

export function initialPixelRatio(
  devicePixelRatio: number,
  width: number,
  height: number,
  lowPower: boolean,
): number {
  const base = Math.min(devicePixelRatio || 1, lowPower ? 1.5 : 2);
  const budget = lowPower ? LOW_POWER_PIXEL_BUDGET : DESKTOP_PIXEL_BUDGET;
  const cap = Math.sqrt(budget / Math.max(1, width * height));
  return Math.max(0.5, Math.min(base, cap));
}

export interface Governor {
  readonly ratio: number;
  sample(frameMs: number): boolean;
}

export function createGovernor(start: number): Governor {
  let ratio = start;
  let average = 16.7;
  let slow = 0;
  return {
    get ratio() {
      return ratio;
    },
    sample(frameMs: number) {
      const clamped = Math.min(100, Math.max(0, frameMs));
      average += (clamped - average) * SMOOTHING;
      slow = average > SLOW_FRAME_MS ? slow + clamped / 1000 : 0;
      if (slow < SLOW_SECONDS || ratio <= FLOOR) {
        return false;
      }
      ratio = Math.max(FLOOR, ratio * STEP);
      slow = 0;
      return true;
    },
  };
}
