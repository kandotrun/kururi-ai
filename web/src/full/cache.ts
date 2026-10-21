export interface CacheLike {
  match(url: string): Promise<Response | undefined>;
  put(url: string, response: Response): Promise<void>;
  delete(url: string): Promise<boolean>;
}

export interface CacheStorageLike {
  keys(): Promise<string[]>;
  open(name: string): Promise<CacheLike>;
  delete(name: string): Promise<boolean>;
}

export interface StorageEstimateLike {
  quota?: number;
  usage?: number;
}

export interface AssetCache {
  readonly writable: boolean;
  match(url: string): Promise<Response | undefined>;
  put(url: string, response: Response): Promise<boolean>;
  delete(url: string): Promise<void>;
}

const PREFIX = "kururi-ai-full-";

export function cacheName(release: string): string {
  return `${PREFIX}${release}`;
}

export function staleCacheNames(
  names: readonly string[],
  current: string,
): string[] {
  return names.filter((name) => name.startsWith(PREFIX) && name !== current);
}

export function hasRoomFor(
  estimate: StorageEstimateLike | null,
  bytes: number,
): boolean {
  if (estimate === null || typeof estimate.quota !== "number") {
    return true;
  }
  return estimate.quota - (estimate.usage ?? 0) >= bytes;
}

async function removeStale(
  storage: CacheStorageLike,
  current: string,
): Promise<void> {
  try {
    const names = await storage.keys();
    await Promise.all(
      staleCacheNames(names, current).map((name) => storage.delete(name)),
    );
  } catch {
    return;
  }
}

export async function openAssetCache(
  storage: CacheStorageLike | null,
  release: string,
  bytesToStore: number,
  estimate: StorageEstimateLike | null,
): Promise<AssetCache | null> {
  if (storage === null) {
    return null;
  }
  const name = cacheName(release);
  await removeStale(storage, name);
  let cache: CacheLike;
  try {
    cache = await storage.open(name);
  } catch {
    return null;
  }
  let writable = hasRoomFor(estimate, bytesToStore);
  return {
    get writable() {
      return writable;
    },
    async match(url) {
      try {
        return await cache.match(url);
      } catch {
        return undefined;
      }
    },
    async put(url, response) {
      if (!writable) {
        return false;
      }
      try {
        await cache.put(url, response);
        return true;
      } catch {
        writable = false;
        return false;
      }
    },
    async delete(url) {
      try {
        await cache.delete(url);
      } catch {
        return;
      }
    },
  };
}
