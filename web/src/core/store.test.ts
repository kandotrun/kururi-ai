import { describe, expect, it, vi } from "vitest";
import type {
  DeskAction,
  DeskState,
  PhotoSource,
  Prediction,
  Quarter,
} from "../contracts";
import { createStore, initialDeskState, reduceDesk } from "./store";

function source(id: string, overrides: Partial<PhotoSource> = {}): PhotoSource {
  return {
    id,
    kind: "commons",
    title: `写真 ${id}`,
    aspect: 1.5,
    thumbUrl: `https://example.test/${id}.jpg`,
    largeUrl: null,
    file: null,
    attribution: null,
    uprightFix: 0,
    ...overrides,
  };
}

function prediction(correction: Quarter, inferenceMs = 240): Prediction {
  return {
    correction,
    confidence: 0.9,
    probabilities: [0.025, 0.025, 0.025, 0.025],
    inferenceMs,
  };
}

function run(state: DeskState, actions: readonly DeskAction[]): DeskState {
  return actions.reduce(reduceDesk, state);
}

function toWaiting(id: string): DeskAction[] {
  return [
    { type: "loaded", id, aspect: 1.25 },
    { type: "landed", id },
  ];
}

describe("initialDeskState", () => {
  it("starts with an empty desk and the given total", () => {
    const state = initialDeskState(12);
    expect(state.records.size).toBe(0);
    expect(state.order).toEqual([]);
    expect(state.nextSlot).toBe(0);
    expect(state.total).toBe(12);
  });
});

describe("reduceDesk", () => {
  it("adds a loading record with defaults", () => {
    const state = reduceDesk(initialDeskState(3), {
      type: "added",
      source: source("a"),
      simulated: 2,
      at: 100,
    });
    expect(state.order).toEqual(["a"]);
    expect(state.records.get("a")).toEqual({
      id: "a",
      source: source("a"),
      simulated: 2,
      phase: "loading",
      aspect: 1.5,
      prediction: null,
      slot: null,
      correct: null,
      addedAt: 100,
      decidedAt: null,
      error: null,
    });
  });

  it("falls back to a square aspect when the source has none", () => {
    const state = reduceDesk(initialDeskState(1), {
      type: "added",
      source: source("a", { aspect: null }),
      simulated: 0,
      at: 0,
    });
    expect(state.records.get("a")?.aspect).toBe(1);
  });

  it("keeps insertion order and ignores duplicate ids", () => {
    const first = run(initialDeskState(3), [
      { type: "added", source: source("b"), simulated: 0, at: 0 },
      { type: "added", source: source("a"), simulated: 1, at: 1 },
    ]);
    const duplicate = reduceDesk(first, {
      type: "added",
      source: source("b"),
      simulated: 3,
      at: 2,
    });
    expect(first.order).toEqual(["b", "a"]);
    expect(duplicate).toBe(first);
  });

  it("never mutates the previous state", () => {
    const empty = initialDeskState(1);
    const added = reduceDesk(empty, {
      type: "added",
      source: source("a"),
      simulated: 0,
      at: 0,
    });
    const before = added.records.get("a");
    const loaded = reduceDesk(added, { type: "loaded", id: "a", aspect: 2 });
    expect(empty.records.size).toBe(0);
    expect(empty.order).toEqual([]);
    expect(added.records).not.toBe(loaded.records);
    expect(added.records.get("a")).toBe(before);
    expect(before?.phase).toBe("loading");
    expect(loaded.records.get("a")?.phase).toBe("landing");
    expect(loaded.records.get("a")?.aspect).toBe(2);
  });

  it("walks the full lifecycle and assigns slots when photos reach the desk", () => {
    const state = run(initialDeskState(2), [
      { type: "added", source: source("a"), simulated: 1, at: 0 },
      { type: "added", source: source("b"), simulated: 2, at: 1 },
      ...toWaiting("b"),
      ...toWaiting("a"),
      { type: "scanStarted", id: "a" },
      { type: "scanStarted", id: "b" },
      { type: "decided", id: "a", prediction: prediction(1), at: 500 },
      { type: "decided", id: "b", prediction: prediction(2), at: 600 },
      { type: "placed", id: "b" },
    ]);
    const a = state.records.get("a");
    const b = state.records.get("b");
    expect(b).toMatchObject({
      phase: "placed",
      slot: 0,
      decidedAt: 600,
      correct: true,
      aspect: 1.25,
    });
    expect(b?.prediction).toEqual(prediction(2));
    expect(a).toMatchObject({
      phase: "placing",
      slot: 1,
      decidedAt: 500,
      correct: false,
    });
    expect(state.nextSlot).toBe(2);
  });

  it("gives a slot on load and keeps it through the decision", () => {
    const loaded = run(initialDeskState(1), [
      { type: "added", source: source("a"), simulated: 1, at: 0 },
      { type: "loaded", id: "a", aspect: 1.5 },
    ]);
    expect(loaded.records.get("a")?.slot).toBe(0);
    expect(loaded.nextSlot).toBe(1);
    const decided = run(loaded, [
      { type: "landed", id: "a" },
      { type: "scanStarted", id: "a" },
      { type: "decided", id: "a", prediction: prediction(3), at: 9 },
    ]);
    expect(decided.records.get("a")?.slot).toBe(0);
    expect(decided.nextSlot).toBe(1);
  });

  it("never gives a slot to a photo that failed to load", () => {
    const state = run(initialDeskState(2), [
      { type: "added", source: source("a"), simulated: 0, at: 0 },
      { type: "added", source: source("b"), simulated: 0, at: 0 },
      { type: "failed", id: "a", error: "x" },
      { type: "loaded", id: "b", aspect: 1 },
    ]);
    expect(state.records.get("a")?.slot).toBeNull();
    expect(state.records.get("b")?.slot).toBe(0);
  });

  it("tracks every intermediate phase", () => {
    const phases: string[] = [];
    let state = initialDeskState(1);
    const actions: DeskAction[] = [
      { type: "added", source: source("a"), simulated: 0, at: 0 },
      ...toWaiting("a"),
      { type: "scanStarted", id: "a" },
      { type: "decided", id: "a", prediction: prediction(0), at: 1 },
      { type: "placed", id: "a" },
    ];
    for (const action of actions) {
      state = reduceDesk(state, action);
      phases.push(state.records.get("a")?.phase ?? "missing");
    }
    expect(phases).toEqual([
      "loading",
      "landing",
      "waiting",
      "scanning",
      "placing",
      "placed",
    ]);
  });

  it("judges against the known upright fix and leaves unknown sources unjudged", () => {
    const state = run(initialDeskState(3), [
      {
        type: "added",
        source: source("sample", { kind: "sample", uprightFix: 3 }),
        simulated: 0,
        at: 0,
      },
      {
        type: "added",
        source: source("mine", { kind: "user", uprightFix: null }),
        simulated: 1,
        at: 0,
      },
      ...toWaiting("sample"),
      ...toWaiting("mine"),
      { type: "scanStarted", id: "sample" },
      { type: "scanStarted", id: "mine" },
      { type: "decided", id: "sample", prediction: prediction(3), at: 1 },
      { type: "decided", id: "mine", prediction: prediction(3), at: 2 },
    ]);
    expect(state.records.get("sample")?.correct).toBe(true);
    expect(state.records.get("mine")?.correct).toBeNull();
  });

  it("ignores transitions that skip a phase", () => {
    const added = reduceDesk(initialDeskState(1), {
      type: "added",
      source: source("a"),
      simulated: 0,
      at: 0,
    });
    const skipped: DeskAction[] = [
      { type: "landed", id: "a" },
      { type: "scanStarted", id: "a" },
      { type: "decided", id: "a", prediction: prediction(0), at: 1 },
      { type: "placed", id: "a" },
    ];
    for (const action of skipped) {
      expect(reduceDesk(added, action)).toBe(added);
    }
    const placed = run(added, [
      ...toWaiting("a"),
      { type: "scanStarted", id: "a" },
      { type: "decided", id: "a", prediction: prediction(0), at: 1 },
      { type: "placed", id: "a" },
    ]);
    expect(
      reduceDesk(placed, {
        type: "decided",
        id: "a",
        prediction: prediction(1),
        at: 2,
      }),
    ).toBe(placed);
    expect(placed.nextSlot).toBe(1);
  });

  it("ignores unknown ids", () => {
    const state = initialDeskState(1);
    const actions: DeskAction[] = [
      { type: "loaded", id: "x", aspect: 1 },
      { type: "landed", id: "x" },
      { type: "scanStarted", id: "x" },
      { type: "decided", id: "x", prediction: prediction(1), at: 0 },
      { type: "placed", id: "x" },
      { type: "failed", id: "x", error: "no" },
    ];
    for (const action of actions) {
      expect(reduceDesk(state, action)).toBe(state);
    }
  });

  it("fails a record from any phase and keeps the error", () => {
    const prefixes: DeskAction[][] = [
      [],
      [{ type: "loaded", id: "a", aspect: 1 }],
      toWaiting("a"),
      [...toWaiting("a"), { type: "scanStarted", id: "a" }],
      [
        ...toWaiting("a"),
        { type: "scanStarted", id: "a" },
        { type: "decided", id: "a", prediction: prediction(0), at: 1 },
      ],
    ];
    for (const prefix of prefixes) {
      const state = run(initialDeskState(1), [
        { type: "added", source: source("a"), simulated: 0, at: 0 },
        ...prefix,
        { type: "failed", id: "a", error: "読み込めませんでした" },
      ]);
      expect(state.records.get("a")).toMatchObject({
        phase: "failed",
        error: "読み込めませんでした",
      });
    }
  });

  it("updates the total and keeps the state when it is unchanged", () => {
    const state = initialDeskState(5);
    const changed = reduceDesk(state, { type: "totalChanged", total: 9 });
    expect(changed.total).toBe(9);
    expect(state.total).toBe(5);
    expect(reduceDesk(changed, { type: "totalChanged", total: 9 })).toBe(
      changed,
    );
  });
});

describe("createStore", () => {
  it("reduces dispatched actions and notifies listeners", () => {
    const store = createStore(initialDeskState(1));
    const listener = vi.fn();
    store.subscribe(listener);
    const action: DeskAction = {
      type: "added",
      source: source("a"),
      simulated: 0,
      at: 0,
    };
    store.dispatch(action);
    expect(store.getState().order).toEqual(["a"]);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(store.getState(), action);
  });

  it("does not notify when the action changes nothing", () => {
    const store = createStore(initialDeskState(1));
    const listener = vi.fn();
    store.subscribe(listener);
    store.dispatch({ type: "landed", id: "missing" });
    store.dispatch({ type: "totalChanged", total: 1 });
    expect(listener).not.toHaveBeenCalled();
  });

  it("stops notifying after unsubscribe, even during a dispatch", () => {
    const store = createStore(initialDeskState(1));
    const calls: string[] = [];
    let unsubscribeSecond: () => void = () => {};
    const unsubscribeFirst = store.subscribe(() => {
      calls.push("first");
      unsubscribeSecond();
    });
    unsubscribeSecond = store.subscribe(() => {
      calls.push("second");
    });
    store.dispatch({ type: "totalChanged", total: 2 });
    store.dispatch({ type: "totalChanged", total: 3 });
    unsubscribeFirst();
    store.dispatch({ type: "totalChanged", total: 4 });
    expect(calls).toEqual(["first", "first"]);
  });
});
