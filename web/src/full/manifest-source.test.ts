import { describe, expect, it } from "vitest";
import published from "./__fixtures__/ensemble-2.0.0.json";
import { folderUrl, loadEnsembleManifest } from "./manifest-source";

const URL_ = "https://models.example/v2/ensemble.json";
const TEXT = JSON.stringify(published);

describe("loadEnsembleManifest", () => {
  it("prefers a revalidated network copy", async () => {
    const inits: RequestInit[] = [];
    const loaded = await loadEnsembleManifest(URL_, {
      fetcher: async (_url, init) => {
        inits.push(init);
        return new Response(TEXT);
      },
      lookup: async () => {
        throw new Error("should not be used");
      },
    });
    expect(loaded.manifest.release).toBe("2.0.0");
    expect(loaded.fromCache).toBe(false);
    expect(loaded.text).toBe(TEXT);
    expect(inits[0]?.cache).toBe("no-cache");
  });

  it("falls back to the stored copy when offline", async () => {
    const loaded = await loadEnsembleManifest(URL_, {
      fetcher: async () => {
        throw new TypeError("Failed to fetch");
      },
      lookup: async (url) => (url === URL_ ? new Response(TEXT) : undefined),
    });
    expect(loaded.fromCache).toBe(true);
    expect(loaded.manifest.general.length).toBe(2);
  });

  it("explains a missing manifest in Japanese", async () => {
    await expect(
      loadEnsembleManifest(URL_, {
        fetcher: async () => new Response("missing", { status: 404 }),
        lookup: async () => undefined,
      }),
    ).rejects.toThrow("高精度モデルを取得できませんでした（HTTP 404）");
    await expect(
      loadEnsembleManifest(URL_, {
        fetcher: async () => {
          throw new TypeError("Failed to fetch");
        },
        lookup: async () => undefined,
      }),
    ).rejects.toThrow(
      "高精度モデルを取得できませんでした（ネットワークに接続できません）",
    );
  });

  it("rejects a manifest it cannot decode", async () => {
    for (const body of ["{", JSON.stringify({ schema_version: 9 })]) {
      await expect(
        loadEnsembleManifest(URL_, {
          fetcher: async () => new Response(body),
          lookup: async () => undefined,
        }),
      ).rejects.toThrow("高精度モデルの設定ファイルを読み取れませんでした");
    }
  });
});

describe("folderUrl", () => {
  it("resolves a folder against the worker location and keeps one trailing slash", () => {
    const worker = "http://127.0.0.1:5173/src/worker-full.ts?worker_file&type=module";
    expect(folderUrl("/full-local/", worker)).toBe("http://127.0.0.1:5173/full-local/");
    expect(folderUrl("/full-local", worker)).toBe("http://127.0.0.1:5173/full-local/");
    expect(folderUrl("https://models.example/v2", worker)).toBe(
      "https://models.example/v2/",
    );
    expect(folderUrl("https://models.example/v2/?x=1", worker)).toBe(
      "https://models.example/v2/",
    );
  });
});
