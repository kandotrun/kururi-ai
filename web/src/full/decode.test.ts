import { describe, expect, it, vi } from "vitest";
import { createRgbDecoder, DECODE_MAX_SIDE, type DecodePorts } from "./decode";

interface FakeBitmap extends ImageBitmap {
  readonly label: string;
  readonly closed: boolean;
}

function bitmap(width: number, height: number, label: string): FakeBitmap {
  let closed = false;
  return {
    width,
    height,
    label,
    get closed() {
      return closed;
    },
    close() {
      closed = true;
    },
  };
}

function rgba(width: number, height: number): Uint8ClampedArray<ArrayBuffer> {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    data[index * 4] = index % 256;
    data[index * 4 + 1] = (index * 3) % 256;
    data[index * 4 + 2] = (index * 7) % 256;
    data[index * 4 + 3] = 255;
  }
  return data;
}

function ports(width: number, height: number) {
  const made: FakeBitmap[] = [];
  const decode = vi.fn(async (_file: Blob, _options: ImageBitmapOptions) => {
    const result = bitmap(width, height, "decoded");
    made.push(result);
    return result;
  });
  const resize = vi.fn(
    async (_image: ImageBitmap, options: ImageBitmapOptions) => {
      const result = bitmap(
        options.resizeWidth ?? 0,
        options.resizeHeight ?? 0,
        "resized",
      );
      made.push(result);
      return result;
    },
  );
  const read = vi.fn((image: ImageBitmap) => {
    const fake = made.find((entry) => entry === image);
    if (!fake || fake.closed) {
      throw new Error("read a closed or unknown bitmap");
    }
    return rgba(image.width, image.height);
  });
  const surface: DecodePorts = { decode, resize, read };
  return { surface, decode, resize, read, made };
}

const file = new Blob(["jpeg"], { type: "image/jpeg" });

describe("createRgbDecoder", () => {
  it("caps photos at a long side of 2048 by default", () => {
    expect(DECODE_MAX_SIDE).toBe(2_048);
  });

  it("reads photos within the cap at their own size", async () => {
    const fake = ports(12, 8);
    const image = await createRgbDecoder(fake.surface, 16)(file, 0);
    expect(fake.decode).toHaveBeenCalledWith(file, {
      imageOrientation: "from-image",
      colorSpaceConversion: "none",
      premultiplyAlpha: "none",
    });
    expect(fake.resize).not.toHaveBeenCalled();
    expect(image.width).toBe(12);
    expect(image.height).toBe(8);
    expect(Array.from(image.data.slice(0, 6))).toEqual([0, 0, 0, 1, 3, 7]);
    expect(fake.made.every((entry) => entry.closed)).toBe(true);
  });

  it("leaves a photo exactly at the cap alone", async () => {
    const fake = ports(16, 5);
    const image = await createRgbDecoder(fake.surface, 16)(file, 0);
    expect(fake.resize).not.toHaveBeenCalled();
    expect(image.width).toBe(16);
  });

  it("shrinks larger photos to the cap before reading their pixels", async () => {
    const fake = ports(60, 40);
    const image = await createRgbDecoder(fake.surface, 16)(file, 0);
    expect(fake.resize).toHaveBeenCalledTimes(1);
    expect(fake.resize.mock.calls[0]?.[0]).toBe(fake.made[0]);
    expect(fake.resize.mock.calls[0]?.[1]).toEqual({
      resizeWidth: 16,
      resizeHeight: 11,
      resizeQuality: "medium",
      colorSpaceConversion: "none",
      premultiplyAlpha: "none",
    });
    expect(fake.read).toHaveBeenCalledWith(fake.made[1]);
    expect(image.width).toBe(16);
    expect(image.height).toBe(11);
    expect(image.data).toHaveLength(16 * 11 * 3);
    expect(fake.made.every((entry) => entry.closed)).toBe(true);
  });

  it("frees the full-size bitmap before reading the smaller one", async () => {
    const fake = ports(60, 40);
    fake.read.mockImplementation((image: ImageBitmap) => {
      expect(fake.made[0]?.closed).toBe(true);
      return rgba(image.width, image.height);
    });
    await createRgbDecoder(fake.surface, 16)(file, 0);
    expect(fake.read).toHaveBeenCalledTimes(1);
  });

  it("shrinks portrait photos by their height", async () => {
    const fake = ports(30, 45);
    const image = await createRgbDecoder(fake.surface, 16)(file, 0);
    expect(fake.resize.mock.calls[0]?.[1]).toMatchObject({
      resizeWidth: 11,
      resizeHeight: 16,
    });
    expect([image.width, image.height]).toEqual([11, 16]);
  });

  it("turns the capped photo by the simulated rotation", async () => {
    const fake = ports(60, 40);
    const image = await createRgbDecoder(fake.surface, 16)(file, 1);
    expect([image.width, image.height]).toEqual([11, 16]);
  });

  it("reports a photo it cannot decode in Japanese", async () => {
    const fake = ports(60, 40);
    fake.decode.mockRejectedValueOnce(new Error("InvalidStateError"));
    await expect(createRgbDecoder(fake.surface, 16)(file, 0)).rejects.toThrow(
      "画像を読み込めませんでした",
    );
  });

  it("closes the full-size bitmap when shrinking fails", async () => {
    const fake = ports(60, 40);
    fake.resize.mockRejectedValueOnce(new Error("out of memory"));
    await expect(createRgbDecoder(fake.surface, 16)(file, 0)).rejects.toThrow(
      "画像を読み込めませんでした",
    );
    expect(fake.made[0]?.closed).toBe(true);
    expect(fake.read).not.toHaveBeenCalled();
  });
});
