import { readAppConfig } from "./app-config";
import type {
  DeskScene,
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
import { createLazyPool } from "./lazy-pool";
import { createDeskScene, WebGLUnavailableError } from "./scene/desk-scene";
import { createImageLoader } from "./services/image-loader";
import { createInferencePool, poolSize } from "./services/inference-pool";
import { loadModels } from "./services/model-loader";
import { createStream, type StreamLimits } from "./services/stream";
import { mountOverlay } from "./ui/overlay";

const STATS_INTERVAL_MS = 1_000;
const FALLBACK_CAPACITY = { desktop: 3200, lowPower: 900 };

const root = document.querySelector<HTMLElement>("#app");
if (!root) {
  throw new Error("Application root is missing");
}

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
let reducedMotion = config.reducedMotion;
let stream: Stream | null = null;
let modelReady = false;
let streamStatus: StreamStatus = "loading-model";
let pinned: string | null = null;
let pausedByVisitor = false;
let pausedByVisibility = false;

const overlay = mountOverlay(root, {
  addFiles(files) {
    if (stream) {
      stream.addUserFiles(files);
    } else {
      pendingFiles.push(...files);
    }
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
});

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

function switchModel(id: ModelId): void {
  const url = new URL(window.location.href);
  if (id === "full") {
    url.searchParams.set("model", "full");
  } else {
    url.searchParams.delete("model");
  }
  window.location.assign(url.toString());
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
  const id = action.type === "added" ? action.source.id : "id" in action ? action.id : null;
  const record = id === null ? undefined : state.records.get(id);
  if (record) {
    overlay.upsertRecord(record);
    if (record.id === pinned) {
      overlay.pin(record);
    }
  }
  queueStats();
});

function showStatus(): void {
  overlay.setStatus(
    !modelReady && streamStatus === "running" ? "loading-model" : streamStatus,
  );
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
  const webgpu = await detectWebGpu(navigatorHints.gpu).catch(() => false);
  const options = modelOptions({ webgpu, fullBaseUrl });
  const { model, notice } = resolveModel(config.model, options);
  overlay.setModels(model, options);
  if (notice) {
    overlay.notice(notice);
  }
  return { model, options };
}

async function boot(): Promise<void> {
  overlay.setStatus("loading-model");
  scene.start();
  const { model, options } = await chooseModel();
  const sources = await loadSources(demoPhotoLimit());
  store.dispatch({ type: "totalChanged", total: sources.length });
  const chosen = choosePool(
    model,
    {
      nano: nanoPool,
      full: () => fullPool(fullBaseUrl ?? ""),
    },
    (error) => {
      console.warn(error);
      overlay.setModels("nano", options);
      overlay.notice(
        `${error instanceof Error ? error.message : "高精度モデルを読み込めませんでした。"} 軽量モデルで判定します。`,
      );
    },
  );
  const pool = createLazyPool(chosen, model === "full" ? 1 : nanoWorkers());
  pool.ready.then(
    () => {
      modelReady = true;
      showStatus();
    },
    (error: unknown) => {
      console.error(error);
      overlay.notice(
        error instanceof Error ? error.message : "モデルを読み込めませんでした。",
      );
    },
  );
  stream = createStream({
    sources,
    makeUserSource: userSource,
    loader: createImageLoader({ tileSize: scene.tileSize, timeoutMs: 15_000 }),
    pool,
    store,
    scene,
    random: mulberry32(config.seed ^ 0x9e3779b9),
    now: () => performance.now(),
    wait: (ms) => new Promise((resolve) => window.setTimeout(resolve, ms)),
    simulateUser: () => overlay.simulateUser(),
    reducedMotion: () => reducedMotion,
    limits: limitsFor(model),
    onStatus: (status) => {
      streamStatus = status;
      showStatus();
    },
    onNotice: (message) => overlay.notice(message),
  });
  stream.start();
  if (pendingFiles.length > 0) {
    stream.addUserFiles(pendingFiles.splice(0));
  }
}

reducedMotionQuery.addEventListener("change", (event) => {
  reducedMotion = event.matches || config.reducedMotion;
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
  overlay.notice(
    error instanceof Error ? error.message : "デモを開始できませんでした。",
  );
});
