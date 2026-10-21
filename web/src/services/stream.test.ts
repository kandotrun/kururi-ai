import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  DeskAction,
  DeskScene,
  ImageLoader,
  InferencePool,
  LoadedImage,
  NewPrint,
  PhotoSource,
  Prediction,
  Quarter,
  Store,
  StreamStatus,
} from "../contracts";
import { mulberry32, type Random } from "../core/random";
import { createStore, initialDeskState } from "../core/store";
import { RateLimitedError } from "./image-loader";
import { createStream, type StreamDeps } from "./stream";

const OFFLINE =
  "Wikimedia Commons に接続できませんでした。自分の写真は並べられます。";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => {};
  let reject: (reason: unknown) => void = () => {};
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

interface FakeBitmap extends ImageBitmap {
  readonly closed: boolean;
}

function fakeBitmap(): FakeBitmap {
  let closed = false;
  return {
    width: 120,
    height: 80,
    get closed() {
      return closed;
    },
    close() {
      closed = true;
    },
  };
}

class FakeLoader implements ImageLoader {
  readonly calls: string[] = [];
  readonly pending = new Map<
    string,
    { deferred: Deferred<LoadedImage>; signal: AbortSignal | undefined }
  >();
  readonly bitmaps = new Map<string, FakeBitmap>();
  readonly failing = new Set<string>();
  readonly limited = new Set<string>();
  auto = false;
  honourAbort = true;
  active = 0;
  maxActive = 0;

  load(source: PhotoSource, signal?: AbortSignal): Promise<LoadedImage> {
    this.calls.push(source.id);
    this.limited.delete(source.id);
    const entry = { deferred: deferred<LoadedImage>(), signal };
    this.pending.set(source.id, entry);
    this.active += 1;
    this.maxActive = Math.max(this.maxActive, this.active);
    signal?.addEventListener("abort", () => {
      if (this.honourAbort) {
        this.finish(source.id)?.reject(new DOMException("stop", "AbortError"));
      }
    });
    if (this.auto) {
      if (this.failing.has(source.id)) {
        this.fail(source.id);
      } else {
        this.succeed(source.id);
      }
    }
    return entry.deferred.promise;
  }

  succeed(id: string, aspect = 1.5): void {
    const bitmap = fakeBitmap();
    this.bitmaps.set(id, bitmap);
    this.finish(id)?.resolve({
      bitmap,
      blob: new Blob([id], { type: "image/jpeg" }),
      aspect,
    });
  }

  fail(id: string, message = "写真を読み込めませんでした（HTTP 503）"): void {
    this.finish(id)?.reject(new Error(message));
  }

  rateLimit(id: string, retryAfterMs: number): void {
    const entry = this.finish(id);
    if (entry) {
      this.limited.add(id);
      entry.reject(new RateLimitedError(retryAfterMs));
    }
  }

  ids(): string[] {
    return [...this.pending.keys()];
  }

  private finish(id: string): Deferred<LoadedImage> | undefined {
    const entry = this.pending.get(id);
    if (!entry) {
      return undefined;
    }
    this.pending.delete(id);
    this.active -= 1;
    return entry.deferred;
  }
}

class FakePool implements InferencePool {
  readonly size: number;
  readonly ready: Promise<void>;
  readonly calls: Array<{ id: string; simulated: Quarter; blob: Blob }> = [];
  readonly jobs = new Map<string, Deferred<Prediction>>();
  readonly failing = new Set<string>();
  autoCorrection: Quarter | null = null;
  overbooked = 0;
  private readyWorkers: number;
  private readonly readyGate = deferred<void>();

  constructor(size: number, readyWorkers: number) {
    this.size = size;
    this.readyWorkers = readyWorkers;
    this.ready = this.readyGate.promise;
    if (readyWorkers > 0) {
      this.readyGate.resolve();
    }
  }

  setReady(count: number): void {
    this.readyWorkers = count;
    this.readyGate.resolve();
  }

  idleCount(): number {
    return Math.max(0, this.readyWorkers - this.jobs.size);
  }

  infer(id: string, blob: Blob, simulated: Quarter): Promise<Prediction> {
    if (this.jobs.size >= this.readyWorkers) {
      this.overbooked += 1;
    }
    this.calls.push({ id, simulated, blob });
    const job = deferred<Prediction>();
    this.jobs.set(id, job);
    if (this.failing.has(id)) {
      this.reject(id);
    } else if (this.autoCorrection !== null) {
      this.answer(id, this.autoCorrection);
    }
    return job.promise;
  }

  answer(id: string, correction: Quarter, inferenceMs = 240): void {
    const job = this.jobs.get(id);
    this.jobs.delete(id);
    job?.resolve({
      correction,
      confidence: 0.9,
      probabilities: [0.1, 0.1, 0.1, 0.7],
      inferenceMs,
    });
  }

  reject(id: string, message = "推論に失敗しました"): void {
    const job = this.jobs.get(id);
    this.jobs.delete(id);
    job?.reject(new Error(message));
  }

  ids(): string[] {
    return [...this.jobs.keys()];
  }

  dispose(): void {}
}

type SceneSurface = Pick<
  DeskScene,
  "addPrint" | "setScanning" | "decide" | "place" | "focus" | "removePrint"
>;

class FakeScene implements SceneSurface {
  readonly log: string[] = [];
  readonly prints: NewPrint[] = [];
  readonly landings = new Map<string, Deferred<void>>();
  readonly flights = new Map<string, Deferred<void>>();
  readonly failLanding = new Set<string>();
  readonly failFlight = new Set<string>();
  autoLand = true;
  autoPlace = true;
  failRemove = false;

  addPrint(print: NewPrint): Promise<void> {
    this.log.push(`addPrint:${print.id}`);
    this.prints.push(print);
    if (this.failLanding.has(print.id)) {
      return Promise.reject(new Error("机に置けませんでした"));
    }
    if (this.autoLand) {
      return Promise.resolve();
    }
    const landing = deferred<void>();
    this.landings.set(print.id, landing);
    return landing.promise;
  }

  setScanning(id: string, scanning: boolean): void {
    this.log.push(`setScanning:${id}:${scanning}`);
  }

  decide(id: string, correction: Quarter): void {
    this.log.push(`decide:${id}:${correction}`);
  }

  place(id: string, slot: number): Promise<void> {
    this.log.push(`place:${id}:${slot}`);
    if (this.failFlight.has(id)) {
      return Promise.reject(new Error("並べられませんでした"));
    }
    if (this.autoPlace) {
      return Promise.resolve();
    }
    const flight = deferred<void>();
    this.flights.set(id, flight);
    return flight.promise;
  }

  focus(id: string | null): void {
    this.log.push(`focus:${id ?? "null"}`);
  }

  removePrint(id: string): void {
    this.log.push(`removePrint:${id}`);
    if (this.failRemove) {
      throw new Error("消せませんでした");
    }
  }

  removed(): string[] {
    return this.log
      .filter((entry) => entry.startsWith("removePrint:"))
      .map((entry) => entry.slice("removePrint:".length));
  }

  land(id: string): void {
    this.landings.get(id)?.resolve();
    this.landings.delete(id);
  }

  arrive(id: string): void {
    this.flights.get(id)?.resolve();
    this.flights.delete(id);
  }
}

function commons(index: number): PhotoSource {
  return {
    id: `c${index}`,
    kind: "commons",
    title: `写真 ${index}`,
    aspect: 1.5,
    thumbUrl: `https://upload.example.test/${index}.jpg`,
    largeUrl: null,
    file: null,
    attribution: {
      author: "作者",
      license: "CC BY-SA 4.0",
      licenseUrl: null,
      pageUrl: `https://commons.example.test/${index}`,
    },
    uprightFix: 0,
  };
}

function sample(index: number, uprightFix: Quarter): PhotoSource {
  return {
    ...commons(index),
    id: `s${index}`,
    kind: "sample",
    attribution: null,
    uprightFix,
  };
}

function file(name: string): File {
  return new File([name], name, { type: "image/jpeg" });
}

function makeUserSource(source: File, id: string): PhotoSource {
  return {
    id,
    kind: "user",
    title: source.name,
    aspect: null,
    thumbUrl: null,
    largeUrl: null,
    file: source,
    attribution: null,
    uprightFix: null,
  };
}

function many(count: number): PhotoSource[] {
  return Array.from({ length: count }, (_, index) => commons(index));
}

interface HarnessOptions {
  sources?: PhotoSource[];
  maxPile?: number;
  maxLoading?: number;
  maxPrints?: number;
  openingBatch?: number;
  openingHoldMs?: number;
  poolSize?: number;
  readyWorkers?: number;
  random?: Random;
  reducedMotion?: boolean;
  dropLoaded?: string[];
}

function storeDropping(ids: readonly string[]): Store {
  const inner = createStore(initialDeskState(0));
  const dropped = new Set(ids);
  return {
    getState: () => inner.getState(),
    dispatch: (action) => {
      if (action.type === "loaded" && dropped.has(action.id)) {
        return;
      }
      inner.dispatch(action);
    },
    subscribe: (listener) => inner.subscribe(listener),
  };
}

function harness(options: HarnessOptions = {}) {
  const sources = options.sources ?? many(3);
  const limits = {
    maxPile: options.maxPile ?? 8,
    maxLoading: options.maxLoading ?? 4,
    maxPrints: options.maxPrints ?? 1_000,
    openingBatch: options.openingBatch ?? 0,
    openingHoldMs: options.openingHoldMs ?? 0,
  };
  const poolSize = options.poolSize ?? 2;
  const loader = new FakeLoader();
  const pool = new FakePool(poolSize, options.readyWorkers ?? poolSize);
  const scene = new FakeScene();
  const store = storeDropping(options.dropLoaded ?? []);
  const statuses: StreamStatus[] = [];
  const notices: Array<string | null> = [];
  const actions: DeskAction[] = [];
  const violations: string[] = [];
  const peaks = { loading: 0, pile: 0, scanning: 0 };
  const settings = { simulateUser: true, reducedMotion: options.reducedMotion ?? false };
  store.subscribe((state, action) => {
    actions.push(action);
    let loading = 0;
    let pile = 0;
    let scanning = 0;
    for (const record of state.records.values()) {
      if (record.phase === "loading" && !loader.limited.has(record.id)) {
        loading += 1;
      } else if (record.phase === "landing" || record.phase === "waiting") {
        pile += 1;
      } else if (record.phase === "scanning") {
        scanning += 1;
      }
    }
    peaks.loading = Math.max(peaks.loading, loading);
    peaks.pile = Math.max(peaks.pile, pile);
    peaks.scanning = Math.max(peaks.scanning, scanning);
    if (loading > limits.maxLoading) {
      violations.push(`loading ${loading} after ${action.type}`);
    }
    if (pile > Math.max(limits.maxPile, limits.openingBatch)) {
      violations.push(`pile ${pile} after ${action.type}`);
    }
    if (scanning > poolSize) {
      violations.push(`scanning ${scanning} after ${action.type}`);
    }
    if (state.records.size > limits.maxPrints) {
      violations.push(`prints ${state.records.size}`);
    }
  });
  const makeUser = vi.fn(makeUserSource);
  const deps: StreamDeps = {
    sources,
    makeUserSource: makeUser,
    loader,
    pool,
    store,
    scene,
    random: options.random ?? mulberry32(1),
    now: () => Date.now(),
    wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    simulateUser: () => settings.simulateUser,
    reducedMotion: () => settings.reducedMotion,
    limits,
    onStatus: (status) => statuses.push(status),
    onNotice: (message) => notices.push(message),
  };
  const stream = createStream(deps);
  const phaseOf = (id: string) => store.getState().records.get(id)?.phase;
  const typesFor = (id: string) =>
    actions
      .filter((action) =>
        action.type === "added"
          ? action.source.id === id
          : "id" in action && action.id === id,
      )
      .map((action) => action.type);
  return {
    stream,
    loader,
    pool,
    scene,
    store,
    statuses,
    notices,
    actions,
    violations,
    peaks,
    settings,
    makeUser,
    phaseOf,
    typesFor,
  };
}

async function tick(ms = 0): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createStream", () => {
  it("carries a photo through its whole lifecycle", async () => {
    const h = harness({ sources: [commons(0)], random: () => 0.5 });
    h.loader.auto = true;
    h.pool.autoCorrection = 2;
    h.stream.start();
    await tick(1_000);
    expect(h.typesFor("c0")).toEqual([
      "added",
      "loaded",
      "landed",
      "scanStarted",
      "decided",
      "placed",
    ]);
    expect(h.scene.log).toEqual([
      "addPrint:c0",
      "setScanning:c0:true",
      "setScanning:c0:false",
      "decide:c0:2",
      "place:c0:0",
    ]);
    expect(h.scene.prints[0]).toMatchObject({
      id: "c0",
      slot: 0,
      aspect: 1.5,
      simulated: 2,
      emphasis: false,
    });
    expect(h.scene.prints[0]?.image).toBe(h.loader.bitmaps.get("c0"));
    expect(h.pool.calls.map((call) => [call.id, call.simulated])).toEqual([
      ["c0", 2],
    ]);
    expect(h.store.getState().records.get("c0")).toMatchObject({
      phase: "placed",
      slot: 0,
      correct: true,
    });
    expect(h.store.getState().total).toBe(1);
    expect(h.statuses).toEqual(["running", "finished"]);
    expect(h.violations).toEqual([]);
  });

  it("waits a short beat between the decision and the flight", async () => {
    const h = harness({ sources: [commons(0)] });
    h.loader.auto = true;
    h.pool.autoCorrection = 1;
    h.stream.start();
    await tick(0);
    expect(h.scene.log).toContain("decide:c0:1");
    expect(h.scene.log.some((entry) => entry.startsWith("place:"))).toBe(false);
    await tick(279);
    expect(h.scene.log.some((entry) => entry.startsWith("place:"))).toBe(false);
    await tick(1);
    expect(h.scene.log).toContain("place:c0:0");
  });

  it("places immediately when motion is reduced", async () => {
    const h = harness({ sources: [commons(0)], reducedMotion: true });
    h.loader.auto = true;
    h.pool.autoCorrection = 1;
    h.stream.start();
    await tick(0);
    expect(h.scene.log).toContain("place:c0:0");
    expect(h.phaseOf("c0")).toBe("placed");
  });

  it("rotates Commons photos, never samples, and visitors' photos only when asked", async () => {
    const h = harness({
      sources: [commons(0), sample(1, 3)],
      random: () => 0.95,
    });
    h.loader.auto = true;
    h.pool.autoCorrection = 0;
    h.stream.addUserFiles([file("a.jpg")]);
    h.settings.simulateUser = false;
    h.stream.addUserFiles([file("b.jpg")]);
    h.stream.start();
    await tick(2_000);
    const simulated = (id: string) => h.store.getState().records.get(id)?.simulated;
    expect(simulated("c0")).toBe(3);
    expect(simulated("s1")).toBe(0);
    expect(simulated("user-1")).toBe(3);
    expect(simulated("user-2")).toBe(0);
    expect(h.store.getState().records.get("s1")?.correct).toBe(false);
    expect(h.store.getState().records.get("user-1")?.correct).toBeNull();
  });

  it("never exceeds its limits while photos load, land, scan and fly at random", async () => {
    const random = mulberry32(42);
    const h = harness({
      sources: many(60),
      maxLoading: 3,
      maxPile: 5,
      poolSize: 2,
    });
    h.scene.autoLand = false;
    h.scene.autoPlace = false;
    h.stream.start();
    let users = 0;
    for (let step = 0; step < 2_000; step += 1) {
      if (step === 40 || step === 90) {
        h.stream.addUserFiles([file(`u${step}a.jpg`), file(`u${step}b.jpg`)]);
        users += 2;
      }
      const options: Array<() => void> = [
        ...h.loader.ids().map((id) => () => {
          if (random() < 0.1) {
            h.loader.fail(id);
          } else {
            h.loader.succeed(id);
          }
        }),
        ...[...h.scene.landings.keys()].map((id) => () => h.scene.land(id)),
        ...h.pool.ids().map((id) => () => {
          if (random() < 0.05) {
            h.pool.reject(id);
          } else {
            h.pool.answer(id, 0);
          }
        }),
        ...[...h.scene.flights.keys()].map((id) => () => h.scene.arrive(id)),
      ];
      if (options.length === 0) {
        await tick(300);
        if (h.statuses.at(-1) === "finished") {
          break;
        }
        continue;
      }
      options[Math.floor(random() * options.length)]!();
      await tick(random() < 0.3 ? 300 : 0);
    }
    const records = [...h.store.getState().records.values()];
    expect(h.violations).toEqual([]);
    expect(h.pool.overbooked).toBe(0);
    expect(records).toHaveLength(60 + users);
    expect(
      records.every(
        (record) => record.phase === "placed" || record.phase === "failed",
      ),
    ).toBe(true);
    expect(h.peaks.loading).toBe(3);
    expect(h.peaks.scanning).toBe(2);
    expect(h.statuses.at(-1)).toBe("finished");
    const slots = records
      .filter((record) => record.phase === "placed")
      .map((record) => record.slot);
    expect(new Set(slots).size).toBe(slots.length);
  });

  it("keeps loads and the pile within the pile limit together", async () => {
    const h = harness({ sources: many(20), maxLoading: 6, maxPile: 4 });
    h.pool.setReady(0);
    h.stream.start();
    await tick(0);
    expect(h.loader.calls).toHaveLength(4);
    h.loader.succeed("c0");
    h.loader.succeed("c1");
    await tick(0);
    expect(h.loader.calls).toHaveLength(4);
    expect(h.phaseOf("c0")).toBe("waiting");
  });

  it("lets visitors' photos jump the load and scan queues", async () => {
    const h = harness({
      sources: many(10),
      maxLoading: 1,
      maxPile: 3,
      poolSize: 1,
    });
    h.stream.start();
    await tick(0);
    expect(h.loader.calls).toEqual(["c0"]);
    h.loader.succeed("c0");
    await tick(0);
    expect(h.pool.ids()).toEqual(["c0"]);
    expect(h.loader.calls).toEqual(["c0", "c1"]);
    h.loader.succeed("c1");
    await tick(0);
    h.stream.addUserFiles([file("mine.jpg")]);
    expect(h.loader.calls).toEqual(["c0", "c1", "c2"]);
    h.loader.succeed("c2");
    await tick(0);
    expect(h.loader.calls).toEqual(["c0", "c1", "c2", "user-1"]);
    h.loader.succeed("user-1");
    await tick(0);
    expect(h.phaseOf("c1")).toBe("waiting");
    expect(h.phaseOf("user-1")).toBe("waiting");
    h.pool.answer("c0", 0);
    await tick(0);
    expect(h.pool.ids()).toEqual(["user-1"]);
    expect(h.scene.prints.find((print) => print.id === "user-1")?.emphasis).toBe(
      true,
    );
    expect(h.makeUser).toHaveBeenCalledWith(expect.any(File), "user-1");
  });

  it("focuses a visitor's photo after landing and lets go after it is placed", async () => {
    const h = harness({ sources: [], reducedMotion: true });
    h.loader.auto = true;
    h.pool.autoCorrection = 1;
    h.stream.start();
    h.stream.addUserFiles([file("mine.jpg")]);
    await tick(0);
    expect(h.scene.log.slice(0, 2)).toEqual([
      "addPrint:user-1",
      "focus:user-1",
    ]);
    expect(h.phaseOf("user-1")).toBe("placed");
    await tick(1_499);
    expect(h.scene.log).not.toContain("focus:null");
    await tick(1);
    expect(h.scene.log.at(-1)).toBe("focus:null");
  });

  it("keeps the focus on the newest visitor's photo", async () => {
    const h = harness({ sources: [], reducedMotion: true, poolSize: 1 });
    h.loader.auto = true;
    h.stream.start();
    h.stream.addUserFiles([file("a.jpg"), file("b.jpg")]);
    await tick(0);
    expect(h.scene.log).toContain("focus:user-2");
    h.pool.answer("user-1", 0);
    await tick(1_500);
    expect(h.scene.log).not.toContain("focus:null");
    h.pool.answer("user-2", 0);
    await tick(1_500);
    expect(h.scene.log.at(-1)).toBe("focus:null");
  });

  it("pauses new loads and scans while in-flight work completes", async () => {
    const h = harness({
      sources: many(8),
      maxLoading: 2,
      maxPile: 8,
      poolSize: 1,
    });
    h.stream.start();
    await tick(0);
    expect(h.loader.calls).toEqual(["c0", "c1"]);
    h.loader.succeed("c0");
    await tick(0);
    expect(h.pool.ids()).toEqual(["c0"]);
    expect(h.loader.calls).toEqual(["c0", "c1", "c2"]);
    h.stream.pause();
    expect(h.stream.paused).toBe(true);
    expect(h.statuses.at(-1)).toBe("paused");
    h.loader.succeed("c1");
    await tick(0);
    expect(h.phaseOf("c1")).toBe("waiting");
    expect(h.loader.calls).toHaveLength(3);
    h.pool.answer("c0", 0);
    await tick(1_000);
    expect(h.phaseOf("c0")).toBe("placed");
    expect(h.pool.calls).toHaveLength(1);
    expect(h.phaseOf("c1")).toBe("waiting");
    h.loader.succeed("c2");
    await tick(1_000);
    expect(h.phaseOf("c2")).toBe("waiting");
    expect(h.loader.calls).toHaveLength(3);
    expect(h.pool.calls).toHaveLength(1);
    h.stream.resume();
    expect(h.stream.paused).toBe(false);
    expect(h.statuses.at(-1)).toBe("running");
    await tick(0);
    expect(h.pool.ids()).toEqual(["c1"]);
    expect(h.loader.calls).toEqual(["c0", "c1", "c2", "c3", "c4"]);
  });

  it("goes offline after eight Commons failures in a row and recovers on success", async () => {
    const h = harness({ sources: many(40), maxLoading: 4 });
    h.pool.autoCorrection = 0;
    h.stream.start();
    await tick(0);
    for (let index = 0; index < 7; index += 1) {
      h.loader.fail(`c${index}`);
      await tick(0);
    }
    expect(h.notices).toEqual([]);
    expect(h.statuses.at(-1)).toBe("running");
    h.loader.fail("c7");
    await tick(0);
    expect(h.notices).toEqual([OFFLINE]);
    expect(h.statuses.at(-1)).toBe("offline");
    expect(h.loader.calls).toHaveLength(11);
    for (const id of h.loader.ids()) {
      h.loader.fail(id);
    }
    await tick(4_999);
    expect(h.loader.calls).toHaveLength(11);
    await tick(1);
    expect(h.loader.calls).toHaveLength(12);
    h.loader.fail("c11");
    await tick(4_000);
    expect(h.loader.calls).toHaveLength(12);
    await tick(1_000);
    expect(h.loader.calls).toHaveLength(13);
    expect(h.notices).toEqual([OFFLINE]);
    h.loader.succeed("c12");
    await tick(0);
    expect(h.notices).toEqual([OFFLINE, null]);
    expect(h.statuses.at(-1)).toBe("running");
    expect(h.loader.calls).toHaveLength(17);
    expect(h.store.getState().records.get("c3")?.phase).toBe("failed");
  });

  it("keeps loading visitors' photos and samples while offline", async () => {
    const sources = [...many(12), sample(20, 3)];
    const h = harness({ sources, maxLoading: 2 });
    h.pool.autoCorrection = 0;
    h.stream.start();
    await tick(0);
    for (let index = 0; index < 8; index += 1) {
      h.loader.fail(`c${index}`);
      await tick(0);
    }
    expect(h.statuses.at(-1)).toBe("offline");
    for (const id of h.loader.ids().filter((id) => id.startsWith("c"))) {
      h.loader.fail(id);
    }
    await tick(0);
    expect(h.loader.calls).toContain("s20");
    h.stream.addUserFiles([file("mine.jpg")]);
    await tick(0);
    expect(h.loader.calls).toContain("user-1");
    h.loader.succeed("user-1");
    h.loader.succeed("s20");
    await tick(1_000);
    expect(h.phaseOf("user-1")).toBe("placed");
    expect(h.phaseOf("s20")).toBe("placed");
    expect(h.notices).toEqual([OFFLINE]);
  });

  it("only counts consecutive Commons failures", async () => {
    const h = harness({ sources: many(30), maxLoading: 1 });
    h.pool.autoCorrection = 0;
    h.stream.start();
    await tick(0);
    for (let index = 0; index < 7; index += 1) {
      h.loader.fail(`c${index}`);
      await tick(0);
    }
    h.loader.succeed("c7");
    await tick(0);
    for (let index = 8; index < 15; index += 1) {
      h.loader.fail(`c${index}`);
      await tick(0);
    }
    expect(h.notices).toEqual([]);
    expect(h.statuses).toEqual(["running"]);
  });

  it("marks every kind of failure and keeps the pipeline moving", async () => {
    const h = harness({ sources: many(5), reducedMotion: true });
    h.loader.auto = true;
    h.loader.failing.add("c0");
    h.scene.failLanding.add("c1");
    h.pool.failing.add("c2");
    h.scene.failFlight.add("c3");
    h.pool.autoCorrection = 0;
    h.stream.start();
    await tick(1_000);
    const record = (id: string) => h.store.getState().records.get(id);
    expect(record("c0")).toMatchObject({
      phase: "failed",
      error: "写真を読み込めませんでした（HTTP 503）",
    });
    expect(record("c1")).toMatchObject({
      phase: "failed",
      error: "机に置けませんでした",
    });
    expect(record("c2")).toMatchObject({
      phase: "failed",
      error: "推論に失敗しました",
    });
    expect(record("c3")).toMatchObject({
      phase: "failed",
      error: "並べられませんでした",
    });
    expect(record("c4")?.phase).toBe("placed");
    expect(h.scene.log).toContain("setScanning:c2:false");
    expect(h.scene.removed()).toEqual(["c1", "c2", "c3"]);
    expect(
      h.scene.log.indexOf("removePrint:c2") >
        h.scene.log.indexOf("setScanning:c2:false"),
    ).toBe(true);
    expect(h.statuses.at(-1)).toBe("finished");
  });

  it("keeps going when the scene cannot remove a failed print", async () => {
    const h = harness({ sources: many(3), reducedMotion: true });
    h.loader.auto = true;
    h.pool.failing.add("c0");
    h.scene.failFlight.add("c1");
    h.scene.failRemove = true;
    h.pool.autoCorrection = 0;
    h.stream.start();
    await tick(1_000);
    expect(h.scene.removed()).toEqual(["c0", "c1"]);
    expect(h.phaseOf("c0")).toBe("failed");
    expect(h.phaseOf("c1")).toBe("failed");
    expect(h.phaseOf("c2")).toBe("placed");
    expect(h.statuses.at(-1)).toBe("finished");
  });

  it("hands each print the slot the store gave it when it loaded", async () => {
    const h = harness({ sources: many(3), maxLoading: 3, reducedMotion: true });
    h.pool.autoCorrection = 0;
    h.stream.start();
    await tick(0);
    h.loader.succeed("c2");
    await tick(0);
    h.loader.succeed("c0");
    await tick(0);
    h.loader.succeed("c1");
    await tick(0);
    expect(h.scene.prints.map((print) => [print.id, print.slot])).toEqual([
      ["c2", 0],
      ["c0", 1],
      ["c1", 2],
    ]);
    const slotOf = (id: string) => h.store.getState().records.get(id)?.slot;
    expect([slotOf("c2"), slotOf("c0"), slotOf("c1")]).toEqual([0, 1, 2]);
    expect(h.scene.log).toEqual(
      expect.arrayContaining(["place:c2:0", "place:c0:1", "place:c1:2"]),
    );
  });

  it("fails a photo the store could not give a slot", async () => {
    const h = harness({
      sources: many(2),
      dropLoaded: ["c0"],
      reducedMotion: true,
    });
    h.loader.auto = true;
    h.pool.autoCorrection = 0;
    h.stream.start();
    await tick(1_000);
    expect(h.store.getState().records.get("c0")).toMatchObject({
      phase: "failed",
      error: "並べる場所が決まりませんでした",
    });
    expect(h.loader.bitmaps.get("c0")?.closed).toBe(true);
    expect(h.scene.prints.map((print) => print.id)).toEqual(["c1"]);
    expect(h.scene.removed()).toEqual([]);
    expect(h.phaseOf("c1")).toBe("placed");
    expect(h.statuses.at(-1)).toBe("finished");
  });

  it("never starts more prints than the desk can hold", async () => {
    const h = harness({ sources: many(10), maxPrints: 4, reducedMotion: true });
    h.loader.auto = true;
    h.pool.autoCorrection = 0;
    h.stream.start();
    await tick(1_000);
    expect(h.loader.calls).toHaveLength(4);
    expect(h.store.getState().total).toBe(4);
    expect(h.statuses.at(-1)).toBe("finished");
    h.stream.addUserFiles([file("late.jpg")]);
    await tick(1_000);
    expect(h.loader.calls).toHaveLength(4);
    expect(h.notices.at(-1)).toEqual(expect.any(String));
    expect(h.violations).toEqual([]);
  });

  it("keeps room for visitors' photos when the stream is long", async () => {
    const h = harness({
      sources: many(200),
      maxPrints: 100,
      maxLoading: 6,
      maxPile: 12,
      poolSize: 4,
      reducedMotion: true,
    });
    h.loader.auto = true;
    h.pool.autoCorrection = 0;
    h.stream.start();
    await tick(5_000);
    expect(h.store.getState().total).toBe(90);
    expect(h.store.getState().records.size).toBe(90);
    expect(h.statuses.at(-1)).toBe("finished");
    h.stream.addUserFiles([file("a.jpg"), file("b.jpg"), file("c.jpg")]);
    expect(h.store.getState().total).toBe(93);
    await tick(5_000);
    expect(h.phaseOf("user-3")).toBe("placed");
    expect(h.statuses.at(-1)).toBe("finished");
    expect(h.violations).toEqual([]);
    expect(h.statuses).toEqual(["running", "finished", "running", "finished"]);
  });

  it("starts visitors' photos added before start first", async () => {
    const h = harness({ sources: many(5), maxLoading: 3 });
    h.stream.addUserFiles([file("a.jpg"), file("b.jpg")]);
    await tick(0);
    expect(h.loader.calls).toEqual([]);
    h.stream.start();
    await tick(0);
    expect(h.loader.calls).toEqual(["user-1", "user-2", "c0"]);
    expect(h.store.getState().total).toBe(7);
  });

  it("gives visitors' photos ids that do not clash with sources", async () => {
    const clash: PhotoSource = { ...commons(0), id: "user-1" };
    const h = harness({ sources: [clash], maxLoading: 3 });
    h.stream.addUserFiles([file("a.jpg")]);
    h.stream.start();
    await tick(0);
    expect(h.loader.calls).toEqual(["user-2", "user-1"]);
  });

  it("waits for workers that are still starting", async () => {
    const h = harness({ sources: [commons(0)], readyWorkers: 0 });
    h.loader.auto = true;
    h.stream.start();
    await tick(2_000);
    expect(h.phaseOf("c0")).toBe("waiting");
    expect(h.pool.calls).toHaveLength(0);
    h.pool.setReady(1);
    await tick(300);
    expect(h.pool.ids()).toEqual(["c0"]);
  });

  it("notices workers that become idle without a finished job", async () => {
    const h = harness({ sources: [commons(0)] });
    h.loader.auto = true;
    h.pool.setReady(0);
    h.stream.start();
    await tick(1_000);
    expect(h.pool.calls).toHaveLength(0);
    h.pool.setReady(2);
    await tick(250);
    expect(h.pool.ids()).toEqual(["c0"]);
  });

  it("stops everything on dispose and ignores late results", async () => {
    const h = harness({ sources: many(6), maxLoading: 2, poolSize: 1 });
    h.stream.start();
    await tick(0);
    h.loader.succeed("c0");
    await tick(0);
    expect(h.pool.ids()).toEqual(["c0"]);
    const signal = h.loader.pending.get("c1")?.signal;
    const actionCount = h.actions.length;
    const logCount = h.scene.log.length;
    const statusCount = h.statuses.length;
    h.stream.dispose();
    expect(signal?.aborted).toBe(true);
    h.pool.answer("c0", 1);
    h.stream.addUserFiles([file("late.jpg")]);
    h.stream.resume();
    h.stream.start();
    await tick(10_000);
    expect(h.actions).toHaveLength(actionCount);
    expect(h.scene.log).toHaveLength(logCount);
    expect(h.statuses).toHaveLength(statusCount);
  });

  it("closes images that finish loading after dispose", async () => {
    const h = harness({ sources: many(2), maxLoading: 1 });
    h.loader.honourAbort = false;
    h.stream.start();
    await tick(0);
    h.stream.dispose();
    h.loader.succeed("c0");
    await tick(0);
    expect(h.loader.bitmaps.get("c0")?.closed).toBe(true);
    expect(h.scene.log).toEqual([]);
  });
});

describe("opening hold", () => {
  it("keeps the opening batch crooked until it has landed and the hold has passed", async () => {
    const h = harness({
      sources: many(12),
      maxPile: 2,
      maxLoading: 2,
      openingBatch: 5,
      openingHoldMs: 1_000,
    });
    h.loader.auto = true;
    h.stream.start();
    await tick(0);
    expect(h.loader.calls).toEqual(["c0", "c1", "c2", "c3", "c4"]);
    expect(
      ["c0", "c1", "c2", "c3", "c4"].map((id) => h.phaseOf(id)),
    ).toEqual(["waiting", "waiting", "waiting", "waiting", "waiting"]);
    await tick(999);
    expect(h.pool.calls).toHaveLength(0);
    expect(h.statuses).toEqual(["running"]);
    await tick(1);
    expect(h.pool.ids()).toEqual(["c0", "c1"]);
    expect(h.peaks.pile).toBe(5);
    expect(h.loader.calls).toHaveLength(5);
    h.pool.answer("c0", 0);
    h.pool.answer("c1", 0);
    await tick(0);
    expect(h.pool.ids()).toEqual(["c2", "c3"]);
    expect(h.loader.calls).toHaveLength(6);
    expect(h.phaseOf("c5")).toBe("waiting");
    h.pool.answer("c2", 0);
    await tick(0);
    expect(h.pool.ids()).toEqual(["c3", "c4"]);
    expect(h.loader.calls).toHaveLength(7);
    expect(h.violations).toEqual([]);
  });

  it("starts the hold only once the model is ready", async () => {
    const h = harness({
      sources: many(3),
      openingBatch: 3,
      openingHoldMs: 600,
      readyWorkers: 0,
    });
    h.loader.auto = true;
    h.stream.start();
    await tick(5_000);
    expect(h.phaseOf("c2")).toBe("waiting");
    expect(h.pool.calls).toHaveLength(0);
    h.pool.setReady(2);
    await tick(599);
    expect(h.pool.calls).toHaveLength(0);
    await tick(1);
    expect(h.pool.ids()).toEqual(["c0", "c1"]);
  });

  it("starts the hold only once the batch has landed", async () => {
    const h = harness({
      sources: many(8),
      maxLoading: 4,
      openingBatch: 3,
      openingHoldMs: 500,
    });
    h.scene.autoLand = false;
    h.stream.start();
    await tick(0);
    h.loader.fail("c0");
    h.loader.succeed("c1");
    h.loader.succeed("c2");
    h.loader.succeed("c3");
    await tick(0);
    h.scene.land("c1");
    h.scene.land("c2");
    await tick(2_000);
    expect(h.pool.calls).toHaveLength(0);
    h.scene.land("c3");
    await tick(499);
    expect(h.pool.calls).toHaveLength(0);
    await tick(1);
    expect(h.pool.ids()).toEqual(["c1", "c2"]);
  });

  it("lets the opening go when no more photos can land", async () => {
    const h = harness({
      sources: many(2),
      openingBatch: 36,
      openingHoldMs: 1_600,
    });
    h.loader.auto = true;
    h.stream.start();
    await tick(1_599);
    expect(h.pool.calls).toHaveLength(0);
    await tick(1);
    expect(h.pool.ids()).toEqual(["c0", "c1"]);
  });

  it("lets the opening go when Commons stops answering", async () => {
    const sources = [...many(10), sample(20, 3)];
    const h = harness({
      sources,
      maxLoading: 2,
      openingBatch: 6,
      openingHoldMs: 300,
    });
    h.stream.start();
    await tick(0);
    for (let index = 0; index < 8; index += 1) {
      h.loader.fail(`c${index}`);
      await tick(0);
    }
    expect(h.statuses.at(-1)).toBe("offline");
    expect(h.loader.ids()).toEqual(["c8", "s20"]);
    h.loader.fail("c8");
    h.loader.succeed("s20");
    await tick(299);
    expect(h.pool.calls).toHaveLength(0);
    await tick(1);
    expect(h.pool.ids()).toEqual(["s20"]);
  });

  it("lets the opening go when a rate limit leaves nothing else to load", async () => {
    const h = harness({
      sources: many(6),
      maxLoading: 2,
      openingBatch: 6,
      openingHoldMs: 300,
    });
    h.stream.start();
    await tick(0);
    h.loader.rateLimit("c1", 10_000);
    await tick(0);
    h.loader.succeed("c0");
    await tick(299);
    expect(h.pool.calls).toHaveLength(0);
    expect(h.loader.calls).toEqual(["c0", "c1"]);
    await tick(1);
    expect(h.pool.ids()).toEqual(["c0"]);
    await tick(9_700);
    expect(h.loader.calls).toEqual(["c0", "c1", "c1", "c2"]);
  });

  it("waits for photos still loading or landing before letting the opening go", async () => {
    const h = harness({
      sources: many(3),
      maxLoading: 3,
      openingBatch: 10,
      openingHoldMs: 200,
    });
    h.scene.autoLand = false;
    h.stream.start();
    await tick(0);
    h.loader.succeed("c0");
    h.loader.succeed("c1");
    await tick(0);
    h.scene.land("c0");
    await tick(1_000);
    expect(h.phaseOf("c1")).toBe("landing");
    expect(h.phaseOf("c2")).toBe("loading");
    expect(h.pool.calls).toHaveLength(0);
    h.scene.land("c1");
    await tick(1_000);
    expect(h.pool.calls).toHaveLength(0);
    h.loader.succeed("c2");
    await tick(1_000);
    expect(h.phaseOf("c2")).toBe("landing");
    expect(h.pool.calls).toHaveLength(0);
    h.scene.land("c2");
    await tick(199);
    expect(h.pool.calls).toHaveLength(0);
    await tick(1);
    expect(h.pool.ids()).toEqual(["c0", "c1"]);
  });

  it("counts visitors' photos in the queue as ones that can still land", async () => {
    const h = harness({
      sources: many(1),
      openingBatch: 5,
      openingHoldMs: 300,
    });
    h.stream.start();
    await tick(0);
    h.stream.pause();
    h.stream.addUserFiles([file("mine.jpg")]);
    h.loader.succeed("c0");
    await tick(0);
    expect(h.phaseOf("c0")).toBe("waiting");
    h.stream.resume();
    await tick(1_000);
    expect(h.loader.calls).toEqual(["c0", "user-1"]);
    expect(h.pool.calls).toHaveLength(0);
    h.loader.succeed("user-1");
    await tick(299);
    expect(h.pool.calls).toHaveLength(0);
    await tick(1);
    expect(h.pool.ids()).toEqual(["user-1", "c0"]);
  });

  it("counts a photo waiting to be retried as one that can still land", async () => {
    const h = harness({
      sources: many(2),
      maxLoading: 2,
      openingBatch: 2,
      openingHoldMs: 300,
    });
    h.stream.start();
    await tick(0);
    h.loader.succeed("c1");
    await tick(0);
    h.stream.pause();
    h.loader.rateLimit("c0", 1_000);
    await tick(2_000);
    h.stream.resume();
    await tick(0);
    expect(h.loader.calls).toEqual(["c0", "c1", "c0"]);
    await tick(1_000);
    expect(h.pool.calls).toHaveLength(0);
    h.loader.succeed("c0");
    await tick(299);
    expect(h.pool.calls).toHaveLength(0);
    await tick(1);
    expect(h.pool.ids()).toEqual(["c1", "c0"]);
  });

  it("makes visitors' photos dropped during the opening wait as well", async () => {
    const h = harness({
      sources: many(6),
      poolSize: 1,
      openingBatch: 4,
      openingHoldMs: 500,
    });
    h.loader.auto = true;
    h.stream.start();
    h.stream.addUserFiles([file("mine.jpg")]);
    await tick(0);
    expect(h.phaseOf("user-1")).toBe("waiting");
    expect(h.scene.log).toContain("focus:user-1");
    await tick(499);
    expect(h.pool.calls).toHaveLength(0);
    await tick(1);
    expect(h.pool.ids()).toEqual(["user-1"]);
  });

  it("never holds again once the opening is over", async () => {
    const h = harness({
      sources: many(3),
      openingBatch: 2,
      openingHoldMs: 1_000,
      reducedMotion: true,
    });
    h.pool.autoCorrection = 0;
    h.stream.start();
    await tick(0);
    h.loader.succeed("c0");
    h.loader.succeed("c1");
    await tick(1_000);
    expect(h.phaseOf("c0")).toBe("placed");
    expect(h.phaseOf("c1")).toBe("placed");
    h.loader.succeed("c2");
    await tick(0);
    expect(h.phaseOf("c2")).toBe("placed");
    expect(h.statuses.at(-1)).toBe("finished");
  });

  it("goes straight to work without an opening batch or hold", async () => {
    const h = harness({ sources: many(2), openingBatch: 0, openingHoldMs: 0 });
    h.loader.auto = true;
    h.stream.start();
    await tick(0);
    expect(h.pool.ids()).toEqual(["c0", "c1"]);
  });
});

describe("rate limits", () => {
  it("waits out a rate limit, then retries the photo first", async () => {
    const sources = [commons(0), commons(1), sample(10, 3), commons(2)];
    const h = harness({ sources, maxLoading: 2, reducedMotion: true });
    h.pool.autoCorrection = 0;
    h.stream.start();
    await tick(0);
    expect(h.loader.calls).toEqual(["c0", "c1"]);
    const simulated = h.store.getState().records.get("c0")?.simulated;
    h.loader.rateLimit("c0", 5_000);
    await tick(0);
    expect(h.loader.calls).toEqual(["c0", "c1", "s10"]);
    h.loader.succeed("c1");
    h.loader.succeed("s10");
    await tick(0);
    expect(h.phaseOf("s10")).toBe("placed");
    h.stream.addUserFiles([file("mine.jpg")]);
    await tick(0);
    expect(h.loader.calls.at(-1)).toBe("user-1");
    h.loader.succeed("user-1");
    await tick(4_000);
    expect(h.loader.calls).toEqual(["c0", "c1", "s10", "user-1"]);
    expect(h.phaseOf("c0")).toBe("loading");
    await tick(1_000);
    expect(h.loader.calls).toEqual(["c0", "c1", "s10", "user-1", "c0", "c2"]);
    h.loader.succeed("c0");
    h.loader.succeed("c2");
    await tick(0);
    expect(h.typesFor("c0")).toEqual([
      "added",
      "loaded",
      "landed",
      "scanStarted",
      "decided",
      "placed",
    ]);
    expect(h.pool.calls.find((call) => call.id === "c0")?.simulated).toBe(
      simulated,
    );
    expect(h.notices).toEqual([]);
    expect(h.statuses).not.toContain("offline");
    expect(h.statuses.at(-1)).toBe("finished");
    expect(h.loader.maxActive).toBe(2);
    expect(h.violations).toEqual([]);
  });

  it("keeps Commons paused until the longest wait and retries in the original order", async () => {
    const h = harness({ sources: many(6), maxLoading: 2 });
    h.stream.start();
    await tick(0);
    h.loader.rateLimit("c1", 2_000);
    await tick(0);
    h.loader.rateLimit("c0", 8_000);
    await tick(7_999);
    expect(h.loader.calls).toEqual(["c0", "c1"]);
    await tick(1);
    expect(h.loader.calls).toEqual(["c0", "c1", "c0", "c1"]);
  });

  it("keeps a short wait when a longer one is already running", async () => {
    const h = harness({ sources: many(6), maxLoading: 2 });
    h.stream.start();
    await tick(0);
    h.loader.rateLimit("c0", 6_000);
    h.loader.rateLimit("c1", 1_000);
    await tick(2_000);
    h.stream.addUserFiles([file("mine.jpg")]);
    await tick(0);
    expect(h.loader.calls).toEqual(["c0", "c1", "user-1"]);
    h.loader.succeed("user-1");
    await tick(3_999);
    expect(h.loader.calls).toEqual(["c0", "c1", "user-1"]);
    await tick(1);
    expect(h.loader.calls).toEqual(["c0", "c1", "user-1", "c0", "c1"]);
  });

  it("waits at least a second and at most a minute", async () => {
    const h = harness({ sources: many(3), maxLoading: 1 });
    h.stream.start();
    await tick(0);
    h.loader.rateLimit("c0", 0);
    await tick(999);
    expect(h.loader.calls).toEqual(["c0"]);
    await tick(1);
    expect(h.loader.calls).toEqual(["c0", "c0"]);
    h.loader.rateLimit("c0", 3_600_000);
    await tick(59_999);
    expect(h.loader.calls).toEqual(["c0", "c0"]);
    await tick(1);
    expect(h.loader.calls).toEqual(["c0", "c0", "c0"]);
  });

  it("does not count rate limits toward going offline", async () => {
    const h = harness({ sources: many(30), maxLoading: 4 });
    h.stream.start();
    await tick(0);
    for (let index = 0; index < 7; index += 1) {
      h.loader.fail(`c${index}`);
      await tick(0);
    }
    expect(h.loader.ids()).toEqual(["c7", "c8", "c9", "c10"]);
    h.loader.rateLimit("c7", 1_000);
    await tick(0);
    expect(h.notices).toEqual([]);
    expect(h.statuses.at(-1)).toBe("running");
    h.loader.fail("c8");
    await tick(0);
    expect(h.notices).toEqual([OFFLINE]);
    expect(h.phaseOf("c7")).toBe("loading");
  });

  it("fails a sample that hits a rate limit without pausing Commons", async () => {
    const h = harness({
      sources: [sample(0, 2), commons(1), commons(2)],
      maxLoading: 2,
    });
    h.stream.start();
    await tick(0);
    expect(h.loader.calls).toEqual(["s0", "c1"]);
    h.loader.rateLimit("s0", 5_000);
    await tick(0);
    expect(h.phaseOf("s0")).toBe("failed");
    expect(h.loader.calls).toEqual(["s0", "c1", "c2"]);
  });
});

describe("stress", () => {
  it("keeps every limit with an opening hold, rate limits and failures at random", async () => {
    const random = mulberry32(7);
    const sources = [...many(50), sample(90, 1), sample(91, 3)];
    const h = harness({
      sources,
      maxLoading: 3,
      maxPile: 4,
      openingBatch: 8,
      openingHoldMs: 700,
      poolSize: 2,
    });
    h.scene.autoLand = false;
    h.scene.autoPlace = false;
    h.stream.start();
    for (let step = 0; step < 6_000; step += 1) {
      if (step === 30) {
        h.stream.addUserFiles([file("u1.jpg"), file("u2.jpg")]);
      }
      const options: Array<() => void> = [
        ...h.loader.ids().map((id) => () => {
          const roll = random();
          if (roll < 0.06) {
            h.loader.fail(id);
          } else if (roll < 0.14) {
            h.loader.rateLimit(id, Math.floor(random() * 3_000));
          } else {
            h.loader.succeed(id);
          }
        }),
        ...[...h.scene.landings.keys()].map((id) => () => h.scene.land(id)),
        ...h.pool.ids().map((id) => () => {
          if (random() < 0.05) {
            h.pool.reject(id);
          } else {
            h.pool.answer(id, 1);
          }
        }),
        ...[...h.scene.flights.keys()].map((id) => () => h.scene.arrive(id)),
      ];
      if (options.length === 0) {
        await tick(300);
        if (h.statuses.at(-1) === "finished") {
          break;
        }
        continue;
      }
      options[Math.floor(random() * options.length)]!();
      await tick(random() < 0.3 ? 300 : 0);
    }
    const records = [...h.store.getState().records.values()];
    expect(h.violations).toEqual([]);
    expect(h.pool.overbooked).toBe(0);
    expect(h.loader.maxActive).toBeLessThanOrEqual(3);
    expect(records).toHaveLength(54);
    expect(h.actions.filter((action) => action.type === "added")).toHaveLength(
      54,
    );
    expect(
      records.every(
        (record) => record.phase === "placed" || record.phase === "failed",
      ),
    ).toBe(true);
    expect(h.statuses.at(-1)).toBe("finished");
    const placed = records.filter((record) => record.phase === "placed");
    expect(new Set(placed.map((record) => record.slot)).size).toBe(
      placed.length,
    );
    const removed = new Set(h.scene.removed());
    for (const record of records) {
      const printed = h.scene.prints.some((print) => print.id === record.id);
      expect(removed.has(record.id)).toBe(record.phase === "failed" && printed);
    }
  });
});
