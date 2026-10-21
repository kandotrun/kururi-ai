import { rgbFromRgba } from "../core/full-ensemble";
import type { Rgb8Image } from "../core/pillow-resize";

const DECODE_FAILED = "画像を読み込めませんでした";

const BITMAP_OPTIONS: ImageBitmapOptions = {
  imageOrientation: "from-image",
  colorSpaceConversion: "none",
  premultiplyAlpha: "none",
};

export async function decodeRgb(file: Blob, turns: number): Promise<Rgb8Image> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, BITMAP_OPTIONS);
  } catch (error) {
    throw new Error(DECODE_FAILED, { cause: error });
  }
  try {
    const { width, height } = bitmap;
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) {
      throw new Error(DECODE_FAILED);
    }
    context.drawImage(bitmap, 0, 0);
    const rgba = context.getImageData(0, 0, width, height).data;
    canvas.width = 0;
    canvas.height = 0;
    return rgbFromRgba(rgba, width, height, turns);
  } finally {
    bitmap.close();
  }
}
