import { describe, expect, it } from "vitest";
import type { CommonsManifest, PhotoSource } from "../contracts";
import { decodeManifest } from "./manifest";
import { mulberry32 } from "./random";
import {
  SAMPLE_PHOTOS,
  buildSourceQueue,
  sampleSource,
  userSource,
} from "./sources";

const BASE = new URL("https://kandotrun.github.io/kururi-ai/");
const SAMPLE_POSITIONS = [2, 6, 11, 17, 24];

function manifestOf(counts: Readonly<Record<string, number>>): CommonsManifest {
  const topics = Object.keys(counts);
  const items: unknown[] = [];
  topics.forEach((topic, topicIndex) => {
    for (let index = 0; index < (counts[topic] ?? 0); index += 1) {
      items.push([`${topic}_${index}.jpg`, "ab", 1600, 1200, 0, 0, topicIndex]);
    }
  });
  return decodeManifest({
    version: 1,
    generatedAt: "2026-10-21T00:00:00.000Z",
    thumbBase: "https://upload.wikimedia.org/wikipedia/commons/thumb/",
    pageBase: "https://commons.wikimedia.org/wiki/File:",
    licenses: [["CC0", null]],
    topics,
    authors: ["Someone"],
    items,
  });
}

function topicOf(source: PhotoSource): string {
  return source.title.replace(/ \d+$/, "");
}

function commonsOnly(queue: readonly PhotoSource[]): PhotoSource[] {
  return queue.filter((source) => source.kind === "commons");
}

describe("SAMPLE_PHOTOS", () => {
  it("lists the owner's crooked photos with their known fixes", () => {
    expect(SAMPLE_PHOTOS).toEqual([
      { file: "sample1.webp", uprightFix: 3 },
      { file: "sample2.webp", uprightFix: 3 },
      { file: "sample3.webp", uprightFix: 1 },
      { file: "sample4.webp", uprightFix: 3 },
      { file: "sample5.jpg", uprightFix: 2 },
    ]);
  });
});

describe("sampleSource", () => {
  it("resolves the bundled sample against the page base", () => {
    const sample = SAMPLE_PHOTOS[2]!;
    expect(sampleSource(BASE, sample, "sample-3")).toEqual({
      id: "sample-3",
      kind: "sample",
      title: "サンプル写真 3",
      aspect: null,
      thumbUrl: "https://kandotrun.github.io/kururi-ai/samples/sample3.webp",
      largeUrl: "https://kandotrun.github.io/kururi-ai/samples/sample3.webp",
      file: null,
      attribution: {
        author: "くるりAI サンプル",
        license: "MIT",
        licenseUrl: "https://github.com/kandotrun/kururi-ai/blob/main/LICENSE",
        pageUrl: "https://github.com/kandotrun/kururi-ai/tree/main/samples",
      },
      uprightFix: 1,
    });
  });

  it("works with a dev server root", () => {
    const source = sampleSource(
      new URL("http://127.0.0.1:5173/"),
      SAMPLE_PHOTOS[4]!,
      "sample-5",
    );
    expect(source.thumbUrl).toBe("http://127.0.0.1:5173/samples/sample5.jpg");
    expect(source.title).toBe("サンプル写真 5");
    expect(source.uprightFix).toBe(2);
  });
});

describe("userSource", () => {
  it("keeps the visitor's file local with unknown orientation", () => {
    const file = new File([new Uint8Array([1, 2, 3])], "IMG_0042.JPG", {
      type: "image/jpeg",
    });
    expect(userSource(file, "user-1")).toEqual({
      id: "user-1",
      kind: "user",
      title: "IMG_0042.JPG",
      aspect: null,
      thumbUrl: null,
      largeUrl: null,
      file,
      attribution: null,
      uprightFix: null,
    });
  });
});

describe("buildSourceQueue", () => {
  const balanced = manifestOf({ birds: 10, plants: 10, cities: 10, food: 10 });

  it("places the five samples at their early positions", () => {
    const queue = buildSourceQueue(balanced, BASE, mulberry32(1), 1000);
    expect(queue).toHaveLength(45);
    const samplePositions = queue
      .map((source, index) => (source.kind === "sample" ? index : -1))
      .filter((index) => index >= 0);
    expect(samplePositions).toEqual(SAMPLE_POSITIONS);
    expect(queue.filter((source) => source.kind === "sample").map((source) => source.id)).toEqual([
      "sample-1",
      "sample-2",
      "sample-3",
      "sample-4",
      "sample-5",
    ]);
  });

  it("uses every Commons entry once with ids that point back to it", () => {
    const queue = buildSourceQueue(balanced, BASE, mulberry32(2), 1000);
    const commons = commonsOnly(queue);
    expect(commons).toHaveLength(40);
    const ids = queue.map((source) => source.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const source of commons) {
      const match = /^commons-(\d+)$/.exec(source.id);
      expect(match).not.toBeNull();
      const entry = balanced.items[Number(match?.[1])];
      expect(entry?.file.replace(/_/g, " ").replace(/\.jpg$/, "")).toBe(
        source.title,
      );
      expect(source.uprightFix).toBe(0);
    }
  });

  it("rotates through topics so neighbours differ", () => {
    for (let seed = 1; seed <= 25; seed += 1) {
      const commons = commonsOnly(
        buildSourceQueue(balanced, BASE, mulberry32(seed), 1000),
      );
      expect(new Set(commons.slice(0, 4).map(topicOf)).size).toBe(4);
      for (let index = 1; index < commons.length; index += 1) {
        expect(topicOf(commons[index]!)).not.toBe(
          topicOf(commons[index - 1]!),
        );
      }
    }
  });

  it("does not repeat the same topic cycle round after round", () => {
    const commons = commonsOnly(
      buildSourceQueue(balanced, BASE, mulberry32(10), 1000),
    );
    const rounds = new Set<string>();
    for (let start = 0; start < commons.length; start += 4) {
      rounds.add(commons.slice(start, start + 4).map(topicOf).join(","));
    }
    expect(rounds.size).toBeGreaterThan(3);
  });

  it("spreads a small topic over the whole run", () => {
    const uneven = manifestOf({ birds: 30, fungi: 5 });
    for (let seed = 1; seed <= 25; seed += 1) {
      const commons = commonsOnly(
        buildSourceQueue(uneven, BASE, mulberry32(seed), 1000),
      );
      const fungi = commons
        .map((source, index) => (topicOf(source) === "fungi" ? index : -1))
        .filter((index) => index >= 0);
      expect(fungi).toHaveLength(5);
      expect(fungi[0]).toBeLessThan(8);
      expect(fungi[4]).toBeGreaterThan(24);
      for (let index = 1; index < fungi.length; index += 1) {
        expect(fungi[index]! - fungi[index - 1]!).toBeGreaterThan(1);
      }
    }
  });

  it("is reproducible for a seed and varies between seeds", () => {
    const titles = (seed: number) =>
      buildSourceQueue(balanced, BASE, mulberry32(seed), 1000).map(
        (source) => source.title,
      );
    expect(titles(5)).toEqual(titles(5));
    expect(titles(5)).not.toEqual(titles(6));
  });

  it("appends the samples when the Commons list is short", () => {
    const tiny = manifestOf({ birds: 3 });
    const kinds = buildSourceQueue(tiny, BASE, mulberry32(7), 1000).map(
      (source) => source.kind,
    );
    expect(kinds).toEqual([
      "commons",
      "commons",
      "sample",
      "commons",
      "sample",
      "sample",
      "sample",
      "sample",
    ]);
  });

  it("still offers the samples without a Commons manifest entry", () => {
    const empty = manifestOf({});
    const queue = buildSourceQueue(empty, BASE, mulberry32(8), 1000);
    expect(queue.map((source) => source.id)).toEqual([
      "sample-1",
      "sample-2",
      "sample-3",
      "sample-4",
      "sample-5",
    ]);
  });

  it("caps the queue at the limit", () => {
    expect(buildSourceQueue(balanced, BASE, mulberry32(9), 12)).toHaveLength(12);
    expect(buildSourceQueue(balanced, BASE, mulberry32(9), 0)).toEqual([]);
    const capped = buildSourceQueue(balanced, BASE, mulberry32(9), 7);
    expect(capped.map((source) => source.kind)).toEqual([
      "commons",
      "commons",
      "sample",
      "commons",
      "commons",
      "commons",
      "sample",
    ]);
  });
});
