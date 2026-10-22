import { describe, expect, it } from "vitest";
import { createHeicTracker } from "./heic-tracker";

describe("createHeicTracker", () => {
  it("knows nothing before files are handed over", () => {
    const tracker = createHeicTracker();
    expect(
      tracker.leftOut({ found: 3, accepted: 0, skipped: 3, done: true }),
    ).toBe(0);
  });

  it("counts HEIC photos the browser could not take", () => {
    const tracker = createHeicTracker();
    tracker.handOff({ found: 1159, photos: 697, photosWithHeic: 740 });
    expect(
      tracker.leftOut({ found: 1159, accepted: 697, skipped: 462, done: false }),
    ).toBe(43);
  });

  it("counts nothing when the browser opened the HEIC photos", () => {
    const tracker = createHeicTracker();
    tracker.handOff({ found: 1159, photos: 697, photosWithHeic: 740 });
    expect(
      tracker.leftOut({ found: 1159, accepted: 740, skipped: 419, done: false }),
    ).toBe(0);
  });

  it("keeps the first answer while the batch's accepted count drops", () => {
    const tracker = createHeicTracker();
    tracker.handOff({ found: 4, photos: 2, photosWithHeic: 4 });
    expect(tracker.leftOut({ found: 4, accepted: 4, skipped: 0, done: false })).toBe(0);
    expect(tracker.leftOut({ found: 4, accepted: 2, skipped: 0, done: true })).toBe(0);
    tracker.handOff({ found: 4, photos: 2, photosWithHeic: 4 });
    expect(tracker.leftOut({ found: 4, accepted: 2, skipped: 2, done: false })).toBe(2);
    expect(tracker.leftOut({ found: 4, accepted: 1, skipped: 2, done: true })).toBe(2);
  });

  it("ignores reports for other batches", () => {
    const tracker = createHeicTracker();
    tracker.handOff({ found: 2, photos: 0, photosWithHeic: 2 });
    expect(tracker.leftOut({ found: 5, accepted: 3, skipped: 2, done: false })).toBe(0);
    expect(tracker.leftOut({ found: 2, accepted: 0, skipped: 2, done: true })).toBe(2);
  });
});
