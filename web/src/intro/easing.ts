export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function clamp01(value: number): number {
  return Number.isNaN(value) ? 0 : clamp(value, 0, 1);
}

export function lerp(from: number, to: number, amount: number): number {
  return from + (to - from) * amount;
}

export function progress(time: number, start: number, end: number): number {
  if (end <= start) {
    return time >= end ? 1 : 0;
  }
  return clamp01((time - start) / (end - start));
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = edge0 === edge1 ? (x >= edge1 ? 1 : 0) : clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

export function smootherstep(edge0: number, edge1: number, x: number): number {
  const t = edge0 === edge1 ? (x >= edge1 ? 1 : 0) : clamp01((x - edge0) / (edge1 - edge0));
  return t * t * t * (t * (t * 6 - 15) + 10);
}

export function easeInCubic(value: number): number {
  const t = clamp01(value);
  return t * t * t;
}

export function easeOutCubic(value: number): number {
  const t = 1 - clamp01(value);
  return 1 - t * t * t;
}

export function easeInOutCubic(value: number): number {
  const t = clamp01(value);
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export function easeInOutSine(value: number): number {
  return 0.5 - 0.5 * Math.cos(Math.PI * clamp01(value));
}

export function envelope(
  time: number,
  riseStart: number,
  riseEnd: number,
  fallStart: number,
  fallEnd: number,
): number {
  return (
    smoothstep(riseStart, riseEnd, time) *
    (1 - smoothstep(fallStart, fallEnd, time))
  );
}

export interface ScalarKey {
  t: number;
  v: number;
  slope?: number;
}

export type Curve = (time: number) => number;

function validateTimes(times: readonly number[]): void {
  if (times.length === 0) {
    throw new Error("a spline needs at least one key");
  }
  for (let index = 1; index < times.length; index += 1) {
    if (!(times[index]! > times[index - 1]!)) {
      throw new Error("spline keys must be strictly increasing in time");
    }
  }
}

function monotoneSlopes(keys: readonly ScalarKey[]): number[] {
  const count = keys.length;
  const secants: number[] = [];
  for (let index = 0; index < count - 1; index += 1) {
    const a = keys[index]!;
    const b = keys[index + 1]!;
    secants.push((b.v - a.v) / (b.t - a.t));
  }
  const slopes: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const before = secants[index - 1];
    const after = secants[index];
    if (before === undefined) {
      slopes.push(after ?? 0);
    } else if (after === undefined) {
      slopes.push(before);
    } else if (before * after <= 0) {
      slopes.push(0);
    } else {
      slopes.push((before + after) / 2);
    }
  }
  for (let index = 0; index < count - 1; index += 1) {
    const secant = secants[index]!;
    if (secant === 0) {
      slopes[index] = 0;
      slopes[index + 1] = 0;
      continue;
    }
    const alpha = slopes[index]! / secant;
    const beta = slopes[index + 1]! / secant;
    const magnitude = alpha * alpha + beta * beta;
    if (magnitude > 9) {
      const tau = 3 / Math.sqrt(magnitude);
      slopes[index] = tau * alpha * secant;
      slopes[index + 1] = tau * beta * secant;
    }
  }
  for (let index = 0; index < count; index += 1) {
    const fixed = keys[index]!.slope;
    if (fixed !== undefined) {
      slopes[index] = fixed;
    }
  }
  return slopes;
}

export function monotoneSpline(keys: readonly ScalarKey[]): Curve {
  validateTimes(keys.map((key) => key.t));
  const times = Float64Array.from(keys, (key) => key.t);
  const values = Float64Array.from(keys, (key) => key.v);
  const slopes = Float64Array.from(monotoneSlopes(keys));
  const last = keys.length - 1;
  return (time: number) => {
    if (!(time > times[0]!)) {
      return values[0]!;
    }
    if (time >= times[last]!) {
      return values[last]!;
    }
    let low = 0;
    let high = last;
    while (high - low > 1) {
      const middle = (low + high) >> 1;
      if (times[middle]! <= time) {
        low = middle;
      } else {
        high = middle;
      }
    }
    const span = times[high]! - times[low]!;
    const s = (time - times[low]!) / span;
    const s2 = s * s;
    const s3 = s2 * s;
    return (
      (2 * s3 - 3 * s2 + 1) * values[low]! +
      (s3 - 2 * s2 + s) * span * slopes[low]! +
      (-2 * s3 + 3 * s2) * values[high]! +
      (s3 - s2) * span * slopes[high]!
    );
  };
}

export interface VectorKey {
  t: number;
  v: readonly number[];
  slope?: readonly number[];
}

export type VectorCurve = (time: number, out: number[]) => number[];

export function vectorTrack(keys: readonly VectorKey[]): VectorCurve {
  const size = keys[0]?.v.length ?? 0;
  if (keys.some((key) => key.v.length !== size)) {
    throw new Error("vector keys must share one size");
  }
  const curves: Curve[] = [];
  for (let component = 0; component < size; component += 1) {
    curves.push(
      monotoneSpline(
        keys.map((key) => {
          const slope = key.slope?.[component];
          return slope === undefined
            ? { t: key.t, v: key.v[component]! }
            : { t: key.t, v: key.v[component]!, slope };
        }),
      ),
    );
  }
  return (time: number, out: number[]) => {
    for (let component = 0; component < size; component += 1) {
      out[component] = curves[component]!(time);
    }
    return out;
  };
}
