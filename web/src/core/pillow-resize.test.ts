import { describe, expect, it } from "vitest";
import fixtures from "./__fixtures__/pillow-resize.json";
import { resizeRgb8, type Rgb8Image } from "./pillow-resize";
import { mulberry32 } from "./random";

interface ResizeCase {
  id: string;
  content: string;
  seed: number;
  width: number;
  height: number;
  targetWidth: number;
  targetHeight: number;
  sha256: string;
  samples: number[][];
}

function noise(seed: number, width: number, height: number): Uint8Array<ArrayBuffer> {
  const random = mulberry32(seed);
  const data = new Uint8Array(width * height * 3);
  for (let index = 0; index < data.length; index += 1) {
    data[index] = Math.floor(random() * 256);
  }
  return data;
}

function gradient(width: number, height: number): Uint8Array<ArrayBuffer> {
  const data = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      for (let channel = 0; channel < 3; channel += 1) {
        data[(y * width + x) * 3 + channel] =
          (x * 7 + y * 13 + channel * 85 + ((x * y) >> 3)) & 255;
      }
    }
  }
  return data;
}

function synthetic(item: ResizeCase): Rgb8Image {
  const data =
    item.content === "noise"
      ? noise(item.seed, item.width, item.height)
      : gradient(item.width, item.height);
  return { data, width: item.width, height: item.height };
}

async function sha256(data: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function image(width: number, height: number, data: number[]): Rgb8Image {
  return { data: Uint8Array.from(data), width, height };
}

function filled(width: number, height: number, rgb: number[]): Rgb8Image {
  const data = new Uint8Array(width * height * 3);
  for (let index = 0; index < width * height; index += 1) {
    data.set(rgb, index * 3);
  }
  return { data, width, height };
}

describe("resizeRgb8", () => {
  it("preserves every channel when the dimensions do not change", () => {
    const source = filled(7, 3, [0, 0, 0]);
    for (let y = 0; y < 3; y += 1) {
      for (let x = 0; x < 7; x += 1) {
        source.data.set([x * 37, y * 81, x + y * 7], (y * 7 + x) * 3);
      }
    }
    const resized = resizeRgb8(source, 7, 3);
    expect(resized.width).toBe(7);
    expect(resized.height).toBe(3);
    expect(Array.from(resized.data)).toEqual(Array.from(source.data));
    expect(resized.data).not.toBe(source.data);
  });

  it("keeps constant images constant across both pass orders", () => {
    const cases: Array<[number, number, number, number]> = [
      [19, 5, 4, 3],
      [5, 19, 3, 4],
      [1, 1, 9, 7],
    ];
    for (const [width, height, targetWidth, targetHeight] of cases) {
      const resized = resizeRgb8(
        filled(width, height, [0, 123, 255]),
        targetWidth,
        targetHeight,
      );
      expect(resized.width).toBe(targetWidth);
      expect(resized.height).toBe(targetHeight);
      expect(Array.from(resized.data)).toEqual(
        Array.from(filled(targetWidth, targetHeight, [0, 123, 255]).data),
      );
    }
  });

  it("rounds half values up in each channel", () => {
    const resized = resizeRgb8(image(2, 1, [0, 254, 10, 1, 255, 11]), 1, 1);
    expect(Array.from(resized.data)).toEqual([1, 255, 11]);
  });

  it("rejects empty dimensions and mismatched buffers", () => {
    expect(() => resizeRgb8(image(1, 1, [1, 2, 3]), 0, 1)).toThrow();
    expect(() => resizeRgb8(image(1, 1, [1, 2, 3]), 1, -1)).toThrow();
    expect(() => resizeRgb8(image(0, 1, []), 1, 1)).toThrow();
    expect(() => resizeRgb8(image(2, 1, [1, 2, 3]), 1, 1)).toThrow();
    expect(() => resizeRgb8(image(1, 1, [1, 2, 3]), 1.5, 1)).toThrow();
  });

  it("generates the same synthetic input bytes as the Python fixture script", () => {
    expect(Array.from(noise(1001, 4, 1))).toEqual([
      36, 68, 28, 85, 168, 249, 153, 218, 173, 89, 39, 24,
    ]);
    expect(Array.from(gradient(3, 2))).toEqual([
      0, 85, 170, 7, 92, 177, 14, 99, 184, 13, 98, 183, 20, 105, 190, 27, 112,
      197,
    ]);
  });

  it("was checked against Pillow 13.0.0", () => {
    expect(fixtures.pillow).toBe("13.0.0");
    expect(fixtures.cases.length).toBeGreaterThan(80);
  });

  it.each(fixtures.cases.map((item: ResizeCase) => [item.id, item] as const))(
    "matches Pillow BILINEAR bit for bit: %s",
    async (_id, item) => {
      const resized = resizeRgb8(
        synthetic(item),
        item.targetWidth,
        item.targetHeight,
      );
      expect(resized.width).toBe(item.targetWidth);
      expect(resized.height).toBe(item.targetHeight);
      for (const [x, y, red, green, blue] of item.samples) {
        const offset = ((y ?? 0) * item.targetWidth + (x ?? 0)) * 3;
        expect(Array.from(resized.data.subarray(offset, offset + 3))).toEqual([
          red,
          green,
          blue,
        ]);
      }
      expect(await sha256(resized.data)).toBe(item.sha256);
    },
  );
});
