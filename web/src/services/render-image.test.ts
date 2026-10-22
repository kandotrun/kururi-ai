import { describe, expect, it, vi } from "vitest";
import type { ExifOrientation } from "../core/tiff-preview";
import { renderImage, type RenderPlan, type RenderPorts } from "./render-image";

interface FakeBitmap extends ImageBitmap {
  readonly closed: boolean;
  readonly label: string;
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

function ports(width: number, height: number) {
  const made: FakeBitmap[] = [];
  const decode = vi.fn(async (_blob: Blob, options?: ImageBitmapOptions) => {
    const result = bitmap(
      options?.resizeWidth ?? width,
      options?.resizeHeight ?? height,
      "decoded",
    );
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
  const orient = vi.fn(
    async (image: ImageBitmap, orientation: ExifOrientation) => {
      const turned = orientation >= 5;
      const result = bitmap(
        turned ? image.height : image.width,
        turned ? image.width : image.height,
        "oriented",
      );
      made.push(result);
      return {
        bitmap: result,
        blob: new Blob([new Uint8Array([orientation])], { type: "image/jpeg" }),
      };
    },
  );
  const all: RenderPorts = { decode, resize, orient };
  return { ports: all, decode, resize, orient, made };
}

const source = new Blob([new Uint8Array([0xff, 0xd8])], { type: "image/jpeg" });

function plan(overrides: Partial<RenderPlan> = {}): RenderPlan {
  return {
    decode: { imageOrientation: "from-image" },
    maxSide: 2_048,
    orientation: 1,
    tileSize: 120,
    encode: true,
    ...overrides,
  };
}

describe("renderImage", () => {
  it("orients, encodes and makes a tile, closing every intermediate bitmap", async () => {
    const fake = ports(2_048, 1_536);
    const result = await renderImage(
      source,
      plan({ orientation: 6 }),
      fake.ports,
    );
    expect(fake.decode).toHaveBeenCalledWith(source, {
      imageOrientation: "from-image",
    });
    expect(fake.orient).toHaveBeenCalledWith(fake.made[0], 6);
    expect(fake.resize).toHaveBeenCalledWith(fake.made[1], {
      resizeWidth: 90,
      resizeHeight: 120,
      resizeQuality: "high",
    });
    expect(result.tile).toBe(fake.made[2]);
    expect(result.blob?.size).toBe(1);
    expect(result.aspect).toBe(0.75);
    expect(
      fake.made
        .filter((item) => item !== result.tile)
        .every((item) => item.closed),
    ).toBe(true);
    expect(fake.made.find((item) => item === result.tile)?.closed).toBe(false);
  });

  it("fits a decoded image that is still larger than the maximum side", async () => {
    const fake = ports(6_000, 4_000);
    const result = await renderImage(source, plan(), fake.ports);
    expect(fake.resize).toHaveBeenNthCalledWith(1, fake.made[0], {
      resizeWidth: 2_048,
      resizeHeight: 1_365,
      resizeQuality: "high",
    });
    expect(fake.orient).toHaveBeenCalledWith(fake.made[1], 1);
    expect(result.blob).not.toBeNull();
  });

  it("keeps the original when nothing had to be turned or shrunk", async () => {
    const fake = ports(1_600, 1_200);
    const result = await renderImage(source, plan(), fake.ports);
    expect(fake.orient).not.toHaveBeenCalled();
    expect(result.blob).toBeNull();
    expect(result.aspect).toBeCloseTo(4 / 3);
  });

  it("only makes a tile when no encoded copy is wanted", async () => {
    const fake = ports(8_064, 6_048);
    const result = await renderImage(
      source,
      plan({
        encode: false,
        maxSide: Number.POSITIVE_INFINITY,
        orientation: 1,
      }),
      fake.ports,
    );
    expect(fake.orient).not.toHaveBeenCalled();
    expect(fake.resize).toHaveBeenCalledTimes(1);
    expect(result.tile.width).toBe(120);
    expect(result.blob).toBeNull();
    expect(result.aspect).toBeCloseTo(4 / 3);
  });

  it("retries a plain decode when the browser rejects the options", async () => {
    const plain = bitmap(100, 50, "plain");
    const decode = vi.fn(async (_blob: Blob, options?: ImageBitmapOptions) => {
      if (options) {
        throw new TypeError("unsupported");
      }
      return plain;
    });
    const fake = ports(1, 1);
    const result = await renderImage(source, plan({ encode: false }), {
      ...fake.ports,
      decode,
    });
    expect(decode).toHaveBeenCalledTimes(2);
    expect(result.tile).toBe(plain);
  });

  it("does not retry a resizing decode with different options", async () => {
    const decode = vi.fn(async () => {
      throw new Error("broken");
    });
    const fake = ports(1, 1);
    await expect(
      renderImage(
        source,
        plan({
          decode: {
            imageOrientation: "from-image",
            resizeWidth: 10,
            resizeHeight: 10,
          },
        }),
        { ...fake.ports, decode },
      ),
    ).rejects.toThrow("broken");
    expect(decode).toHaveBeenCalledTimes(1);
  });

  it("closes what it decoded when orienting fails", async () => {
    const fake = ports(2_048, 1_536);
    const orient = vi.fn(async () => {
      throw new Error("no canvas");
    });
    await expect(
      renderImage(source, plan({ orientation: 3 }), { ...fake.ports, orient }),
    ).rejects.toThrow("no canvas");
    expect(fake.made[0]?.closed).toBe(true);
  });

  it("rejects images without a size", async () => {
    const fake = ports(0, 0);
    await expect(renderImage(source, plan(), fake.ports)).rejects.toThrow();
    expect(fake.made[0]?.closed).toBe(true);
  });
});
