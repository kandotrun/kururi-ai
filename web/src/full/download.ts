import type { AssetCache } from "./cache";
import type { EnsembleAsset } from "./ensemble-manifest";
import { createProgressMeter, type ProgressReport } from "./progress";

export type AssetBytes = Uint8Array<ArrayBuffer>;

export interface DownloadDeps {
  fetcher: (url: string, init: RequestInit) => Promise<Response>;
  cache: AssetCache | null;
  digest: (data: AssetBytes) => Promise<string>;
}

export interface DownloadedAssets {
  files: Map<string, AssetBytes>;
  fromCache: string[];
  stored: string[];
}

interface Fetched {
  data: AssetBytes;
  cached: boolean;
  stored: boolean;
}

export class FullModelError extends Error {}

const FETCH_FAILED = "高精度モデルを取得できませんでした";
const PROGRESS_STEPS = 400;

function sizeError(file: string): FullModelError {
  return new FullModelError(`高精度モデルのファイルサイズが合いません（${file}）`);
}

export async function sha256Hex(data: AssetBytes): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function readExact(
  response: Response,
  asset: EnsembleAsset,
  onBytes: (count: number) => void,
): Promise<AssetBytes> {
  const data = new Uint8Array(asset.bytes);
  let offset = 0;
  const append = (chunk: Uint8Array) => {
    if (offset + chunk.byteLength > data.length) {
      throw sizeError(asset.file);
    }
    data.set(chunk, offset);
    offset += chunk.byteLength;
    onBytes(chunk.byteLength);
  };
  if (!response.body) {
    append(new Uint8Array(await response.arrayBuffer()));
  } else {
    const reader = response.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        append(value);
      }
    } catch (error) {
      await reader.cancel().catch(() => {});
      throw error instanceof FullModelError
        ? error
        : new FullModelError(`${FETCH_FAILED}（通信が途中で切れました）`);
    }
  }
  if (offset !== data.length) {
    throw sizeError(asset.file);
  }
  return data;
}

export async function downloadAssets(
  assets: readonly EnsembleAsset[],
  baseUrl: string,
  deps: DownloadDeps,
  onProgress: ProgressReport | null,
): Promise<DownloadedAssets> {
  const total = assets.reduce((sum, asset) => sum + asset.bytes, 0);
  const meter = createProgressMeter(
    assets.map((asset) => asset.bytes),
    onProgress ?? (() => {}),
    Math.max(1, Math.floor(total / PROGRESS_STEPS)),
  );
  const controller = new AbortController();
  const cache = deps.cache;

  async function fromCache(
    asset: EnsembleAsset,
    index: number,
    url: string,
  ): Promise<AssetBytes | null> {
    if (cache === null) {
      return null;
    }
    const cached = await cache.match(url);
    if (!cached) {
      return null;
    }
    const data = await readExact(cached, asset, (count) =>
      meter.add(index, count),
    ).catch(() => null);
    if (data && (await deps.digest(data)) === asset.sha256) {
      return data;
    }
    await cache.delete(url);
    meter.reset(index);
    return null;
  }

  async function fromNetwork(
    asset: EnsembleAsset,
    index: number,
    url: string,
    storing: boolean,
  ): Promise<AssetBytes> {
    const init: RequestInit = { signal: controller.signal };
    if (storing) {
      init.cache = "no-store";
    }
    let response: Response;
    try {
      response = await deps.fetcher(url, init);
    } catch {
      throw new FullModelError(`${FETCH_FAILED}（ネットワークに接続できません）`);
    }
    if (!response.ok) {
      throw new FullModelError(`${FETCH_FAILED}（HTTP ${response.status}）`);
    }
    const data = await readExact(response, asset, (count) =>
      meter.add(index, count),
    );
    if ((await deps.digest(data)) !== asset.sha256) {
      throw new FullModelError(
        `高精度モデルのファイルが壊れています（${asset.file}）`,
      );
    }
    return data;
  }

  async function fetchOne(
    asset: EnsembleAsset,
    index: number,
  ): Promise<Fetched> {
    const url = new URL(asset.file, baseUrl).href;
    const cachedData = await fromCache(asset, index, url);
    if (cachedData) {
      meter.finish(index);
      return { data: cachedData, cached: true, stored: false };
    }
    const storing = cache?.writable === true;
    const data = await fromNetwork(asset, index, url, storing);
    meter.finish(index);
    const stored =
      storing && cache !== null
        ? await cache.put(
            url,
            new Response(data, {
              headers: {
                "content-type": "application/octet-stream",
                "content-length": String(data.length),
              },
            }),
          )
        : false;
    return { data, cached: false, stored };
  }

  let fetched: Fetched[];
  try {
    fetched = await Promise.all(assets.map(fetchOne));
  } catch (error) {
    controller.abort();
    throw error;
  }
  const result: DownloadedAssets = {
    files: new Map(),
    fromCache: [],
    stored: [],
  };
  fetched.forEach((item, index) => {
    const file = assets[index]!.file;
    result.files.set(file, item.data);
    if (item.cached) {
      result.fromCache.push(file);
    }
    if (item.stored) {
      result.stored.push(file);
    }
  });
  return result;
}

async function holds(
  cache: AssetCache,
  url: string,
  asset: EnsembleAsset,
): Promise<boolean> {
  const found = await cache.match(url);
  if (!found) {
    return false;
  }
  await found.body?.cancel().catch(() => {});
  const length = found.headers.get("content-length");
  return length === null || Number(length) === asset.bytes;
}

export async function prefetchAssets(
  assets: readonly EnsembleAsset[],
  baseUrl: string,
  deps: DownloadDeps,
): Promise<Map<string, AssetBytes> | null> {
  const cache = deps.cache;
  if (cache === null || !cache.writable) {
    return (await downloadAssets(assets, baseUrl, deps, null)).files;
  }
  const missing: EnsembleAsset[] = [];
  for (const asset of assets) {
    if (!(await holds(cache, new URL(asset.file, baseUrl).href, asset))) {
      missing.push(asset);
    }
  }
  if (missing.length === 0) {
    return null;
  }
  const fetched = await downloadAssets(missing, baseUrl, deps, null);
  const kept = new Set([...fetched.stored, ...fetched.fromCache]);
  if (missing.every((asset) => kept.has(asset.file))) {
    return null;
  }
  const rest = assets.filter((asset) => !missing.includes(asset));
  const others =
    rest.length === 0
      ? new Map<string, AssetBytes>()
      : (await downloadAssets(rest, baseUrl, deps, null)).files;
  return new Map([...others, ...fetched.files]);
}
