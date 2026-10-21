import {
  orientationMatrix,
  orientedSize,
  type ExifOrientation,
} from "../core/tiff-preview";

export interface OrientedImage {
  bitmap: ImageBitmap;
  blob: Blob;
}

export interface RenderPorts {
  decode: (source: Blob, options?: ImageBitmapOptions) => Promise<ImageBitmap>;
  resize: (
    image: ImageBitmap,
    options: ImageBitmapOptions,
  ) => Promise<ImageBitmap>;
  orient: (
    image: ImageBitmap,
    orientation: ExifOrientation,
  ) => Promise<OrientedImage>;
}

export interface RenderPlan {
  decode: ImageBitmapOptions;
  maxSide: number;
  orientation: ExifOrientation;
  tileSize: number;
  encode: boolean;
}

export interface RenderedImage {
  tile: ImageBitmap;
  blob: Blob | null;
  aspect: number;
}

export type RenderImage = (
  source: Blob,
  plan: RenderPlan,
) => Promise<RenderedImage>;

const JPEG_QUALITY = 0.92;

export function fitWithin(
  width: number,
  height: number,
  maxSide: number,
): { width: number; height: number } | null {
  const longSide = Math.max(width, height);
  if (longSide <= maxSide) {
    return null;
  }
  const scale = maxSide / longSide;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export async function orientOnCanvas(
  image: ImageBitmap,
  orientation: ExifOrientation,
): Promise<OrientedImage> {
  const size = orientedSize(image.width, image.height, orientation);
  const canvas = new OffscreenCanvas(size.width, size.height);
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("画像を回転できませんでした");
  }
  context.setTransform(
    ...orientationMatrix(orientation, image.width, image.height),
  );
  context.drawImage(image, 0, 0);
  const blob = await canvas.convertToBlob({
    type: "image/jpeg",
    quality: JPEG_QUALITY,
  });
  return { bitmap: canvas.transferToImageBitmap(), blob };
}

export const BROWSER_RENDER_PORTS: RenderPorts = {
  decode: (source, options) =>
    options ? createImageBitmap(source, options) : createImageBitmap(source),
  resize: (image, options) => createImageBitmap(image, options),
  orient: orientOnCanvas,
};

function hasResize(options: ImageBitmapOptions): boolean {
  return (
    options.resizeWidth !== undefined || options.resizeHeight !== undefined
  );
}

async function decodeWith(
  source: Blob,
  options: ImageBitmapOptions,
  ports: RenderPorts,
): Promise<ImageBitmap> {
  try {
    return await ports.decode(source, options);
  } catch (error) {
    if (hasResize(options)) {
      throw error;
    }
    return ports.decode(source);
  }
}

async function shrink(
  image: ImageBitmap,
  maxSide: number,
  ports: RenderPorts,
): Promise<ImageBitmap> {
  const target = fitWithin(image.width, image.height, maxSide);
  if (!target) {
    return image;
  }
  try {
    return await ports.resize(image, {
      resizeWidth: target.width,
      resizeHeight: target.height,
      resizeQuality: "high",
    });
  } finally {
    image.close();
  }
}

export async function renderImage(
  source: Blob,
  plan: RenderPlan,
  ports: RenderPorts,
): Promise<RenderedImage> {
  const decoded = await decodeWith(source, plan.decode, ports);
  if (decoded.width <= 0 || decoded.height <= 0) {
    decoded.close();
    throw new Error("画像の大きさを読み取れませんでした");
  }
  const resized = hasResize(plan.decode);
  let image = await shrink(decoded, plan.maxSide, ports);
  let blob: Blob | null = null;
  if (plan.encode && (plan.orientation !== 1 || resized || image !== decoded)) {
    let oriented: OrientedImage;
    try {
      oriented = await ports.orient(image, plan.orientation);
    } finally {
      image.close();
    }
    image = oriented.bitmap;
    blob = oriented.blob;
  }
  const aspect = image.width / image.height;
  const tile = await shrink(image, plan.tileSize, ports);
  return { tile, blob, aspect };
}
