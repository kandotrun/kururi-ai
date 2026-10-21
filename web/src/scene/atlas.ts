import { ExternalTexture, type WebGLRenderer } from "three";

export interface AtlasSpec {
  cellWidth: number;
  cellHeight: number;
  gutter: number;
  columns: number;
  rows: number;
}

export interface AtlasRect {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
  rotated: boolean;
  aspect: number;
}

interface AtlasPage {
  glTexture: WebGLTexture | null;
  texture: ExternalTexture;
  dirty: boolean;
  lastMipmap: number;
}

type StagingCanvas = HTMLCanvasElement | OffscreenCanvas;
type StagingContext =
  CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

const MIPMAP_INTERVAL = 0.25;
const MAX_ANISOTROPY = 8;

export const DESKTOP_ATLAS: AtlasSpec = {
  cellWidth: 128,
  cellHeight: 80,
  gutter: 4,
  columns: 16,
  rows: 25,
};

export const LOW_POWER_ATLAS: AtlasSpec = {
  cellWidth: 96,
  cellHeight: 64,
  gutter: 4,
  columns: 16,
  rows: 25,
};

export function cellsPerPage(spec: AtlasSpec): number {
  return spec.columns * spec.rows;
}

function createStaging(width: number, height: number): StagingCanvas {
  if (typeof OffscreenCanvas === "function") {
    return new OffscreenCanvas(width, height);
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function stagingContext(canvas: StagingCanvas): StagingContext {
  const context = canvas.getContext("2d", { alpha: false });
  if (!context || !("drawImage" in context) || !("setTransform" in context)) {
    throw new Error("atlas staging canvas is unavailable");
  }
  return context;
}

export class PrintAtlas {
  readonly spec: AtlasSpec;
  readonly pageWidth: number;
  readonly pageHeight: number;
  private readonly renderer: WebGLRenderer;
  private readonly gl: WebGL2RenderingContext;
  private readonly pages: AtlasPage[] = [];
  private readonly staging: StagingCanvas;
  private readonly context: StagingContext;
  private readonly anisotropy: number;
  private lost = false;

  constructor(renderer: WebGLRenderer, spec: AtlasSpec) {
    this.renderer = renderer;
    this.gl = renderer.getContext() as WebGL2RenderingContext;
    this.spec = spec;
    this.pageWidth = spec.cellWidth * spec.columns;
    this.pageHeight = spec.cellHeight * spec.rows;
    this.staging = createStaging(spec.cellWidth, spec.cellHeight);
    this.context = stagingContext(this.staging);
    const extension = this.gl.getExtension("EXT_texture_filter_anisotropic");
    this.anisotropy = extension
      ? Math.min(
          MAX_ANISOTROPY,
          this.gl.getParameter(
            extension.MAX_TEXTURE_MAX_ANISOTROPY_EXT,
          ) as number,
        )
      : 0;
  }

  markLost(): void {
    this.lost = true;
  }

  page(index: number): ExternalTexture {
    const existing = this.pages[index];
    if (existing) {
      return existing.texture;
    }
    for (let page = this.pages.length; page <= index; page += 1) {
      this.pages.push(this.allocate());
    }
    const created = this.pages[index];
    if (!created) {
      throw new Error("atlas page allocation failed");
    }
    return created.texture;
  }

  write(globalCell: number, image: CanvasImageSource, now: number): AtlasRect {
    const perPage = cellsPerPage(this.spec);
    const pageIndex = Math.floor(globalCell / perPage);
    const cell = globalCell % perPage;
    this.page(pageIndex);
    const page = this.pages[pageIndex];
    const { cellWidth, cellHeight, gutter, columns } = this.spec;
    const column = cell % columns;
    const row = Math.floor(cell / columns);
    const originX = column * cellWidth;
    const originY = row * cellHeight;
    const sourceWidth = imageWidth(image);
    const sourceHeight = imageHeight(image);
    const rotated = sourceHeight > sourceWidth;
    const longSide = Math.max(sourceWidth, sourceHeight, 1);
    const shortSide = Math.max(Math.min(sourceWidth, sourceHeight), 1);
    const contentWidth = cellWidth - gutter * 2;
    const contentHeight = cellHeight - gutter * 2;
    const scale = Math.min(contentWidth / longSide, contentHeight / shortSide);
    const drawWidth = Math.max(1, Math.round(longSide * scale));
    const drawHeight = Math.max(1, Math.round(shortSide * scale));
    const offsetX = gutter + Math.floor((contentWidth - drawWidth) / 2);
    const offsetY = gutter + Math.floor((contentHeight - drawHeight) / 2);
    const context = this.context;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.fillStyle = "#7f8580";
    context.fillRect(0, 0, cellWidth, cellHeight);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    try {
      this.drawFitted(
        image,
        rotated,
        offsetX - gutter,
        offsetY - gutter,
        drawWidth + gutter * 2,
        drawHeight + gutter * 2,
      );
      this.drawFitted(image, rotated, offsetX, offsetY, drawWidth, drawHeight);
    } catch {
      context.setTransform(1, 0, 0, 1, 0, 0);
    }
    context.setTransform(1, 0, 0, 1, 0, 0);
    if (page && page.glTexture && !this.lost) {
      const gl = this.gl;
      this.renderer.state.bindTexture(gl.TEXTURE_2D, page.glTexture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
      gl.texSubImage2D(
        gl.TEXTURE_2D,
        0,
        originX,
        originY,
        cellWidth,
        cellHeight,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        this.staging,
      );
      page.dirty = true;
      if (now - page.lastMipmap >= MIPMAP_INTERVAL) {
        this.regenerate(page, now);
      }
    }
    return {
      u0: (originX + offsetX) / this.pageWidth,
      v0: (originY + offsetY) / this.pageHeight,
      u1: (originX + offsetX + drawWidth) / this.pageWidth,
      v1: (originY + offsetY + drawHeight) / this.pageHeight,
      rotated,
      aspect:
        sourceWidth > 0 && sourceHeight > 0 ? sourceWidth / sourceHeight : 1,
    };
  }

  readyTime(now: number, globalCell: number): number {
    const page = this.pages[Math.floor(globalCell / cellsPerPage(this.spec))];
    if (!page) {
      return now;
    }
    return Math.max(now, page.lastMipmap + MIPMAP_INTERVAL) + 0.05;
  }

  flush(now: number): boolean {
    let pending = false;
    for (const page of this.pages) {
      if (!page.dirty) {
        continue;
      }
      if (now - page.lastMipmap >= MIPMAP_INTERVAL) {
        this.regenerate(page, now);
      } else {
        pending = true;
      }
    }
    return pending;
  }

  dispose(): void {
    for (const page of this.pages) {
      page.texture.dispose();
      if (!this.lost && page.glTexture) {
        this.gl.deleteTexture(page.glTexture);
      }
    }
    this.pages.length = 0;
  }

  private drawFitted(
    image: CanvasImageSource,
    rotated: boolean,
    x: number,
    y: number,
    width: number,
    height: number,
  ): void {
    const context = this.context;
    if (!rotated) {
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.drawImage(image, x, y, width, height);
      return;
    }
    context.setTransform(0, 1, -1, 0, x + width, y);
    context.drawImage(image, 0, 0, height, width);
  }

  private regenerate(page: AtlasPage, now: number): void {
    if (this.lost || !page.glTexture) {
      page.dirty = false;
      return;
    }
    const gl = this.gl;
    this.renderer.state.bindTexture(gl.TEXTURE_2D, page.glTexture);
    gl.generateMipmap(gl.TEXTURE_2D);
    page.dirty = false;
    page.lastMipmap = now;
  }

  private allocate(): AtlasPage {
    const gl = this.gl;
    const glTexture = this.lost ? null : gl.createTexture();
    if (!glTexture) {
      return {
        glTexture: null,
        texture: new ExternalTexture(null),
        dirty: false,
        lastMipmap: Number.NEGATIVE_INFINITY,
      };
    }
    this.renderer.state.bindTexture(gl.TEXTURE_2D, glTexture);
    const levels =
      Math.floor(Math.log2(Math.max(this.pageWidth, this.pageHeight))) + 1;
    gl.texStorage2D(
      gl.TEXTURE_2D,
      levels,
      gl.SRGB8_ALPHA8,
      this.pageWidth,
      this.pageHeight,
    );
    gl.texParameteri(
      gl.TEXTURE_2D,
      gl.TEXTURE_MIN_FILTER,
      gl.LINEAR_MIPMAP_LINEAR,
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (this.anisotropy > 1) {
      gl.texParameterf(gl.TEXTURE_2D, 0x84fe, this.anisotropy);
    }
    return {
      glTexture,
      texture: new ExternalTexture(glTexture),
      dirty: false,
      lastMipmap: Number.NEGATIVE_INFINITY,
    };
  }
}

function imageWidth(image: CanvasImageSource): number {
  if ("displayWidth" in image) {
    return image.displayWidth;
  }
  if (image instanceof HTMLImageElement) {
    return image.naturalWidth;
  }
  if ("width" in image) {
    const value = image.width;
    return typeof value === "number" ? value : value.baseVal.value;
  }
  return 1;
}

function imageHeight(image: CanvasImageSource): number {
  if ("displayHeight" in image) {
    return image.displayHeight;
  }
  if (image instanceof HTMLImageElement) {
    return image.naturalHeight;
  }
  if ("height" in image) {
    const value = image.height;
    return typeof value === "number" ? value : value.baseVal.value;
  }
  return 1;
}
