import {
  ClampToEdgeWrapping,
  LinearFilter,
  LinearMipmapLinearFilter,
  NoColorSpace,
  NoToneMapping,
  type PerspectiveCamera,
  RepeatWrapping,
  SRGBColorSpace,
  type Scene,
  Texture,
  type WebGLRenderTarget,
  WebGLRenderer,
} from "three";
import type { GeoPoint } from "../contracts";
import { mulberry32 } from "../core/random";
import {
  type IntroImages,
  closeImages,
  fallbackOrigins,
  loadIntroImages,
} from "./assets";
import {
  type CameraPath,
  type DeskView,
  createCameraPath,
  createCameraPose,
  defaultDeskView,
} from "./camera-path";
import { CityStage } from "./city-stage";
import { easeInOutSine, lerp } from "./easing";
import { createGovernor, initialPixelRatio, type Governor } from "./governor";
import { GlobeStage, type GlobeTextures } from "./globe-stage";
import { planArcs } from "./origins";
import { createCompositeParams, PostPipeline } from "./post";
import { RoomStage } from "./room-stage";
import {
  CLOUD_PASS,
  INTRO_DURATION_MS,
  INTRO_SECONDS,
  type IntroPhase,
  PHASE_STARTS,
  createStageMix,
  stageMix,
} from "./timeline";

export type { IntroPhase } from "./timeline";
export type IntroDeskView = DeskView;

export class IntroUnavailableError extends Error {
  constructor(message = "WebGL2 is unavailable for the intro") {
    super(message);
    this.name = "IntroUnavailableError";
  }
}

export interface IntroOptions {
  container: HTMLElement;
  origins: readonly GeoPoint[];
  target: GeoPoint;
  textureBaseUrl: string;
  lowPower: boolean;
  deskView?: IntroDeskView | ((aspect: number) => IntroDeskView);
}

export interface Intro {
  readonly durationMs: number;
  play(): Promise<void>;
  skip(): void;
  onPhase(handler: (phase: IntroPhase) => void): () => void;
  dispose(): void;
}

export interface IntroDebugOptions {
  manualClock?: boolean;
  speed?: number;
  benchmark?: boolean;
  seed?: number;
}

export interface IntroFrameStats {
  frames: number;
  averageMs: number;
  worstMs: number;
  renderMs: number;
  pixelRatio: number;
  arcs: number;
  buildings: number;
  width: number;
  height: number;
}

export interface IntroController extends Intro {
  readonly ready: Promise<boolean>;
  readonly phase: IntroPhase | null;
  readonly time: number;
  seek(ms: number): void;
  frameStats(): IntroFrameStats;
  resetStats(): void;
}

type StageName = "globe" | "city" | "room";

type State = "idle" | "loading" | "playing" | "fading" | "finished" | "disposed";

const TEXTURE_TIMEOUT_MS = 4000;
const CSS_FADE_MS = 380;
const SKIP_FADE_MS = 360;
const HANDOFF_INDEX = PHASE_STARTS.findIndex(([phase]) => phase === "handoff");

function createContext(canvas: HTMLCanvasElement): WebGL2RenderingContext {
  let context: WebGL2RenderingContext | null = null;
  try {
    context = canvas.getContext("webgl2", {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: "high-performance",
      preserveDrawingBuffer: false,
    });
  } catch {
    context = null;
  }
  if (!context) {
    throw new IntroUnavailableError();
  }
  return context;
}

function viewSize(container: HTMLElement): [number, number] {
  const width = container.clientWidth || window.innerWidth || 1;
  const height = container.clientHeight || window.innerHeight || 1;
  return [width, height];
}

class IntroRuntime implements IntroController {
  readonly durationMs = INTRO_DURATION_MS;
  readonly ready: Promise<boolean>;
  private readonly options: IntroOptions;
  private readonly debug: IntroDebugOptions;
  private readonly canvas: HTMLCanvasElement;
  private readonly gl: WebGL2RenderingContext;
  private readonly renderer: WebGLRenderer;
  private readonly post: PostPipeline;
  private readonly city: CityStage;
  private readonly room: RoomStage;
  private readonly abort = new AbortController();
  private readonly handlers = new Set<(phase: IntroPhase) => void>();
  private readonly pose = createCameraPose();
  private readonly mix = createStageMix();
  private readonly params = createCompositeParams();
  private readonly textures: Texture[] = [];
  private readonly governor: Governor;
  private readonly resizeObserver: ResizeObserver | null;
  private readonly onContextLost: (event: Event) => void;
  private readonly onWindowResize: () => void;
  private readonly probe = new Uint8Array(4);
  private globe: GlobeStage | null = null;
  private images: IntroImages | null = null;
  private path: CameraPath;
  private state: State = "idle";
  private currentTime = 0;
  private lastFrame = 0;
  private frameHandle = 0;
  private timeoutHandle = 0;
  private skipStartedAt: number | null = null;
  private skipRequested = false;
  private phaseIndex = -1;
  private playPromise: Promise<void> | null = null;
  private resolvePlay: (() => void) | null = null;
  private cssWidth = 1;
  private cssHeight = 1;
  private pixelRatio = 1;
  private frames = 0;
  private frameSum = 0;
  private frameWorst = 0;
  private renderSum = 0;
  private arcCount = 0;

  constructor(options: IntroOptions, debug: IntroDebugOptions) {
    this.options = options;
    this.debug = debug;
    const canvas = document.createElement("canvas");
    canvas.className = "intro-canvas";
    canvas.setAttribute("aria-hidden", "true");
    Object.assign(canvas.style, {
      position: "absolute",
      inset: "0",
      width: "100%",
      height: "100%",
      display: "block",
      zIndex: "1",
      pointerEvents: "none",
      background: "#000",
    });
    this.gl = createContext(canvas);
    this.canvas = canvas;
    this.renderer = new WebGLRenderer({
      canvas,
      context: this.gl,
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      powerPreference: "high-performance",
    });
    this.renderer.autoClear = false;
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = NoToneMapping;
    const halfFloat =
      this.renderer.extensions.has("EXT_color_buffer_float") ||
      this.renderer.extensions.has("EXT_color_buffer_half_float");
    this.post = new PostPipeline(this.renderer, {
      halfFloat,
      samples: options.lowPower ? 0 : 4,
      levels: options.lowPower ? 4 : 5,
    });
    const seed = debug.seed ?? 20261021;
    this.city = new CityStage({
      lowPower: options.lowPower,
      random: mulberry32(seed + 1),
    });
    this.room = new RoomStage({
      lowPower: options.lowPower,
      random: mulberry32(seed + 2),
    });
    const [width, height] = viewSize(options.container);
    this.governor = createGovernor(
      initialPixelRatio(window.devicePixelRatio, width, height, options.lowPower),
    );
    this.path = this.buildPath(width / height);
    options.container.appendChild(canvas);
    this.applySize(true);
    this.onContextLost = (event: Event) => {
      event.preventDefault();
      this.contextLost();
    };
    this.onWindowResize = () => this.applySize(false);
    canvas.addEventListener("webglcontextlost", this.onContextLost);
    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(() => this.applySize(false));
      this.resizeObserver.observe(options.container);
    } else {
      this.resizeObserver = null;
      window.addEventListener("resize", this.onWindowResize);
    }
    this.ready = this.prepare(seed);
  }

  get phase(): IntroPhase | null {
    return this.phaseIndex >= 0 ? PHASE_STARTS[this.phaseIndex]![0] : null;
  }

  get time(): number {
    return this.currentTime;
  }

  play(): Promise<void> {
    if (this.playPromise) {
      return this.playPromise;
    }
    this.playPromise = new Promise<void>((resolve) => {
      this.resolvePlay = resolve;
    });
    if (this.state === "disposed") {
      this.settle();
      return this.playPromise;
    }
    if (this.skipRequested) {
      this.fadeOutWithoutRendering();
      return this.playPromise;
    }
    this.state = "loading";
    const timeout = new Promise<boolean>((resolve) => {
      this.timeoutHandle = window.setTimeout(() => resolve(false), TEXTURE_TIMEOUT_MS);
    });
    void Promise.race([this.ready, timeout]).then((ok) => {
      window.clearTimeout(this.timeoutHandle);
      if (this.state !== "loading") {
        return;
      }
      if (ok) {
        this.start();
      } else {
        this.fadeOutWithoutRendering();
      }
    });
    return this.playPromise;
  }

  skip(): void {
    if (this.state === "idle") {
      this.skipRequested = true;
      return;
    }
    if (this.state === "loading") {
      window.clearTimeout(this.timeoutHandle);
      this.fadeOutWithoutRendering();
      return;
    }
    if (this.state === "playing" && this.skipStartedAt === null) {
      this.skipStartedAt = performance.now();
      this.emitThrough(HANDOFF_INDEX);
    }
  }

  onPhase(handler: (phase: IntroPhase) => void): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  seek(ms: number): void {
    if (this.state === "disposed" || this.state === "finished") {
      return;
    }
    this.currentTime = Math.max(0, ms / 1000);
    if (this.state !== "playing") {
      return;
    }
    this.renderFrame(this.currentTime, performance.now());
    this.emitCrossed(Math.min(this.currentTime, INTRO_SECONDS - 1e-6));
  }

  frameStats(): IntroFrameStats {
    return {
      frames: this.frames,
      averageMs: this.frames > 0 ? this.frameSum / this.frames : 0,
      worstMs: this.frameWorst,
      renderMs: this.frames > 0 ? this.renderSum / this.frames : 0,
      pixelRatio: this.pixelRatio,
      arcs: this.arcCount,
      buildings: this.city.buildingCount,
      width: this.cssWidth,
      height: this.cssHeight,
    };
  }

  resetStats(): void {
    this.frames = 0;
    this.frameSum = 0;
    this.frameWorst = 0;
    this.renderSum = 0;
  }

  dispose(): void {
    if (this.state === "disposed") {
      return;
    }
    this.state = "disposed";
    window.cancelAnimationFrame(this.frameHandle);
    window.clearTimeout(this.timeoutHandle);
    this.abort.abort();
    this.resizeObserver?.disconnect();
    window.removeEventListener("resize", this.onWindowResize);
    this.canvas.removeEventListener("webglcontextlost", this.onContextLost);
    this.globe?.dispose();
    this.city.dispose();
    this.room.dispose();
    this.post.dispose();
    for (const texture of this.textures) {
      texture.dispose();
    }
    if (this.images) {
      closeImages(this.images);
      this.images = null;
    }
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.canvas.remove();
    this.handlers.clear();
    this.settle();
  }

  private isDisposed(): boolean {
    return this.state === "disposed";
  }

  private buildPath(aspect: number): CameraPath {
    const option = this.options.deskView;
    const view =
      typeof option === "function"
        ? option(aspect)
        : (option ?? defaultDeskView(aspect));
    this.room.setDeskView(view);
    return createCameraPath(aspect, this.options.target, view);
  }

  private async prepare(seed: number): Promise<boolean> {
    try {
      const maxSize = this.renderer.capabilities.maxTextureSize;
      const images = await loadIntroImages(this.options.textureBaseUrl, {
        maxWidth: Math.min(this.options.lowPower ? 2048 : 4096, maxSize),
        signal: this.abort.signal,
      });
      if (this.isDisposed()) {
        closeImages(images);
        return false;
      }
      this.images = images;
      const random = mulberry32(seed);
      const origins =
        this.options.origins.length > 0
          ? this.options.origins
          : fallbackOrigins(images.night, this.options.lowPower ? 600 : 2200, random);
      const plan = planArcs(origins, this.options.target, {
        cap: this.options.lowPower ? 800 : 3000,
        random,
      });
      this.arcCount = plan.count;
      this.globe = new GlobeStage({
        plan,
        target: this.options.target,
        lowPower: this.options.lowPower,
        random: mulberry32(seed + 3),
      });
      const textures: GlobeTextures = {
        day: this.texture(images.day, true, true),
        night: this.texture(images.night, true, true),
        clouds: this.texture(images.clouds, false, true),
        japanNight: this.texture(images.japanNight, true, false),
        japanDay: this.texture(images.japanDay, true, false),
      };
      this.globe.setTextures(textures);
      for (const texture of this.textures) {
        this.renderer.initTexture(texture);
      }
      await this.compile(this.globe.scene, this.globe.camera);
      await this.compile(this.city.scene, this.city.camera);
      await this.compile(this.room.scene, this.room.camera);
      if (this.isDisposed()) {
        return false;
      }
      this.post.warmUp();
      this.warmUp();
      return true;
    } catch {
      return false;
    }
  }

  private async compile(scene: Scene, camera: PerspectiveCamera): Promise<void> {
    if (this.isDisposed()) {
      return;
    }
    await this.renderer.compileAsync(scene, camera);
  }

  private warmUp(): void {
    const target = this.post.targetB;
    this.renderStage("globe", 2.6, target);
    this.renderStage("city", 6.8, target);
    this.renderStage("room", 8.4, target);
    this.renderer.setRenderTarget(null);
  }

  private texture(bitmap: ImageBitmap, srgb: boolean, repeat: boolean): Texture {
    const texture = new Texture(bitmap);
    texture.flipY = false;
    texture.colorSpace = srgb ? SRGBColorSpace : NoColorSpace;
    texture.wrapS = repeat ? RepeatWrapping : ClampToEdgeWrapping;
    texture.wrapT = ClampToEdgeWrapping;
    texture.minFilter = LinearMipmapLinearFilter;
    texture.magFilter = LinearFilter;
    texture.generateMipmaps = true;
    texture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    texture.needsUpdate = true;
    this.textures.push(texture);
    return texture;
  }

  private start(): void {
    this.state = "playing";
    if (!this.debug.manualClock) {
      this.currentTime = 0;
    }
    this.lastFrame = 0;
    this.emitThrough(0);
    this.renderFrame(this.currentTime, performance.now());
    this.canvas.style.background = "transparent";
    if (!this.debug.manualClock) {
      this.frameHandle = window.requestAnimationFrame(this.tick);
    }
  }

  private readonly tick = (now: number): void => {
    if (this.state !== "playing") {
      return;
    }
    this.frameHandle = window.requestAnimationFrame(this.tick);
    const elapsed = this.lastFrame > 0 ? now - this.lastFrame : 0;
    this.lastFrame = now;
    if (elapsed > 0) {
      this.frames += 1;
      this.frameSum += elapsed;
      this.frameWorst = Math.max(this.frameWorst, elapsed);
      if (this.governor.sample(elapsed)) {
        this.applySize(true);
      }
    }
    this.currentTime += (Math.min(100, elapsed) / 1000) * (this.debug.speed ?? 1);
    this.renderFrame(this.currentTime, now);
    if (this.skipStartedAt === null) {
      this.emitCrossed(Math.min(this.currentTime, INTRO_SECONDS - 1e-6));
    }
    const skipDone =
      this.skipStartedAt !== null && now - this.skipStartedAt >= SKIP_FADE_MS;
    if (skipDone || this.currentTime >= INTRO_SECONDS) {
      this.finish();
    }
  };

  private renderFrame(time: number, now: number): void {
    const started = performance.now();
    const mix = stageMix(time, this.mix);
    const params = this.params;
    params.weightA = 0;
    params.weightB = 0;
    let slot = this.layer("globe", mix.globe, time, 0);
    slot = this.layer("city", mix.city, time, slot);
    this.layer("room", mix.room, time, slot);
    const skipFade =
      this.skipStartedAt === null
        ? 1
        : 1 - easeInOutSine((now - this.skipStartedAt) / SKIP_FADE_MS);
    params.clouds = mix.clouds;
    params.cloudTime = (time - CLOUD_PASS.riseStart) * 1.5;
    params.glow = mix.glow;
    params.fade = Math.min(mix.fade, skipFade);
    params.intro = mix.intro;
    params.exposure = mix.exposure;
    params.vignette = lerp(0.34, 0.46, mix.globe);
    params.bloomStrength = 0.16 + 0.06 * mix.globe + 0.04 * mix.city;
    params.bloomThreshold = 0.75;
    params.time = time;
    this.post.render(params);
    if (this.debug.benchmark) {
      this.gl.readPixels(0, 0, 1, 1, this.gl.RGBA, this.gl.UNSIGNED_BYTE, this.probe);
    }
    this.renderSum += performance.now() - started;
  }

  private layer(
    stage: StageName,
    weight: number,
    time: number,
    slot: number,
  ): number {
    if (weight <= 0.001 || slot > 1) {
      return slot;
    }
    this.renderStage(
      stage,
      time,
      slot === 0 ? this.post.targetA : this.post.targetB,
    );
    if (slot === 0) {
      this.params.weightA = weight;
    } else {
      this.params.weightB = weight;
    }
    return slot + 1;
  }

  private renderStage(
    stage: StageName,
    time: number,
    target: WebGLRenderTarget,
  ): void {
    const renderer = this.renderer;
    renderer.setRenderTarget(target);
    renderer.setClearColor(0x000000, 1);
    renderer.clear(true, true, false);
    const width = this.cssWidth;
    const height = this.cssHeight;
    const ratio = this.pixelRatio;
    if (stage === "globe") {
      if (!this.globe) {
        return;
      }
      this.path.globe(time, this.pose);
      this.globe.update(time, this.pose, width, height, ratio);
      renderer.render(this.globe.scene, this.globe.camera);
    } else if (stage === "city") {
      this.path.city(time, this.pose);
      this.city.update(time, this.pose, width, height, ratio);
      renderer.render(this.city.scene, this.city.camera);
    } else {
      this.path.room(time, this.pose);
      this.room.update(time, this.pose, width, height, ratio);
      renderer.render(this.room.scene, this.room.camera);
    }
  }

  private applySize(force: boolean): void {
    if (this.state === "disposed") {
      return;
    }
    const [width, height] = viewSize(this.options.container);
    const cap = initialPixelRatio(
      window.devicePixelRatio,
      width,
      height,
      this.options.lowPower,
    );
    const ratio = Math.min(this.governor.ratio, cap);
    if (
      !force &&
      width === this.cssWidth &&
      height === this.cssHeight &&
      ratio === this.pixelRatio
    ) {
      return;
    }
    const aspectChanged =
      Math.abs(width / height - this.cssWidth / this.cssHeight) > 1e-4;
    this.cssWidth = width;
    this.cssHeight = height;
    this.pixelRatio = ratio;
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(width, height, false);
    this.post.setSize(width * ratio, height * ratio);
    if (aspectChanged || force) {
      this.path = this.buildPath(width / height);
    }
    if (this.state === "playing" && this.debug.manualClock) {
      this.renderFrame(this.currentTime, performance.now());
    }
  }

  private emitCrossed(to: number): void {
    let index = this.phaseIndex;
    while (
      index + 1 < PHASE_STARTS.length &&
      PHASE_STARTS[index + 1]![1] <= to
    ) {
      index += 1;
    }
    this.emitThrough(index);
  }

  private emitThrough(index: number): void {
    if (index <= this.phaseIndex) {
      return;
    }
    const jump = index === HANDOFF_INDEX && this.skipStartedAt !== null;
    const first = jump ? index : this.phaseIndex + 1;
    this.phaseIndex = index;
    for (let current = first; current <= index; current += 1) {
      const phase = PHASE_STARTS[current]![0];
      for (const handler of [...this.handlers]) {
        try {
          handler(phase);
        } catch (error) {
          window.setTimeout(() => {
            throw error;
          });
        }
      }
    }
  }

  private fadeOutWithoutRendering(): void {
    if (this.state === "fading" || this.state === "finished" || this.state === "disposed") {
      return;
    }
    this.state = "fading";
    this.emitThrough(HANDOFF_INDEX);
    this.canvas.style.transition = `opacity ${CSS_FADE_MS}ms ease`;
    this.canvas.style.opacity = "0";
    window.setTimeout(() => this.finish(), CSS_FADE_MS);
  }

  private contextLost(): void {
    window.cancelAnimationFrame(this.frameHandle);
    window.clearTimeout(this.timeoutHandle);
    if (this.state === "idle") {
      this.skipRequested = true;
    } else if (this.state === "loading" || this.state === "playing") {
      this.fadeOutWithoutRendering();
    }
  }

  private finish(): void {
    if (this.state === "finished" || this.state === "disposed") {
      return;
    }
    const wasPlaying = this.state === "playing";
    this.state = "finished";
    window.cancelAnimationFrame(this.frameHandle);
    if (wasPlaying && !this.gl.isContextLost()) {
      this.renderer.setRenderTarget(null);
      this.renderer.setClearColor(0x000000, 0);
      this.renderer.clear(true, false, false);
    }
    this.canvas.style.opacity = "0";
    this.emitThrough(PHASE_STARTS.length - 1);
    this.settle();
  }

  private settle(): void {
    const resolve = this.resolvePlay;
    this.resolvePlay = null;
    resolve?.();
  }
}

export function createIntroController(
  options: IntroOptions,
  debug: IntroDebugOptions = {},
): IntroController {
  return new IntroRuntime(options, debug);
}

export function createIntro(options: IntroOptions): Intro {
  return createIntroController(options);
}
