import type { GeoPoint, ViewInsets } from "../src/contracts";
import { decodeManifest } from "../src/core/manifest";
import { mulberry32 } from "../src/core/random";
import {
  type IntroController,
  type IntroFrameStats,
  type IntroPhase,
  IntroUnavailableError,
  createIntroController,
} from "../src/intro/intro";

interface IntroHarness {
  controller: IntroController;
  desk: DeskHandle | null;
  ready: Promise<boolean>;
  readonly phase: IntroPhase | null;
  readonly time: number;
  readonly fps: number;
  readonly done: boolean;
  readonly phases: readonly string[];
  readonly origins: number;
  readonly source: string;
  seek(ms: number): void;
  setInsets(insets: ViewInsets): void;
  skip(): void;
  stats(): IntroFrameStats;
  resetStats(): void;
}

declare global {
  interface Window {
    __intro?: IntroHarness;
  }
}

const TOKYO: GeoPoint = { lat: 35.6812, lon: 139.7671 };

const LAND: readonly (readonly [number, number, number, number, number])[] = [
  [40, 58, -8, 30, 5],
  [30, 47, -122, -75, 4],
  [45, 55, -125, -70, 1],
  [16, 28, -105, -90, 1],
  [-30, 0, -70, -40, 2],
  [-30, 10, 15, 35, 1.5],
  [10, 28, 72, 86, 2],
  [22, 40, 100, 120, 3],
  [-37, -20, 115, 150, 1.5],
  [33, 43, 130, 142, 3],
  [0, 20, 95, 110, 1.5],
  [25, 36, 35, 55, 1],
  [-46, -36, 168, 178, 0.5],
  [60, 68, 10, 30, 0.6],
];

function randomLand(count: number, seed: number): GeoPoint[] {
  const random = mulberry32(seed);
  const total = LAND.reduce((sum, box) => sum + box[4], 0);
  const points: GeoPoint[] = [];
  for (let index = 0; index < count; index += 1) {
    let pick = random() * total;
    let box = LAND[0]!;
    for (const candidate of LAND) {
      pick -= candidate[4];
      if (pick <= 0) {
        box = candidate;
        break;
      }
    }
    points.push({
      lat: box[0] + (box[1] - box[0]) * random(),
      lon: box[2] + (box[3] - box[2]) * random(),
    });
  }
  return points;
}

async function manifestOrigins(): Promise<GeoPoint[]> {
  try {
    const response = await fetch("/commons/manifest.json");
    if (!response.ok) {
      return [];
    }
    const manifest = decodeManifest(await response.json());
    const points: GeoPoint[] = [];
    for (const entry of manifest.items) {
      if (entry.location) {
        points.push({ lat: entry.location.lat, lon: entry.location.lon });
      }
    }
    return points;
  } catch {
    return [];
  }
}

interface DeskHandle {
  hide(hidden: boolean): void;
  setInsets(insets: ViewInsets): void;
}

async function mountDesk(stage: HTMLElement): Promise<DeskHandle | null> {
  const placeholder = stage.querySelector<HTMLElement>("#desk");
  const canvas = document.createElement("canvas");
  canvas.id = "desk-canvas";
  Object.assign(canvas.style, {
    position: "absolute",
    inset: "0",
    width: "100%",
    height: "100%",
    display: "block",
    zIndex: "0",
  });
  try {
    const module = await import("../src/scene/desk-scene");
    placeholder?.remove();
    stage.prepend(canvas);
    const scene = module.createDeskScene(canvas, {
      reducedMotion: false,
      lowPower: false,
    });
    scene.start();
    return {
      hide(hidden: boolean) {
        canvas.style.visibility = hidden ? "hidden" : "visible";
      },
      setInsets(insets: ViewInsets) {
        scene.setViewInsets(insets);
      },
    };
  } catch (error) {
    console.warn("desk scene unavailable", error);
    return null;
  }
}

async function main(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const stillMs = params.has("t") ? Number(params.get("t")) : null;
  const speed = Number(params.get("speed") ?? 1) || 1;
  const lowPower = params.get("lowPower") === "1";
  const originMode = params.get("origins") ?? "manifest";
  const seed = Number(params.get("seed") ?? 7) || 7;
  const hud = document.querySelector<HTMLElement>("#hud")!;
  const skipButton = document.querySelector<HTMLButtonElement>("#skip")!;
  const stage = document.querySelector<HTMLElement>("#stage")!;
  hud.hidden = params.get("hud") !== "1";
  const desk = params.get("desk") === "scene" ? await mountDesk(stage) : null;

  let origins: GeoPoint[] = [];
  let source = "empty";
  if (originMode === "manifest") {
    origins = await manifestOrigins();
    source = "manifest";
    if (origins.length === 0) {
      origins = randomLand(3000, seed);
      source = "random-land";
    }
  } else if (originMode === "random") {
    origins = randomLand(Number(params.get("count") ?? 3000), seed);
    source = "random-land";
  }

  let controller: IntroController;
  try {
    controller = createIntroController(
      {
        container: stage,
        origins,
        target: TOKYO,
        textureBaseUrl: new URL("/intro/", location.href).href,
        lowPower,
      },
      {
        manualClock: stillMs !== null,
        speed,
        benchmark: params.get("bench") === "1",
        seed,
      },
    );
  } catch (error) {
    hud.hidden = false;
    hud.textContent =
      error instanceof IntroUnavailableError ? "WebGL2 なし" : String(error);
    return;
  }

  const phases: string[] = [];
  let done = false;
  let frames = 0;
  let fps = 0;
  let windowStart = performance.now();
  controller.onPhase((phase) => {
    phases.push(`${phase}@${Math.round(controller.time * 1000)}`);
  });

  window.__intro = {
    controller,
    desk,
    ready: controller.ready,
    get phase() {
      return controller.phase;
    },
    get time() {
      return controller.time * 1000;
    },
    get fps() {
      return fps;
    },
    get done() {
      return done;
    },
    get phases() {
      return phases;
    },
    origins: origins.length,
    source,
    seek: (ms: number) => controller.seek(ms),
    setInsets: (value: ViewInsets) => desk?.setInsets(value),
    skip: () => controller.skip(),
    stats: () => controller.frameStats(),
    resetStats: () => controller.resetStats(),
  };

  const meter = (now: number) => {
    frames += 1;
    if (now - windowStart >= 500) {
      fps = (frames * 1000) / (now - windowStart);
      frames = 0;
      windowStart = now;
      if (!hud.hidden) {
        const stats = controller.frameStats();
        hud.textContent = [
          `phase ${controller.phase ?? "-"}  t ${(controller.time * 1000).toFixed(0)} ms`,
          `fps ${fps.toFixed(1)}  frame ${stats.averageMs.toFixed(1)} ms  worst ${stats.worstMs.toFixed(1)} ms`,
          `ratio ${stats.pixelRatio.toFixed(2)}  arcs ${stats.arcs}  buildings ${stats.buildings}`,
          `origins ${origins.length} (${source})`,
        ].join("\n");
      }
    }
    if (!done) {
      requestAnimationFrame(meter);
    }
  };
  requestAnimationFrame(meter);

  skipButton.hidden = stillMs !== null;
  skipButton.addEventListener("click", () => controller.skip());
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      controller.skip();
    }
  });

  const playing = controller.play();
  if (stillMs !== null) {
    const ok = await controller.ready;
    if (ok) {
      controller.seek(stillMs);
    }
    return;
  }
  await playing;
  done = true;
  skipButton.hidden = true;
  if (params.get("keep") !== "1") {
    controller.dispose();
  }
}

void main();
