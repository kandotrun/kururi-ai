import { describe, expect, it } from "vitest";
import {
  cacheName,
  hasRoomFor,
  openAssetCache,
  staleCacheNames,
  type CacheStorageLike,
} from "./cache";

class FakeCache {
  readonly entries = new Map<string, Response>();

  async match(url: string): Promise<Response | undefined> {
    return this.entries.get(url)?.clone();
  }

  async put(url: string, response: Response): Promise<void> {
    this.entries.set(url, response);
  }

  async delete(url: string): Promise<boolean> {
    return this.entries.delete(url);
  }
}

class FakeStorage implements CacheStorageLike {
  readonly caches = new Map<string, FakeCache>();
  readonly deleted: string[] = [];

  constructor(names: string[]) {
    for (const name of names) {
      this.caches.set(name, new FakeCache());
    }
  }

  async keys(): Promise<string[]> {
    return [...this.caches.keys()];
  }

  async open(name: string): Promise<FakeCache> {
    const existing = this.caches.get(name);
    if (existing) {
      return existing;
    }
    const created = new FakeCache();
    this.caches.set(name, created);
    return created;
  }

  async delete(name: string): Promise<boolean> {
    this.deleted.push(name);
    return this.caches.delete(name);
  }
}

describe("cacheName", () => {
  it("is versioned by the release", () => {
    expect(cacheName("2.0.0")).toBe("kururi-ai-full-2.0.0");
  });
});

describe("staleCacheNames", () => {
  it("selects older full-model caches only", () => {
    expect(
      staleCacheNames(
        ["kururi-ai-full-1.9.0", "kururi-ai-full-2.0.0", "other-app", "kururi-ai-nano"],
        "kururi-ai-full-2.0.0",
      ),
    ).toEqual(["kururi-ai-full-1.9.0"]);
  });
});

describe("hasRoomFor", () => {
  it("allows writing when the estimate is unknown", () => {
    expect(hasRoomFor(null, 500)).toBe(true);
    expect(hasRoomFor({}, 500)).toBe(true);
  });

  it("compares the free quota with the bytes to store", () => {
    expect(hasRoomFor({ quota: 1000, usage: 400 }, 500)).toBe(true);
    expect(hasRoomFor({ quota: 1000, usage: 600 }, 500)).toBe(false);
    expect(hasRoomFor({ quota: 1000 }, 1200)).toBe(false);
  });
});

describe("openAssetCache", () => {
  it("returns null without Cache Storage", async () => {
    expect(await openAssetCache(null, "2.0.0", 10, null)).toBeNull();
  });

  it("removes older releases and opens the current one", async () => {
    const storage = new FakeStorage(["kururi-ai-full-1.0.0", "unrelated"]);
    const cache = await openAssetCache(storage, "2.0.0", 10, null);
    expect(cache).not.toBeNull();
    expect(storage.deleted).toEqual(["kururi-ai-full-1.0.0"]);
    expect([...storage.caches.keys()].sort()).toEqual([
      "kururi-ai-full-2.0.0",
      "unrelated",
    ]);
    expect(cache?.writable).toBe(true);
  });

  it("stays readable but stops writing when the quota is too small", async () => {
    const storage = new FakeStorage([]);
    const cache = await openAssetCache(storage, "2.0.0", 5000, {
      quota: 1000,
      usage: 0,
    });
    expect(cache?.writable).toBe(false);
    await cache?.put("https://models.example/a.onnx", new Response("abc"));
    expect(storage.caches.get("kururi-ai-full-2.0.0")?.entries.size).toBe(0);
  });

  it("turns writing off after the first failed put", async () => {
    const storage = new FakeStorage([]);
    const cache = await openAssetCache(storage, "2.0.0", 10, null);
    const inner = storage.caches.get("kururi-ai-full-2.0.0")!;
    let attempts = 0;
    inner.put = async () => {
      attempts += 1;
      throw new DOMException("full", "QuotaExceededError");
    };
    expect(await cache?.put("https://models.example/a.onnx", new Response("a"))).toBe(false);
    expect(cache?.writable).toBe(false);
    expect(await cache?.put("https://models.example/b.onnx", new Response("b"))).toBe(false);
    expect(attempts).toBe(1);
  });

  it("treats lookup failures as misses", async () => {
    const storage = new FakeStorage([]);
    const cache = await openAssetCache(storage, "2.0.0", 10, null);
    const inner = storage.caches.get("kururi-ai-full-2.0.0")!;
    inner.match = async () => {
      throw new Error("broken");
    };
    expect(await cache?.match("https://models.example/a.onnx")).toBeUndefined();
  });

  it("returns null when the cache cannot be opened", async () => {
    const storage = new FakeStorage([]);
    storage.open = async () => {
      throw new DOMException("denied", "SecurityError");
    };
    expect(await openAssetCache(storage, "2.0.0", 10, null)).toBeNull();
  });
});
