import type {
  DeskScene,
  ImageLoader,
  InferencePool,
  LoadedImage,
  PhotoSource,
  Prediction,
  Quarter,
  Store,
  Stream,
  StreamStatus,
} from "../contracts";
import type { Random } from "../core/random";
import { pickSimulated } from "../core/rotation";
import { RateLimitedError } from "./image-loader";

export interface StreamLimits {
  maxPile: number;
  maxLoading: number;
  maxPrints: number;
  openingBatch: number;
  openingHoldMs: number;
}

export interface StreamDeps {
  sources: readonly PhotoSource[];
  makeUserSource: (file: File, id: string) => PhotoSource;
  loader: ImageLoader;
  pool: InferencePool;
  store: Store;
  scene: Pick<
    DeskScene,
    "addPrint" | "setScanning" | "decide" | "place" | "focus" | "removePrint"
  >;
  random: Random;
  now: () => number;
  wait: (ms: number) => Promise<void>;
  simulateUser: () => boolean;
  reducedMotion: () => boolean;
  limits: () => StreamLimits;
  onStatus: (status: StreamStatus) => void;
  onNotice: (message: string | null) => void;
}

export const OFFLINE_NOTICE =
  "Wikimedia Commons に接続できませんでした。自分の写真は並べられます。";
export function deskFullNotice(leftOut: number): string {
  return `机がいっぱいなので、${leftOut.toLocaleString("ja-JP")}枚は並べられませんでした。`;
}
export const WORKERS_STOPPED_NOTICE =
  "推論ワーカーが止まったため、ここから先の写真は判定できません。ページを再読み込みしてください。";

const OFFLINE_AFTER_FAILURES = 8;
const OFFLINE_PROBE_MS = 5_000;
const IDLE_POLL_MS = 250;
const DECISION_BEAT_MS = 280;
const RELEASE_FOCUS_MS = 1_500;
const USER_RESERVE = 64;
const FOCUS_DROP_LIMIT = 3;
const MIN_RATE_PAUSE_MS = 1_000;
const MAX_RATE_PAUSE_MS = 60_000;
const NO_SLOT = "並べる場所が決まりませんでした";
const WORKERS_STOPPED = "推論ワーカーが停止したため判定できませんでした";

type OpeningPhase = "gathering" | "holding" | "released";

interface Pending {
  source: PhotoSource;
  simulated: Quarter;
  order: number;
  added: boolean;
  focus: boolean;
}

interface Landed {
  source: PhotoSource;
  blob: Blob;
  simulated: Quarter;
  focus: boolean;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isUser(source: PhotoSource): boolean {
  return source.kind === "user";
}

export function createStream(deps: StreamDeps): Stream {
  const { limits, store, scene, pool } = deps;
  const desk = limits().maxPrints;
  const reserve = Math.min(USER_RESERVE, Math.floor(desk / 10));
  const remaining = deps.sources.slice(
    0,
    Math.max(0, Math.min(deps.sources.length, desk - reserve)),
  );
  let plannedSources = remaining.length;
  const takenIds = new Set(deps.sources.map((source) => source.id));
  const userQueue: Pending[] = [];
  const retryQueue: Pending[] = [];
  const waiting: Landed[] = [];
  const controllers = new Set<AbortController>();
  let userAccepted = 0;
  let userCounter = 0;
  let pendingOrder = 0;
  let started = false;
  let paused = false;
  let disposed = false;
  let stopped = false;
  let poolReady = false;
  let opening: OpeningPhase = "gathering";
  let landedCount = 0;
  let active = 0;
  let loading = 0;
  let commonsLoading = 0;
  let landing = 0;
  let scanning = 0;
  let commonsFailures = 0;
  let commonsResumeAt = Number.NEGATIVE_INFINITY;
  let resumeScheduled = false;
  let offline = false;
  let probing = false;
  let polling = false;
  let pumping = false;
  let pumpAgain = false;
  let focused: string | null = null;
  let status: StreamStatus | null = null;

  const total = () => plannedSources + userAccepted;

  function simulatedFor(source: PhotoSource): Quarter {
    if (source.kind === "sample") {
      return 0;
    }
    if (source.kind === "user") {
      return deps.simulateUser() ? pickSimulated(deps.random) : 0;
    }
    return pickSimulated(deps.random);
  }

  function pending(source: PhotoSource, focus = false): Pending {
    pendingOrder += 1;
    return {
      source,
      simulated: simulatedFor(source),
      order: pendingOrder,
      added: false,
      focus,
    };
  }

  function dropUnstartedCommons(count: number): number {
    let dropped = 0;
    for (
      let index = remaining.length - 1;
      index >= 0 && dropped < count;
      index -= 1
    ) {
      if (remaining[index]!.kind === "commons") {
        remaining.splice(index, 1);
        dropped += 1;
      }
    }
    plannedSources -= dropped;
    return dropped;
  }

  function quietly(action: () => void): void {
    try {
      action();
    } catch {
      return;
    }
  }

  function finished(): boolean {
    return active === 0 && userQueue.length === 0 && remaining.length === 0;
  }

  function refreshStatus(): void {
    const next: StreamStatus = stopped
      ? "model-failed"
      : paused
        ? "paused"
        : finished()
          ? "finished"
          : offline
            ? "offline"
            : "running";
    if (next !== status) {
      status = next;
      deps.onStatus(next);
    }
  }

  function commonsPaused(): boolean {
    return deps.now() < commonsResumeAt;
  }

  function commonsBlocked(): boolean {
    return commonsPaused() || (offline && (probing || commonsLoading > 0));
  }

  function nextRemainingIndex(blocked: boolean): number {
    if (blocked) {
      return remaining.findIndex((source) => source.kind !== "commons");
    }
    return remaining.length > 0 ? 0 : -1;
  }

  function hasLoadable(): boolean {
    if (userQueue.length > 0) {
      return true;
    }
    const blocked = commonsBlocked();
    return (
      (!blocked && retryQueue.length > 0) || nextRemainingIndex(blocked) >= 0
    );
  }

  function nextPending(): Pending | null {
    const user = userQueue.shift();
    if (user) {
      return user;
    }
    const blocked = commonsBlocked();
    if (!blocked) {
      const retry = retryQueue.shift();
      if (retry) {
        return retry;
      }
    }
    const index = nextRemainingIndex(blocked);
    if (index < 0) {
      return null;
    }
    return pending(remaining.splice(index, 1)[0]!);
  }

  function requeue(entry: Pending): void {
    const index = retryQueue.findIndex((other) => other.order > entry.order);
    retryQueue.splice(index < 0 ? retryQueue.length : index, 0, entry);
  }

  function scheduleResume(): void {
    if (resumeScheduled) {
      return;
    }
    const delay = commonsResumeAt - deps.now();
    if (delay <= 0) {
      return;
    }
    resumeScheduled = true;
    void deps.wait(delay).then(() => {
      resumeScheduled = false;
      scheduleResume();
      pump();
    });
  }

  function pauseCommons(retryAfterMs: number): void {
    const delay = Math.min(
      MAX_RATE_PAUSE_MS,
      Math.max(MIN_RATE_PAUSE_MS, retryAfterMs),
    );
    commonsResumeAt = Math.max(commonsResumeAt, deps.now() + delay);
    scheduleResume();
  }

  function probeLater(): void {
    if (probing) {
      return;
    }
    probing = true;
    void deps.wait(OFFLINE_PROBE_MS).then(() => {
      probing = false;
      pump();
    });
  }

  function pollLater(): void {
    if (polling) {
      return;
    }
    polling = true;
    void deps.wait(IDLE_POLL_MS).then(() => {
      polling = false;
      pump();
    });
  }

  function noteCommons(source: PhotoSource, ok: boolean): void {
    if (source.kind !== "commons") {
      return;
    }
    if (ok) {
      commonsFailures = 0;
      if (offline) {
        offline = false;
        deps.onNotice(null);
      }
      return;
    }
    commonsFailures += 1;
    if (!offline && commonsFailures >= OFFLINE_AFTER_FAILURES) {
      offline = true;
      deps.onNotice(OFFLINE_NOTICE);
    }
    if (offline) {
      probeLater();
    }
  }

  function starved(): boolean {
    return loading === 0 && landing === 0 && !hasLoadable();
  }

  function updateOpening(): void {
    if (opening !== "gathering" || !poolReady) {
      return;
    }
    if (landedCount < limits().openingBatch && !starved()) {
      return;
    }
    opening = "holding";
    void deps.wait(limits().openingHoldMs).then(() => {
      opening = "released";
      pump();
    });
  }

  function pileLimit(): number {
    const { maxPile, openingBatch } = limits();
    return opening === "released" ? maxPile : Math.max(maxPile, openingBatch);
  }

  function releaseFocus(id: string): void {
    if (focused === id) {
      focused = null;
      quietly(() => scene.focus(null));
    }
  }

  function stopLoading(source: PhotoSource): void {
    loading -= 1;
    if (source.kind === "commons") {
      commonsLoading -= 1;
    }
  }

  function fail(source: PhotoSource, error: unknown): void {
    active -= 1;
    store.dispatch({ type: "failed", id: source.id, error: messageOf(error) });
    releaseFocus(source.id);
    pump();
  }

  function failPrint(source: PhotoSource, error: unknown): void {
    quietly(() => scene.removePrint(source.id));
    fail(source, error);
  }

  function workersStopped(): boolean {
    return poolReady && pool.size === 0;
  }

  function stop(): void {
    stopped = true;
    deps.onNotice(WORKERS_STOPPED_NOTICE);
    const error = new Error(WORKERS_STOPPED);
    for (const controller of controllers) {
      controller.abort();
    }
    for (const entry of waiting.splice(0)) {
      failPrint(entry.source, error);
    }
    for (const entry of retryQueue.splice(0)) {
      fail(entry.source, error);
    }
    for (const entry of userQueue.splice(0)) {
      active += 1;
      store.dispatch({
        type: "added",
        source: entry.source,
        simulated: entry.simulated,
        at: deps.now(),
      });
      fail(entry.source, error);
    }
    plannedSources -= remaining.length;
    remaining.length = 0;
    store.dispatch({ type: "totalChanged", total: total() });
  }

  function noticeStoppedWorkers(): void {
    if (!stopped && workersStopped()) {
      stop();
    }
  }

  async function runLoad(entry: Pending): Promise<void> {
    const { source, simulated, focus } = entry;
    const controller = new AbortController();
    controllers.add(controller);
    let image: LoadedImage;
    try {
      image = await deps.loader.load(source, controller.signal);
    } catch (error) {
      controllers.delete(controller);
      if (disposed) {
        return;
      }
      stopLoading(source);
      if (stopped) {
        fail(source, new Error(WORKERS_STOPPED));
        return;
      }
      if (error instanceof RateLimitedError && source.kind === "commons") {
        requeue(entry);
        pauseCommons(error.retryAfterMs);
        pump();
        return;
      }
      noteCommons(source, false);
      fail(source, error);
      return;
    }
    controllers.delete(controller);
    if (disposed) {
      image.bitmap.close();
      return;
    }
    stopLoading(source);
    if (stopped) {
      image.bitmap.close();
      fail(source, new Error(WORKERS_STOPPED));
      return;
    }
    noteCommons(source, true);
    store.dispatch({ type: "loaded", id: source.id, aspect: image.aspect });
    const slot = store.getState().records.get(source.id)?.slot ?? null;
    if (slot === null) {
      image.bitmap.close();
      fail(source, new Error(NO_SLOT));
      return;
    }
    landing += 1;
    pump();
    try {
      await scene.addPrint({
        id: source.id,
        slot,
        aspect: image.aspect,
        simulated,
        image: image.bitmap,
        emphasis: isUser(source),
      });
    } catch (error) {
      if (disposed) {
        return;
      }
      landing -= 1;
      failPrint(source, error);
      return;
    }
    if (disposed) {
      return;
    }
    landing -= 1;
    if (stopped) {
      failPrint(source, new Error(WORKERS_STOPPED));
      return;
    }
    landedCount += 1;
    store.dispatch({ type: "landed", id: source.id });
    if (focus) {
      focused = source.id;
      quietly(() => scene.focus(source.id));
    }
    waiting.push({ source, blob: image.blob, simulated, focus });
    pump();
  }

  async function runScan({
    source,
    blob,
    simulated,
    focus,
  }: Landed): Promise<void> {
    const id = source.id;
    scanning += 1;
    store.dispatch({ type: "scanStarted", id });
    let prediction: Prediction;
    try {
      scene.setScanning(id, true);
      prediction = await pool.infer(id, blob, simulated);
    } catch (error) {
      if (disposed) {
        return;
      }
      scanning -= 1;
      quietly(() => scene.setScanning(id, false));
      failPrint(source, error);
      return;
    }
    if (disposed) {
      return;
    }
    scanning -= 1;
    store.dispatch({ type: "decided", id, prediction, at: deps.now() });
    quietly(() => scene.setScanning(id, false));
    pump();
    try {
      scene.decide(id, prediction.correction);
      const beat = deps.reducedMotion() ? 0 : DECISION_BEAT_MS;
      if (beat > 0) {
        await deps.wait(beat);
      }
      if (disposed) {
        return;
      }
      const slot = store.getState().records.get(id)?.slot;
      if (slot === null || slot === undefined) {
        throw new Error(NO_SLOT);
      }
      await scene.place(id, slot);
    } catch (error) {
      if (!disposed) {
        failPrint(source, error);
      }
      return;
    }
    if (disposed) {
      return;
    }
    active -= 1;
    store.dispatch({ type: "placed", id });
    pump();
    if (focus) {
      await deps.wait(RELEASE_FOCUS_MS);
      if (!disposed) {
        releaseFocus(id);
      }
    }
  }

  function startScans(): void {
    if (opening !== "released" || stopped) {
      return;
    }
    while (waiting.length > 0 && scanning < pool.size && pool.idleCount() > 0) {
      const userIndex = waiting.findIndex((entry) => isUser(entry.source));
      const entry = waiting.splice(Math.max(0, userIndex), 1)[0]!;
      void runScan(entry);
    }
  }

  function startLoads(): void {
    while (
      !stopped &&
      loading < limits().maxLoading &&
      loading + landing + waiting.length < pileLimit()
    ) {
      const next = nextPending();
      if (!next) {
        return;
      }
      loading += 1;
      if (next.source.kind === "commons") {
        commonsLoading += 1;
      }
      if (!next.added) {
        next.added = true;
        active += 1;
        store.dispatch({
          type: "added",
          source: next.source,
          simulated: next.simulated,
          at: deps.now(),
        });
      }
      void runLoad(next);
    }
  }

  function step(): void {
    noticeStoppedWorkers();
    if (!paused) {
      updateOpening();
      startScans();
      startLoads();
      if (waiting.length > 0 && scanning === 0 && pool.idleCount() === 0) {
        pollLater();
      }
    }
    refreshStatus();
  }

  function pump(): void {
    if (!started || disposed) {
      return;
    }
    if (pumping) {
      pumpAgain = true;
      return;
    }
    pumping = true;
    try {
      do {
        pumpAgain = false;
        step();
      } while (pumpAgain && !disposed);
    } finally {
      pumping = false;
    }
  }

  function nextUserId(): string {
    let id: string;
    do {
      userCounter += 1;
      id = `user-${userCounter}`;
    } while (takenIds.has(id) || store.getState().records.has(id));
    takenIds.add(id);
    return id;
  }

  return {
    get paused() {
      return paused;
    },
    start() {
      if (started || disposed) {
        return;
      }
      started = true;
      store.dispatch({ type: "totalChanged", total: total() });
      void pool.ready.then(
        () => {
          poolReady = true;
          pump();
        },
        () => {},
      );
      pump();
    },
    pause() {
      if (disposed || paused) {
        return;
      }
      paused = true;
      pump();
    },
    resume() {
      if (disposed || !paused) {
        return;
      }
      paused = false;
      pump();
    },
    addUserFiles(files) {
      if (disposed) {
        return files.slice();
      }
      if (files.length === 0) {
        return [];
      }
      noticeStoppedWorkers();
      if (stopped) {
        pump();
        return files.slice();
      }
      const free = Math.max(
        0,
        limits().maxPrints - plannedSources - userAccepted,
      );
      const dropped =
        files.length > free ? dropUnstartedCommons(files.length - free) : 0;
      const accepted = files.slice(0, free + dropped);
      const focusEach = files.length <= FOCUS_DROP_LIMIT;
      if (!focusEach && focused !== null) {
        focused = null;
        quietly(() => scene.focus(null));
      }
      for (const file of accepted) {
        userQueue.push(
          pending(deps.makeUserSource(file, nextUserId()), focusEach),
        );
      }
      userAccepted += accepted.length;
      if (accepted.length < files.length) {
        deps.onNotice(deskFullNotice(files.length - accepted.length));
      }
      if (accepted.length > 0) {
        store.dispatch({ type: "totalChanged", total: total() });
      }
      pump();
      return files.slice(accepted.length);
    },
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      for (const controller of controllers) {
        controller.abort();
      }
      controllers.clear();
      waiting.length = 0;
      userQueue.length = 0;
      retryQueue.length = 0;
    },
  };
}
