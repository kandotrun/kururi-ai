import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { publishedFile, serveModel, type ModelBucket } from "./models";

function bucket(objects: Record<string, string>): ModelBucket & { get: ReturnType<typeof vi.fn> } {
  const get = vi.fn(async (key: string) => {
    const text = objects[key];
    if (text === undefined) {
      return null;
    }
    const bytes = new TextEncoder().encode(text);
    return {
      body: new Blob([bytes]).stream(),
      size: bytes.byteLength,
      httpEtag: `"etag-${key}"`,
    };
  });
  const head = vi.fn(async (key: string) => {
    const text = objects[key];
    return text === undefined
      ? null
      : { size: new TextEncoder().encode(text).byteLength, httpEtag: `"etag-${key}"` };
  });
  return Object.assign({ get, head }, { get });
}

const files = {
  "v2.0.0/ensemble.json": "{\"release\":\"2.0.0\"}",
  "v2.0.0/convnext-small-288.onnx.data": "weights",
  "v2.0.0/convnext-base-224.onnx.data.part0": "first-",
  "v2.0.0/convnext-base-224.onnx.data.part1": "second",
  "v2.0.0/secret.txt": "nope",
  "v2.0.0/licenses/Apache-2.0.txt": "Apache License Version 2.0",
  "v2.0.0/LICENSE": "MIT License",
  "v2.0.0/THIRD_PARTY_NOTICES.md": "# Third-party notices",
  "v2.0.0/MODEL_CARD.md": "# Kururi AI orientation model v2.0.0",
  "v2.0.0/README.md": "# Release readme",
  "v2.0.0/upstream/convnext-base/README.md": "# convnext_base card",
  "v2.0.0/upstream/convnext-base/config.json": "{\"architecture\":\"convnext_base\"}",
  "v2.0.0/upstream/convnext-base/provenance.json": "{\"model_name\":\"convnext_base\"}",
  "v2.0.0/upstream/convnext-small/README.md": "# convnext_small card",
  "v2.0.0/upstream/convnext-small/config.json": "{\"architecture\":\"convnext_small\"}",
  "v2.0.0/upstream/convnext-small/provenance.json": "{\"model_name\":\"convnext_small\"}",
};

const MARKDOWN = "text/markdown; charset=utf-8";
const JSON_TYPE = "application/json; charset=utf-8";
const DOCUMENT_CACHE = "public, max-age=86400";

describe("serveModel", () => {
  it("streams an allowed model file with long-lived caching", async () => {
    const response = await serveModel(
      new Request("https://kururi-ai.2-38.com/models/v2.0.0/convnext-small-288.onnx.data"),
      bucket(files),
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("weights");
    expect(response.headers.get("content-type")).toBe("application/octet-stream");
    expect(response.headers.get("content-length")).toBe("7");
    expect(response.headers.get("etag")).toBe("\"etag-v2.0.0/convnext-small-288.onnx.data\"");
    expect(response.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
  });

  it("joins a file that was uploaded in parts", async () => {
    const response = await serveModel(
      new Request("https://kururi-ai.2-38.com/models/v2.0.0/convnext-base-224.onnx.data"),
      bucket(files),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-length")).toBe("12");
    expect(response.headers.get("etag")).toBe(
      "\"etag-v2.0.0/convnext-base-224.onnx.data.part0+etag-v2.0.0/convnext-base-224.onnx.data.part1\"",
    );
    expect(await response.text()).toBe("first-second");
  });

  it("sums the parts for HEAD and fails when a part is missing", async () => {
    const head = await serveModel(
      new Request("https://kururi-ai.2-38.com/models/v2.0.0/convnext-base-224.onnx.data", { method: "HEAD" }),
      bucket(files),
    );
    expect(head.headers.get("content-length")).toBe("12");
    const partial = { ...files };
    delete (partial as Record<string, string>)["v2.0.0/convnext-base-224.onnx.data.part1"];
    const missing = await serveModel(
      new Request("https://kururi-ai.2-38.com/models/v2.0.0/convnext-base-224.onnx.data"),
      bucket(partial),
    );
    expect(missing.status).toBe(404);
  });

  it("serves the ensemble description as JSON", async () => {
    const response = await serveModel(
      new Request("https://kururi-ai.2-38.com/models/v2.0.0/ensemble.json"),
      bucket(files),
    );
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(await response.json()).toEqual({ release: "2.0.0" });
  });

  it("answers HEAD without a body", async () => {
    const store = bucket(files);
    const response = await serveModel(
      new Request("https://kururi-ai.2-38.com/models/v2.0.0/ensemble.json", { method: "HEAD" }),
      store,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-length")).toBe("19");
    expect(response.body).toBeNull();
    expect(store.get).not.toHaveBeenCalled();
  });

  it("returns 304 when the cached copy is current", async () => {
    const response = await serveModel(
      new Request("https://kururi-ai.2-38.com/models/v2.0.0/ensemble.json", {
        headers: { "if-none-match": "\"etag-v2.0.0/ensemble.json\"" },
      }),
      bucket(files),
    );
    expect(response.status).toBe(304);
    expect(response.body).toBeNull();
  });

  it("refuses keys outside the published ensemble", async () => {
    const store = bucket(files);
    for (const path of [
      "/models/v2.0.0/secret.txt",
      "/models/v2.0.0/",
      "/models/../v2.0.0/ensemble.json",
      "/models/v2.0.0/convnext-base-224.onnx.data/extra",
      "/models/v1/ensemble.json",
    ]) {
      const response = await serveModel(new Request(`https://kururi-ai.2-38.com${path}`), store);
      expect(response.status, path).toBe(404);
    }
    expect(store.get).not.toHaveBeenCalled();
  });

  it("reports a missing upload as 404", async () => {
    const response = await serveModel(
      new Request("https://kururi-ai.2-38.com/models/v2.0.0/convnext-small-288.onnx"),
      bucket(files),
    );
    expect(response.status).toBe(404);
  });

  it("serves the Apache-2.0 text of the derived weights as LICENSE", async () => {
    for (const path of ["/models/v2.0.0/LICENSE", "/models/v2.0.0/licenses/Apache-2.0.txt"]) {
      const response = await serveModel(
        new Request(`https://kururi-ai.2-38.com${path}`),
        bucket(files),
      );
      expect(response.status, path).toBe(200);
      expect(response.headers.get("content-type"), path).toBe("text/plain; charset=utf-8");
      expect(response.headers.get("cache-control"), path).toBe(DOCUMENT_CACHE);
      expect(await response.text(), path).toBe("Apache License Version 2.0");
    }
  });

  it("serves the notices, model card and upstream model cards next to the weights", async () => {
    const expected: readonly [string, string][] = [
      ["THIRD_PARTY_NOTICES.md", MARKDOWN],
      ["MODEL_CARD.md", MARKDOWN],
      ["upstream/convnext-base/README.md", MARKDOWN],
      ["upstream/convnext-base/config.json", JSON_TYPE],
      ["upstream/convnext-base/provenance.json", JSON_TYPE],
      ["upstream/convnext-small/README.md", MARKDOWN],
      ["upstream/convnext-small/config.json", JSON_TYPE],
      ["upstream/convnext-small/provenance.json", JSON_TYPE],
    ];
    for (const [name, type] of expected) {
      const response = await serveModel(
        new Request(`https://kururi-ai.2-38.com/models/v2.0.0/${name}`),
        bucket(files),
      );
      expect(response.status, name).toBe(200);
      expect(response.headers.get("content-type"), name).toBe(type);
      expect(response.headers.get("cache-control"), name).toBe(DOCUMENT_CACHE);
      expect(await response.text(), name).toBe(files[`v2.0.0/${name}` as keyof typeof files]);
    }
  });

  it("answers HEAD for a document without reading it", async () => {
    const store = bucket(files);
    const response = await serveModel(
      new Request("https://kururi-ai.2-38.com/models/v2.0.0/LICENSE", { method: "HEAD" }),
      store,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-length")).toBe("26");
    expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(response.body).toBeNull();
    expect(store.get).not.toHaveBeenCalled();
  });

  it("tells browsers not to sniff any served file", async () => {
    for (const path of [
      "/models/v2.0.0/ensemble.json",
      "/models/v2.0.0/convnext-small-288.onnx.data",
      "/models/v2.0.0/convnext-base-224.onnx.data",
      "/models/v2.0.0/MODEL_CARD.md",
    ]) {
      const response = await serveModel(new Request(`https://kururi-ai.2-38.com${path}`), bucket(files));
      expect(response.headers.get("x-content-type-options"), path).toBe("nosniff");
      await response.body?.cancel();
    }
  });

  it("keeps unlisted release files private", async () => {
    const store = bucket(files);
    for (const path of [
      "/models/v2.0.0/README.md",
      "/models/v2.0.0/upstream/convnext-base/",
      "/models/v2.0.0/upstream/convnext-tiny/README.md",
      "/models/v2.0.0/licenses/",
      "/models/v2.0.0/license",
    ]) {
      const response = await serveModel(new Request(`https://kururi-ai.2-38.com${path}`), store);
      expect(response.status, path).toBe(404);
    }
    expect(store.get).not.toHaveBeenCalled();
  });

  it("only allows reading methods", async () => {
    const response = await serveModel(
      new Request("https://kururi-ai.2-38.com/models/v2.0.0/ensemble.json", { method: "PUT", body: "x" }),
      bucket(files),
    );
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET, HEAD");
  });
});

describe("publishedFile", () => {
  interface EnsembleFile {
    file: string;
  }
  interface EnsembleModel {
    graph: EnsembleFile;
    external_data: EnsembleFile;
  }
  const ensemble = JSON.parse(
    readFileSync(
      new URL("../full/__fixtures__/ensemble-2.0.0.json", import.meta.url),
      "utf8",
    ),
  ) as { general_models: EnsembleModel[]; fallback: EnsembleModel };

  it("publishes every file the release ensemble names, from the same file in the release", () => {
    const models = [...ensemble.general_models, ensemble.fallback];
    const names = models.flatMap((model) => [model.graph.file, model.external_data.file]);
    expect(names).toHaveLength(6);
    for (const name of ["ensemble.json", ...names]) {
      expect(publishedFile(name)?.source, name).toBe(name);
    }
  });

  it("maps LICENSE to the release's Apache-2.0 text", () => {
    expect(publishedFile("LICENSE")).toMatchObject({
      source: "licenses/Apache-2.0.txt",
      parts: ["v2.0.0/licenses/Apache-2.0.txt"],
      contentType: "text/plain; charset=utf-8",
    });
  });

  it("knows nothing outside the published list", () => {
    for (const name of ["", "README.md", "BENCHMARK_REPORT.md", "../LICENSE", "upstream/", "v2.0.0/LICENSE"]) {
      expect(publishedFile(name), name).toBeUndefined();
    }
  });
});
