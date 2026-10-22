import { describe, expect, it } from "vitest";
import { createDecisionLog } from "./decision-log";

describe("createDecisionLog", () => {
  it("records each id once in decision order", () => {
    const log = createDecisionLog();
    expect(log.note("a")).toBe(true);
    expect(log.note("b")).toBe(true);
    expect(log.note("a")).toBe(false);
    expect(log.size).toBe(2);
  });

  it("lists the newest ids first up to a limit", () => {
    const log = createDecisionLog();
    for (const id of ["a", "b", "c", "d"]) {
      log.note(id);
    }
    expect(log.newest(3)).toEqual(["d", "c", "b"]);
    expect(log.newest(10)).toEqual(["d", "c", "b", "a"]);
  });

  it("lists ids noted after a given size, newest first", () => {
    const log = createDecisionLog();
    for (const id of ["a", "b", "c", "d", "e"]) {
      log.note(id);
    }
    expect(log.since(3)).toEqual(["e", "d"]);
    expect(log.since(5)).toEqual([]);
    expect(log.since(0)).toEqual(["e", "d", "c", "b", "a"]);
  });

  it("can cap the ids returned since a size", () => {
    const log = createDecisionLog();
    for (const id of ["a", "b", "c", "d", "e"]) {
      log.note(id);
    }
    expect(log.since(0, 2)).toEqual(["e", "d"]);
  });
});
