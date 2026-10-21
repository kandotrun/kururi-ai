import { describe, expect, it } from "vitest";
import { FULL_FALLBACK_BYTES, FULL_GENERAL_BYTES } from "../core/model-profiles";
import published from "./__fixtures__/ensemble-2.0.0.json";
import {
  decodeEnsembleManifest,
  generalAssets,
  modelAssets,
} from "./ensemble-manifest";

function asset(file: string, bytes: number, digit: string) {
  return { file, bytes, sha256: digit.repeat(64) };
}

function model(name: string, role: string, size: number, weight: number) {
  return {
    name,
    role,
    backbone: "convnext",
    input_size: size,
    batch_size: 4,
    views: 4,
    weight,
    fallback_rule:
      role === "fallback"
        ? "Use only when normalized top1-top2 margin is below 0.033333333."
        : null,
    graph: asset(`${name}.onnx`, 1390721, "a"),
    external_data: asset(`${name}.onnx.data`, 350355456, "b"),
  };
}

function release() {
  return {
    schema_version: 1,
    release: "2.0.0",
    class_order_correction_cw: [0, 90, 180, 270],
    preprocess: "v2-whole224-bilinear-imagenet",
    general_models: [
      model("convnext-base-224", "general", 224, 0.5),
      model("convnext-small-288", "general", 288, 0.4),
    ],
    fallback: model("convnext-small-224", "fallback", 224, 0.1),
    selection: { frozen_test_accuracy: 0.9943181818181818 },
  };
}

type Mutable = Record<string, unknown>;

function mutate(edit: (json: Mutable) => void): unknown {
  const json: Mutable = release();
  edit(json);
  return json;
}

function generalAt(json: Mutable, index: number): Mutable {
  return (json.general_models as Mutable[])[index]!;
}

describe("decodeEnsembleManifest", () => {
  it("reads the release policy", () => {
    const manifest = decodeEnsembleManifest(release());
    expect(manifest.release).toBe("2.0.0");
    expect(manifest.general.map((item) => item.name)).toEqual([
      "convnext-base-224",
      "convnext-small-288",
    ]);
    expect(manifest.general.map((item) => item.inputSize)).toEqual([224, 288]);
    expect(manifest.general.map((item) => item.weight)).toEqual([0.5, 0.4]);
    expect(manifest.fallback?.name).toBe("convnext-small-224");
    expect(manifest.fallback?.weight).toBe(0.1);
    expect(manifest.fallbackMargin).toBe(0.033333333);
    expect(manifest.general[0]?.graph).toEqual(
      asset("convnext-base-224.onnx", 1390721, "a"),
    );
    expect(manifest.general[0]?.externalData?.file).toBe(
      "convnext-base-224.onnx.data",
    );
  });

  it("accepts a release without a fallback model", () => {
    const manifest = decodeEnsembleManifest(
      mutate((json) => {
        json.fallback = null;
      }),
    );
    expect(manifest.fallback).toBeNull();
    expect(manifest.fallbackMargin).toBe(0);
  });

  it("accepts models without external data", () => {
    const manifest = decodeEnsembleManifest(
      mutate((json) => {
        generalAt(json, 0).external_data = null;
      }),
    );
    expect(manifest.general[0]?.externalData).toBeNull();
  });

  it.each([
    ["not an object", () => "ensemble"],
    [
      "an unknown schema",
      () =>
        mutate((json) => {
          json.schema_version = 2;
        }),
    ],
    [
      "a release name unsafe for a cache key",
      () =>
        mutate((json) => {
          json.release = "../2.0.0";
        }),
    ],
    [
      "a different class order",
      () =>
        mutate((json) => {
          json.class_order_correction_cw = [0, 270, 180, 90];
        }),
    ],
    [
      "a different preprocess",
      () =>
        mutate((json) => {
          json.preprocess = "v2-whole224-bicubic";
        }),
    ],
    [
      "no general models",
      () =>
        mutate((json) => {
          json.general_models = [];
        }),
    ],
    [
      "a fallback listed as general",
      () =>
        mutate((json) => {
          generalAt(json, 1).role = "fallback";
        }),
    ],
    [
      "a batch other than four views",
      () =>
        mutate((json) => {
          generalAt(json, 0).batch_size = 1;
        }),
    ],
    [
      "a non-integer input size",
      () =>
        mutate((json) => {
          generalAt(json, 0).input_size = 224.5;
        }),
    ],
    [
      "a negative weight",
      () =>
        mutate((json) => {
          generalAt(json, 0).weight = -0.5;
        }),
    ],
    [
      "a file name with a path",
      () =>
        mutate((json) => {
          generalAt(json, 0).graph = asset("../model.onnx", 10, "a");
        }),
    ],
    [
      "an uppercase digest",
      () =>
        mutate((json) => {
          generalAt(json, 0).graph = asset("model.onnx", 10, "A");
        }),
    ],
    [
      "a zero byte count",
      () =>
        mutate((json) => {
          generalAt(json, 0).graph = asset("model.onnx", 0, "a");
        }),
    ],
    [
      "duplicate file names",
      () =>
        mutate((json) => {
          generalAt(json, 1).graph = asset("convnext-base-224.onnx", 10, "c");
        }),
    ],
    [
      "a fallback rule without a margin",
      () =>
        mutate((json) => {
          (json.fallback as Mutable).fallback_rule = "Use when unsure.";
        }),
    ],
    [
      "a margin outside 0..1",
      () =>
        mutate((json) => {
          (json.fallback as Mutable).fallback_rule =
            "Use only when normalized top1-top2 margin is below 1.5.";
        }),
    ],
  ])("rejects %s", (_label, build) => {
    expect(() => decodeEnsembleManifest(build())).toThrow(
      /Invalid ensemble manifest/,
    );
  });
});

describe("the published v2.0.0 ensemble.json", () => {
  it("decodes and matches the advertised download sizes", () => {
    const manifest = decodeEnsembleManifest(published);
    expect(manifest.release).toBe("2.0.0");
    expect(manifest.fallbackMargin).toBe(0.033333333);
    const total = (items: readonly { bytes: number }[]) =>
      items.reduce((sum, item) => sum + item.bytes, 0);
    expect(total(generalAssets(manifest))).toBe(FULL_GENERAL_BYTES);
    expect(total(modelAssets(manifest.fallback!))).toBe(FULL_FALLBACK_BYTES);
  });
});

describe("asset lists", () => {
  it("lists graph then external data for each model", () => {
    const manifest = decodeEnsembleManifest(release());
    expect(modelAssets(manifest.general[1]!).map((item) => item.file)).toEqual([
      "convnext-small-288.onnx",
      "convnext-small-288.onnx.data",
    ]);
    expect(generalAssets(manifest).map((item) => item.file)).toEqual([
      "convnext-base-224.onnx",
      "convnext-base-224.onnx.data",
      "convnext-small-288.onnx",
      "convnext-small-288.onnx.data",
    ]);
  });
});
