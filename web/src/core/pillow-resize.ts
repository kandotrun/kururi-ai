export interface Rgb8Image {
  readonly data: Uint8Array<ArrayBuffer>;
  readonly width: number;
  readonly height: number;
}

interface AxisTaps {
  starts: Int32Array;
  counts: Int32Array;
  offsets: Int32Array;
  weights: Int32Array;
}

const COEFFICIENT_BITS = 22;
const COEFFICIENT_SCALE = 1 << COEFFICIENT_BITS;
const ROUNDING_BIAS = 1 << (COEFFICIENT_BITS - 1);

function isDimension(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

function axisTaps(input: number, output: number): AxisTaps {
  const scale = input / output;
  const support = Math.max(scale, 1);
  const inverseSupport = 1 / support;
  const starts = new Int32Array(output);
  const counts = new Int32Array(output);
  const offsets = new Int32Array(output);
  const rows: Float64Array[] = [];
  let total = 0;
  for (let position = 0; position < output; position += 1) {
    const center = (position + 0.5) * scale;
    const start = Math.trunc(Math.max(center - support + 0.5, 0));
    const end = Math.min(Math.trunc(center + support + 0.5), input);
    const row = new Float64Array(Math.max(end - start, 0));
    for (let sample = start; sample < end; sample += 1) {
      const distance = Math.abs((sample - center + 0.5) * inverseSupport);
      row[sample - start] = Math.max(1 - distance, 0);
    }
    starts[position] = start;
    counts[position] = row.length;
    offsets[position] = total;
    total += row.length;
    rows.push(row);
  }
  const weights = new Int32Array(total);
  rows.forEach((row, position) => {
    let sum = 0;
    for (const weight of row) {
      sum += weight;
    }
    const offset = offsets[position]!;
    for (let index = 0; index < row.length; index += 1) {
      const normalized = sum === 0 ? row[index]! : row[index]! / sum;
      weights[offset + index] = Math.trunc(
        0.5 + normalized * COEFFICIENT_SCALE,
      );
    }
  });
  return { starts, counts, offsets, weights };
}

function toChannel(sum: number): number {
  const value = sum >> COEFFICIENT_BITS;
  return value > 255 ? 255 : value < 0 ? 0 : value;
}

function horizontal(source: Rgb8Image, width: number): Rgb8Image {
  const { starts, counts, offsets, weights } = axisTaps(source.width, width);
  const input = source.data;
  const output = new Uint8Array(width * source.height * 3);
  const inputStride = source.width * 3;
  for (let y = 0; y < source.height; y += 1) {
    const rowStart = y * inputStride;
    let target = y * width * 3;
    for (let x = 0; x < width; x += 1) {
      let red = ROUNDING_BIAS;
      let green = ROUNDING_BIAS;
      let blue = ROUNDING_BIAS;
      const offset = offsets[x]!;
      const count = counts[x]!;
      let sample = rowStart + starts[x]! * 3;
      for (let tap = 0; tap < count; tap += 1) {
        const weight = weights[offset + tap]!;
        red += input[sample]! * weight;
        green += input[sample + 1]! * weight;
        blue += input[sample + 2]! * weight;
        sample += 3;
      }
      output[target] = toChannel(red);
      output[target + 1] = toChannel(green);
      output[target + 2] = toChannel(blue);
      target += 3;
    }
  }
  return { data: output, width, height: source.height };
}

function vertical(source: Rgb8Image, height: number): Rgb8Image {
  const { starts, counts, offsets, weights } = axisTaps(source.height, height);
  const input = source.data;
  const stride = source.width * 3;
  const output = new Uint8Array(stride * height);
  for (let y = 0; y < height; y += 1) {
    const offset = offsets[y]!;
    const count = counts[y]!;
    const firstRow = starts[y]! * stride;
    const target = y * stride;
    for (let column = 0; column < stride; column += 1) {
      let sum = ROUNDING_BIAS;
      let sample = firstRow + column;
      for (let tap = 0; tap < count; tap += 1) {
        sum += input[sample]! * weights[offset + tap]!;
        sample += stride;
      }
      output[target + column] = toChannel(sum);
    }
  }
  return { data: output, width: source.width, height };
}

export function resizeRgb8(
  source: Rgb8Image,
  width: number,
  height: number,
): Rgb8Image {
  if (
    !isDimension(source.width) ||
    !isDimension(source.height) ||
    !isDimension(width) ||
    !isDimension(height)
  ) {
    throw new RangeError("Resize dimensions must be positive integers");
  }
  if (source.data.length !== source.width * source.height * 3) {
    throw new RangeError("RGB8 buffer length does not match its dimensions");
  }
  const changeWidth = source.width !== width;
  const changeHeight = source.height !== height;
  if (!changeWidth && !changeHeight) {
    return { data: source.data.slice(), width, height };
  }
  if (!changeHeight) {
    return horizontal(source, width);
  }
  if (!changeWidth) {
    return vertical(source, height);
  }
  const widthReduction = source.width - width;
  const heightReduction = source.height - height;
  if (heightReduction > 0 && heightReduction > 2 * widthReduction) {
    return horizontal(vertical(source, height), width);
  }
  return vertical(horizontal(source, width), height);
}
