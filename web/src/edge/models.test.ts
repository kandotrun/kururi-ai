import { describe, expect, it, vi } from "vitest";
import { serveModel, type ModelBucket } from "./models";

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
};

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

  it("only allows reading methods", async () => {
    const response = await serveModel(
      new Request("https://kururi-ai.2-38.com/models/v2.0.0/ensemble.json", { method: "PUT", body: "x" }),
      bucket(files),
    );
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET, HEAD");
  });
});
