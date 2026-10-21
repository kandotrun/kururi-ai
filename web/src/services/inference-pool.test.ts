import { describe, expect, expectTypeOf, it, vi } from "vitest";
import type { ModelProgress } from "../contracts";
import type { InitRequest, WorkerResponse } from "../types";
import { createInferencePool, poolSize, type WorkerLike } from "./inference-pool";
import type { LoadedModel } from "./model-loader";

class FakeWorker implements WorkerLike {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  readonly posted: Array<{ message: unknown; transfer: Transferable[] | undefined }> = [];
  terminated = false;

  postMessage(message: unknown, transfer?: Transferable[]): void {
    this.posted.push({ message, transfer });
  }

  terminate(): void {
    this.terminated = true;
  }

  raw(data: unknown): void {
    this.onmessage?.(new MessageEvent("message", { data }));
  }

  reply(data: WorkerResponse): void {
    this.raw(data);
  }

  ready(): void {
    this.reply({ type: "ready", loadMs: 10 });
  }

  progress(loaded: number, total: number): void {
    this.reply({ type: "load-progress", loaded, total });
  }

  crash(message = "worker crashed"): void {
    this.onerror?.(new ErrorEvent("error", { message }));
  }

  result(id: string, correctionCw = 0): void {
    this.reply({
      type: "result",
      id,
      correctionCw,
      confidence: 0.7,
      probabilities: [0.1, 0.1, 0.1, 0.7],
      inferenceMs: 230,
    });
  }

  processed(): Array<{ id: string; file: unknown; simulateRotation: unknown }> {
    const result: Array<{ id: string; file: unknown; simulateRotation: unknown }> = [];
    for (const { message } of this.posted) {
      if (
        typeof message === "object" &&
        message !== null &&
        "type" in message &&
        message.type === "process" &&
        "id" in message &&
        typeof message.id === "string" &&
        "file" in message &&
        "simulateRotation" in message
      ) {
        result.push({
          id: message.id,
          file: message.file,
          simulateRotation: message.simulateRotation,
        });
      }
    }
    return result;
  }
}

type InitBuilder = (workerIndex: number) => {
  message: InitRequest;
  transfer: Transferable[];
};

function models(): LoadedModel[] {
  return [
    { bytes: new Uint8Array([1, 2, 3]).buffer, weight: 0.18 },
    { bytes: new Uint8Array([4, 5]).buffer, weight: 0.82 },
  ];
}

function nanoInit(loaded: readonly LoadedModel[]): InitBuilder {
  return () => {
    const copies = loaded.map((model) => ({
      bytes: model.bytes.slice(0),
      weight: model.weight,
    }));
    return {
      message: {
        type: "init",
        engine: "nano",
        models: copies,
        wasmBaseUrl: "https://example.test/ort/",
      },
      transfer: copies.map((model) => model.bytes),
    };
  };
}

function fullInit(workerIndex: number): {
  message: InitRequest;
  transfer: Transferable[];
} {
  return {
    message: {
      type: "init",
      engine: "full",
      baseUrl: `https://models.example.test/${workerIndex}/`,
      wasmBaseUrl: "https://example.test/ort/",
    },
    transfer: [new ArrayBuffer(workerIndex + 1)],
  };
}

interface SetupOptions {
  initMessage?: InitBuilder;
  onProgress?: (progress: ModelProgress) => void;
}

function setup(size: number, options: SetupOptions = {}) {
  const workers: FakeWorker[] = [];
  const createWorker = vi.fn(() => {
    const worker = new FakeWorker();
    workers.push(worker);
    return worker;
  });
  const initMessage = vi.fn(options.initMessage ?? nanoInit(models()));
  const pool = createInferencePool({
    size,
    createWorker,
    initMessage,
    onProgress: options.onProgress,
  });
  return { pool, workers, createWorker, initMessage };
}

async function settled(promise: Promise<unknown>): Promise<boolean> {
  let done = false;
  promise.then(
    () => {
      done = true;
    },
    () => {
      done = true;
    },
  );
  for (let index = 0; index < 10; index += 1) {
    await Promise.resolve();
  }
  return done;
}

function worker(workers: FakeWorker[], index: number): FakeWorker {
  const found = workers[index];
  if (!found) {
    throw new Error(`worker ${index} was not created`);
  }
  return found;
}

const blob = new Blob(["x"], { type: "image/jpeg" });

describe("createInferencePool", () => {
  it("accepts real module workers", () => {
    expectTypeOf<Worker>().toExtend<WorkerLike>();
  });

  it("boots every worker with the init message built for its index", () => {
    const { pool, workers, createWorker, initMessage } = setup(3, {
      initMessage: fullInit,
    });
    expect(pool.size).toBe(3);
    expect(createWorker).toHaveBeenCalledTimes(3);
    expect(initMessage.mock.calls).toEqual([[0], [1], [2]]);
    workers.forEach((fake, index) => {
      const built = initMessage.mock.results[index];
      if (built?.type !== "return") {
        throw new Error(`init message ${index} was not built`);
      }
      expect(fake.posted).toHaveLength(1);
      expect(fake.posted[0]?.message).toBe(built.value.message);
      expect(fake.posted[0]?.transfer).toBe(built.value.transfer);
      expect(fake.posted[0]?.message).toMatchObject({
        engine: "full",
        baseUrl: `https://models.example.test/${index}/`,
      });
    });
  });

  it("hands nano workers the buffers the caller copied for them", () => {
    const loaded = models();
    const { workers } = setup(2, { initMessage: nanoInit(loaded) });
    const [first, second] = workers.map((fake) => fake.posted[0]);
    expect(first?.message).toMatchObject({ type: "init", engine: "nano" });
    expect(first?.transfer).toHaveLength(2);
    expect(second?.transfer).toHaveLength(2);
    for (const transferable of [
      ...(first?.transfer ?? []),
      ...(second?.transfer ?? []),
    ]) {
      expect(loaded.some((model) => model.bytes === transferable)).toBe(false);
    }
    expect(first?.transfer?.[0]).not.toBe(second?.transfer?.[0]);
  });

  it("boots a replacement worker with a fresh init message for the same index", () => {
    const { workers, initMessage } = setup(2, { initMessage: fullInit });
    worker(workers, 1).crash();
    expect(initMessage.mock.calls).toEqual([[0], [1], [1]]);
    const rebuilt = initMessage.mock.results[2];
    if (rebuilt?.type !== "return") {
      throw new Error("replacement init message was not built");
    }
    expect(worker(workers, 2).posted[0]?.message).toBe(rebuilt.value.message);
    expect(worker(workers, 2).posted[0]?.transfer).toBe(rebuilt.value.transfer);
  });

  it("forwards load progress and reports readiness once", () => {
    const onProgress = vi.fn((_progress: ModelProgress) => {});
    const { workers } = setup(1, { initMessage: fullInit, onProgress });
    expect(onProgress).not.toHaveBeenCalled();
    worker(workers, 0).progress(10, 400);
    worker(workers, 0).progress(250, 400);
    expect(onProgress.mock.calls).toEqual([
      [{ loaded: 10, total: 400, ready: false }],
      [{ loaded: 250, total: 400, ready: false }],
    ]);
    worker(workers, 0).ready();
    expect(onProgress).toHaveBeenLastCalledWith({
      loaded: 400,
      total: 400,
      ready: true,
    });
    expect(onProgress).toHaveBeenCalledTimes(3);
    worker(workers, 0).progress(5, 90);
    expect(onProgress).toHaveBeenCalledTimes(3);
  });

  it("adds up progress across workers and skips replaced workers and bad messages", () => {
    const onProgress = vi.fn((_progress: ModelProgress) => {});
    const { workers } = setup(2, { initMessage: fullInit, onProgress });
    worker(workers, 0).progress(10, 100);
    worker(workers, 1).progress(30, 50);
    expect(onProgress).toHaveBeenLastCalledWith({
      loaded: 40,
      total: 150,
      ready: false,
    });
    worker(workers, 1).raw({ type: "load-progress", loaded: "40", total: 50 });
    worker(workers, 1).raw({ type: "load-progress", loaded: 40 });
    expect(onProgress).toHaveBeenCalledTimes(2);
    worker(workers, 0).crash();
    worker(workers, 0).progress(99, 100);
    expect(onProgress).toHaveBeenCalledTimes(2);
    worker(workers, 2).progress(5, 100);
    expect(onProgress).toHaveBeenLastCalledWith({
      loaded: 35,
      total: 150,
      ready: false,
    });
    worker(workers, 1).ready();
    worker(workers, 2).ready();
    expect(onProgress).toHaveBeenLastCalledWith({
      loaded: 150,
      total: 150,
      ready: true,
    });
  });

  it("reports readiness without byte counts when workers never sent progress", () => {
    const onProgress = vi.fn((_progress: ModelProgress) => {});
    const { workers } = setup(2, { onProgress });
    worker(workers, 0).ready();
    expect(onProgress).not.toHaveBeenCalled();
    worker(workers, 1).ready();
    expect(onProgress.mock.calls).toEqual([
      [{ loaded: 0, total: 0, ready: true }],
    ]);
  });

  it("never reports readiness when no worker can start", async () => {
    const onProgress = vi.fn((_progress: ModelProgress) => {});
    const { pool, workers } = setup(1, { initMessage: fullInit, onProgress });
    worker(workers, 0).progress(10, 100);
    worker(workers, 0).crash();
    worker(workers, 1).crash();
    await expect(pool.ready).rejects.toThrow();
    expect(
      onProgress.mock.calls.some(([progress]) => progress.ready),
    ).toBe(false);
  });

  it("resolves ready once every worker is ready", async () => {
    const { pool, workers } = setup(2);
    worker(workers, 0).ready();
    expect(await settled(pool.ready)).toBe(false);
    worker(workers, 1).ready();
    expect(await settled(pool.ready)).toBe(true);
    await expect(pool.ready).resolves.toBeUndefined();
  });

  it("starts inferring as soon as one worker is ready", () => {
    const { pool, workers } = setup(2);
    void pool.infer("a", blob, 1);
    expect(pool.idleCount()).toBe(0);
    expect(worker(workers, 0).processed()).toEqual([]);
    worker(workers, 0).ready();
    expect(worker(workers, 0).processed()).toEqual([
      { id: "a", file: blob, simulateRotation: 90 },
    ]);
    expect(pool.idleCount()).toBe(0);
    worker(workers, 1).ready();
    expect(pool.idleCount()).toBe(1);
  });

  it("dispatches jobs in order to idle workers and queues the rest", async () => {
    const { pool, workers } = setup(2);
    worker(workers, 0).ready();
    worker(workers, 1).ready();
    expect(pool.idleCount()).toBe(2);
    const a = pool.infer("a", blob, 0);
    const b = pool.infer("b", blob, 2);
    const c = pool.infer("c", blob, 3);
    expect(pool.idleCount()).toBe(0);
    expect(worker(workers, 0).processed().map((job) => job.id)).toEqual(["a"]);
    expect(worker(workers, 1).processed().map((job) => job.id)).toEqual(["b"]);
    worker(workers, 1).result("b", 180);
    expect(worker(workers, 1).processed().map((job) => job.id)).toEqual([
      "b",
      "c",
    ]);
    await expect(b).resolves.toMatchObject({ correction: 2 });
    worker(workers, 0).result("a");
    worker(workers, 1).result("c");
    await expect(a).resolves.toMatchObject({ correction: 0 });
    await expect(c).resolves.toMatchObject({ correction: 0 });
    expect(pool.idleCount()).toBe(2);
  });

  it("maps worker results to predictions", async () => {
    const { pool, workers } = setup(1);
    worker(workers, 0).ready();
    const result = pool.infer("a", blob, 3);
    expect(worker(workers, 0).processed()).toEqual([
      { id: "a", file: blob, simulateRotation: 270 },
    ]);
    worker(workers, 0).result("a", 270);
    await expect(result).resolves.toEqual({
      correction: 3,
      confidence: 0.7,
      probabilities: [0.1, 0.1, 0.1, 0.7],
      inferenceMs: 230,
    });
  });

  it("ignores results for jobs the worker is not running", async () => {
    const { pool, workers } = setup(1);
    worker(workers, 0).ready();
    const result = pool.infer("a", blob, 0);
    worker(workers, 0).result("other", 90);
    expect(await settled(result)).toBe(false);
    worker(workers, 0).result("a", 90);
    await expect(result).resolves.toMatchObject({ correction: 1 });
  });

  it("rejects only the job the worker reported an error for", async () => {
    const { pool, workers } = setup(1);
    worker(workers, 0).ready();
    const a = pool.infer("a", blob, 0);
    const b = pool.infer("b", blob, 0);
    worker(workers, 0).reply({
      type: "error",
      id: "a",
      message: "画像を読み取れません",
    });
    await expect(a).rejects.toThrow("画像を読み取れません");
    expect(worker(workers, 0).processed().map((job) => job.id)).toEqual([
      "a",
      "b",
    ]);
    worker(workers, 0).result("b");
    await expect(b).resolves.toMatchObject({ correction: 0 });
  });

  it("fails the running job and recreates a crashed worker once", async () => {
    const { pool, workers, createWorker } = setup(1);
    worker(workers, 0).ready();
    const a = pool.infer("a", blob, 0);
    worker(workers, 0).crash("out of memory");
    await expect(a).rejects.toThrow("out of memory");
    expect(worker(workers, 0).terminated).toBe(true);
    expect(createWorker).toHaveBeenCalledTimes(2);
    expect(worker(workers, 1).posted[0]?.message).toMatchObject({
      type: "init",
    });
    const b = pool.infer("b", blob, 1);
    expect(pool.idleCount()).toBe(0);
    worker(workers, 1).ready();
    expect(worker(workers, 1).processed().map((job) => job.id)).toEqual(["b"]);
    const c = pool.infer("c", blob, 1);
    worker(workers, 1).crash("again");
    await expect(b).rejects.toThrow("again");
    await expect(c).rejects.toThrow();
    expect(createWorker).toHaveBeenCalledTimes(2);
    await expect(pool.infer("d", blob, 0)).rejects.toThrow();
  });

  it("ignores messages from a worker that was replaced", async () => {
    const { pool, workers } = setup(1);
    const first = worker(workers, 0);
    first.ready();
    first.crash();
    first.ready();
    expect(pool.idleCount()).toBe(0);
    const job = pool.infer("a", blob, 0);
    first.result("a");
    expect(await settled(job)).toBe(false);
    worker(workers, 1).ready();
    worker(workers, 1).result("a");
    await expect(job).resolves.toMatchObject({ correction: 0 });
  });

  it("treats an init error as a crash and keeps waiting for the replacement", async () => {
    const { pool, workers, createWorker } = setup(2);
    worker(workers, 0).reply({ type: "error", message: "wasm missing" });
    expect(createWorker).toHaveBeenCalledTimes(3);
    worker(workers, 1).ready();
    expect(await settled(pool.ready)).toBe(false);
    worker(workers, 2).ready();
    await expect(pool.ready).resolves.toBeUndefined();
    expect(pool.idleCount()).toBe(2);
  });

  it("resolves ready with the workers that survived", async () => {
    const { pool, workers } = setup(2);
    worker(workers, 0).crash();
    worker(workers, 2).crash();
    expect(await settled(pool.ready)).toBe(false);
    worker(workers, 1).ready();
    await expect(pool.ready).resolves.toBeUndefined();
    expect(pool.idleCount()).toBe(1);
  });

  it("rejects ready when no worker can start", async () => {
    const { pool, workers } = setup(1);
    worker(workers, 0).crash();
    worker(workers, 1).crash();
    await expect(pool.ready).rejects.toThrow();
  });

  it("terminates workers and rejects pending work on dispose", async () => {
    const { pool, workers } = setup(2);
    worker(workers, 0).ready();
    const running = pool.infer("a", blob, 0);
    const queued = pool.infer("b", blob, 0);
    worker(workers, 1).crash();
    pool.dispose();
    expect(workers.every((fake) => fake.terminated)).toBe(true);
    await expect(running).rejects.toThrow();
    await expect(queued).rejects.toThrow();
    await expect(pool.ready).rejects.toThrow();
    await expect(pool.infer("c", blob, 0)).rejects.toThrow();
    expect(pool.idleCount()).toBe(0);
    expect(() => worker(workers, 0).result("a")).not.toThrow();
  });
});

describe("poolSize", () => {
  it("leaves two cores free and caps at four workers", () => {
    expect(poolSize(undefined, undefined, false)).toBe(2);
    expect(poolSize(8, 8, false)).toBe(4);
    expect(poolSize(16, 16, false)).toBe(4);
    expect(poolSize(5, 8, false)).toBe(3);
    expect(poolSize(2, 8, false)).toBe(1);
    expect(poolSize(1, undefined, false)).toBe(1);
  });

  it("uses at most two workers on phones and small-memory devices", () => {
    expect(poolSize(8, 8, true)).toBe(2);
    expect(poolSize(8, 4, false)).toBe(2);
    expect(poolSize(8, 2, false)).toBe(2);
    expect(poolSize(3, 2, true)).toBe(1);
    expect(poolSize(6, undefined, true)).toBe(2);
  });
});
