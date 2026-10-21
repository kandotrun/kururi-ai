import type {
  InferencePool,
  ModelProgress,
  Prediction,
  Probabilities,
  Quarter,
} from "../contracts";
import { normalizeQuarter } from "../core/rotation";
import type {
  InitRequest,
  ProcessRequest,
  ResultMessage,
  WorkerResponse,
} from "../types";

export interface WorkerLike {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  terminate(): void;
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
}

export interface WorkerInit {
  message: InitRequest;
  transfer: Transferable[];
}

export interface PoolOptions {
  size: number;
  createWorker: () => WorkerLike;
  initMessage: (workerIndex: number) => WorkerInit;
  onProgress?: (progress: ModelProgress) => void;
}

interface Job {
  id: string;
  blob: Blob;
  simulated: Quarter;
  resolve: (prediction: Prediction) => void;
  reject: (error: Error) => void;
}

interface Slot {
  index: number;
  worker: WorkerLike;
  ready: boolean;
  alive: boolean;
  restarts: number;
  job: Job | null;
  progress: { loaded: number; total: number } | null;
}

const MAX_RESTARTS = 1;
const CRASHED = "推論ワーカーが停止しました";
const NO_WORKERS = "推論ワーカーを起動できませんでした";
const DISPOSED = "推論を停止しました";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readResponse(data: unknown): WorkerResponse | null {
  if (!isRecord(data)) {
    return null;
  }
  if (data.type === "ready") {
    return {
      type: "ready",
      loadMs: typeof data.loadMs === "number" ? data.loadMs : 0,
    };
  }
  if (
    data.type === "load-progress" &&
    typeof data.loaded === "number" &&
    typeof data.total === "number"
  ) {
    return { type: "load-progress", loaded: data.loaded, total: data.total };
  }
  if (data.type === "error") {
    return {
      type: "error",
      id: typeof data.id === "string" ? data.id : undefined,
      message: typeof data.message === "string" ? data.message : CRASHED,
    };
  }
  if (
    data.type === "result" &&
    typeof data.id === "string" &&
    typeof data.correctionCw === "number" &&
    typeof data.confidence === "number" &&
    Array.isArray(data.probabilities) &&
    typeof data.inferenceMs === "number"
  ) {
    return {
      type: "result",
      id: data.id,
      correctionCw: data.correctionCw,
      confidence: data.confidence,
      probabilities: data.probabilities.map((value: unknown) =>
        typeof value === "number" ? value : 0,
      ),
      inferenceMs: data.inferenceMs,
    };
  }
  return null;
}

function toPrediction(message: ResultMessage): Prediction {
  const values = message.probabilities;
  const probabilities: Probabilities = [
    values[0] ?? 0,
    values[1] ?? 0,
    values[2] ?? 0,
    values[3] ?? 0,
  ];
  return {
    correction: normalizeQuarter(message.correctionCw / 90),
    confidence: message.confidence,
    probabilities,
    inferenceMs: message.inferenceMs,
  };
}

export function poolSize(
  hardwareConcurrency: number | undefined,
  deviceMemory: number | undefined,
  mobile: boolean,
): number {
  const base = Math.min(4, Math.max(1, (hardwareConcurrency ?? 4) - 2));
  const constrained =
    mobile || (deviceMemory !== undefined && deviceMemory <= 4);
  return constrained ? Math.min(base, 2) : base;
}

export function createInferencePool(options: PoolOptions): InferencePool {
  const size = Math.max(1, Math.floor(options.size));
  const queue: Job[] = [];
  const slots: Slot[] = [];
  let disposed = false;
  let readySettled = false;
  let resolveReady: () => void = () => {};
  let rejectReady: (error: Error) => void = () => {};
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  ready.catch(() => {});

  function progressTotals(): { loaded: number; total: number } {
    let loaded = 0;
    let total = 0;
    for (const slot of slots) {
      loaded += slot.progress?.loaded ?? 0;
      total += slot.progress?.total ?? 0;
    }
    return { loaded, total };
  }

  function reportProgress(): void {
    if (!readySettled) {
      options.onProgress?.({ ...progressTotals(), ready: false });
    }
  }

  function settleReady(error: Error | null): void {
    if (readySettled) {
      return;
    }
    readySettled = true;
    if (error) {
      rejectReady(error);
      return;
    }
    resolveReady();
    const { total } = progressTotals();
    options.onProgress?.({ loaded: total, total, ready: true });
  }

  function rejectQueue(message: string): void {
    for (const job of queue.splice(0)) {
      job.reject(new Error(message));
    }
  }

  function checkReady(): void {
    const alive = slots.filter((slot) => slot.alive);
    if (alive.length === 0) {
      settleReady(new Error(NO_WORKERS));
      rejectQueue(NO_WORKERS);
      return;
    }
    if (alive.every((slot) => slot.ready)) {
      settleReady(null);
    }
  }

  function pump(): void {
    if (disposed) {
      return;
    }
    for (const slot of slots) {
      if (queue.length === 0) {
        return;
      }
      if (!slot.alive || !slot.ready || slot.job) {
        continue;
      }
      const job = queue.shift()!;
      slot.job = job;
      const request: ProcessRequest = {
        type: "process",
        id: job.id,
        file: job.blob,
        simulateRotation: job.simulated * 90,
      };
      slot.worker.postMessage(request);
    }
  }

  function finishJob(slot: Slot): Job | null {
    const job = slot.job;
    slot.job = null;
    return job;
  }

  function crash(slot: Slot, message: string): void {
    finishJob(slot)?.reject(new Error(message));
    slot.worker.terminate();
    slot.ready = false;
    slot.progress = null;
    if (slot.restarts < MAX_RESTARTS) {
      slot.restarts += 1;
      slot.worker = options.createWorker();
      boot(slot);
    } else {
      slot.alive = false;
    }
    checkReady();
    pump();
  }

  function handle(slot: Slot, data: unknown): void {
    const message = readResponse(data);
    if (!message) {
      return;
    }
    if (message.type === "load-progress") {
      slot.progress = { loaded: message.loaded, total: message.total };
      reportProgress();
      return;
    }
    if (message.type === "ready") {
      slot.ready = true;
      checkReady();
      pump();
      return;
    }
    if (message.type === "result") {
      if (slot.job?.id === message.id) {
        finishJob(slot)?.resolve(toPrediction(message));
        pump();
      }
      return;
    }
    if (!slot.ready) {
      crash(slot, message.message);
      return;
    }
    if (slot.job && (message.id === undefined || slot.job.id === message.id)) {
      finishJob(slot)?.reject(new Error(message.message));
      pump();
    }
  }

  function boot(slot: Slot): void {
    const worker = slot.worker;
    worker.onmessage = (event) => {
      if (!disposed && slot.worker === worker) {
        handle(slot, event.data);
      }
    };
    worker.onerror = (event) => {
      if (!disposed && slot.worker === worker) {
        crash(slot, event.message || CRASHED);
      }
    };
    const init = options.initMessage(slot.index);
    worker.postMessage(init.message, init.transfer);
  }

  for (let index = 0; index < size; index += 1) {
    const slot: Slot = {
      index,
      worker: options.createWorker(),
      ready: false,
      alive: true,
      restarts: 0,
      job: null,
      progress: null,
    };
    slots.push(slot);
    boot(slot);
  }

  return {
    size,
    ready,
    idleCount() {
      if (disposed) {
        return 0;
      }
      return slots.filter((slot) => slot.alive && slot.ready && !slot.job)
        .length;
    },
    infer(id, blob, simulated) {
      if (disposed) {
        return Promise.reject(new Error(DISPOSED));
      }
      if (!slots.some((slot) => slot.alive)) {
        return Promise.reject(new Error(NO_WORKERS));
      }
      return new Promise<Prediction>((resolve, reject) => {
        queue.push({ id, blob, simulated, resolve, reject });
        pump();
      });
    },
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      for (const slot of slots) {
        slot.worker.terminate();
        slot.alive = false;
        finishJob(slot)?.reject(new Error(DISPOSED));
      }
      rejectQueue(DISPOSED);
      settleReady(new Error(DISPOSED));
    },
  };
}
