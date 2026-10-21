import { describe, expect, it } from "vitest";
import type {
  DeskAction,
  DeskState,
  PhotoSource,
  Quarter,
} from "../contracts";
import { computeStats } from "./stats";
import { initialDeskState, reduceDesk } from "./store";

interface Plan {
  id: string;
  addedAt?: number;
  simulated?: Quarter;
  uprightFix?: Quarter | null;
  correction?: Quarter;
  decidedAt?: number;
  inferenceMs?: number;
  placed?: boolean;
  failed?: boolean;
}

function source(plan: Plan): PhotoSource {
  const uprightFix = plan.uprightFix === undefined ? 0 : plan.uprightFix;
  return {
    id: plan.id,
    kind: uprightFix === null ? "user" : "commons",
    title: plan.id,
    aspect: 1,
    thumbUrl: null,
    largeUrl: null,
    file: null,
    attribution: null,
    uprightFix,
  };
}

function desk(plans: readonly Plan[], total = plans.length): DeskState {
  const actions: DeskAction[] = [];
  for (const plan of plans) {
    actions.push({
      type: "added",
      source: source(plan),
      simulated: plan.simulated ?? 0,
      at: plan.addedAt ?? 0,
    });
    if (plan.failed && plan.correction === undefined) {
      actions.push({ type: "failed", id: plan.id, error: "x" });
      continue;
    }
    if (plan.correction === undefined) {
      continue;
    }
    actions.push(
      { type: "loaded", id: plan.id, aspect: 1 },
      { type: "landed", id: plan.id },
      { type: "scanStarted", id: plan.id },
      {
        type: "decided",
        id: plan.id,
        prediction: {
          correction: plan.correction,
          confidence: 0.8,
          probabilities: [0.25, 0.25, 0.25, 0.25],
          inferenceMs: plan.inferenceMs ?? 200,
        },
        at: plan.decidedAt ?? 0,
      },
    );
    if (plan.placed) {
      actions.push({ type: "placed", id: plan.id });
    }
    if (plan.failed) {
      actions.push({ type: "failed", id: plan.id, error: "x" });
    }
  }
  return actions.reduce(reduceDesk, initialDeskState(total));
}

describe("computeStats", () => {
  it("reports an empty desk", () => {
    expect(computeStats(initialDeskState(30), 0)).toEqual({
      total: 30,
      added: 0,
      processed: 0,
      placed: 0,
      rotatedFixed: 0,
      judged: 0,
      correct: 0,
      accuracy: null,
      perSecond: null,
      medianMs: null,
      failed: 0,
      crooked: 0,
    });
  });

  it("counts photos that are on the desk but not straightened yet", () => {
    const state = desk([
      { id: "a", correction: 0, placed: true },
      { id: "b", correction: 1 },
      { id: "c" },
      { id: "e", failed: true },
    ]);
    const landed = reduceDesk(
      reduceDesk(reduceDesk(state, { type: "loaded", id: "c", aspect: 1 }), {
        type: "landed",
        id: "c",
      }),
      { type: "added", source: source({ id: "z" }), simulated: 0, at: 0 },
    );
    expect(computeStats(landed, 0).crooked).toBe(2);
  });

  it("counts placed, processed, rotated, failed and added records", () => {
    const stats = computeStats(
      desk(
        [
          { id: "a", correction: 0, placed: true },
          { id: "b", correction: 1, placed: true },
          { id: "c", correction: 3 },
          { id: "d" },
          { id: "e", failed: true },
          { id: "f", correction: 2, failed: true },
        ],
        40,
      ),
      0,
    );
    expect(stats).toMatchObject({
      total: 40,
      added: 6,
      processed: 4,
      placed: 2,
      rotatedFixed: 3,
      failed: 2,
    });
  });

  it("measures accuracy only over judged records", () => {
    const stats = computeStats(
      desk([
        { id: "a", simulated: 1, correction: 3 },
        { id: "b", simulated: 2, correction: 2 },
        { id: "c", simulated: 3, correction: 2 },
        { id: "d", uprightFix: null, simulated: 1, correction: 1 },
        { id: "e", uprightFix: 2, simulated: 0, correction: 2 },
      ]),
      0,
    );
    expect(stats.judged).toBe(4);
    expect(stats.correct).toBe(3);
    expect(stats.accuracy).toBeCloseTo(0.75);
  });

  it("takes the median inference time", () => {
    const odd = desk([
      { id: "a", correction: 0, inferenceMs: 300 },
      { id: "b", correction: 0, inferenceMs: 100 },
      { id: "c", correction: 0, inferenceMs: 250 },
    ]);
    const even = desk([
      { id: "a", correction: 0, inferenceMs: 300 },
      { id: "b", correction: 0, inferenceMs: 100 },
      { id: "c", correction: 0, inferenceMs: 250 },
      { id: "d", correction: 0, inferenceMs: 200 },
    ]);
    expect(computeStats(odd, 0).medianMs).toBe(250);
    expect(computeStats(even, 0).medianMs).toBe(225);
  });

  it("returns no rate until two decisions fall inside the window", () => {
    const one = desk([{ id: "a", correction: 0, decidedAt: 5_000 }]);
    const stale = desk([
      { id: "a", correction: 0, decidedAt: 1_000 },
      { id: "b", correction: 0, decidedAt: 2_000 },
    ]);
    expect(computeStats(one, 6_000).perSecond).toBeNull();
    expect(computeStats(stale, 30_000).perSecond).toBeNull();
  });

  it("divides decisions in the window by the full window once it is covered", () => {
    const plans: Plan[] = [];
    for (let index = 0; index < 60; index += 1) {
      plans.push({
        id: `p${index}`,
        addedAt: 0,
        correction: 0,
        decidedAt: 1_000 + index * 250,
      });
    }
    const now = 1_000 + 59 * 250;
    expect(computeStats(desk(plans), now).perSecond).toBeCloseTo(40 / 10);
    expect(computeStats(desk(plans), now, 5_000).perSecond).toBeCloseTo(
      20 / 5,
    );
  });

  it("only divides by the part of the window since the first photo arrived", () => {
    const stats = computeStats(
      desk([
        { id: "a", addedAt: 1_000, correction: 0, decidedAt: 1_800 },
        { id: "b", addedAt: 1_000, correction: 0, decidedAt: 1_900 },
        { id: "c", addedAt: 1_100, correction: 0, decidedAt: 2_500 },
        { id: "d", addedAt: 1_100, correction: 0, decidedAt: 3_000 },
      ]),
      3_000,
    );
    expect(stats.perSecond).toBeCloseTo(4 / 2);
  });

  it("ignores decisions that are later than now", () => {
    const stats = computeStats(
      desk([
        { id: "a", addedAt: 0, correction: 0, decidedAt: 9_000 },
        { id: "b", addedAt: 0, correction: 0, decidedAt: 9_500 },
        { id: "c", addedAt: 0, correction: 0, decidedAt: 20_000 },
      ]),
      10_000,
    );
    expect(stats.perSecond).toBeCloseTo(2 / 10);
  });
});
