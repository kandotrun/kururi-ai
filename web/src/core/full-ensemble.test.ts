import { describe, expect, it } from "vitest";
import {
  alignViews,
  argmaxLast,
  buildViewBatch,
  decideEnsemble,
  needsFallback,
  normalizeImagenet,
  prepareModelInput,
  rgbFromRgba,
  rotateChw,
  rotateRgbClockwise,
  topMargin,
  weightedAverage,
} from "./full-ensemble";
import type { Rgb8Image } from "./pillow-resize";

function indexImage(width: number, height: number): Rgb8Image {
  const data = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      data.set([y * width + x, 100 + x, 200 + y], (y * width + x) * 3);
    }
  }
  return { data, width, height };
}

function redAt(image: Rgb8Image, x: number, y: number): number {
  return image.data[(y * image.width + x) * 3]!;
}

function f32Normalized(value: number, mean: number, std: number): number {
  return Math.fround(
    Math.fround(Math.fround(value / 255) - Math.fround(mean)) /
      Math.fround(std),
  );
}

function peakedLogits(base: number): number[] {
  const logits: number[] = [];
  for (let view = 0; view < 4; view += 1) {
    const values = [0, 0, 0, 0];
    values[(base + 4 - view) % 4] = 10;
    logits.push(...values);
  }
  return logits;
}

describe("rotateRgbClockwise", () => {
  it("turns a 2x3 image clockwise like image::rotate90", () => {
    const right = rotateRgbClockwise(indexImage(2, 3), 1);
    expect([right.width, right.height]).toEqual([3, 2]);
    expect(redAt(right, 2, 0)).toBe(0);
    expect(redAt(right, 0, 1)).toBe(5);
    expect(redAt(right, 0, 0)).toBe(4);
  });

  it("handles half and three-quarter turns", () => {
    const source = indexImage(2, 3);
    const half = rotateRgbClockwise(source, 2);
    expect([half.width, half.height]).toEqual([2, 3]);
    expect(redAt(half, 0, 0)).toBe(5);
    const left = rotateRgbClockwise(source, 3);
    expect([left.width, left.height]).toEqual([3, 2]);
    expect(redAt(left, 0, 0)).toBe(1);
    expect(redAt(left, 2, 1)).toBe(4);
  });

  it("returns to the source after a full turn and normalises quarters", () => {
    const source = indexImage(3, 2);
    let turned = source;
    for (let step = 0; step < 4; step += 1) {
      turned = rotateRgbClockwise(turned, 1);
    }
    expect(Array.from(turned.data)).toEqual(Array.from(source.data));
    expect(Array.from(rotateRgbClockwise(source, -1).data)).toEqual(
      Array.from(rotateRgbClockwise(source, 3).data),
    );
    expect(Array.from(rotateRgbClockwise(source, 5).data)).toEqual(
      Array.from(rotateRgbClockwise(source, 1).data),
    );
    expect(rotateRgbClockwise(source, 0).data).not.toBe(source.data);
  });
});

describe("rgbFromRgba", () => {
  it("drops alpha and applies the clockwise turn in one pass", () => {
    const rgba = new Uint8ClampedArray([
      1, 2, 3, 255, 4, 5, 6, 0, 7, 8, 9, 128, 10, 11, 12, 255,
    ]);
    const upright = rgbFromRgba(rgba, 2, 2, 0);
    expect(Array.from(upright.data)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
    ]);
    const turned = rgbFromRgba(rgba, 2, 2, 1);
    expect(Array.from(turned.data)).toEqual(
      Array.from(rotateRgbClockwise(upright, 1).data),
    );
  });

  it("rejects a buffer that does not match the dimensions", () => {
    expect(() => rgbFromRgba(new Uint8ClampedArray(12), 2, 2, 0)).toThrow();
  });
});

describe("normalizeImagenet", () => {
  it("writes ImageNet-normalised channels as CHW planes with float32 rounding", () => {
    const tensor = normalizeImagenet({
      data: Uint8Array.from([255, 0, 128, 0, 255, 64]),
      width: 2,
      height: 1,
    });
    expect(Array.from(tensor)).toEqual([
      f32Normalized(255, 0.485, 0.229),
      f32Normalized(0, 0.485, 0.229),
      f32Normalized(0, 0.456, 0.224),
      f32Normalized(255, 0.456, 0.224),
      f32Normalized(128, 0.406, 0.225),
      f32Normalized(64, 0.406, 0.225),
    ]);
  });
});

describe("prepareModelInput", () => {
  it("resizes a constant photo to the model side and normalises it", () => {
    const data = new Uint8Array(400 * 100 * 3);
    for (let index = 0; index < 400 * 100; index += 1) {
      data.set([255, 0, 128], index * 3);
    }
    const tensor = prepareModelInput({ data, width: 400, height: 100 }, 224);
    const plane = 224 * 224;
    expect(tensor.length).toBe(3 * plane);
    const expected = [
      (1 - 0.485) / 0.229,
      -0.456 / 0.224,
      (128 / 255 - 0.406) / 0.225,
    ];
    for (let channel = 0; channel < 3; channel += 1) {
      for (const value of tensor.subarray(
        channel * plane,
        (channel + 1) * plane,
      )) {
        expect(Math.abs(value - expected[channel]!)).toBeLessThan(1e-6);
      }
    }
  });
});

describe("rotateChw", () => {
  it("matches the native clockwise view rotation", () => {
    const side = 224;
    const input = Float32Array.from(
      { length: 3 * side * side },
      (_, index) => index,
    );
    const right = rotateChw(input, side, 1);
    expect(right[0]).toBe(input[(side - 1) * side]);
    expect(Array.from(rotateChw(right, side, 3))).toEqual(Array.from(input));
  });

  it("agrees with rotating the RGB8 pixels of a square image", () => {
    const source = indexImage(3, 3);
    for (let quarters = 0; quarters < 4; quarters += 1) {
      expect(
        Array.from(rotateChw(normalizeImagenet(source), 3, quarters)),
      ).toEqual(
        Array.from(normalizeImagenet(rotateRgbClockwise(source, quarters))),
      );
    }
  });
});

describe("buildViewBatch", () => {
  it("stacks the four clockwise views in order", () => {
    const side = 4;
    const input = Float32Array.from(
      { length: 3 * side * side },
      (_, index) => index / 7,
    );
    const batch = buildViewBatch(input, side);
    const size = input.length;
    expect(batch.length).toBe(4 * size);
    for (let view = 0; view < 4; view += 1) {
      expect(Array.from(batch.subarray(view * size, (view + 1) * size))).toEqual(
        Array.from(rotateChw(input, side, view)),
      );
    }
  });
});

describe("alignViews", () => {
  it("aligns every view back to the input classes", () => {
    for (let base = 0; base < 4; base += 1) {
      const probabilities = alignViews(peakedLogits(base));
      expect(probabilities[base]).toBeGreaterThan(0.999);
      const sum = probabilities.reduce((total, value) => total + value, 0);
      expect(Math.abs(sum - 1)).toBeLessThan(1e-9);
    }
  });

  it("averages softmax values view by view", () => {
    const logits = [
      Math.log(1),
      Math.log(3),
      Math.log(0.5),
      Math.log(0.5),
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
    ];
    const probabilities = alignViews(logits);
    expect(probabilities[0]).toBeCloseTo((0.2 + 0.75) / 4, 12);
    expect(probabilities[1]).toBeCloseTo((0.6 + 0.75) / 4, 12);
    expect(probabilities[2]).toBeCloseTo((0.1 + 0.75) / 4, 12);
    expect(probabilities[3]).toBeCloseTo((0.1 + 0.75) / 4, 12);
  });

  it("rejects non-finite or misshaped logits", () => {
    expect(() => alignViews([Number.NaN, 0, 0, 0])).toThrow();
    expect(() => alignViews([0, 0, 0])).toThrow();
    expect(() => alignViews([0, 0, 0, Number.POSITIVE_INFINITY])).toThrow();
  });
});

describe("weightedAverage", () => {
  it("normalises by the sum of the invoked weights", () => {
    const combined = weightedAverage([
      { weight: 0.5, probabilities: [1, 0, 0, 0] },
      { weight: 0.4, probabilities: [0, 1, 0, 0] },
    ]);
    expect(combined[0]).toBeCloseTo(0.5 / 0.9, 12);
    expect(combined[1]).toBeCloseTo(0.4 / 0.9, 12);
    expect(combined[2]).toBe(0);
  });

  it("rejects empty or zero weights", () => {
    expect(() => weightedAverage([])).toThrow();
    expect(() =>
      weightedAverage([{ weight: 0, probabilities: [1, 0, 0, 0] }]),
    ).toThrow();
  });
});

describe("topMargin and needsFallback", () => {
  it("measures the gap between the two largest probabilities", () => {
    expect(topMargin([0.1, 0.5, 0.3, 0.1])).toBeCloseTo(0.2, 12);
    expect(topMargin([0.25, 0.25, 0.25, 0.25])).toBe(0);
  });

  it("calls the fallback only below the threshold", () => {
    expect(needsFallback([0.5, 0.48, 0.01, 0.01], 0.033333333)).toBe(true);
    expect(needsFallback([0.6, 0.3, 0.05, 0.05], 0.033333333)).toBe(false);
    expect(needsFallback([0.5, 0.25, 0.25, 0], 0.25)).toBe(false);
  });
});

describe("argmaxLast", () => {
  it("keeps the last maximal index on ties like Rust max_by", () => {
    expect(argmaxLast([0.25, 0.25, 0.25, 0.25])).toBe(3);
    expect(argmaxLast([0.4, 0.4, 0.1, 0.1])).toBe(1);
    expect(argmaxLast([0.1, 0.7, 0.1, 0.1])).toBe(1);
  });
});

describe("decideEnsemble", () => {
  const confident = { weight: 0.5, probabilities: [0.05, 0.85, 0.05, 0.05] };
  const unsure = { weight: 0.4, probabilities: [0.1, 0.4, 0.4, 0.1] };

  it("uses the general models when no fallback ran", () => {
    const decision = decideEnsemble([confident, unsure], null);
    expect(decision.correction).toBe(1);
    expect(decision.fallbackUsed).toBe(false);
    expect(decision.probabilities[1]).toBeCloseTo(
      (0.5 * 0.85 + 0.4 * 0.4) / 0.9,
      12,
    );
    expect(decision.confidence).toBe(decision.probabilities[1]);
  });

  it("renormalises over all three weights when the fallback ran", () => {
    const fallback = { weight: 0.1, probabilities: [0, 0, 1, 0] };
    const decision = decideEnsemble([confident, unsure], fallback);
    expect(decision.fallbackUsed).toBe(true);
    expect(decision.probabilities[2]).toBeCloseTo(
      0.5 * 0.05 + 0.4 * 0.4 + 0.1,
      12,
    );
    const sum = decision.probabilities.reduce((total, value) => total + value, 0);
    expect(sum).toBeCloseTo(1, 12);
  });

  it("reports the general margin used for the fallback decision", () => {
    const decision = decideEnsemble([confident, unsure], null);
    expect(decision.generalMargin).toBeCloseTo(
      (0.5 * 0.85 + 0.4 * 0.4) / 0.9 - (0.5 * 0.05 + 0.4 * 0.4) / 0.9,
      12,
    );
  });
});
