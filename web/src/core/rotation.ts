import type { Quarter } from "../contracts";

const SIMULATED_WEIGHTS = [0.1, 0.3, 0.3, 0.3] as const;

export function normalizeQuarter(value: number): Quarter {
  return (((Math.round(value) % 4) + 4) % 4) as Quarter;
}

export function quarterToYaw(quarter: Quarter): number {
  return ((0 - quarter) * Math.PI) / 2;
}

export function finalQuarter(simulated: Quarter, correction: Quarter): Quarter {
  return normalizeQuarter(simulated + correction);
}

export function isUpright(simulated: Quarter, correction: Quarter): boolean {
  return finalQuarter(simulated, correction) === 0;
}

export function markSide(simulated: Quarter, correction: Quarter): Quarter {
  return normalizeQuarter(-(simulated + correction));
}

export function turnDelta(correction: Quarter): number {
  return correction === 3 ? Math.PI / 2 : ((0 - correction) * Math.PI) / 2;
}

export function pickSimulated(random: () => number): Quarter {
  let threshold = random();
  for (let quarter = 0; quarter < 3; quarter += 1) {
    threshold -= SIMULATED_WEIGHTS[quarter]!;
    if (threshold < 0) {
      return quarter as Quarter;
    }
  }
  return 3;
}

export function expectedCorrection(
  uprightFix: Quarter,
  simulated: Quarter,
): Quarter {
  return normalizeQuarter(uprightFix - simulated);
}

export function isCorrect(
  uprightFix: Quarter | null,
  simulated: Quarter,
  correction: Quarter,
): boolean | null {
  if (uprightFix === null) {
    return null;
  }
  return expectedCorrection(uprightFix, simulated) === correction;
}
