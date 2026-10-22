export function stepCount(
  displayed: number,
  target: number,
  elapsedMs: number,
  tauMs: number,
): number {
  if (tauMs <= 0) {
    return target;
  }
  const remaining = (target - displayed) * Math.exp(-elapsedMs / tauMs);
  return Math.abs(remaining) < 0.5 ? target : target - remaining;
}
