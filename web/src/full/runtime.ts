import type { EnsembleDecision } from "../core/full-ensemble";
import type { Rgb8Image } from "../core/pillow-resize";
import { normalizeQuarter } from "../core/rotation";
import type {
  FullInitRequest,
  ProcessRequest,
  WorkerRequest,
  WorkerResponse,
} from "../types";
import type { FullEngine } from "./engine";

export interface FullRuntimeDeps {
  post(message: WorkerResponse): void;
  now(): number;
  createEngine(request: FullInitRequest): Promise<FullEngine>;
  decode(file: Blob, turns: number): Promise<Rgb8Image>;
  log?(error: unknown): void;
}

export interface ProcessOutcome {
  decision: EnsembleDecision;
  decodeMs: number;
  totalMs: number;
}

export interface FullRuntime {
  handle(request: WorkerRequest): Promise<void>;
  processImage(
    id: string,
    image: Rgb8Image,
  ): Promise<ProcessOutcome | null>;
}

const NANO_REFUSED = "このワーカーは高精度モデル専用です";
const START_FAILED = "高精度モデルを準備できませんでした";
const NOT_READY = "高精度モデルはまだ準備できていません";
const JUDGE_FAILED = "向きを判定できませんでした";
const JAPANESE = /[぀-ヿ一-鿿]/;

function describe(error: unknown, fallback: string): string {
  if (error instanceof Error && JAPANESE.test(error.message)) {
    return error.message;
  }
  return fallback;
}

export function createFullRuntime(deps: FullRuntimeDeps): FullRuntime {
  const log = deps.log ?? ((error: unknown) => console.error(error));
  let engine: FullEngine | null = null;
  let starting: Promise<void> | null = null;

  async function start(request: FullInitRequest): Promise<void> {
    const started = deps.now();
    try {
      const created = await deps.createEngine(request);
      await created.initialize((loaded, total) => {
        deps.post({ type: "load-progress", loaded, total });
      });
      engine = created;
      deps.post({ type: "ready", loadMs: deps.now() - started });
      created.prefetchFallback();
    } catch (error) {
      log(error);
      starting = null;
      deps.post({ type: "error", message: describe(error, START_FAILED) });
    }
  }

  async function judge(
    id: string,
    started: number,
    image: () => Promise<Rgb8Image>,
  ): Promise<ProcessOutcome | null> {
    try {
      if (engine === null) {
        throw new Error(NOT_READY);
      }
      const pixels = await image();
      const decoded = deps.now();
      const decision = await engine.process(pixels);
      const finished = deps.now();
      deps.post({
        type: "result",
        id,
        correctionCw: decision.correction * 90,
        confidence: decision.confidence,
        probabilities: [...decision.probabilities],
        inferenceMs: finished - started,
      });
      return {
        decision,
        decodeMs: decoded - started,
        totalMs: finished - started,
      };
    } catch (error) {
      if (!(error instanceof Error && error.message === NOT_READY)) {
        log(error);
      }
      deps.post({ type: "error", id, message: describe(error, JUDGE_FAILED) });
      return null;
    }
  }

  async function process(request: ProcessRequest): Promise<void> {
    const started = deps.now();
    const turns = normalizeQuarter(request.simulateRotation / 90);
    await judge(request.id, started, () => deps.decode(request.file, turns));
  }

  return {
    async handle(request) {
      if (request.type === "process") {
        await process(request);
        return;
      }
      if (request.engine !== "full") {
        deps.post({ type: "error", message: NANO_REFUSED });
        return;
      }
      starting ??= start(request);
      await starting;
    },
    async processImage(id, image) {
      return judge(id, deps.now(), async () => image);
    },
  };
}
