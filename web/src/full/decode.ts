import { rgbFromRgba } from "../core/full-ensemble";
import type { Rgb8Image } from "../core/pillow-resize";
import { fitWithin } from "../services/render-image";

export interface DecodePorts {
  decode(file: Blob, options: ImageBitmapOptions): Promise<ImageBitmap>;
  resize(image: ImageBitmap, options: ImageBitmapOptions): Promise<ImageBitmap>;
  read(image: ImageBitmap): ArrayLike<number>;
}

export type RgbDecoder = (file: Blob, turns: number) => Promise<Rgb8Image>;

export const DECODE_MAX_SIDE = 2_048;

const DECODE_FAILED = "画像を読み込めませんでした";

const PIXEL_OPTIONS: ImageBitmapOptions = {
  colorSpaceConversion: "none",
  premultiplyAlpha: "none",
};

const BITMAP_OPTIONS: ImageBitmapOptions = {
  imageOrientation: "from-image",
  ...PIXEL_OPTIONS,
};

function readOnCanvas(image: ImageBitmap): Uint8ClampedArray {
  const { width, height } = image;
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    throw new Error(DECODE_FAILED);
  }
  context.drawImage(image, 0, 0);
  const rgba = context.getImageData(0, 0, width, height).data;
  canvas.width = 0;
  canvas.height = 0;
  return rgba;
}

export const BROWSER_DECODE_PORTS: DecodePorts = {
  decode: (file, options) => createImageBitmap(file, options),
  resize: (image, options) => createImageBitmap(image, options),
  read: readOnCanvas,
};

async function capped(
  ports: DecodePorts,
  image: ImageBitmap,
  maxSide: number,
): Promise<ImageBitmap> {
  const target = fitWithin(image.width, image.height, maxSide);
  if (!target) {
    return image;
  }
  try {
    return await ports.resize(image, {
      resizeWidth: target.width,
      resizeHeight: target.height,
      resizeQuality: "medium",
      ...PIXEL_OPTIONS,
    });
  } catch (error) {
    throw new Error(DECODE_FAILED, { cause: error });
  } finally {
    image.close();
  }
}

export function createRgbDecoder(
  ports: DecodePorts,
  maxSide = DECODE_MAX_SIDE,
): RgbDecoder {
  return async (file, turns) => {
    let decoded: ImageBitmap;
    try {
      decoded = await ports.decode(file, BITMAP_OPTIONS);
    } catch (error) {
      throw new Error(DECODE_FAILED, { cause: error });
    }
    const image = await capped(ports, decoded, maxSide);
    try {
      const { width, height } = image;
      return rgbFromRgba(ports.read(image), width, height, turns);
    } finally {
      image.close();
    }
  };
}

export const decodeRgb = createRgbDecoder(BROWSER_DECODE_PORTS);
