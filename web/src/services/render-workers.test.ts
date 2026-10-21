import { describe, expect, it, vi } from "vitest";
import type { RenderPlan, RenderedImage } from "./render-image";
import {
  createRenderWorkers,
  isRenderRequest,
  renderWorkerCount,
  type RenderWorkerLike,
} from "./render-workers";

interface Posted {
  message: unknown;
  transfer: Transferable[] | undefined;
}

class FakeWorker implements RenderWorkerLike {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  readonly posted: Posted[] = [];
  terminated = false;

  postMessage(message: unknown, transfer?: Transferable[]): void {
    this.posted.push({ message, transfer });
  }

  terminate(): void {
    this.terminated = true;
  }

  requestIds(): number[] {
    return this.posted.map((entry) =>
      isRenderRequest(entry.message) ? entry.message.id : -1,
    );
  }

  reply(data: unknown): void {
    this.onmessage?.(new MessageEvent("message", { data }));
  }

  render(id: number, aspect = 1.5): ImageBitmap {
    const tile = { width: 120, height: 80, close: vi.fn() };
    this.reply({ type: "rendered", id, tile, blob: null, aspect });
    return tile;
  }

  crash(): void {
    this.onerror?.({ message: "boom" } as ErrorEvent);
  }
}

const plan: RenderPlan = {
  decode: { imageOrientation: "from-image" },
  maxSide: 2_048,
  orientation: 6,
  tileSize: 120,
  encode: true,
};

function source(label: string): Blob {
  return new Blob([label], { type: "image/jpeg" });
}

function setup(
  size = 2,
  fallback?: (blob: Blob, plan: RenderPlan) => Promise<RenderedImage>,
) {
  const workers: FakeWorker[] = [];
  const createWorker = vi.fn(() => {
    const worker = new FakeWorker();
    workers.push(worker);
    return worker;
  });
  const pool = createRenderWorkers({ size, createWorker, fallback });
  return { pool, workers, createWorker };
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("createRenderWorkers", () => {
  it("starts workers only when there is work and sends the plan with the source", async () => {
    const { pool, workers, createWorker } = setup(2);
    expect(createWorker).not.toHaveBeenCalled();
    const blob = source("a");
    const job = pool.render(blob, plan);
    expect(workers).toHaveLength(1);
    const request = workers[0]!.posted[0]!.message;
    expect(isRenderRequest(request)).toBe(true);
    expect(request).toMatchObject({ type: "render", source: blob, plan });
    const tile = workers[0]!.render(workers[0]!.requestIds()[0]!, 0.75);
    await expect(job).resolves.toEqual({ tile, blob: null, aspect: 0.75 });
  });

  it("spreads work over idle workers before queueing on busy ones", async () => {
    const { pool, workers } = setup(2);
    const jobs = [
      pool.render(source("a"), plan),
      pool.render(source("b"), plan),
      pool.render(source("c"), plan),
    ];
    expect(workers).toHaveLength(2);
    expect(workers.map((worker) => worker.posted.length)).toEqual([2, 1]);
    for (const worker of workers) {
      for (const id of worker.requestIds()) {
        worker.render(id);
      }
    }
    await expect(Promise.all(jobs)).resolves.toHaveLength(3);
  });

  it("passes a worker's failure on to that job only", async () => {
    const { pool, workers } = setup(1);
    const first = pool.render(source("a"), plan);
    const second = pool.render(source("b"), plan);
    const [firstId, secondId] = workers[0]!.requestIds();
    workers[0]!.reply({ type: "failed", id: firstId, message: "壊れた画像" });
    workers[0]!.render(secondId!);
    await expect(first).rejects.toThrow("壊れた画像");
    await expect(second).resolves.toMatchObject({ aspect: 1.5 });
  });

  it("ignores replies it cannot read", async () => {
    const { pool, workers } = setup(1);
    const job = pool.render(source("a"), plan);
    const [id] = workers[0]!.requestIds();
    workers[0]!.reply(null);
    workers[0]!.reply({
      type: "rendered",
      id: 999,
      tile: {},
      blob: null,
      aspect: 1,
    });
    workers[0]!.reply({
      type: "rendered",
      id,
      tile: null,
      blob: null,
      aspect: 1,
    });
    workers[0]!.render(id!);
    await expect(job).resolves.toMatchObject({ aspect: 1.5 });
  });

  it("redoes the jobs of a crashed worker on the page and replaces the worker", async () => {
    const fallback = vi.fn(async (_blob: Blob, _plan: RenderPlan) => ({
      tile: { width: 1, height: 1, close() {} },
      blob: null,
      aspect: 2,
    }));
    const { pool, workers } = setup(1, fallback);
    const blob = source("a");
    const job = pool.render(blob, plan);
    workers[0]!.crash();
    await expect(job).resolves.toMatchObject({ aspect: 2 });
    expect(fallback).toHaveBeenCalledWith(blob, plan);
    expect(workers[0]!.terminated).toBe(true);
    const next = pool.render(source("b"), plan);
    expect(workers).toHaveLength(2);
    workers[1]!.render(workers[1]!.requestIds()[0]!);
    await expect(next).resolves.toMatchObject({ aspect: 1.5 });
  });

  it("falls back to the page for good after repeated crashes", async () => {
    const fallback = vi.fn(async () => ({
      tile: { width: 1, height: 1, close() {} },
      blob: null,
      aspect: 3,
    }));
    const { pool, workers } = setup(1, fallback);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const job = pool.render(source(`a${attempt}`), plan);
      workers.at(-1)!.crash();
      await job;
    }
    const created = workers.length;
    await expect(pool.render(source("z"), plan)).resolves.toMatchObject({
      aspect: 3,
    });
    expect(workers).toHaveLength(created);
  });

  it("uses the page when workers cannot be created at all", async () => {
    const fallback = vi.fn(async () => ({
      tile: { width: 1, height: 1, close() {} },
      blob: null,
      aspect: 4,
    }));
    const pool = createRenderWorkers({
      size: 2,
      createWorker: () => {
        throw new Error("no workers here");
      },
      fallback,
    });
    await expect(pool.render(source("a"), plan)).resolves.toMatchObject({
      aspect: 4,
    });
  });

  it("rejects work after a crash when there is no fallback", async () => {
    const { pool, workers } = setup(1);
    const job = pool.render(source("a"), plan);
    workers[0]!.crash();
    await expect(job).rejects.toThrow();
  });

  it("stops every worker and pending job on dispose", async () => {
    const { pool, workers } = setup(2);
    const jobs = [
      pool.render(source("a"), plan),
      pool.render(source("b"), plan),
    ];
    pool.dispose();
    expect(workers.every((worker) => worker.terminated)).toBe(true);
    for (const job of jobs) {
      await expect(job).rejects.toThrow();
    }
    await expect(pool.render(source("c"), plan)).rejects.toThrow();
    await flush();
  });

  it("closes tiles that arrive after their job was settled", async () => {
    const { pool, workers } = setup(1);
    const job = pool.render(source("a"), plan);
    const [id] = workers[0]!.requestIds();
    pool.dispose();
    await expect(job).rejects.toThrow();
    const tile = workers[0]!.render(id!);
    expect(tile.close).toHaveBeenCalled();
  });
});

describe("isRenderRequest", () => {
  it("accepts only well-formed render requests", () => {
    expect(
      isRenderRequest({ type: "render", id: 1, source: source("a"), plan }),
    ).toBe(true);
    expect(
      isRenderRequest({ type: "render", id: "1", source: source("a"), plan }),
    ).toBe(false);
    expect(isRenderRequest({ type: "render", id: 1, source: "a", plan })).toBe(
      false,
    );
    expect(
      isRenderRequest({
        type: "render",
        id: 1,
        source: source("a"),
        plan: null,
      }),
    ).toBe(false);
    expect(
      isRenderRequest({ type: "other", id: 1, source: source("a"), plan }),
    ).toBe(false);
    expect(isRenderRequest(undefined)).toBe(false);
  });
});

describe("renderWorkerCount", () => {
  it("uses a quarter of the cores, between one and four", () => {
    expect(renderWorkerCount(16, 8, false)).toBe(4);
    expect(renderWorkerCount(32, 16, false)).toBe(4);
    expect(renderWorkerCount(8, 8, false)).toBe(2);
    expect(renderWorkerCount(4, 8, false)).toBe(1);
    expect(renderWorkerCount(2, undefined, false)).toBe(1);
    expect(renderWorkerCount(undefined, undefined, false)).toBe(1);
  });

  it("keeps a single worker on phones and low-memory devices", () => {
    expect(renderWorkerCount(16, 8, true)).toBe(1);
    expect(renderWorkerCount(16, 4, false)).toBe(1);
  });
});
