type ChannelKind = "production" | "probe";

interface Progress {
  loaded: number;
  total: number;
  at: number;
}

interface Waiting {
  resolve: (value: Record<string, unknown>) => void;
  reject: (error: Error) => void;
  result: Record<string, unknown> | null;
  detail: Record<string, unknown> | null;
  needsDetail: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

class Channel {
  readonly worker: Worker;
  readonly progress: Progress[] = [];
  private readonly waiting = new Map<string, Waiting>();
  private ready: ((value: Record<string, unknown>) => void) | null = null;
  private failed: ((error: Error) => void) | null = null;
  private started = 0;

  constructor(kind: ChannelKind) {
    this.worker =
      kind === "production"
        ? new Worker(new URL("../src/worker-full.ts", import.meta.url), { type: "module" })
        : new Worker(new URL("./engine-parity-worker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = (event: MessageEvent<unknown>) => this.receive(event.data);
    this.worker.onerror = (event) => {
      const error = new Error(event.message || "worker error");
      this.failed?.(error);
      for (const entry of this.waiting.values()) {
        entry.reject(error);
      }
    };
  }

  init(baseUrl: string, wasmBaseUrl: string): Promise<Record<string, unknown>> {
    this.started = performance.now();
    return new Promise((resolve, reject) => {
      this.ready = resolve;
      this.failed = reject;
      this.worker.postMessage({ type: "init", engine: "full", baseUrl, wasmBaseUrl });
    });
  }

  send(
    id: string,
    message: Record<string, unknown>,
    needsDetail: boolean,
    transfer: Transferable[] = [],
  ): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      this.waiting.set(id, { resolve, reject, result: null, detail: null, needsDetail });
      this.worker.postMessage(message, transfer);
    });
  }

  private settle(id: string): void {
    const entry = this.waiting.get(id);
    if (!entry || !entry.result || (entry.needsDetail && !entry.detail)) {
      return;
    }
    this.waiting.delete(id);
    entry.resolve({ result: entry.result, detail: entry.detail });
  }

  private receive(data: unknown): void {
    if (!isRecord(data)) {
      return;
    }
    const message = data;
    if (message.type === "load-progress" && typeof message.loaded === "number" && typeof message.total === "number") {
      this.progress.push({ loaded: message.loaded, total: message.total, at: performance.now() - this.started });
      return;
    }
    if (message.type === "ready") {
      this.ready?.({ loadMs: message.loadMs, wallMs: performance.now() - this.started });
      return;
    }
    const id = typeof message.id === "string" ? message.id : null;
    if (message.type === "error") {
      if (id === null) {
        this.failed?.(new Error(String(message.message)));
        return;
      }
      const entry = this.waiting.get(id);
      if (entry) {
        entry.result = { ...message };
        if (!entry.needsDetail) {
          this.settle(id);
        }
      }
      return;
    }
    if (id === null) {
      return;
    }
    const entry = this.waiting.get(id);
    if (!entry) {
      return;
    }
    if (message.type === "result") {
      entry.result = { ...message };
    } else if (message.type === "detail") {
      entry.detail = { ...message };
    }
    this.settle(id);
  }
}

const channels = new Map<string, Channel>();
let counter = 0;

async function bytes(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }
  return response.arrayBuffer();
}

function channel(name: string): Channel {
  const found = channels.get(name);
  if (!found) {
    throw new Error(`unknown channel ${name}`);
  }
  return found;
}

const api = {
  async open(name: string, kind: ChannelKind, baseUrl: string, wasmBaseUrl: string) {
    const created = new Channel(kind);
    channels.set(name, created);
    const ready = await created.init(baseUrl, wasmBaseUrl);
    return { ...ready, progress: created.progress };
  },
  close(name: string) {
    channels.get(name)?.worker.terminate();
    channels.delete(name);
  },
  async process(name: string, url: string, simulateRotation: number) {
    const file = new Blob([await bytes(url)]);
    const id = `p${(counter += 1)}`;
    const started = performance.now();
    const outcome = await channel(name).send(id, { type: "process", id, file, simulateRotation }, false);
    return { ...outcome, wallMs: performance.now() - started };
  },
  async probeFile(name: string, url: string, simulateRotation: number, referenceUrl: string | null) {
    const file = new Blob([await bytes(url)]);
    const reference = referenceUrl === null ? null : await bytes(referenceUrl);
    const id = `f${(counter += 1)}`;
    const started = performance.now();
    const outcome = await channel(name).send(
      id,
      { type: "probe-file", id, file, simulateRotation, reference },
      true,
      reference === null ? [] : [reference],
    );
    return { ...outcome, wallMs: performance.now() - started };
  },
  async probeRgb(name: string, url: string, width: number, height: number, simulateRotation: number) {
    const rgb = await bytes(url);
    const id = `r${(counter += 1)}`;
    const started = performance.now();
    const outcome = await channel(name).send(
      id,
      { type: "probe-rgb", id, rgb, width, height, simulateRotation },
      true,
      [rgb],
    );
    return { ...outcome, wallMs: performance.now() - started };
  },
  async cacheState() {
    const names = await caches.keys();
    const entries: Record<string, number> = {};
    for (const name of names) {
      entries[name] = (await (await caches.open(name)).keys()).length;
    }
    const estimate = await navigator.storage.estimate();
    return { names, entries, usage: estimate.usage ?? null, quota: estimate.quota ?? null };
  },
};

Object.assign(window, { engineParity: api });
const status = document.querySelector("#status");
if (status) {
  status.textContent = "照合の準備ができました";
}
