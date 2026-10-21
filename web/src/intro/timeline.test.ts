import { describe, expect, it } from "vitest";
import {
  INTRO_DURATION_MS,
  INTRO_SECONDS,
  PHASE_STARTS,
  type StageMix,
  createStageMix,
  phaseAt,
  phasesBetween,
  stageMix,
} from "./timeline";

function sample(time: number): StageMix {
  return stageMix(time, createStageMix());
}

describe("phases", () => {
  it("follows the spec order and timings", () => {
    expect(PHASE_STARTS.map(([phase]) => phase)).toEqual([
      "space",
      "gather",
      "descent",
      "city",
      "room",
      "handoff",
      "done",
    ]);
    expect(INTRO_DURATION_MS).toBe(9600);
    expect(INTRO_SECONDS).toBeCloseTo(9.6, 12);
  });

  it("reports the phase that started last", () => {
    expect(phaseAt(0)).toBe("space");
    expect(phaseAt(0.99)).toBe("space");
    expect(phaseAt(1.0)).toBe("gather");
    expect(phaseAt(3.3)).toBe("descent");
    expect(phaseAt(6)).toBe("city");
    expect(phaseAt(7.5)).toBe("room");
    expect(phaseAt(9.1)).toBe("handoff");
    expect(phaseAt(9.6)).toBe("done");
    expect(phaseAt(40)).toBe("done");
    expect(phaseAt(-1)).toBe("space");
  });

  it("lists the phases crossed by a frame step in order", () => {
    expect(phasesBetween(-1, 0)).toEqual(["space"]);
    expect(phasesBetween(0, 0.5)).toEqual([]);
    expect(phasesBetween(0.9, 3.3)).toEqual(["gather", "descent"]);
    expect(phasesBetween(8.9, 20)).toEqual(["handoff", "done"]);
  });
});

describe("stageMix", () => {
  it("shows only the globe in space and only the room before the hand-off", () => {
    const space = sample(0.3);
    expect(space.globe).toBe(1);
    expect(space.city).toBe(0);
    expect(space.room).toBe(0);
    expect(space.fade).toBe(1);
    const room = sample(8.6);
    expect(room.room).toBe(1);
    expect(room.globe).toBe(0);
    expect(room.city).toBe(0);
  });

  it("keeps stage weights summing to one", () => {
    for (let time = 0; time <= 10; time += 0.01) {
      const mix = sample(time);
      expect(mix.globe + mix.city + mix.room).toBeCloseTo(1, 9);
    }
  });

  it("hides every stage switch inside clouds or window light", () => {
    for (let time = 0; time <= 10; time += 0.005) {
      const mix = sample(time);
      if (mix.globe > 0.001 && mix.city > 0.001) {
        expect(mix.clouds).toBeGreaterThan(0.85);
      }
      if (mix.city > 0.001 && mix.room > 0.001) {
        expect(mix.glow).toBeGreaterThan(0.85);
      }
    }
  });

  it("fades the canvas out during the hand-off only", () => {
    expect(sample(8.99).fade).toBe(1);
    expect(sample(9.3).fade).toBeGreaterThan(0.2);
    expect(sample(9.3).fade).toBeLessThan(0.8);
    expect(sample(9.6).fade).toBe(0);
  });

  it("changes continuously", () => {
    const a = createStageMix();
    const b = createStageMix();
    for (let time = 0; time <= 10; time += 0.002) {
      stageMix(time, a);
      stageMix(time + 0.002, b);
      for (const key of Object.keys(a) as (keyof StageMix)[]) {
        expect(Math.abs(a[key] - b[key])).toBeLessThan(0.08);
      }
    }
  });

  it("fades in from black at the very start", () => {
    expect(sample(0).intro).toBe(0);
    expect(sample(1).intro).toBe(1);
  });
});
