import type { Probabilities, Quarter } from "../contracts";
import { resizeRgb8, type Rgb8Image } from "./pillow-resize";
import { normalizeQuarter } from "./rotation";

export interface WeightedProbabilities {
  weight: number;
  probabilities: readonly number[];
}

export interface EnsembleDecision {
  correction: Quarter;
  confidence: number;
  probabilities: Probabilities;
  generalMargin: number;
  fallbackUsed: boolean;
}

const CLASSES = 4;
const VIEWS = 4;
const IMAGENET_MEAN = [0.485, 0.456, 0.406] as const;
const IMAGENET_STD = [0.229, 0.224, 0.225] as const;

function normalizationTable(): Float32Array {
  const table = new Float32Array(3 * 256);
  for (let channel = 0; channel < 3; channel += 1) {
    const mean = Math.fround(IMAGENET_MEAN[channel]!);
    const std = Math.fround(IMAGENET_STD[channel]!);
    for (let value = 0; value < 256; value += 1) {
      const scaled = Math.fround(value / 255);
      table[channel * 256 + value] = Math.fround(scaled - mean) / std;
    }
  }
  return table;
}

const NORMALIZED = normalizationTable();

function rotatePixels(
  pixels: ArrayLike<number>,
  width: number,
  height: number,
  stride: 3 | 4,
  turns: number,
): Rgb8Image {
  if (pixels.length !== width * height * stride) {
    throw new RangeError("Pixel buffer length does not match its dimensions");
  }
  const quarter = normalizeQuarter(turns);
  const swapped = quarter % 2 === 1;
  const outWidth = swapped ? height : width;
  const outHeight = swapped ? width : height;
  const data = new Uint8Array(outWidth * outHeight * 3);
  let target = 0;
  for (let y = 0; y < outHeight; y += 1) {
    for (let x = 0; x < outWidth; x += 1) {
      let sourceX = x;
      let sourceY = y;
      if (quarter === 1) {
        sourceX = y;
        sourceY = height - 1 - x;
      } else if (quarter === 2) {
        sourceX = width - 1 - x;
        sourceY = height - 1 - y;
      } else if (quarter === 3) {
        sourceX = width - 1 - y;
        sourceY = x;
      }
      const source = (sourceY * width + sourceX) * stride;
      data[target] = pixels[source]!;
      data[target + 1] = pixels[source + 1]!;
      data[target + 2] = pixels[source + 2]!;
      target += 3;
    }
  }
  return { data, width: outWidth, height: outHeight };
}

export function rotateRgbClockwise(image: Rgb8Image, turns: number): Rgb8Image {
  return rotatePixels(image.data, image.width, image.height, 3, turns);
}

export function rgbFromRgba(
  rgba: ArrayLike<number>,
  width: number,
  height: number,
  turns: number,
): Rgb8Image {
  return rotatePixels(rgba, width, height, 4, turns);
}

export function normalizeImagenet(
  image: Rgb8Image,
): Float32Array<ArrayBuffer> {
  const plane = image.width * image.height;
  const tensor = new Float32Array(3 * plane);
  const data = image.data;
  for (let index = 0; index < plane; index += 1) {
    const source = index * 3;
    tensor[index] = NORMALIZED[data[source]!]!;
    tensor[plane + index] = NORMALIZED[256 + data[source + 1]!]!;
    tensor[2 * plane + index] = NORMALIZED[512 + data[source + 2]!]!;
  }
  return tensor;
}

export function prepareModelInput(
  image: Rgb8Image,
  side: number,
): Float32Array<ArrayBuffer> {
  return normalizeImagenet(resizeRgb8(image, side, side));
}

export function rotateChw(
  data: Float32Array,
  side: number,
  turns: number,
): Float32Array<ArrayBuffer> {
  const quarter = normalizeQuarter(turns);
  const plane = side * side;
  const result = new Float32Array(3 * plane);
  for (let channel = 0; channel < 3; channel += 1) {
    const base = channel * plane;
    for (let y = 0; y < side; y += 1) {
      for (let x = 0; x < side; x += 1) {
        let sourceY = y;
        let sourceX = x;
        if (quarter === 1) {
          sourceY = side - 1 - x;
          sourceX = y;
        } else if (quarter === 2) {
          sourceY = side - 1 - y;
          sourceX = side - 1 - x;
        } else if (quarter === 3) {
          sourceY = x;
          sourceX = side - 1 - y;
        }
        result[base + y * side + x] = data[base + sourceY * side + sourceX]!;
      }
    }
  }
  return result;
}

export function buildViewBatch(
  data: Float32Array,
  side: number,
): Float32Array<ArrayBuffer> {
  const batch = new Float32Array(VIEWS * data.length);
  for (let view = 0; view < VIEWS; view += 1) {
    batch.set(rotateChw(data, side, view), view * data.length);
  }
  return batch;
}

export function alignViews(logits: ArrayLike<number>): number[] {
  if (logits.length === 0 || logits.length % CLASSES !== 0) {
    throw new RangeError("Model logits must hold four classes per view");
  }
  const views = logits.length / CLASSES;
  const probabilities = [0, 0, 0, 0];
  for (let view = 0; view < views; view += 1) {
    const row = Array.from({ length: CLASSES }, (_, index) => {
      const value = logits[view * CLASSES + index]!;
      if (!Number.isFinite(value)) {
        throw new RangeError("Model produced non-finite logits");
      }
      return value;
    });
    const maximum = Math.max(...row);
    const exponentials = row.map((value) => Math.exp(value - maximum));
    const denominator = exponentials.reduce((sum, value) => sum + value, 0);
    exponentials.forEach((value, index) => {
      probabilities[(index + view) % CLASSES]! += value / denominator / views;
    });
  }
  return probabilities;
}

export function weightedAverage(
  runs: readonly WeightedProbabilities[],
): number[] {
  const total = runs.reduce((sum, run) => sum + run.weight, 0);
  if (runs.length === 0 || !Number.isFinite(total) || total <= 0) {
    throw new RangeError("Ensemble weights must have a positive finite sum");
  }
  const combined = [0, 0, 0, 0];
  for (const run of runs) {
    for (let index = 0; index < CLASSES; index += 1) {
      combined[index]! +=
        (run.weight / total) * (run.probabilities[index] ?? 0);
    }
  }
  return combined;
}

export function topMargin(probabilities: readonly number[]): number {
  const sorted = [...probabilities].sort((left, right) => right - left);
  return (sorted[0] ?? 0) - (sorted[1] ?? 0);
}

export function needsFallback(
  probabilities: readonly number[],
  margin: number,
): boolean {
  return topMargin(probabilities) < margin;
}

export function argmaxLast(probabilities: readonly number[]): number {
  let best = 0;
  for (let index = 1; index < probabilities.length; index += 1) {
    if (probabilities[index]! >= probabilities[best]!) {
      best = index;
    }
  }
  return best;
}

export function decideEnsemble(
  general: readonly WeightedProbabilities[],
  fallback: WeightedProbabilities | null,
): EnsembleDecision {
  const generalCombined = weightedAverage(general);
  const combined =
    fallback === null
      ? generalCombined
      : weightedAverage([...general, fallback]);
  const correction = argmaxLast(combined) as Quarter;
  return {
    correction,
    confidence: combined[correction]!,
    probabilities: [combined[0]!, combined[1]!, combined[2]!, combined[3]!],
    generalMargin: topMargin(generalCombined),
    fallbackUsed: fallback !== null,
  };
}
