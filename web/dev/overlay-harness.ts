import type {
  DeskStats,
  ModelId,
  ModelOption,
  Overlay,
  PhotoRecord,
  PhotoSource,
  Prediction,
  Quarter,
  ScreenPoint,
  StreamStatus,
} from "../src/contracts";
import { modelOptions } from "../src/core/model-profiles";
import { isCorrect, normalizeQuarter } from "../src/core/rotation";
import { mountOverlay } from "../src/ui/overlay";

type HarnessState =
  | "crooked"
  | "running"
  | "loupe"
  | "pinned"
  | "list"
  | "about"
  | "drop"
  | "offline"
  | "nowebgl"
  | "finished"
  | "full-loading"
  | "full-running"
  | "confirm"
  | "full-unavailable"
  | "nano-only";

const STATES: readonly HarnessState[] = [
  "crooked",
  "running",
  "loupe",
  "pinned",
  "list",
  "about",
  "drop",
  "offline",
  "nowebgl",
  "finished",
  "full-loading",
  "full-running",
  "confirm",
  "full-unavailable",
  "nano-only",
];

const SAMPLE_FILES = [
  { file: "sample1.webp", fix: 3 },
  { file: "sample2.webp", fix: 3 },
  { file: "sample3.webp", fix: 1 },
  { file: "sample4.webp", fix: 3 },
  { file: "sample5.jpg", fix: 2 },
] as const;

const COMMONS_TITLES = [
  "Lake Bled from Osojnica viewpoint at dawn",
  "Kinkaku-ji in the snow, Kyoto",
  "Red fox (Vulpes vulpes) in a meadow near Dobrogea",
  "Sunflower field in Provence",
  "Interior of the Sheikh Lotfollah Mosque dome",
  "Steam locomotive 52 8154 on the Geislingen incline",
  "Bread rolls at a bakery in Vienna",
  "Mount Fuji from Lake Kawaguchi",
  "Atlantic puffin (Fratercula arctica) with sand eels",
  "Old town of Český Krumlov with the Vltava",
];

const COMMONS_AUTHORS = [
  "Diliff",
  "Arne Müseler",
  "Charles J. Sharp",
  "Benh LIEU SONG",
  "Martin Falbisoner",
  "Myrabella",
  "Christian Ferrer",
  "Jakub Hałun",
];

const params = new URLSearchParams(window.location.search);
const requested = params.get("state");
const state: HarnessState = STATES.find((item) => item === requested) ?? "running";
const live = params.has("live");
const base = new URL("../", window.location.href);
const sampleUrls = SAMPLE_FILES.map(
  (item) => new URL(`samples/${item.file}`, base).href,
);

function seeded(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

const random = seeded(7);

function prediction(correction: Quarter, confidence: number): Prediction {
  const rest = (1 - confidence) / 3;
  const probabilities: [number, number, number, number] = [rest, rest, rest, rest];
  probabilities[correction] = confidence;
  return {
    correction,
    confidence,
    probabilities,
    inferenceMs: 210 + Math.round(random() * 80),
  };
}

function commonsSource(index: number): PhotoSource {
  const title = COMMONS_TITLES[index % COMMONS_TITLES.length]!;
  const author = COMMONS_AUTHORS[index % COMMONS_AUTHORS.length]!;
  const image = sampleUrls[index % sampleUrls.length]!;
  return {
    id: `commons-${index}`,
    kind: "commons",
    title,
    aspect: 1.5,
    thumbUrl: image,
    largeUrl: image,
    file: null,
    attribution: {
      author,
      license: index % 3 === 0 ? "CC BY 4.0" : "CC BY-SA 4.0",
      licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
      pageUrl: `https://commons.wikimedia.org/wiki/File:Example_${index}.jpg`,
    },
    uprightFix: 0,
  };
}

function sampleSource(index: number): PhotoSource {
  const sample = SAMPLE_FILES[index % SAMPLE_FILES.length]!;
  return {
    id: `sample-${index}`,
    kind: "sample",
    title: `サンプル写真 ${index + 1}`,
    aspect: null,
    thumbUrl: sampleUrls[index % sampleUrls.length]!,
    largeUrl: sampleUrls[index % sampleUrls.length]!,
    file: null,
    attribution: null,
    uprightFix: sample.fix,
  };
}

function record(
  source: PhotoSource,
  simulated: Quarter,
  correction: Quarter | null,
  index: number,
): PhotoRecord {
  const predicted =
    correction === null ? null : prediction(correction, 0.62 + random() * 0.37);
  return {
    id: source.id,
    source,
    simulated,
    phase: predicted ? "placed" : "scanning",
    aspect: 1.5,
    prediction: predicted,
    slot: predicted ? index : null,
    correct:
      correction === null
        ? null
        : isCorrect(source.uprightFix, simulated, correction),
    addedAt: index * 60,
    decidedAt: predicted ? index * 60 + 400 : null,
    error: null,
  };
}

function mockRecords(count: number): PhotoRecord[] {
  const result: PhotoRecord[] = [];
  for (let index = 0; index < count; index += 1) {
    if (index % 13 === 4) {
      const source = sampleSource(index % 5);
      const fix = source.uprightFix ?? 0;
      const miss = index % 26 === 4;
      result.push(
        record(
          { ...source, id: `sample-${index}` },
          0,
          miss ? normalizeQuarter(fix + 2) : fix,
          index,
        ),
      );
      continue;
    }
    const source = commonsSource(index);
    const simulated = normalizeQuarter(Math.floor(random() * 4));
    const expected = normalizeQuarter(-simulated);
    const miss = index % 9 === 7;
    result.push(
      record(source, simulated, miss ? normalizeQuarter(expected + 1) : expected, index),
    );
  }
  return result;
}

function statsFor(placed: number, total: number, crooked = 24): DeskStats {
  const judged = Math.max(0, placed - Math.floor(placed / 40));
  const correct = Math.round(judged * 0.924);
  return {
    total,
    added: Math.min(total, placed + 28),
    processed: placed === 0 ? 0 : Math.min(total, placed + 6),
    placed,
    rotatedFixed: Math.round(placed * 0.73),
    judged,
    correct,
    accuracy: judged > 0 ? correct / judged : null,
    perSecond: placed > 0 ? 16.2 : null,
    medianMs: placed > 0 ? 238 : null,
    failed: Math.floor(placed / 120),
    crooked,
  };
}

function spiral(count: number): Array<{ x: number; y: number }> {
  const cells: Array<{ x: number; y: number }> = [{ x: 0, y: 0 }];
  let x = 0;
  let y = 0;
  let step = 1;
  const directions = [
    [1, 0],
    [0, 1],
    [-1, 0],
    [0, -1],
  ] as const;
  let direction = 0;
  while (cells.length < count) {
    for (let repeat = 0; repeat < 2 && cells.length < count; repeat += 1) {
      const [dx, dy] = directions[direction % 4]!;
      for (let move = 0; move < step && cells.length < count; move += 1) {
        x += dx;
        y += dy;
        cells.push({ x, y });
      }
      direction += 1;
    }
    step += 1;
  }
  return cells;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(url));
    image.src = url;
  });
}

function drawPrint(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  cx: number,
  cy: number,
  longSide: number,
  angle: number,
): void {
  const aspect = image.naturalWidth / image.naturalHeight;
  const width = aspect >= 1 ? longSide : longSide * aspect;
  const height = aspect >= 1 ? longSide / aspect : longSide;
  const border = Math.min(width, height) * 0.05;
  context.save();
  context.translate(cx, cy);
  context.rotate(angle);
  context.shadowColor = "rgba(11, 32, 25, 0.45)";
  context.shadowBlur = longSide * 0.08;
  context.shadowOffsetY = longSide * 0.03;
  context.fillStyle = "#f7f5ef";
  context.fillRect(-width / 2, -height / 2, width, height);
  context.shadowColor = "transparent";
  context.drawImage(
    image,
    -width / 2 + border,
    -height / 2 + border,
    width - border * 2,
    height - border * 2,
  );
  context.restore();
}

async function paintDesk(
  canvas: HTMLCanvasElement,
  prints: number,
  crooked: number,
): Promise<void> {
  canvas.classList.add("css-mat");
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const width = window.innerWidth;
  const height = window.innerHeight;
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  const context = canvas.getContext("2d");
  if (!context || prints + crooked === 0) {
    return;
  }
  const images = await Promise.all(sampleUrls.map(loadImage));
  context.scale(ratio, ratio);
  const cell = width < 720 ? 44 : 62;
  const centre = { x: width * (width < 720 ? 0.5 : 0.58), y: height * 0.52 };
  const cells = spiral(prints + crooked);
  cells.forEach((position, index) => {
    const image = images[index % images.length]!;
    const tilted = index >= prints;
    const quarter = tilted ? 1 + Math.floor(random() * 3) : 0;
    const jitter = tilted ? (random() - 0.5) * 0.28 : 0;
    drawPrint(
      context,
      image,
      centre.x + position.x * cell + (tilted ? (random() - 0.5) * cell * 0.2 : 0),
      centre.y + position.y * cell + (tilted ? (random() - 0.5) * cell * 0.2 : 0),
      cell * 0.9,
      (quarter * Math.PI) / 2 + jitter,
    );
  });
}

function setup(overlay: Overlay, records: PhotoRecord[]): void {
  for (const item of records) {
    overlay.upsertRecord(item);
  }
}

const statusLog: StreamStatus[] = [];
const modelCalls: ModelId[] = [];
let currentStatus: StreamStatus = "running";
const recordsById = new Map<string, PhotoRecord>();

const overlay = mountOverlay(document.querySelector<HTMLElement>("#app")!, {
  addFiles(files) {
    console.info("addFiles", files.map((file) => file.name));
  },
  togglePause() {
    currentStatus = currentStatus === "paused" ? "running" : "paused";
    statusLog.push(currentStatus);
    overlay.setStatus(currentStatus);
  },
  scatter() {
    console.info("scatter");
  },
  setSimulateUser(enabled) {
    console.info("simulateUser", enabled);
  },
  selectRecord(id) {
    const found = id === null ? null : (recordsById.get(id) ?? null);
    overlay.pin(found);
  },
  selectModel(id) {
    modelCalls.push(id);
    console.info("selectModel", id);
  },
});

const total = 3005;
const records = mockRecords(72);
for (const item of records) {
  recordsById.set(item.id, item);
}

function centrePoint(): ScreenPoint {
  return {
    x: Math.round(window.innerWidth * 0.6),
    y: Math.round(window.innerHeight * 0.5),
  };
}

const FULL_BASE = "/full-local/";

function optionsFor(target: HarnessState): ModelOption[] {
  if (target === "nano-only") {
    return modelOptions({ webgpu: true, fullBaseUrl: null });
  }
  return modelOptions({
    webgpu: target !== "full-unavailable",
    fullBaseUrl: FULL_BASE,
  });
}

function startStory(): void {
  let crooked = 0;
  let placed = 0;
  let phase: "crooked" | "straightening" = "crooked";
  overlay.setStatus("running");
  window.setInterval(() => {
    if (phase === "crooked") {
      crooked = Math.min(40, crooked + 2);
      overlay.setStats(statsFor(0, total, crooked));
      if (crooked === 40) {
        phase = "straightening";
      }
      return;
    }
    placed = Math.min(total, placed + 3);
    overlay.setStats(statsFor(placed, total, Math.max(0, 40 - placed)));
  }, 180);
}

async function run(): Promise<void> {
  const ready = { loaded: 11_908_441, total: 11_908_441, ready: true };
  const fullTotal = 551_055_739;
  const current: ModelId =
    state === "full-loading" || state === "full-running" ? "full" : "nano";
  overlay.setModels(current, optionsFor(state));
  if (state === "crooked") {
    overlay.setModelProgress({ loaded: 4_200_000, total: 11_908_441, ready: false });
    overlay.setStatus("loading-model");
    overlay.setStats(statsFor(0, total, 36));
    await paintDesk(overlay.canvas, 0, 36);
    if (live) {
      startStory();
    }
    return;
  }
  if (state === "full-loading") {
    overlay.setModelProgress({ loaded: 231_400_000, total: fullTotal, ready: false });
    overlay.setStatus("loading-model");
    overlay.setStats(statsFor(0, total, 48));
    await paintDesk(overlay.canvas, 0, 48);
    return;
  }
  overlay.setModelProgress(
    state === "full-running" ? { loaded: fullTotal, total: fullTotal, ready: true } : ready,
  );
  const placed = state === "finished" ? total : 1284;
  currentStatus =
    state === "finished" ? "finished" : state === "offline" ? "offline" : "running";
  overlay.setStatus(currentStatus);
  overlay.setStats(statsFor(placed, total, state === "finished" ? 0 : 24));
  setup(overlay, records);
  if (state === "nowebgl") {
    overlay.webglUnavailable();
    return;
  }
  await paintDesk(overlay.canvas, state === "finished" ? 420 : 160, state === "finished" ? 0 : 6);
  if (state === "offline") {
    overlay.notice("Wikimedia Commons に接続できませんでした。自分の写真は並べられます。");
  }
  if (state === "loupe") {
    const target = records.find((item) => item.correct === true && item.source.kind === "commons");
    if (target) {
      overlay.showLoupe(target, centrePoint());
    }
  }
  if (state === "pinned") {
    const target = records.find((item) => item.correct === false && item.source.kind === "commons");
    if (target) {
      overlay.showLoupe(target, centrePoint());
      overlay.pin(target);
    }
  }
  if (state === "list") {
    document.querySelector<HTMLButtonElement>("[aria-controls='ledger']")?.click();
  }
  if (state === "about") {
    Array.from(document.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent === "このデモについて")
      ?.click();
  }
  if (state === "drop") {
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array([1])], "photo.jpg", { type: "image/jpeg" }));
    window.dispatchEvent(new DragEvent("dragenter", { dataTransfer: transfer, bubbles: true }));
  }
  if (state === "confirm") {
    document.querySelector<HTMLInputElement>("input[value='full']")?.click();
  }
  if (live) {
    let count = placed;
    window.setInterval(() => {
      count = Math.min(total, count + 3);
      overlay.setStats(statsFor(count, total));
    }, 180);
  }
}

void run().then(() => {
  document.documentElement.dataset.harnessReady = "true";
});

Object.assign(window, {
  harnessOverlay: overlay,
  harnessRecords: records,
  harnessModelCalls: modelCalls,
  harnessOptions: optionsFor,
  harnessStats: statsFor,
});
