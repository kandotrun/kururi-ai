import {
  type CanvasTexture,
  NoToneMapping,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  WebGLRenderer,
} from "three";
import type {
  DeskScene,
  DeskSceneEvents,
  DeskSceneOptions,
  NewPrint,
  Quarter,
  ScreenPoint,
} from "../contracts";
import {
  cellSlot,
  matHalfSize,
  mosaicBounds,
  spiralCell,
} from "../core/layout";
import { mulberry32 } from "../core/random";
import { DESKTOP_ATLAS, LOW_POWER_ATLAS, PrintAtlas } from "./atlas";
import { CameraDirector } from "./camera-director";
import { DeskInput } from "./input";
import {
  type MarkTexture,
  createDigitTexture,
  createMarkTexture,
} from "./mark-texture";
import { type DeskMat, createMat } from "./mat";
import { PALETTE } from "./palette";
import { DeskPicker } from "./picking";
import {
  type BandExtent,
  PLACED_Y,
  PrintFleet,
  type PrintEntry,
} from "./print-fleet";
import { type PrintUniforms, createPrintUniforms } from "./print-material";
import { PrintPages } from "./print-pages";
import { createSharedUniforms } from "./uniforms";

export class WebGLUnavailableError extends Error {
  constructor(message = "WebGL2 is unavailable") {
    super(message);
    this.name = "WebGLUnavailableError";
  }
}

export interface DeskSceneStats {
  prints: number;
  active: number;
  drawCalls: number;
  renderMs: number;
  frames: number;
  pixelRatio: number;
  mode: string;
}

type HoverHandler = DeskSceneEvents["hover"];
type SelectHandler = DeskSceneEvents["select"];

const DESKTOP_CAPACITY = 3200;
const LOW_POWER_CAPACITY = 900;
const DESKTOP_TILE = 120;
const LOW_POWER_TILE = 96;
const HOVER_LIFT = 0.085;
const SLOW_FRAME_MS = 22;
const SLOW_WINDOW_SECONDS = 2;
const REDUCED_PIXEL_RATIO = 1.25;
const MAX_FRAME_STEP = 0.1;

function clock(): number {
  return performance.now() / 1000;
}

function createContext(canvas: HTMLCanvasElement): WebGL2RenderingContext {
  let context: WebGL2RenderingContext | null = null;
  try {
    context = canvas.getContext("webgl2", {
      antialias: true,
      alpha: false,
      depth: true,
      stencil: false,
      premultipliedAlpha: true,
      powerPreference: "high-performance",
      preserveDrawingBuffer: false,
    });
  } catch {
    context = null;
  }
  if (!context) {
    throw new WebGLUnavailableError();
  }
  return context;
}

function closeImage(image: ImageBitmap): void {
  try {
    image.close();
  } catch {
    return;
  }
}

class SortingDesk implements DeskScene {
  readonly capacity: number;
  readonly tileSize: number;
  private readonly canvas: HTMLCanvasElement;
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(32, 1.6, 0.5, 400);
  private readonly director: CameraDirector;
  private readonly picker: DeskPicker;
  private readonly shared = createSharedUniforms();
  private readonly printUniforms: PrintUniforms;
  private readonly atlas: PrintAtlas;
  private readonly pages: PrintPages;
  private readonly fleet: PrintFleet;
  private readonly mark: MarkTexture;
  private readonly digits: CanvasTexture;
  private readonly mat: DeskMat;
  private readonly input: DeskInput;
  private readonly resizeObserver: ResizeObserver | null;
  private readonly epoch = clock();
  private readonly band: BandExtent = {
    count: 0,
    minX: 0,
    maxX: 0,
    minZ: 0,
    maxZ: 0,
  };
  private readonly hoverHandlers = new Set<HoverHandler>();
  private readonly selectHandlers = new Set<SelectHandler>();
  private readonly onContextLost: (event: Event) => void;
  private readonly onVisibility: () => void;
  private reduced: boolean;
  private started = false;
  private disposed = false;
  private lost = false;
  private frameHandle = 0;
  private cueTimer: ReturnType<typeof setTimeout> | null = null;
  private lastFrame = 0;
  private frameCount = 0;
  private slowSince = -1;
  private pixelRatio: number;
  private viewWidth = 1;
  private viewHeight = 1;
  private pointerInside = false;
  private pointerX = 0;
  private pointerY = 0;
  private hovered: PrintEntry | null = null;
  private selected: PrintEntry | null = null;
  private focused: PrintEntry | null = null;
  private hoverAAmount = 0;
  private hoverBAmount = 0;
  private focusAmount = 0;
  private renderMs = 0;
  private framesRendered = 0;

  constructor(canvas: HTMLCanvasElement, options: DeskSceneOptions) {
    this.canvas = canvas;
    this.reduced = options.reducedMotion;
    const lowPower = options.lowPower;
    this.capacity = lowPower ? LOW_POWER_CAPACITY : DESKTOP_CAPACITY;
    this.tileSize = lowPower ? LOW_POWER_TILE : DESKTOP_TILE;
    const context = createContext(canvas);
    try {
      this.renderer = new WebGLRenderer({
        canvas,
        context,
        antialias: true,
        powerPreference: "high-performance",
      });
    } catch (error) {
      throw new WebGLUnavailableError(
        error instanceof Error ? error.message : undefined,
      );
    }
    const renderer = this.renderer;
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = NoToneMapping;
    renderer.setClearColor(PALETTE.matDeep, 1);
    const devicePixelRatio =
      typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
    this.pixelRatio = Math.min(devicePixelRatio, lowPower ? 1.75 : 2);
    renderer.setPixelRatio(this.pixelRatio);
    this.director = new CameraDirector(this.camera, this.reduced);
    this.picker = new DeskPicker(this.camera);
    this.mark = createMarkTexture(() => this.wake());
    this.digits = createDigitTexture();
    this.printUniforms = createPrintUniforms(this.shared, this.mark.texture);
    const halfSize = matHalfSize(this.capacity);
    this.director.setMaxDistance(halfSize * 5);
    this.mat = createMat(this.shared, halfSize, this.digits);
    this.scene.add(this.mat.mesh);
    this.atlas = new PrintAtlas(
      renderer,
      lowPower ? LOW_POWER_ATLAS : DESKTOP_ATLAS,
    );
    this.pages = new PrintPages({
      scene: this.scene,
      atlas: this.atlas,
      printUniforms: this.printUniforms,
      segments: lowPower ? 4 : 8,
    });
    this.fleet = new PrintFleet({
      pages: this.pages,
      atlas: this.atlas,
      random: mulberry32(20260521),
      now: () => this.now(),
      wake: () => this.wake(),
      reducedMotion: this.reduced,
    });
    this.input = new DeskInput(canvas, {
      hover: (x, y) => {
        this.pointerInside = true;
        this.pointerX = x;
        this.pointerY = y;
        this.updateHover(true);
        this.wake();
      },
      leave: () => {
        this.pointerInside = false;
        this.setHovered(null, true);
        this.wake();
      },
      tap: (x, y) => this.tap(x, y),
      orbit: (dx, dy) => {
        this.director.orbit(dx, dy, this.now());
        this.wake();
      },
      pan: (dx, dy) => {
        this.director.pan(dx, dy, this.now());
        this.wake();
      },
      zoom: (factor) => {
        this.director.zoom(factor, this.now());
        this.wake();
      },
      reset: () => {
        this.director.resetToAuto();
        if (this.selected) {
          this.selected = null;
          this.emitSelect(null);
        }
        this.wake();
      },
      parallax: (x, y) => {
        this.director.pointer(x, y);
        this.wake();
      },
    });
    canvas.style.touchAction = "none";
    this.onContextLost = (event: Event) => {
      event.preventDefault();
      this.handleContextLost();
    };
    canvas.addEventListener("webglcontextlost", this.onContextLost);
    this.onVisibility = () => this.wake();
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", this.onVisibility);
    }
    this.resizeObserver =
      typeof ResizeObserver === "function"
        ? new ResizeObserver(() => this.resize())
        : null;
    this.resizeObserver?.observe(canvas);
    this.resize();
  }

  start(): void {
    if (this.started || this.disposed) {
      return;
    }
    this.started = true;
    this.wake();
  }

  addPrint(print: NewPrint): Promise<void> {
    if (this.disposed) {
      closeImage(print.image);
      return Promise.resolve();
    }
    if (this.fleet.get(print.id)) {
      closeImage(print.image);
      return Promise.reject(new Error(`print ${print.id} already exists`));
    }
    if (this.fleet.size >= this.capacity) {
      closeImage(print.image);
      return Promise.reject(new Error("the desk is full"));
    }
    let landed: Promise<void>;
    try {
      landed = this.fleet.add(print);
    } catch (error) {
      return Promise.reject(
        error instanceof Error ? error : new Error(String(error)),
      );
    } finally {
      closeImage(print.image);
    }
    this.wake();
    return landed;
  }

  setScanning(id: string, scanning: boolean): void {
    const entry = this.entry(id);
    if (entry) {
      this.fleet.setScanning(entry, scanning);
      this.wake();
    }
  }

  decide(id: string, correction: Quarter): void {
    const entry = this.entry(id);
    if (entry) {
      this.fleet.decide(entry, correction);
      this.wake();
    }
  }

  place(id: string, slot: number): Promise<void> {
    const entry = this.entry(id);
    if (!entry) {
      return Promise.resolve();
    }
    const placed = this.fleet.place(entry, slot);
    this.wake();
    return placed;
  }

  removePrint(id: string): void {
    const entry = this.entry(id);
    if (!entry) {
      return;
    }
    this.fleet.remove(entry);
    if (this.hovered === entry) {
      this.setHovered(null, true);
    }
    if (this.selected === entry) {
      this.selected = null;
      this.emitSelect(null);
    }
    if (this.focused === entry) {
      this.focused = null;
    }
    this.wake();
  }

  scatterAll(): Promise<void> {
    if (this.disposed) {
      return Promise.resolve();
    }
    const run = this.fleet.scatterAll();
    this.wake();
    return run;
  }

  focus(id: string | null): void {
    if (this.disposed) {
      return;
    }
    this.focused = id === null ? null : (this.fleet.get(id) ?? null);
    this.wake();
  }

  select(id: string | null): void {
    if (this.disposed) {
      return;
    }
    this.selected = id === null ? null : (this.fleet.get(id) ?? null);
    this.wake();
  }

  screenPosition(id: string): ScreenPoint | null {
    const entry = this.entry(id);
    if (!entry || this.viewWidth <= 1) {
      return null;
    }
    return this.picker.project(
      entry.pose.x,
      entry.pose.y + this.hoverLift(entry),
      entry.pose.z,
      this.viewWidth,
      this.viewHeight,
    );
  }

  setReducedMotion(reduced: boolean): void {
    this.reduced = reduced;
    this.director.setReducedMotion(reduced);
    this.fleet.setReducedMotion(reduced);
    this.wake();
  }

  on<K extends keyof DeskSceneEvents>(
    event: K,
    handler: DeskSceneEvents[K],
  ): () => void {
    if (event === "hover") {
      const hover = handler as HoverHandler;
      this.hoverHandlers.add(hover);
      return () => {
        this.hoverHandlers.delete(hover);
      };
    }
    const select = handler as SelectHandler;
    this.selectHandlers.add(select);
    return () => {
      this.selectHandlers.delete(select);
    };
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.clearCue();
    if (this.frameHandle) {
      cancelAnimationFrame(this.frameHandle);
      this.frameHandle = 0;
    }
    this.fleet.dispose();
    this.input.dispose();
    this.resizeObserver?.disconnect();
    this.canvas.removeEventListener("webglcontextlost", this.onContextLost);
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.onVisibility);
    }
    this.hoverHandlers.clear();
    this.selectHandlers.clear();
    this.pages.dispose();
    this.atlas.dispose();
    this.mat.dispose();
    this.mark.dispose();
    this.digits.dispose();
    this.scene.clear();
    this.renderer.dispose();
  }

  debugProject(x: number, y: number, z: number): ScreenPoint | null {
    if (this.viewWidth <= 1) {
      return null;
    }
    return this.picker.project(x, y, z, this.viewWidth, this.viewHeight);
  }

  debugStats(): DeskSceneStats {
    return {
      prints: this.fleet.size,
      active: this.fleet.activeCount,
      drawCalls: this.renderer.info.render.calls,
      renderMs:
        this.framesRendered > 0 ? this.renderMs / this.framesRendered : 0,
      frames: this.framesRendered,
      pixelRatio: this.pixelRatio,
      mode: this.director.mode,
    };
  }

  private now(): number {
    return clock() - this.epoch;
  }

  private entry(id: string): PrintEntry | undefined {
    return this.disposed ? undefined : this.fleet.get(id);
  }

  private hoverLift(entry: PrintEntry): number {
    return this.hovered === entry ? HOVER_LIFT * this.hoverAAmount : 0;
  }

  private wake(): void {
    if (!this.started || this.disposed || this.lost || this.frameHandle !== 0) {
      return;
    }
    this.clearCue();
    this.frameHandle = requestAnimationFrame(() => this.frame());
  }

  private frame(): void {
    this.frameHandle = 0;
    if (this.disposed || this.lost) {
      return;
    }
    const began = performance.now();
    const now = this.now();
    const elapsed = this.lastFrame > 0 ? now - this.lastFrame : -1;
    const dt = elapsed >= 0 ? Math.min(MAX_FRAME_STEP, elapsed) : 1 / 60;
    this.lastFrame = now;
    this.frameCount += 1;
    const fleet = this.fleet;
    fleet.step(now);
    const hoverBusy = this.stepHighlights(dt);
    const cameraBusy = this.stepCamera(now, dt);
    this.updateUniforms(now);
    if (
      this.pointerInside &&
      (cameraBusy || fleet.activeCount > 0) &&
      this.frameCount % 3 === 0
    ) {
      this.updateHover(false);
    }
    const atlasPending = this.atlas.flush(now);
    this.pages.flush();
    this.renderer.render(this.scene, this.camera);
    this.renderMs += performance.now() - began;
    this.framesRendered += 1;
    this.adaptPixelRatio(now, elapsed);
    const busy =
      fleet.activeCount > 0 ||
      fleet.scanningCount > 0 ||
      cameraBusy ||
      hoverBusy ||
      atlasPending ||
      now < fleet.effectsUntil;
    if (busy) {
      this.wake();
    } else {
      this.lastFrame = 0;
      this.scheduleCue(now);
    }
  }

  private scheduleCue(now: number): void {
    this.clearCue();
    const wait = this.director.secondsUntilNextCue(
      now,
      this.fleet.placedCount,
      this.fleet.lastPlacedAt,
    );
    if (wait === null) {
      return;
    }
    this.cueTimer = setTimeout(
      () => {
        this.cueTimer = null;
        this.wake();
      },
      wait * 1000 + 40,
    );
  }

  private clearCue(): void {
    if (this.cueTimer !== null) {
      clearTimeout(this.cueTimer);
      this.cueTimer = null;
    }
  }

  private stepHighlights(dt: number): boolean {
    const blend = 1 - Math.exp(-(this.reduced ? 30 : 9) * dt);
    const goalA = this.hovered ? 1 : 0;
    this.hoverAAmount += (goalA - this.hoverAAmount) * blend;
    this.hoverBAmount -= this.hoverBAmount * blend;
    const focusTarget = this.focusEntry();
    const goalFocus = focusTarget ? 1 : 0;
    this.focusAmount +=
      (goalFocus - this.focusAmount) * (1 - Math.exp(-4 * dt));
    const uniforms = this.printUniforms;
    uniforms.uHoverAAmount.value = this.hoverAAmount;
    uniforms.uHoverBAmount.value = this.hoverBAmount;
    uniforms.uFocusAmount.value = this.focusAmount;
    if (focusTarget) {
      uniforms.uFocusIndex.value = focusTarget.index;
    }
    return (
      Math.abs(goalA - this.hoverAAmount) > 0.003 ||
      this.hoverBAmount > 0.003 ||
      Math.abs(goalFocus - this.focusAmount) > 0.003
    );
  }

  private focusEntry(): PrintEntry | null {
    const target = this.focused ?? this.selected;
    return target && this.fleet.has(target) ? target : null;
  }

  private stepCamera(now: number, dt: number): boolean {
    const fleet = this.fleet;
    const band = fleet.bandExtent(this.band);
    const front = spiralCell(fleet.highestSlot + 1);
    const focus = this.focusEntry();
    return this.director.update({
      now,
      dt,
      frontX: front.x,
      frontZ: front.z,
      bandMinX: band.minX,
      bandMaxX: band.maxX,
      bandMinZ: band.minZ,
      bandMaxZ: band.maxZ,
      bandCount: band.count,
      prints: fleet.size,
      placed: fleet.placedCount,
      lastPlacedAt: fleet.lastPlacedAt,
      bounds: mosaicBounds(Math.max(1, fleet.highestSlot + 1)),
      focusX: focus ? focus.pose.x : 0,
      focusZ: focus ? focus.pose.z : 0,
      hasFocus: focus !== null,
      holdWide: fleet.scattering,
      viewWidth: this.viewWidth,
      viewHeight: this.viewHeight,
    });
  }

  private updateUniforms(now: number): void {
    const shared = this.shared;
    const director = this.director;
    const distance = director.distance;
    const radius = director.frameRadius;
    const x = director.targetX;
    const z = director.targetZ;
    shared.uTime.value = now;
    shared.uCameraPos.value.copy(this.camera.position);
    shared.uLampPos.value.set(
      x - distance * 0.2,
      distance * 0.72,
      z - distance * 0.16,
    );
    shared.uLampRadius.value = radius * 0.95;
    shared.uLampCenter.value.set(x - radius * 0.22, z - radius * 0.16);
    shared.uFogCenter.value.set(x, z - radius * 0.1);
    shared.uFogRange.value.set(radius * 0.95, radius * 2.3);
    this.printUniforms.uSoftbox.value.set(distance * 0.13, distance * 0.075);
  }

  private updateHover(fromPointer: boolean): void {
    if (this.pointerInside) {
      this.setHovered(this.pick(this.pointerX, this.pointerY), fromPointer);
    }
  }

  private setHovered(entry: PrintEntry | null, fromPointer: boolean): void {
    const previous = this.hovered;
    if (previous === entry) {
      if (entry && fromPointer) {
        this.emitHover(entry);
      }
      return;
    }
    const uniforms = this.printUniforms;
    if (previous) {
      uniforms.uHoverB.value = previous.index;
      this.hoverBAmount = this.hoverAAmount;
    }
    uniforms.uHoverA.value = entry ? entry.index : -1;
    this.hoverAAmount = 0;
    this.hovered = entry;
    this.emitHover(entry);
    this.wake();
  }

  private emitHover(entry: PrintEntry | null): void {
    const at = entry ? { x: this.pointerX, y: this.pointerY } : null;
    for (const handler of this.hoverHandlers) {
      handler(entry ? entry.id : null, at);
    }
  }

  private emitSelect(id: string | null): void {
    for (const handler of this.selectHandlers) {
      handler(id);
    }
  }

  private tap(x: number, y: number): void {
    this.pointerX = x;
    this.pointerY = y;
    const entry = this.pick(x, y);
    this.selected = entry;
    if (entry) {
      this.director.resetToAuto();
    }
    this.emitSelect(entry ? entry.id : null);
    this.wake();
  }

  private pick(x: number, y: number): PrintEntry | null {
    this.camera.updateMatrixWorld();
    const picker = this.picker;
    picker.aim(x, y, this.viewWidth, this.viewHeight);
    let best: PrintEntry | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const entry of this.fleet.loosePrints()) {
      const distance = picker.distanceTo(entry, this.hoverLift(entry));
      if (distance >= 0 && distance < bestDistance) {
        best = entry;
        bestDistance = distance;
      }
    }
    if (best || !picker.plane(PLACED_Y)) {
      return best;
    }
    const candidate = this.fleet.placedAt(cellSlot(picker.hitX, picker.hitZ));
    if (!candidate) {
      return null;
    }
    return picker.distanceTo(candidate, this.hoverLift(candidate)) >= 0
      ? candidate
      : null;
  }

  private resize(): void {
    if (this.disposed) {
      return;
    }
    const width = Math.max(1, Math.round(this.canvas.clientWidth));
    const height = Math.max(1, Math.round(this.canvas.clientHeight));
    if (width === this.viewWidth && height === this.viewHeight) {
      return;
    }
    this.viewWidth = width;
    this.viewHeight = height;
    if (!this.lost) {
      this.renderer.setSize(width, height, false);
    }
    this.syncViewport();
    this.wake();
  }

  private syncViewport(): void {
    this.renderer.getDrawingBufferSize(this.shared.uViewport.value);
  }

  private adaptPixelRatio(now: number, elapsed: number): void {
    const intervalMs = elapsed * 1000;
    const continuous = elapsed >= 0 && intervalMs < 250;
    if (!continuous || this.pixelRatio <= REDUCED_PIXEL_RATIO) {
      this.slowSince = -1;
      return;
    }
    if (intervalMs <= SLOW_FRAME_MS) {
      this.slowSince = -1;
      return;
    }
    if (this.slowSince < 0) {
      this.slowSince = now;
      return;
    }
    if (now - this.slowSince > SLOW_WINDOW_SECONDS) {
      this.pixelRatio = REDUCED_PIXEL_RATIO;
      this.renderer.setPixelRatio(this.pixelRatio);
      this.renderer.setSize(this.viewWidth, this.viewHeight, false);
      this.syncViewport();
      this.slowSince = -1;
    }
  }

  private handleContextLost(): void {
    if (this.lost) {
      return;
    }
    this.lost = true;
    this.atlas.markLost();
    this.fleet.markLost();
    this.clearCue();
    if (this.frameHandle) {
      cancelAnimationFrame(this.frameHandle);
      this.frameHandle = 0;
    }
  }
}

export function createDeskScene(
  canvas: HTMLCanvasElement,
  options: DeskSceneOptions,
): DeskScene {
  return new SortingDesk(canvas, options);
}

export function deskSceneStats(scene: DeskScene): DeskSceneStats | null {
  return scene instanceof SortingDesk ? scene.debugStats() : null;
}

export function deskSceneProject(
  scene: DeskScene,
  x: number,
  y: number,
  z: number,
): ScreenPoint | null {
  return scene instanceof SortingDesk ? scene.debugProject(x, y, z) : null;
}
