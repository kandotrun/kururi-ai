import type { CommonsManifest, PhotoSource, Quarter } from "../contracts";
import { commonsSource } from "./manifest";
import { shuffle, type Random } from "./random";

export interface SamplePhoto {
  file: string;
  uprightFix: Quarter;
}

interface QueuedEntry {
  index: number;
  topic: string;
}

export const SAMPLE_PHOTOS: readonly SamplePhoto[] = [
  { file: "sample1.webp", uprightFix: 3 },
  { file: "sample2.webp", uprightFix: 3 },
  { file: "sample3.webp", uprightFix: 1 },
  { file: "sample4.webp", uprightFix: 3 },
  { file: "sample5.jpg", uprightFix: 2 },
];

export const SAMPLE_POSITIONS: readonly number[] = [2, 6, 11, 17, 24];

const SAMPLE_ATTRIBUTION = {
  author: "くるりAI サンプル",
  license: "MIT",
  licenseUrl: "https://github.com/kandotrun/kururi-ai/blob/main/LICENSE",
  pageUrl: "https://github.com/kandotrun/kururi-ai/tree/main/samples",
} as const;

const NEIGHBOUR_WINDOW = 2;

export function sampleSource(
  baseUrl: URL,
  sample: SamplePhoto,
  id: string,
): PhotoSource {
  const url = new URL(`samples/${sample.file}`, baseUrl).href;
  const number = /\d+/.exec(sample.file)?.[0];
  return {
    id,
    kind: "sample",
    title: number === undefined ? "サンプル写真" : `サンプル写真 ${number}`,
    aspect: null,
    thumbUrl: url,
    largeUrl: url,
    file: null,
    attribution: { ...SAMPLE_ATTRIBUTION },
    uprightFix: sample.uprightFix,
  };
}

export function userSource(file: File, id: string): PhotoSource {
  return {
    id,
    kind: "user",
    title: file.name,
    aspect: null,
    thumbUrl: null,
    largeUrl: null,
    file,
    attribution: null,
    uprightFix: null,
  };
}

function spreadTopics(
  entries: readonly QueuedEntry[],
  random: Random,
): QueuedEntry[] {
  const groups = new Map<string, QueuedEntry[]>();
  for (const entry of entries) {
    const group = groups.get(entry.topic);
    if (group) {
      group.push(entry);
    } else {
      groups.set(entry.topic, [entry]);
    }
  }
  const keyed: { entry: QueuedEntry; key: number }[] = [];
  for (const group of groups.values()) {
    group.forEach((entry, rank) => {
      const jitter = 0.1 + 0.8 * random();
      keyed.push({ entry, key: (rank + jitter) / group.length });
    });
  }
  keyed.sort((left, right) => left.key - right.key);
  return keyed.map(({ entry }) => entry);
}

function separateNeighbours(entries: readonly QueuedEntry[]): QueuedEntry[] {
  const result = [...entries];
  for (let index = 1; index < result.length; index += 1) {
    const previous = result[index - 1]!.topic;
    if (result[index]!.topic !== previous) {
      continue;
    }
    const limit = Math.min(result.length, index + 1 + NEIGHBOUR_WINDOW);
    for (let candidate = index + 1; candidate < limit; candidate += 1) {
      if (result[candidate]!.topic !== previous) {
        const [moved] = result.splice(candidate, 1);
        result.splice(index, 0, moved!);
        break;
      }
    }
  }
  return result;
}

function withSamples(
  commons: readonly PhotoSource[],
  samples: readonly PhotoSource[],
): PhotoSource[] {
  const queue: PhotoSource[] = [];
  let next = 0;
  for (const source of commons) {
    while (next < samples.length && queue.length === SAMPLE_POSITIONS[next]) {
      queue.push(samples[next]!);
      next += 1;
    }
    queue.push(source);
  }
  return [...queue, ...samples.slice(next)];
}

export function buildSourceQueue(
  manifest: CommonsManifest,
  baseUrl: URL,
  random: Random,
  limit: number,
): PhotoSource[] {
  const shuffled = shuffle(
    manifest.items.map((entry, index) => ({ index, topic: entry.topic })),
    random,
  );
  const commons = separateNeighbours(spreadTopics(shuffled, random)).map(
    ({ index }) =>
      commonsSource(manifest, manifest.items[index]!, `commons-${index}`),
  );
  const samples = SAMPLE_PHOTOS.map((sample, index) =>
    sampleSource(baseUrl, sample, `sample-${index + 1}`),
  );
  return withSamples(commons, samples).slice(0, Math.max(0, limit));
}
