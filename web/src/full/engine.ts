import {
  alignViews,
  buildViewBatch,
  decideEnsemble,
  needsFallback,
  prepareModelInput,
  weightedAverage,
  type EnsembleDecision,
  type WeightedProbabilities,
} from "../core/full-ensemble";
import type { Rgb8Image } from "../core/pillow-resize";
import type { AssetBytes } from "./download";
import {
  modelAssets,
  type EnsembleAsset,
  type EnsembleManifest,
  type EnsembleModel,
} from "./ensemble-manifest";
import type { ProgressReport } from "./progress";

export interface ModelRunner {
  run(batch: Float32Array, side: number): Promise<Float32Array>;
  release(): Promise<void>;
}

export interface FullEngineDeps {
  manifest: EnsembleManifest;
  loadAssets(
    assets: readonly EnsembleAsset[],
    onProgress: ProgressReport | null,
  ): Promise<Map<string, AssetBytes>>;
  createRunner(
    model: EnsembleModel,
    files: ReadonlyMap<string, AssetBytes>,
  ): Promise<ModelRunner>;
  onFallbackError?(error: unknown): void;
}

export interface FullEngine {
  initialize(onProgress: ProgressReport | null): Promise<void>;
  prefetchFallback(): void;
  process(image: Rgb8Image): Promise<EnsembleDecision>;
  dispose(): Promise<void>;
}

interface LoadedModel {
  model: EnsembleModel;
  runner: ModelRunner;
}

const NOT_READY = "高精度モデルはまだ準備できていません";
const STOPPED = "高精度モデルを停止しました";
const BAD_OUTPUT = "高精度モデルの出力を読み取れませんでした";
const VIEWS = 4;
const OUTPUTS = VIEWS * 4;

async function infer(
  loaded: LoadedModel,
  batch: Float32Array,
): Promise<WeightedProbabilities> {
  const logits = await loaded.runner.run(batch, loaded.model.inputSize);
  if (logits.length !== OUTPUTS) {
    throw new Error(BAD_OUTPUT);
  }
  return { weight: loaded.model.weight, probabilities: alignViews(logits) };
}

async function releaseAll(models: readonly LoadedModel[]): Promise<void> {
  await Promise.all(
    models.map((entry) => entry.runner.release().catch(() => {})),
  );
}

export function createFullEngine(deps: FullEngineDeps): FullEngine {
  const { manifest } = deps;
  let general: LoadedModel[] | null = null;
  let fallback: Promise<LoadedModel> | null = null;
  let fallbackFiles: Promise<Map<string, AssetBytes>> | null = null;
  const owned: LoadedModel[] = [];
  let disposed = false;
  let queue: Promise<unknown> = Promise.resolve();

  async function load(
    models: readonly EnsembleModel[],
    onProgress: ProgressReport | null,
    preloaded: Map<string, AssetBytes> | null = null,
  ): Promise<LoadedModel[]> {
    const files =
      preloaded ??
      (await deps.loadAssets(models.flatMap(modelAssets), onProgress));
    const loaded: LoadedModel[] = [];
    try {
      for (const model of models) {
        const entry = { model, runner: await deps.createRunner(model, files) };
        for (const asset of modelAssets(model)) {
          files.delete(asset.file);
        }
        loaded.push(entry);
        const side = model.inputSize;
        await infer(entry, new Float32Array(VIEWS * 3 * side * side));
      }
    } catch (error) {
      await releaseAll(loaded);
      throw error;
    }
    owned.push(...loaded);
    return loaded;
  }

  function fallbackAssets(model: EnsembleModel): Promise<Map<string, AssetBytes>> {
    if (fallbackFiles === null) {
      const pending = deps.loadAssets(modelAssets(model), null);
      pending.catch(() => {
        if (fallbackFiles === pending) {
          fallbackFiles = null;
        }
      });
      fallbackFiles = pending;
    }
    return fallbackFiles;
  }

  async function fallbackModel(): Promise<LoadedModel | null> {
    const model = manifest.fallback;
    if (model === null) {
      return null;
    }
    if (fallback === null) {
      const pending = fallbackAssets(model)
        .then((files) => load([model], null, files))
        .then((loaded) => loaded[0]!);
      pending.catch(() => {
        if (fallback === pending) {
          fallback = null;
        }
      });
      fallback = pending;
    }
    try {
      return await fallback;
    } catch (error) {
      deps.onFallbackError?.(error);
      return null;
    }
  }

  async function run(image: Rgb8Image): Promise<EnsembleDecision> {
    if (disposed) {
      throw new Error(STOPPED);
    }
    if (general === null) {
      throw new Error(NOT_READY);
    }
    const batches = new Map<number, Float32Array>();
    const batchFor = (side: number): Float32Array => {
      const existing = batches.get(side);
      if (existing) {
        return existing;
      }
      const created = buildViewBatch(prepareModelInput(image, side), side);
      batches.set(side, created);
      return created;
    };
    const runs: WeightedProbabilities[] = [];
    for (const entry of general) {
      runs.push(await infer(entry, batchFor(entry.model.inputSize)));
    }
    let extra: WeightedProbabilities | null = null;
    if (
      manifest.fallback !== null &&
      needsFallback(weightedAverage(runs), manifest.fallbackMargin)
    ) {
      const entry = await fallbackModel();
      if (entry !== null) {
        extra = await infer(entry, batchFor(entry.model.inputSize));
      }
    }
    return decideEnsemble(runs, extra);
  }

  return {
    async initialize(onProgress) {
      if (disposed) {
        throw new Error(STOPPED);
      }
      if (general === null) {
        general = await load(manifest.general, onProgress);
      }
    },
    prefetchFallback() {
      if (general === null || disposed || manifest.fallback === null) {
        return;
      }
      fallbackAssets(manifest.fallback).catch((error: unknown) => {
        deps.onFallbackError?.(error);
      });
    },
    process(image) {
      const task = queue.then(() => run(image));
      queue = task.catch(() => {});
      return task;
    },
    async dispose() {
      disposed = true;
      await queue;
      await fallback?.catch(() => null);
      await fallbackFiles?.catch(() => null);
      await releaseAll(owned.splice(0));
      general = null;
    },
  };
}
