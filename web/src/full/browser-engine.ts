import type { FullInitRequest } from "../types";
import {
  openAssetCache,
  type AssetCache,
  type StorageEstimateLike,
} from "./cache";
import {
  downloadAssets,
  FullModelError,
  prefetchAssets,
  sha256Hex,
  type DownloadDeps,
} from "./download";
import { createFullEngine, type FullEngine } from "./engine";
import { generalAssets, modelAssets } from "./ensemble-manifest";
import { folderUrl, loadEnsembleManifest } from "./manifest-source";
import { configureOrt, createOrtRunner } from "./ort-runner";
import { detectWebGpu, type GpuLike } from "./webgpu";

const NO_WEBGPU =
  "このブラウザでは WebGPU が使えないため、高精度モデルを動かせません";
const MANIFEST = "ensemble.json";

async function requireWebGpu(): Promise<void> {
  const gpu = (navigator as Navigator & { gpu?: GpuLike }).gpu;
  if (!(await detectWebGpu(gpu))) {
    throw new FullModelError(NO_WEBGPU);
  }
}

function cacheStorage(): CacheStorage | null {
  return typeof caches === "undefined" ? null : caches;
}

async function storageEstimate(): Promise<StorageEstimateLike | null> {
  try {
    return (await navigator.storage?.estimate()) ?? null;
  } catch {
    return null;
  }
}

async function remember(
  cache: AssetCache | null,
  url: string,
  text: string,
): Promise<void> {
  await cache?.put(
    url,
    new Response(text, { headers: { "content-type": "application/json" } }),
  );
}

export async function createBrowserEngine(
  request: FullInitRequest,
): Promise<FullEngine> {
  await requireWebGpu();
  const location = self.location.href;
  const baseUrl = folderUrl(request.baseUrl, location);
  configureOrt(folderUrl(request.wasmBaseUrl, location));
  const storage = cacheStorage();
  const manifestUrl = new URL(MANIFEST, baseUrl).href;
  const loaded = await loadEnsembleManifest(manifestUrl, {
    fetcher: (url, init) => fetch(url, init),
    lookup: async (url) => (storage ? storage.match(url) : undefined),
  });
  const manifest = loaded.manifest;
  const allAssets = [
    ...generalAssets(manifest),
    ...(manifest.fallback ? modelAssets(manifest.fallback) : []),
  ];
  const cache = await openAssetCache(
    storage,
    manifest.release,
    allAssets.reduce((sum, asset) => sum + asset.bytes, 0),
    await storageEstimate(),
  );
  if (!loaded.fromCache) {
    await remember(cache, manifestUrl, loaded.text);
  }
  const downloads: DownloadDeps = {
    fetcher: (url, init) => fetch(url, init),
    cache,
    digest: sha256Hex,
  };
  return createFullEngine({
    manifest,
    async loadAssets(assets, onProgress) {
      const result = await downloadAssets(assets, baseUrl, downloads, onProgress);
      return result.files;
    },
    prefetchAssets: (assets) => prefetchAssets(assets, baseUrl, downloads),
    createRunner: createOrtRunner,
    onFallbackError(error) {
      console.warn(error);
    },
  });
}
