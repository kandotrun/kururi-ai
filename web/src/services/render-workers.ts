import {
  BROWSER_RENDER_PORTS,
  renderImage,
  type RenderImage,
  type RenderPlan,
  type RenderedImage,
} from "./render-image";
import { isBitmapLike, isRecord, type RenderRequest } from "./render-protocol";

export { isRenderRequest, type RenderRequest } from "./render-protocol";

export interface RenderWorkerLike {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  terminate(): void;
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
}

export interface RenderWorkersOptions {
  size: number;
  createWorker: () => RenderWorkerLike;
  fallback?: RenderImage;
  maxRestarts?: number;
}

export interface RenderWorkers {
  readonly size: number;
  render: RenderImage;
  dispose(): void;
}

interface Job {
  id: number;
  source: Blob;
  plan: RenderPlan;
  resolve: (rendered: RenderedImage) => void;
  reject: (error: Error) => void;
}

interface Slot {
  worker: RenderWorkerLike;
  jobs: Map<number, Job>;
}

const WORKER_STOPPED = "画像を読み込むワーカーが停止しました";
const DISPOSED = "画像の読み込みを停止しました";
const DEFAULT_MAX_RESTARTS = 2;

function closeStray(data: Record<string, unknown>): void {
  if (isBitmapLike(data.tile)) {
    data.tile.close();
  }
}

export function createRenderWorkers(
  options: RenderWorkersOptions,
): RenderWorkers {
  const size = Math.max(1, Math.floor(options.size));
  const maxRestarts = options.maxRestarts ?? DEFAULT_MAX_RESTARTS;
  const slots: Slot[] = [];
  let nextId = 0;
  let failures = 0;
  let broken = false;
  let disposed = false;

  function settle(slot: Slot, data: unknown): void {
    if (!isRecord(data) || typeof data.id !== "number") {
      return;
    }
    const job = slot.jobs.get(data.id);
    if (!job) {
      closeStray(data);
      return;
    }
    if (data.type === "failed") {
      slot.jobs.delete(job.id);
      job.reject(
        new Error(
          typeof data.message === "string" ? data.message : WORKER_STOPPED,
        ),
      );
      return;
    }
    if (
      data.type !== "rendered" ||
      !isBitmapLike(data.tile) ||
      typeof data.aspect !== "number" ||
      !(data.blob === null || data.blob instanceof Blob)
    ) {
      return;
    }
    slot.jobs.delete(job.id);
    job.resolve({ tile: data.tile, blob: data.blob, aspect: data.aspect });
  }

  function viaFallback(job: Job): void {
    if (!options.fallback) {
      job.reject(new Error(WORKER_STOPPED));
      return;
    }
    options
      .fallback(job.source, job.plan)
      .then(job.resolve, (error: unknown) =>
        job.reject(error instanceof Error ? error : new Error(String(error))),
      );
  }

  function crashed(slot: Slot): void {
    const index = slots.indexOf(slot);
    if (index < 0) {
      return;
    }
    slots.splice(index, 1);
    slot.worker.onmessage = null;
    slot.worker.onerror = null;
    slot.worker.terminate();
    failures += 1;
    if (failures > maxRestarts) {
      broken = true;
    }
    const jobs = [...slot.jobs.values()];
    slot.jobs.clear();
    for (const job of jobs) {
      viaFallback(job);
    }
  }

  function spawn(): Slot | null {
    let worker: RenderWorkerLike;
    try {
      worker = options.createWorker();
    } catch {
      broken = true;
      return null;
    }
    const slot: Slot = { worker, jobs: new Map() };
    worker.onmessage = (event) => settle(slot, event.data);
    worker.onerror = () => crashed(slot);
    slots.push(slot);
    return slot;
  }

  function pick(): Slot | null {
    const idle = slots.find((slot) => slot.jobs.size === 0);
    if (idle) {
      return idle;
    }
    if (slots.length < size) {
      return spawn() ?? least();
    }
    return least();
  }

  function least(): Slot | null {
    let best: Slot | null = null;
    for (const slot of slots) {
      if (!best || slot.jobs.size < best.jobs.size) {
        best = slot;
      }
    }
    return best;
  }

  return {
    size,
    render(source, plan) {
      return new Promise<RenderedImage>((resolve, reject) => {
        if (disposed) {
          reject(new Error(DISPOSED));
          return;
        }
        nextId += 1;
        const job: Job = { id: nextId, source, plan, resolve, reject };
        const slot = broken ? null : pick();
        if (!slot) {
          viaFallback(job);
          return;
        }
        slot.jobs.set(job.id, job);
        const request: RenderRequest = {
          type: "render",
          id: job.id,
          source,
          plan,
        };
        try {
          slot.worker.postMessage(request);
        } catch {
          slot.jobs.delete(job.id);
          viaFallback(job);
        }
      });
    },
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      for (const slot of slots) {
        slot.worker.terminate();
        for (const job of slot.jobs.values()) {
          job.reject(new Error(DISPOSED));
        }
        slot.jobs.clear();
      }
    },
  };
}

export function browserRenderWorkers(
  size: number,
  fallback: RenderImage = (source, plan) =>
    renderImage(source, plan, BROWSER_RENDER_PORTS),
): RenderWorkers {
  return createRenderWorkers({
    size,
    fallback,
    createWorker: () =>
      new Worker(new URL("./render.worker.ts", import.meta.url), {
        type: "module",
      }),
  });
}

export function renderWorkerCount(
  hardwareConcurrency: number | undefined,
  deviceMemory: number | undefined,
  mobile: boolean,
): number {
  if (mobile || (deviceMemory !== undefined && deviceMemory <= 4)) {
    return 1;
  }
  return Math.min(4, Math.max(1, Math.floor((hardwareConcurrency ?? 4) / 4)));
}
