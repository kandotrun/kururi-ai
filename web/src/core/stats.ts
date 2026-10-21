import type { DeskState, DeskStats, PhotoPhase } from "../contracts";

const CROOKED_PHASES: ReadonlySet<PhotoPhase> = new Set([
  "landing",
  "waiting",
  "scanning",
  "placing",
]);

const DEFAULT_WINDOW_MS = 10_000;

function median(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[middle]!;
  }
  return (sorted[middle - 1]! + sorted[middle]!) / 2;
}

export function computeStats(
  state: DeskState,
  now: number,
  windowMs: number = DEFAULT_WINDOW_MS,
): DeskStats {
  let processed = 0;
  let placed = 0;
  let rotatedFixed = 0;
  let judged = 0;
  let correct = 0;
  let failed = 0;
  let crooked = 0;
  let recent = 0;
  let firstAddedAt = Number.POSITIVE_INFINITY;
  const inferenceTimes: number[] = [];
  const windowStart = now - windowMs;
  for (const record of state.records.values()) {
    firstAddedAt = Math.min(firstAddedAt, record.addedAt);
    if (record.phase === "placed") {
      placed += 1;
    } else if (record.phase === "failed") {
      failed += 1;
    } else if (CROOKED_PHASES.has(record.phase)) {
      crooked += 1;
    }
    if (record.prediction) {
      processed += 1;
      inferenceTimes.push(record.prediction.inferenceMs);
      if (record.prediction.correction !== 0) {
        rotatedFixed += 1;
      }
    }
    if (record.correct !== null) {
      judged += 1;
      if (record.correct) {
        correct += 1;
      }
    }
    if (
      record.decidedAt !== null &&
      record.decidedAt > windowStart &&
      record.decidedAt <= now
    ) {
      recent += 1;
    }
  }
  const coveredMs = now - Math.max(windowStart, firstAddedAt);
  return {
    total: state.total,
    added: state.order.length,
    processed,
    placed,
    rotatedFixed,
    judged,
    correct,
    accuracy: judged > 0 ? correct / judged : null,
    perSecond:
      recent >= 2 && coveredMs > 0 ? recent / (coveredMs / 1000) : null,
    medianMs: median(inferenceTimes),
    failed,
    crooked,
  };
}
