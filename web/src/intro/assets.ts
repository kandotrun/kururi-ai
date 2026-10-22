import type { GeoPoint } from "../contracts";
import type { Random } from "../core/random";
import { lightWeights, sampleWeightedPoints } from "./origins";

export const INTRO_FILES = {
  day: "earth-day-4096.webp",
  night: "earth-night-4096.webp",
  clouds: "earth-clouds-2048.webp",
  japanNight: "japan-night-128E-152E-26N-46N.webp",
  japanDay: "japan-day-128E-152E-26N-46N.webp",
} as const;

export type IntroImageName = keyof typeof INTRO_FILES;
export type IntroImages = Record<IntroImageName, ImageBitmap>;

export interface LoadOptions {
  maxWidth: number;
  signal: AbortSignal;
  fetcher?: typeof fetch;
}

const DECODE: ImageBitmapOptions = {
  premultiplyAlpha: "none",
  colorSpaceConversion: "none",
};

async function fetchBitmap(
  url: string,
  options: LoadOptions,
): Promise<ImageBitmap> {
  const fetcher = options.fetcher ?? fetch;
  const response = await fetcher(url, { signal: options.signal });
  if (!response.ok) {
    throw new Error(`intro texture ${url} answered ${response.status}`);
  }
  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob, DECODE);
  if (bitmap.width <= options.maxWidth) {
    return bitmap;
  }
  const height = Math.max(
    1,
    Math.round((bitmap.height * options.maxWidth) / bitmap.width),
  );
  const resized = await createImageBitmap(bitmap, {
    ...DECODE,
    resizeWidth: options.maxWidth,
    resizeHeight: height,
    resizeQuality: "high",
  });
  bitmap.close();
  return resized;
}

export function closeImages(images: Partial<IntroImages>): void {
  for (const bitmap of Object.values(images)) {
    try {
      bitmap?.close();
    } catch {
      continue;
    }
  }
}

export async function loadIntroImages(
  baseUrl: string,
  options: LoadOptions,
): Promise<IntroImages> {
  const names = Object.keys(INTRO_FILES) as IntroImageName[];
  const settled = await Promise.allSettled(
    names.map((name) => fetchBitmap(new URL(INTRO_FILES[name], baseUrl).href, options)),
  );
  const images: Partial<IntroImages> = {};
  let failure: unknown = null;
  settled.forEach((result, index) => {
    const name = names[index]!;
    if (result.status === "fulfilled") {
      images[name] = result.value;
    } else {
      failure = result.reason;
    }
  });
  if (failure !== null || names.some((name) => images[name] === undefined)) {
    closeImages(images);
    throw failure instanceof Error ? failure : new Error("intro textures failed");
  }
  return images as IntroImages;
}

export function fallbackOrigins(
  night: ImageBitmap,
  count: number,
  random: Random,
): GeoPoint[] {
  const width = 360;
  const height = 180;
  let pixels: Uint8ClampedArray | null = null;
  if (typeof OffscreenCanvas !== "undefined") {
    const context = new OffscreenCanvas(width, height).getContext("2d");
    if (context) {
      context.drawImage(night, 0, 0, width, height);
      pixels = context.getImageData(0, 0, width, height).data;
    }
  } else {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (context) {
      context.drawImage(night, 0, 0, width, height);
      pixels = context.getImageData(0, 0, width, height).data;
    }
  }
  if (!pixels) {
    return [];
  }
  return sampleWeightedPoints(
    lightWeights(pixels, width, height),
    width,
    height,
    count,
    random,
  );
}
