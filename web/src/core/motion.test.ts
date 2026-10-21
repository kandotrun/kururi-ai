import { describe, expect, it } from "vitest";
import type { DeskPose, Quarter } from "../contracts";
import {
  FLIGHT_SECONDS,
  MARK_LEAD_SECONDS,
  MARK_WRITE_SECONDS,
  STRAIGHTEN_LIFT,
  STRAIGHTEN_SECONDS,
  UNSETTLE_LIFT,
  UNSETTLE_SECONDS,
  clamp01,
  createPose,
  easeInOutCubic,
  easeOutBack,
  easeOutCubic,
  fallPose,
  fallStart,
  flightArc,
  flightPose,
  lerp,
  placedYaw,
  replayDelay,
  slidePose,
  springSettled,
  springStep,
  straightenStart,
  turnInPlacePose,
} from "./motion";
import { mulberry32 } from "./random";
import { quarterToYaw, turnDelta } from "./rotation";

function pose(values: Partial<DeskPose>): DeskPose {
  return { ...createPose(), ...values };
}

function expectPose(actual: DeskPose, expected: DeskPose): void {
  expect(actual.x).toBeCloseTo(expected.x, 9);
  expect(actual.y).toBeCloseTo(expected.y, 9);
  expect(actual.z).toBeCloseTo(expected.z, 9);
  expect(actual.yaw).toBeCloseTo(expected.yaw, 9);
  expect(actual.tiltX).toBeCloseTo(expected.tiltX, 9);
  expect(actual.tiltZ).toBeCloseTo(expected.tiltZ, 9);
  expect(actual.scale).toBeCloseTo(expected.scale, 9);
}

function finite(value: DeskPose): boolean {
  return Object.values(value).every((component) => Number.isFinite(component));
}

describe("easings", () => {
  const easings = [easeOutCubic, easeInOutCubic, (t: number) => easeOutBack(t)];

  it("start at zero and end at one", () => {
    for (const easing of easings) {
      expect(easing(0)).toBeCloseTo(0, 12);
      expect(easing(1)).toBeCloseTo(1, 12);
    }
  });

  it("clamp outside the unit interval", () => {
    for (const easing of easings) {
      expect(easing(-2)).toBeCloseTo(0, 12);
      expect(easing(3)).toBeCloseTo(1, 12);
      expect(easing(Number.NaN)).toBeCloseTo(0, 12);
    }
  });

  it("are monotonic where they should be", () => {
    let previousOut = 0;
    let previousInOut = 0;
    for (let step = 1; step <= 100; step += 1) {
      const t = step / 100;
      expect(easeOutCubic(t)).toBeGreaterThanOrEqual(previousOut);
      expect(easeInOutCubic(t)).toBeGreaterThanOrEqual(previousInOut);
      previousOut = easeOutCubic(t);
      previousInOut = easeInOutCubic(t);
    }
  });

  it("lets easeOutBack overshoot before settling", () => {
    let peak = 0;
    for (let step = 0; step <= 100; step += 1) {
      peak = Math.max(peak, easeOutBack(step / 100));
    }
    expect(peak).toBeGreaterThan(1.02);
    expect(peak).toBeLessThan(1.2);
    expect(easeOutBack(0.5, 0)).toBeLessThanOrEqual(1);
  });

  it("clamp01 and lerp behave", () => {
    expect(clamp01(-1)).toBe(0);
    expect(clamp01(2)).toBe(1);
    expect(clamp01(Number.NaN)).toBe(0);
    expect(lerp(2, 6, 0.25)).toBe(3);
  });
});

describe("springStep", () => {
  it("approaches the target without overshoot from rest", () => {
    const spring = { value: 0, velocity: 0 };
    let previous = 0;
    for (let frame = 0; frame < 240; frame += 1) {
      springStep(spring, 10, 4, 1 / 60);
      expect(spring.value).toBeGreaterThanOrEqual(previous - 1e-9);
      expect(spring.value).toBeLessThanOrEqual(10 + 1e-9);
      previous = spring.value;
    }
    expect(spring.value).toBeCloseTo(10, 3);
    expect(springSettled(spring, 10, 0.001)).toBe(true);
  });

  it("is stable for huge time steps", () => {
    const spring = { value: 5, velocity: 40 };
    springStep(spring, -3, 6, 10);
    expect(spring.value).toBeCloseTo(-3, 6);
    expect(Number.isFinite(spring.velocity)).toBe(true);
  });

  it("ignores negative or invalid steps", () => {
    const spring = { value: 1, velocity: 0 };
    springStep(spring, 4, 3, -1);
    springStep(spring, 4, 3, Number.NaN);
    expect(spring.value).toBe(1);
  });

  it("is not settled while moving", () => {
    expect(springSettled({ value: 1, velocity: 0.5 }, 1, 0.01)).toBe(false);
    expect(springSettled({ value: 0.5, velocity: 0 }, 1, 0.01)).toBe(false);
  });
});

describe("placedYaw", () => {
  it("adds the shortest visual turn to the crooked yaw", () => {
    for (let simulated = 0; simulated < 4; simulated += 1) {
      for (let correction = 0; correction < 4; correction += 1) {
        const yaw = placedYaw(simulated as Quarter, correction as Quarter);
        expect(yaw).toBeCloseTo(
          quarterToYaw(simulated as Quarter) + turnDelta(correction as Quarter),
        );
        const final = ((simulated + correction) % 4) as Quarter;
        const difference = yaw - quarterToYaw(final);
        const turns = difference / (2 * Math.PI);
        expect(Math.abs(turns - Math.round(turns))).toBeLessThan(1e-9);
      }
    }
  });
});

describe("fallPose", () => {
  const rest = pose({ x: 3, y: 0.012, z: -2, yaw: -1.6, scale: 1 });
  const from = fallStart(createPose(), rest, mulberry32(4));

  it("starts high above the rest spot", () => {
    expect(from.y - rest.y).toBeGreaterThan(1.9);
    expect(from.y - rest.y).toBeLessThan(2.7);
    expect(Math.hypot(from.x - rest.x, from.z - rest.z)).toBeLessThan(0.7);
    expect(Math.abs(from.tiltX) + Math.abs(from.tiltZ)).toBeGreaterThan(0.1);
  });

  it("drops from above or slightly behind, never from the viewer's side", () => {
    const random = mulberry32(12);
    for (let index = 0; index < 300; index += 1) {
      const start = fallStart(createPose(), rest, random);
      expect(start.z - rest.z).toBeLessThanOrEqual(0.2);
      expect(Math.abs(start.x - rest.x)).toBeLessThanOrEqual(0.4);
    }
  });

  it("matches the endpoints", () => {
    expectPose(fallPose(createPose(), 0, from, rest), from);
    expectPose(fallPose(createPose(), 1, from, rest), rest);
    expectPose(fallPose(createPose(), 4, from, rest), rest);
  });

  it("descends without passing through the desk and stays finite", () => {
    const out = createPose();
    for (let step = 0; step <= 200; step += 1) {
      fallPose(out, step / 200, from, rest);
      expect(finite(out)).toBe(true);
      expect(out.y).toBeGreaterThanOrEqual(rest.y - 1e-9);
      expect(out.y).toBeLessThanOrEqual(from.y + 1e-9);
    }
  });

  it("is mostly down by the touchdown moment", () => {
    const out = fallPose(createPose(), 0.88, from, rest);
    expect(out.y - rest.y).toBeLessThan(0.05);
  });
});

describe("flightPose", () => {
  const from = pose({ x: 6, y: 0.03, z: 1, yaw: quarterToYaw(1) + 0.08 });
  const to = pose({ x: 2, y: 0.002, z: -1, yaw: placedYaw(1, 3) });
  const arc = flightArc(Math.hypot(4, 2));

  it("matches the endpoints", () => {
    expectPose(flightPose(createPose(), 0, from, to, arc), from);
    expectPose(flightPose(createPose(), 1, from, to, arc), to);
    expectPose(flightPose(createPose(), 1.5, from, to, arc), to);
  });

  it("lifts in an arc that peaks mid-flight", () => {
    const out = createPose();
    let peak = 0;
    let peakAt = 0;
    for (let step = 0; step <= 100; step += 1) {
      flightPose(out, step / 100, from, to, arc);
      expect(finite(out)).toBe(true);
      expect(out.y).toBeGreaterThanOrEqual(to.y - 1e-9);
      if (out.y > peak) {
        peak = out.y;
        peakAt = step / 100;
      }
    }
    expect(peak).toBeGreaterThan(0.4);
    expect(peak).toBeLessThan(1);
    expect(peakAt).toBeGreaterThan(0.25);
    expect(peakAt).toBeLessThan(0.65);
  });

  it("travels monotonically toward the slot", () => {
    const out = createPose();
    let previous = Number.POSITIVE_INFINITY;
    for (let step = 0; step <= 100; step += 1) {
      flightPose(out, step / 100, from, to, arc);
      const remaining = Math.hypot(out.x - to.x, out.z - to.z);
      expect(remaining).toBeLessThanOrEqual(previous + 1e-9);
      previous = remaining;
    }
  });

  it("overshoots the turn and settles", () => {
    const out = createPose();
    const total = to.yaw - from.yaw;
    let beyond = 0;
    for (let step = 0; step <= 100; step += 1) {
      flightPose(out, step / 100, from, to, arc);
      beyond = Math.max(beyond, (out.yaw - from.yaw) / total);
    }
    expect(beyond).toBeGreaterThan(1.01);
    flightPose(out, 0.9, from, to, arc);
    expect(out.yaw).toBeCloseTo(to.yaw, 6);
  });

  it("tilts while carried and lands flat", () => {
    const out = flightPose(createPose(), 0.45, from, to, arc);
    expect(Math.abs(out.tiltX) + Math.abs(out.tiltZ)).toBeGreaterThan(0.05);
    const landed = flightPose(createPose(), 1, from, to, arc);
    expect(landed.tiltX).toBeCloseTo(0, 9);
    expect(landed.tiltZ).toBeCloseTo(0, 9);
  });

  it("does not produce NaN when the print does not move", () => {
    const out = createPose();
    for (let step = 0; step <= 20; step += 1) {
      flightPose(out, step / 20, to, to, flightArc(0));
      expect(finite(out)).toBe(true);
    }
  });
});

describe("flightArc", () => {
  it("rises toward 0.6 for typical hops and stays bounded", () => {
    expect(flightArc(3)).toBeGreaterThan(0.5);
    expect(flightArc(3)).toBeLessThan(0.7);
    expect(flightArc(0)).toBeGreaterThan(0.3);
    expect(flightArc(500)).toBeLessThanOrEqual(0.9);
  });
});

describe("slidePose", () => {
  it("interpolates linearly without arcs", () => {
    const from = pose({ x: 0, y: 0.01, z: 0, yaw: 0 });
    const to = pose({ x: 4, y: 0.002, z: 2, yaw: -Math.PI / 2 });
    const out = slidePose(createPose(), 0.5, from, to);
    expect(out.x).toBeCloseTo(2);
    expect(out.z).toBeCloseTo(1);
    expect(out.y).toBeCloseTo(0.006);
    expect(out.yaw).toBeCloseTo(-Math.PI / 4);
    expectPose(slidePose(createPose(), 1, from, to), to);
  });
});

describe("turnInPlacePose", () => {
  const crooked = pose({
    x: 2.08,
    y: 0.0092,
    z: -0.93,
    yaw: quarterToYaw(1) + 0.1,
  });
  const placed = pose({ x: 2, y: 0.002, z: -1, yaw: placedYaw(1, 3) });

  it("has timings and heights that read as a quick hand straightening", () => {
    expect(STRAIGHTEN_SECONDS).toBeGreaterThanOrEqual(0.6);
    expect(STRAIGHTEN_SECONDS).toBeLessThanOrEqual(0.8);
    expect(STRAIGHTEN_LIFT).toBeGreaterThanOrEqual(0.2);
    expect(STRAIGHTEN_LIFT).toBeLessThanOrEqual(0.3);
    expect(UNSETTLE_LIFT).toBeLessThan(STRAIGHTEN_LIFT);
    expect(UNSETTLE_SECONDS).toBeLessThanOrEqual(STRAIGHTEN_SECONDS);
  });

  it("matches the endpoints", () => {
    const lift = STRAIGHTEN_LIFT;
    expectPose(turnInPlacePose(createPose(), 0, crooked, placed, lift), crooked);
    expectPose(turnInPlacePose(createPose(), -1, crooked, placed, lift), crooked);
    expectPose(turnInPlacePose(createPose(), 1, crooked, placed, lift), placed);
    expectPose(turnInPlacePose(createPose(), 1.4, crooked, placed, lift), placed);
  });

  it("lifts a little and puts the print back down", () => {
    const out = createPose();
    const base = Math.max(crooked.y, placed.y);
    let peak = Number.NEGATIVE_INFINITY;
    let peakAt = 0;
    for (let step = 0; step <= 200; step += 1) {
      const t = step / 200;
      turnInPlacePose(out, t, crooked, placed, STRAIGHTEN_LIFT);
      expect(finite(out)).toBe(true);
      expect(out.y).toBeGreaterThanOrEqual(Math.min(crooked.y, placed.y) - 1e-9);
      if (out.y > peak) {
        peak = out.y;
        peakAt = t;
      }
    }
    expect(peak - base).toBeGreaterThan(0.2);
    expect(peak - base).toBeLessThan(0.3);
    expect(peakAt).toBeGreaterThan(0.2);
    expect(peakAt).toBeLessThan(0.65);
    const late = turnInPlacePose(createPose(), 0.93, crooked, placed, 0.24);
    expect(late.y - placed.y).toBeLessThan(0.01);
  });

  it("turns past the target and has settled before it lands", () => {
    const out = createPose();
    const total = placed.yaw - crooked.yaw;
    let beyond = 0;
    for (let step = 0; step <= 200; step += 1) {
      turnInPlacePose(out, step / 200, crooked, placed, STRAIGHTEN_LIFT);
      beyond = Math.max(beyond, (out.yaw - crooked.yaw) / total);
    }
    expect(beyond).toBeGreaterThan(1.02);
    expect(beyond).toBeLessThan(1.25);
    turnInPlacePose(out, 0.76, crooked, placed, STRAIGHTEN_LIFT);
    expect(out.yaw).toBeCloseTo(placed.yaw, 6);
  });

  it("slides the jittered print into the middle of its cell", () => {
    const out = createPose();
    let previous = Number.POSITIVE_INFINITY;
    for (let step = 0; step <= 100; step += 1) {
      turnInPlacePose(out, step / 100, crooked, placed, STRAIGHTEN_LIFT);
      const remaining = Math.hypot(out.x - placed.x, out.z - placed.z);
      expect(remaining).toBeLessThanOrEqual(previous + 1e-9);
      previous = remaining;
    }
    turnInPlacePose(out, 0.8, crooked, placed, STRAIGHTEN_LIFT);
    expect(Math.hypot(out.x - placed.x, out.z - placed.z)).toBeLessThan(1e-6);
  });

  it("tilts as if picked up by a corner and lands flat", () => {
    const mid = turnInPlacePose(createPose(), 0.4, crooked, placed, 0.24);
    expect(Math.abs(mid.tiltX) + Math.abs(mid.tiltZ)).toBeGreaterThan(0.03);
    expect(Math.abs(mid.tiltX) + Math.abs(mid.tiltZ)).toBeLessThan(0.25);
    const landed = turnInPlacePose(createPose(), 1, crooked, placed, 0.24);
    expect(landed.tiltX).toBeCloseTo(0, 9);
    expect(landed.tiltZ).toBeCloseTo(0, 9);
  });

  it("works backwards to knock a placed print crooked again", () => {
    const out = createPose();
    expectPose(
      turnInPlacePose(out, 1, placed, crooked, UNSETTLE_LIFT),
      crooked,
    );
    let peak = 0;
    for (let step = 0; step <= 100; step += 1) {
      turnInPlacePose(out, step / 100, placed, crooked, UNSETTLE_LIFT);
      peak = Math.max(peak, out.y - Math.max(placed.y, crooked.y));
    }
    expect(peak).toBeGreaterThan(UNSETTLE_LIFT * 0.85);
    expect(peak).toBeLessThan(UNSETTLE_LIFT * 1.1);
  });

  it("stays finite and flat when nothing has to move", () => {
    const out = createPose();
    for (let step = 0; step <= 20; step += 1) {
      turnInPlacePose(out, step / 20, placed, placed, 0);
      expect(finite(out)).toBe(true);
      expect(out.y).toBeCloseTo(placed.y, 9);
      expect(out.tiltX).toBeCloseTo(0, 9);
    }
  });
});

describe("replayDelay", () => {
  it("staggers by 0.6 ms per rank for small mosaics", () => {
    expect(replayDelay(0, 100, FLIGHT_SECONDS)).toBe(0);
    expect(replayDelay(50, 100, FLIGHT_SECONDS)).toBeCloseTo(0.03);
  });

  it("keeps a straightening wave inside four seconds", () => {
    const count = 3200;
    const last = replayDelay(count - 1, count, STRAIGHTEN_SECONDS);
    expect(last + STRAIGHTEN_SECONDS).toBeLessThanOrEqual(4 + 1e-9);
  });

  it("caps the whole wave at four seconds", () => {
    const count = 20_000;
    const last = replayDelay(count - 1, count, FLIGHT_SECONDS);
    expect(last + FLIGHT_SECONDS).toBeLessThanOrEqual(4 + 1e-9);
    expect(replayDelay(count / 2, count, FLIGHT_SECONDS)).toBeLessThan(last);
  });
});

describe("straightenStart", () => {
  it("lets the top mark be written before the print turns", () => {
    expect(MARK_LEAD_SECONDS).toBeGreaterThanOrEqual(MARK_WRITE_SECONDS);
    expect(MARK_LEAD_SECONDS).toBeLessThan(0.6);
    expect(straightenStart(10.1, 10)).toBeCloseTo(10 + MARK_LEAD_SECONDS);
  });

  it("starts at once when the mark is already on the print", () => {
    expect(straightenStart(12, 10)).toBe(12);
  });

  it("starts at once when there is no mark to wait for", () => {
    expect(straightenStart(3, Number.NaN)).toBe(3);
    expect(straightenStart(3, Number.NEGATIVE_INFINITY)).toBe(3);
  });
});
