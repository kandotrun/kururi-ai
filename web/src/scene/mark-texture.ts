import {
  CanvasTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  NoColorSpace,
  SRGBColorSpace,
} from "three";
import markFontUrl from "@fontsource/shippori-mincho-b1/files/shippori-mincho-b1-113-800-normal.woff2?url";
import { mulberry32, range } from "../core/random";
import { PALETTE } from "./palette";

const MARK_SIZE = 256;
const MARK_FAMILY = "KururiMark";
const MARK_FALLBACK =
  "'Shippori Mincho B1', 'Hiragino Mincho ProN', 'Yu Mincho', 'Noto Serif JP', serif";
const DIGIT_CELL = 64;

export interface MarkTexture {
  readonly texture: CanvasTexture;
  dispose(): void;
}

function createCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function drawMark(canvas: HTMLCanvasElement, family: string): void {
  const context = canvas.getContext("2d");
  if (!context) {
    return;
  }
  const random = mulberry32(1187);
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, MARK_SIZE, MARK_SIZE);
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.font = `800 196px ${family}`;
  context.fillStyle = PALETTE.marker;
  context.strokeStyle = PALETTE.marker;
  context.lineJoin = "round";
  context.lineCap = "round";
  for (let pass = 0; pass < 7; pass += 1) {
    const x = MARK_SIZE / 2 + range(random, -2.4, 2.4);
    const y = MARK_SIZE / 2 + 10 + range(random, -2.4, 2.4);
    context.globalAlpha = pass === 0 ? 1 : 0.4;
    context.lineWidth = pass === 0 ? 9 : range(random, 4, 11);
    context.strokeText("天", x, y);
    context.fillText("天", x, y);
  }
  context.globalAlpha = 1;
  context.globalCompositeOperation = "destination-out";
  for (let streak = 0; streak < 46; streak += 1) {
    const x = range(random, 20, MARK_SIZE - 20);
    const y = range(random, 20, MARK_SIZE - 20);
    const length = range(random, 8, 34);
    const angle = range(random, -0.5, -0.2);
    context.globalAlpha = range(random, 0.18, 0.55);
    context.lineWidth = range(random, 0.6, 1.6);
    context.beginPath();
    context.moveTo(x, y);
    context.lineTo(x + Math.cos(angle) * length, y + Math.sin(angle) * length);
    context.stroke();
  }
  for (let speck = 0; speck < 900; speck += 1) {
    context.globalAlpha = range(random, 0.25, 0.85);
    context.beginPath();
    context.arc(
      range(random, 0, MARK_SIZE),
      range(random, 0, MARK_SIZE),
      range(random, 0.4, 1.4),
      0,
      Math.PI * 2,
    );
    context.fill();
  }
  context.globalCompositeOperation = "source-atop";
  context.fillStyle = "#F2826F";
  for (let grain = 0; grain < 500; grain += 1) {
    context.globalAlpha = range(random, 0.12, 0.38);
    context.fillRect(
      range(random, 0, MARK_SIZE),
      range(random, 0, MARK_SIZE),
      range(random, 1, 3),
      range(random, 0.6, 1.4),
    );
  }
  context.globalCompositeOperation = "source-over";
  context.globalAlpha = 1;
}

export function createMarkTexture(onChange: () => void): MarkTexture {
  const canvas = createCanvas(MARK_SIZE, MARK_SIZE);
  drawMark(canvas, MARK_FALLBACK);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.flipY = false;
  texture.generateMipmaps = true;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.magFilter = LinearFilter;
  texture.anisotropy = 4;
  let disposed = false;
  if (typeof FontFace === "function" && typeof document !== "undefined") {
    const face = new FontFace(MARK_FAMILY, `url(${markFontUrl})`, {
      weight: "800",
      style: "normal",
    });
    face
      .load()
      .then((loaded) => {
        if (disposed) {
          return;
        }
        document.fonts.add(loaded);
        drawMark(canvas, `${MARK_FAMILY}, ${MARK_FALLBACK}`);
        texture.needsUpdate = true;
        onChange();
      })
      .catch(() => undefined);
  }
  return {
    texture,
    dispose() {
      disposed = true;
      texture.dispose();
    },
  };
}

export function createDigitTexture(): CanvasTexture {
  const canvas = createCanvas(DIGIT_CELL * 10, DIGIT_CELL);
  const context = canvas.getContext("2d");
  if (context) {
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#FFFFFF";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.font =
      "500 50px 'Hiragino Sans', 'Helvetica Neue', Arial, system-ui, sans-serif";
    for (let digit = 0; digit < 10; digit += 1) {
      context.fillText(String(digit), digit * DIGIT_CELL + DIGIT_CELL / 2, 35);
    }
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = NoColorSpace;
  texture.flipY = false;
  texture.generateMipmaps = true;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.magFilter = LinearFilter;
  texture.anisotropy = 4;
  return texture;
}
