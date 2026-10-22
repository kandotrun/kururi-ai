import { readAppConfig } from "./app-config";
import type {
  DeskScene,
  FolderProgress,
  GeoPoint,
  InferencePool,
  ModelId,
  ModelOption,
  PhotoRecord,
  PhotoSource,
  Stream,
  StreamStatus,
} from "./contracts";
import { decodeManifest } from "./core/manifest";
import { modelOptions, resolveModel } from "./core/model-profiles";
import { splitPhotoFiles } from "./core/photo-files";
import { mulberry32 } from "./core/random";
import {
  buildSourceQueue,
  SAMPLE_PHOTOS,
  sampleSource,
  userSource,
} from "./core/sources";
import { computeStats } from "./core/stats";
import { createStore, initialDeskState } from "./core/store";
import { choosePool } from "./engine-choice";
import { createFallbackScene } from "./fallback-scene";
import { detectWebGpu, type GpuLike } from "./full/webgpu";
import { createIntro, type Intro } from "./intro/intro";
import { holdLandings } from "./landing-gate";
import { createLazyPool } from "./lazy-pool";
import {
  createDeskScene,
  onDeskSceneContext,
  setDeskSettled,
  WebGLUnavailableError,
} from "./scene/desk-scene";
import { createImageLoader } from "./services/image-loader";
import { createInferencePool, poolSize } from "./services/inference-pool";
import { loadModels } from "./services/model-loader";
import { detectPhotoSupport } from "./services/photo-support";
import {
  browserRenderWorkers,
  renderWorkerCount,
} from "./services/render-workers";
import { createStream, type StreamLimits } from "./services/stream";
import { mountOverlay } from "./ui/overlay";

const STATS_INTERVAL_MS = 1_000;
const FALLBACK_CAPACITY = { desktop: 3200, lowPower: 900 };
const TOKYO: GeoPoint = { lat: 35.6812, lon: 139.7671 };
const MAX_ORIGINS = 3000;
const FULL_CONFIRMED_KEY = "kururi-full-confirmed";
const FULL_CACHE_PREFIX = "kururi-ai-full-";

interface VisitorBatch {
  progress: FolderProgress;
  remaining: number;
}

const root = document.querySelector<HTMLElement>("#app");
if (!root) {
  throw new Error("Application root is missing");
}
const appRoot: HTMLElement = root;

const appBase = new URL(import.meta.env.BASE_URL, window.location.href);
const wasmBaseUrl = new URL("ort/", appBase).href;
const fullBaseSetting = import.meta.env.VITE_FULL_MODEL_BASE_URL;
const fullBaseUrl = fullBaseSetting
  ? new URL(fullBaseSetting, appBase).href
  : null;
const navigatorHints = navigator as Navigator & {
  deviceMemory?: number;
  gpu?: GpuLike;
};
const reducedMotionQuery = window.matchMedia(
  "(prefers-reduced-motion: reduce)",
);
const config = readAppConfig(window.location.search, {
  randomSeed: crypto.getRandomValues(new Uint32Array(1))[0] ?? 1,
  prefersReducedMotion: reducedMotionQuery.matches,
  coarsePointer: window.matchMedia("(pointer: coarse)").matches,
  shortestScreenSide: Math.min(window.screen.width, window.screen.height),
  deviceMemory: navigatorHints.deviceMemory,
  hardwareConcurrency: navigator.hardwareConcurrency,
});

const store = createStore(initialDeskState(0));
const pendingFiles: File[] = [];
const pendingBatchFiles = new Map<File, VisitorBatch>();
const visitorBatches = new Map<string, VisitorBatch>();
const photoSupport = detectPhotoSupport();
let latestBatch: VisitorBatch | null = null;
let reducedMotion = config.reducedMotion;
let stream: Stream | null = null;
let intro: Intro | null = null;
let introSkipRequested = false;
let activeModel: ModelId = "nano";
let modelReady = false;
let modelError: string | null = null;
let streamStatus: StreamStatus = "loading-model";
let pinned: string | null = null;
let pausedByVisitor = false;
let pausedByVisibility = false;
let openLandingGate: () => void = () => {};
const landingGate = new Promise<void>((resolve) => {
  openLandingGate = resolve;
});

const overlay = mountOverlay(appRoot, {
  addFiles(files) {
    void acceptVisitorFiles(files);
  },
  togglePause() {
    if (!stream) {
      return;
    }
    if (stream.paused) {
      pausedByVisitor = false;
      stream.resume();
    } else {
      pausedByVisitor = true;
      stream.pause();
    }
  },
  scatter() {
    void scene.scatterAll();
  },
  setSimulateUser() {},
  selectRecord(id) {
    select(id, true);
  },
  selectModel(id) {
    switchModel(id);
  },
  skipIntro() {
    requestIntroSkip();
  },
});

if (config.intro) {
  overlay.setIntroActive(true);
  overlay.canvas.style.visibility = "hidden";
} else {
  openLandingGate();
}

function requestIntroSkip(): void {
  introSkipRequested = true;
  intro?.skip();
}

function createScene(): DeskScene {
  try {
    return createDeskScene(overlay.canvas, {
      reducedMotion,
      lowPower: config.lowPower,
    });
  } catch (error) {
    if (!(error instanceof WebGLUnavailableError)) {
      console.error(error);
    }
    overlay.webglUnavailable();
    return createFallbackScene(
      config.lowPower ? FALLBACK_CAPACITY.lowPower : FALLBACK_CAPACITY.desktop,
    );
  }
}

const scene = createScene();
onDeskSceneContext(scene, (state) => {
  if (state === "failed") {
    overlay.webglUnavailable();
  }
});
scene.setViewInsets(overlay.viewInsets());
overlay.onViewInsetsChange((insets) => scene.setViewInsets(insets));

async function acceptVisitorFiles(files: File[]): Promise<void> {
  const { photos, skipped } = splitPhotoFiles(files, await photoSupport);
  const progress: FolderProgress = {
    found: files.length,
    accepted: photos.length,
    skipped,
    done: photos.length === 0,
  };
  overlay.setFolderProgress(progress);
  if (photos.length === 0) {
    return;
  }
  const batch: VisitorBatch = { progress, remaining: photos.length };
  latestBatch = batch;
  for (const photo of photos) {
    pendingBatchFiles.set(photo, batch);
  }
  requestIntroSkip();
  if (stream) {
    handOff(stream, photos);
  } else {
    pendingFiles.push(...photos);
  }
}

function handOff(target: Stream, photos: File[]): void {
  for (const file of target.addUserFiles(photos)) {
    const batch = pendingBatchFiles.get(file);
    if (!batch) {
      continue;
    }
    pendingBatchFiles.delete(file);
    batch.progress = {
      ...batch.progress,
      accepted: batch.progress.accepted - 1,
    };
    settleBatch(batch);
  }
}

function settleBatch(batch: VisitorBatch): void {
  batch.remaining -= 1;
  if (batch !== latestBatch) {
    return;
  }
  if (batch.remaining <= 0) {
    overlay.setFolderProgress({ ...batch.progress, done: true });
    latestBatch = null;
  } else {
    overlay.setFolderProgress({ ...batch.progress });
  }
}

function makeVisitorSource(file: File, id: string): PhotoSource {
  const batch = pendingBatchFiles.get(file);
  if (batch) {
    pendingBatchFiles.delete(file);
    visitorBatches.set(id, batch);
  }
  return userSource(file, id);
}

function recordOf(id: string | null): PhotoRecord | null {
  return id === null ? null : (store.getState().records.get(id) ?? null);
}

function select(id: string | null, fromOverlay: boolean): void {
  pinned = id;
  overlay.pin(recordOf(id));
  if (fromOverlay) {
    scene.select(id);
  }
}

function rememberFullConfirmed(): void {
  try {
    window.sessionStorage.setItem(FULL_CONFIRMED_KEY, "1");
  } catch {
    return;
  }
}

function takeFullConfirmed(): boolean {
  try {
    const confirmed = window.sessionStorage.getItem(FULL_CONFIRMED_KEY) === "1";
    window.sessionStorage.removeItem(FULL_CONFIRMED_KEY);
    return confirmed;
  } catch {
    return false;
  }
}

async function fullModelCached(): Promise<boolean> {
  try {
    const names = await window.caches.keys();
    return names.some((name) => name.startsWith(FULL_CACHE_PREFIX));
  } catch {
    return false;
  }
}

function switchModel(id: ModelId): void {
  const url = new URL(window.location.href);
  url.searchParams.delete("model");
  if (id === "full") {
    rememberFullConfirmed();
    url.searchParams.set("model", "full");
  }
  window.location.assign(url.toString());
}

function forgetModelInAddress(): void {
  const url = new URL(window.location.href);
  if (!url.searchParams.has("model")) {
    return;
  }
  url.searchParams.delete("model");
  window.history.replaceState(window.history.state, "", url.toString());
}

scene.on("hover", (id, at) => {
  const record = recordOf(id);
  if (record && at) {
    overlay.showLoupe(record, at);
  } else {
    overlay.hideLoupe();
  }
});
scene.on("select", (id) => select(id, false));

let statsFrame = 0;
function publishStats(): void {
  statsFrame = 0;
  overlay.setStats(computeStats(store.getState(), performance.now()));
}

function queueStats(): void {
  if (statsFrame === 0) {
    statsFrame = window.requestAnimationFrame(publishStats);
  }
}

window.setInterval(queueStats, STATS_INTERVAL_MS);

store.subscribe((state, action) => {
  const id =
    action.type === "added"
      ? action.source.id
      : "id" in action
        ? action.id
        : null;
  const record = id === null ? undefined : state.records.get(id);
  if (record) {
    overlay.upsertRecord(record);
    if (record.id === pinned) {
      overlay.pin(record);
    }
    const batch = visitorBatches.get(record.id);
    if (batch && (record.phase === "placed" || record.phase === "failed")) {
      visitorBatches.delete(record.id);
      settleBatch(batch);
    }
  }
  queueStats();
});

function showStatus(): void {
  if (modelError !== null) {
    overlay.setStatus("model-failed");
    return;
  }
  overlay.setStatus(
    !modelReady && streamStatus === "running" ? "loading-model" : streamStatus,
  );
}

function sentence(text: string): string {
  return /[。．！？]$/.test(text) ? text : `${text}。`;
}

async function loadSources(limit: number): Promise<PhotoSource[]> {
  const random = mulberry32(config.seed);
  if (config.commons) {
    try {
      const response = await fetch(new URL("commons/manifest.json", appBase));
      if (!response.ok) {
        throw new Error(`manifest ${response.status}`);
      }
      const manifest = decodeManifest(await response.json());
      return buildSourceQueue(manifest, appBase, random, limit);
    } catch (error) {
      console.warn(error);
      overlay.notice(
        "Wikimedia Commons の写真一覧を読み込めませんでした。サンプルと自分の写真は並べられます。",
      );
    }
  }
  return SAMPLE_PHOTOS.slice(0, limit).map((sample, index) =>
    sampleSource(appBase, sample, `sample-${index + 1}`),
  );
}

function nanoWorkers(): number {
  return (
    config.workers ??
    poolSize(
      navigator.hardwareConcurrency,
      navigatorHints.deviceMemory,
      config.lowPower,
    )
  );
}

function nanoPool(): Promise<InferencePool> {
  return loadModels(
    [
      {
        url: new URL("model/kururi-ai-v2-nano-small.onnx", appBase).href,
        weight: 0.18,
      },
      {
        url: new URL("model/kururi-ai-v2-nano.onnx", appBase).href,
        weight: 0.82,
      },
    ],
    (progress) => overlay.setModelProgress(progress),
  ).then((models) =>
    createInferencePool({
      size: nanoWorkers(),
      createWorker: () =>
        new Worker(new URL("./worker.ts", import.meta.url), {
          type: "module",
        }),
      initMessage: () => {
        const copies = models.map((model) => ({
          bytes: model.bytes.slice(0),
          weight: model.weight,
        }));
        return {
          message: {
            type: "init",
            engine: "nano",
            models: copies,
            wasmBaseUrl,
          },
          transfer: copies.map((model) => model.bytes),
        };
      },
    }),
  );
}

function fullPool(baseUrl: string): InferencePool {
  return createInferencePool({
    size: 1,
    createWorker: () =>
      new Worker(new URL("./worker-full.ts", import.meta.url), {
        type: "module",
      }),
    initMessage: () => ({
      message: { type: "init", engine: "full", baseUrl, wasmBaseUrl },
      transfer: [],
    }),
    onProgress: (progress) => overlay.setModelProgress(progress),
  });
}

function demoPhotoLimit(): number {
  const room = scene.capacity - Math.min(64, Math.floor(scene.capacity / 10));
  return Math.min(config.limit ?? room, room);
}

function limitsFor(model: ModelId): StreamLimits {
  const maxPrints = scene.capacity;
  if (model === "full") {
    return config.lowPower
      ? { maxPile: 12, maxLoading: 4, maxPrints, openingBatch: 40, openingHoldMs: 600 }
      : { maxPile: 24, maxLoading: 6, maxPrints, openingBatch: 120, openingHoldMs: 600 };
  }
  return config.lowPower
    ? { maxPile: 12, maxLoading: 4, maxPrints, openingBatch: 16, openingHoldMs: 1600 }
    : { maxPile: 24, maxLoading: 6, maxPrints, openingBatch: 36, openingHoldMs: 1600 };
}

async function chooseModel(): Promise<{
  model: ModelId;
  options: ModelOption[];
}> {
  const confirmed = takeFullConfirmed();
  forgetModelInAddress();
  const webgpu = await detectWebGpu(navigatorHints.gpu).catch(() => false);
  const options = modelOptions({ webgpu, fullBaseUrl });
  const { model, notice } = resolveModel(config.model, options);
  if (notice) {
    overlay.notice(notice);
  }
  if (model === "full" && !confirmed && !(await fullModelCached())) {
    overlay.setModels("nano", options);
    const full = options.find((option) => option.id === "full");
    if (full) {
      void overlay.confirmFullModel(full).then((accepted) => {
        if (accepted) {
          switchModel("full");
        }
      });
    }
    return { model: "nano", options };
  }
  overlay.setModels(model, options);
  return { model, options };
}

function originsOf(sources: readonly PhotoSource[]): GeoPoint[] {
  const origins: GeoPoint[] = [];
  for (const source of sources) {
    if (source.location && origins.length < MAX_ORIGINS) {
      origins.push({ lat: source.location.lat, lon: source.location.lon });
    }
  }
  return origins;
}

async function playIntro(origins: readonly GeoPoint[]): Promise<void> {
  if (!config.intro) {
    return;
  }
  try {
    intro = createIntro({
      container: appRoot,
      origins,
      target: TOKYO,
      textureBaseUrl: new URL("intro/", appBase).href,
      lowPower: config.lowPower,
    });
    overlay.canvas.style.visibility = "";
    if (introSkipRequested) {
      intro.skip();
    }
    await intro.play();
  } catch (error) {
    console.warn(error);
  } finally {
    overlay.canvas.style.visibility = "";
    openLandingGate();
    intro?.dispose();
    intro = null;
    overlay.setIntroActive(false);
  }
}

async function boot(): Promise<void> {
  overlay.setStatus("loading-model");
  scene.start();
  const sources = await loadSources(demoPhotoLimit());
  void playIntro(originsOf(sources));
  const { model, options } = await chooseModel();
  activeModel = model;
  store.dispatch({ type: "totalChanged", total: sources.length });
  const chosen = choosePool(
    model,
    {
      nano: nanoPool,
      full: () => fullPool(fullBaseUrl ?? ""),
    },
    (error) => {
      console.warn(error);
      activeModel = "nano";
      overlay.setModels("nano", options);
      const reason =
        error instanceof Error ? error.message : "高精度モデルを読み込めませんでした";
      overlay.notice(`${sentence(reason)}軽量モデルで判定します。`);
    },
  ).then((result) => {
    activeModel = result.model;
    return result.pool;
  });
  const pool = createLazyPool(chosen, model === "full" ? 1 : nanoWorkers());
  pool.ready.then(
    () => {
      modelReady = true;
      showStatus();
    },
    (error: unknown) => {
      console.error(error);
      modelError =
        error instanceof Error ? error.message : "モデルを読み込めませんでした";
      stream?.pause();
      overlay.notice(sentence(modelError));
      showStatus();
    },
  );
  const renderWorkers = browserRenderWorkers(
    renderWorkerCount(
      navigator.hardwareConcurrency,
      navigatorHints.deviceMemory,
      config.lowPower,
    ),
  );
  stream = createStream({
    sources,
    makeUserSource: makeVisitorSource,
    loader: createImageLoader({
      tileSize: scene.tileSize,
      timeoutMs: 15_000,
      render: renderWorkers.render,
      heavyDecodes: renderWorkers.size,
    }),
    pool,
    store,
    scene: holdLandings(scene, landingGate),
    random: mulberry32(config.seed ^ 0x9e3779b9),
    now: () => performance.now(),
    wait: (ms) => new Promise((resolve) => window.setTimeout(resolve, ms)),
    simulateUser: () => overlay.simulateUser(),
    reducedMotion: () => reducedMotion,
    limits: () => limitsFor(activeModel),
    onStatus: (status) => {
      streamStatus = status;
      setDeskSettled(scene, status === "finished");
      showStatus();
    },
    onNotice: (message) => overlay.notice(message),
  });
  stream.start();
  if (pendingFiles.length > 0) {
    handOff(stream, pendingFiles.splice(0));
  }
}

reducedMotionQuery.addEventListener("change", (event) => {
  reducedMotion = event.matches || config.forceReducedMotion;
  scene.setReducedMotion(reducedMotion);
});

document.addEventListener("visibilitychange", () => {
  if (!stream || pausedByVisitor) {
    return;
  }
  if (document.hidden && !stream.paused) {
    pausedByVisibility = true;
    stream.pause();
  } else if (!document.hidden && pausedByVisibility) {
    pausedByVisibility = false;
    stream.resume();
  }
});

boot().catch((error: unknown) => {
  console.error(error);
  openLandingGate();
  overlay.canvas.style.visibility = "";
  overlay.setIntroActive(false);
  overlay.notice(
    error instanceof Error ? error.message : "デモを開始できませんでした。",
  );
});
