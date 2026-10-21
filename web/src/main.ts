import "@fontsource-variable/newsreader";
import "./style.css";
import type { WorkerResponse } from "./types";

type ItemState = "queued" | "working" | "done" | "error";

interface QueueItem {
  id: string;
  file: File;
  simulateRotation: number;
  state: ItemState;
  bitmap: ImageBitmap;
  card: HTMLElement;
  beforeCanvas: HTMLCanvasElement;
  afterCanvas: HTMLCanvasElement;
  status: HTMLElement;
  inferenceMs?: number;
}

const SAMPLE_FILES = [
  "sample1.webp",
  "sample2.webp",
  "sample3.webp",
  "sample4.webp",
  "sample5.jpg",
];

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) {
  throw new Error("Application root is missing");
}

app.innerHTML = `
  <main class="shell">
    <header class="site-header">
      <a class="wordmark" href="./" aria-label="くるりAI デモ">
        <span class="wordmark-mark" aria-hidden="true">
          <i></i><i></i><i></i>
        </span>
        <span>くるりAI <b>v2-nano</b></span>
      </a>
      <nav aria-label="関連リンク">
        <a href="https://github.com/kandotrun/kururi-ai">GitHub</a>
        <a href="https://github.com/kandotrun/kururi-ai/releases/tag/v2.0.0">v2.0.0</a>
      </nav>
    </header>

    <section class="hero" aria-labelledby="hero-title">
      <div class="hero-copy">
        <p class="kicker">写真の向きを、まとめて整える。</p>
        <h1 id="hero-title">
          <span>大量の写真を、</span>
          <span>まっすぐ。</span>
        </h1>
        <p class="lede">
          写真を選ぶと、ブラウザの中だけで向きを判定し、補正後を並べて表示します。
          アップロードはありません。
        </p>
        <div class="hero-actions">
          <button class="primary-action" id="choose-files" type="button">
            写真を選ぶ
          </button>
          <button class="text-action" id="load-samples" type="button">
            サンプルで試す
          </button>
        </div>
        <label class="simulation-control">
          <input id="simulate-rotation" type="checkbox" checked />
          <span class="switch" aria-hidden="true"></span>
          <span>デモ用に写真の向きをランダムに崩す</span>
        </label>
      </div>

      <div class="drop-stage" id="drop-stage">
        <div class="photo-stack" aria-hidden="true">
          <span class="stack-photo stack-one"></span>
          <span class="stack-photo stack-two"></span>
          <span class="stack-photo stack-three"></span>
          <span class="corner-label">0° / 90° / 180° / 270°</span>
        </div>
        <div class="drop-copy">
          <strong>ここに写真をドロップ</strong>
          <span>JPEG・PNG・WebPなど</span>
        </div>
        <div class="model-meter" aria-live="polite">
          <span id="model-status">11.9MBモデルを準備中</span>
          <span id="model-percent">0%</span>
          <i class="meter-track"><i id="model-progress"></i></i>
        </div>
      </div>
    </section>

    <section class="workbench" aria-labelledby="workbench-title">
      <div class="workbench-head">
        <div>
          <p class="section-label">light table</p>
          <h2 id="workbench-title">補正コンタクトシート</h2>
        </div>
        <div class="summary-strip" aria-live="polite">
          <span><b id="count-ready">0</b> / <i id="count-total">0</i> 枚</span>
          <span>中央値 <b id="median-time">—</b></span>
          <button class="text-action" id="clear-all" type="button">クリア</button>
        </div>
      </div>

      <div class="empty-state" id="empty-state">
        <span class="empty-mark" aria-hidden="true">↻</span>
        <p>写真を追加すると、元画像と補正後がここに並びます。</p>
      </div>
      <div class="contact-sheet" id="contact-sheet" aria-live="polite"></div>
    </section>

    <section class="notes" aria-label="モデル情報">
      <article>
        <p class="note-number">81.82%</p>
        <h3>未使用テスト</h3>
        <p>99枚×4方向 = 396条件。フルv2より軽量なブラウザ用モデルです。</p>
      </article>
      <article>
        <p class="note-number">11.9MB</p>
        <h3>INT8 ONNX</h3>
        <p>MobileNetV4 SmallとMediumをQDQ量子化。WASMでCPU推論します。</p>
      </article>
      <article>
        <p class="note-number">local</p>
        <h3>画像は送信しない</h3>
        <p>画像のデコード、推論、補正プレビューはすべてこのタブ内で完結します。</p>
      </article>
    </section>

    <footer class="site-footer">
      <span>くるりAI v2-nano demo</span>
      <span>右角度の補正のみ対応</span>
      <a href="model/provenance.json">モデル情報</a>
    </footer>
  </main>
  <input id="file-input" type="file" accept="image/*" multiple hidden />
`;

function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Missing element: ${selector}`);
  }
  return element;
}

const fileInput = required<HTMLInputElement>("#file-input");
const chooseFiles = required<HTMLButtonElement>("#choose-files");
const loadSamples = required<HTMLButtonElement>("#load-samples");
const clearAll = required<HTMLButtonElement>("#clear-all");
const dropStage = required<HTMLElement>("#drop-stage");
const simulateRotation = required<HTMLInputElement>("#simulate-rotation");
const contactSheet = required<HTMLElement>("#contact-sheet");
const emptyState = required<HTMLElement>("#empty-state");
const countReady = required<HTMLElement>("#count-ready");
const countTotal = required<HTMLElement>("#count-total");
const medianTime = required<HTMLElement>("#median-time");
const modelStatus = required<HTMLElement>("#model-status");
const modelPercent = required<HTMLElement>("#model-percent");
const modelProgress = required<HTMLElement>("#model-progress");

const worker = new Worker(new URL("./worker.ts", import.meta.url), {
  type: "module",
});
const queue: QueueItem[] = [];
const items = new Map<string, QueueItem>();
const baseUrl = new URL(import.meta.env.BASE_URL, window.location.href);
const models = [
  {
    url: new URL("model/kururi-ai-v2-nano-small.onnx", baseUrl).href,
    weight: 0.18,
  },
  {
    url: new URL("model/kururi-ai-v2-nano.onnx", baseUrl).href,
    weight: 0.82,
  },
];
const wasmBaseUrl = new URL("ort/", baseUrl).href;
let activeItem: QueueItem | null = null;
let modelReady = false;
let nextId = 0;

function randomRotation(): number {
  return [0, 90, 180, 270][Math.floor(Math.random() * 4)] ?? 0;
}

function drawPhoto(
  canvas: HTMLCanvasElement,
  bitmap: ImageBitmap,
  rotation: number,
): void {
  const ratio = window.devicePixelRatio || 1;
  const width = 320;
  const height = 236;
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  canvas.style.aspectRatio = `${width} / ${height}`;
  const context = canvas.getContext("2d");
  if (!context) {
    return;
  }
  context.scale(ratio, ratio);
  context.fillStyle = "#d4dedb";
  context.fillRect(0, 0, width, height);
  const quarter = ((rotation / 90) % 4 + 4) % 4;
  const rotatedWidth = quarter % 2 === 0 ? bitmap.width : bitmap.height;
  const rotatedHeight = quarter % 2 === 0 ? bitmap.height : bitmap.width;
  const scale = Math.min((width - 20) / rotatedWidth, (height - 20) / rotatedHeight);
  context.save();
  context.translate(width / 2, height / 2);
  context.rotate((rotation * Math.PI) / 180);
  context.drawImage(
    bitmap,
    (-bitmap.width * scale) / 2,
    (-bitmap.height * scale) / 2,
    bitmap.width * scale,
    bitmap.height * scale,
  );
  context.restore();
}

function createCard(item: QueueItem): HTMLElement {
  const card = document.createElement("article");
  card.className = "photo-card";
  card.dataset.state = item.state;
  card.innerHTML = `
    <div class="photo-pair">
      <figure>
        <canvas></canvas>
        <figcaption>入力</figcaption>
      </figure>
      <span class="pair-arrow" aria-hidden="true"></span>
      <figure>
        <canvas></canvas>
        <figcaption>補正後</figcaption>
      </figure>
    </div>
    <div class="photo-meta">
      <strong title="${escapeHtml(item.file.name)}">${escapeHtml(item.file.name)}</strong>
      <span class="photo-status">待機中</span>
    </div>
  `;
  item.card = card;
  const canvases = card.querySelectorAll<HTMLCanvasElement>("canvas");
  item.beforeCanvas = canvases[0]!;
  item.afterCanvas = canvases[1]!;
  const status = card.querySelector<HTMLElement>(".photo-status");
  if (!status) {
    throw new Error("Photo status element is missing");
  }
  item.status = status;
  drawPhoto(item.beforeCanvas, item.bitmap, item.simulateRotation);
  drawPhoto(item.afterCanvas, item.bitmap, item.simulateRotation);
  return card;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function addFiles(files: File[]): Promise<void> {
  const imageFiles = files
    .filter((file) => file.type.startsWith("image/"))
    .slice(0, Math.max(0, 60 - items.size));
  for (const file of imageFiles) {
    try {
      let bitmap: ImageBitmap;
      try {
        bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      } catch {
        bitmap = await createImageBitmap(file);
      }
      const id = `photo-${nextId++}`;
      const item: QueueItem = {
        id,
        file,
        simulateRotation: simulateRotation.checked ? randomRotation() : 0,
        state: "queued",
        bitmap,
        card: document.createElement("article"),
        beforeCanvas: document.createElement("canvas"),
        afterCanvas: document.createElement("canvas"),
        status: document.createElement("span"),
      };
      items.set(id, item);
      queue.push(item);
      contactSheet.append(createCard(item));
    } catch {
      const failed = document.createElement("article");
      failed.className = "photo-card error-card";
      failed.innerHTML = `<strong>${escapeHtml(file.name)}</strong><p>この形式はブラウザで開けませんでした。</p>`;
      contactSheet.append(failed);
    }
  }
  updateCounts();
  processNext();
}

function processNext(): void {
  if (!modelReady || activeItem) {
    return;
  }
  const item = queue.shift();
  if (!item) {
    return;
  }
  activeItem = item;
  item.state = "working";
  item.card.dataset.state = "working";
  item.status.textContent = "判定中";
  worker.postMessage({
    type: "process",
    id: item.id,
    file: item.file,
    simulateRotation: item.simulateRotation,
  });
}

function updateCounts(): void {
  const done = [...items.values()].filter((item) => item.state === "done");
  countReady.textContent = String(done.length);
  countTotal.textContent = String(items.size);
  emptyState.hidden = items.size > 0;
  const times = done
    .map((item) => item.inferenceMs)
    .filter((value): value is number => value !== undefined)
    .sort((left, right) => left - right);
  if (times.length === 0) {
    medianTime.textContent = "—";
    return;
  }
  const middle = Math.floor(times.length / 2);
  const median =
    times.length % 2 === 0
      ? (times[middle - 1]! + times[middle]!) / 2
      : times[middle]!;
  medianTime.textContent = `${Math.round(median)} ms`;
}

worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
  const message = event.data;
  if (message.type === "load-progress") {
    const percent = message.total
      ? Math.min(100, Math.round((message.loaded / message.total) * 100))
      : 0;
    modelPercent.textContent = `${percent}%`;
    modelProgress.style.width = `${percent}%`;
    modelStatus.textContent = `モデル ${message.modelIndex + 1}/${message.modelCount} を取得中`;
    return;
  }
  if (message.type === "ready") {
    modelReady = true;
    modelStatus.textContent = `準備完了 · ${Math.round(message.loadMs)} ms`;
    modelPercent.textContent = "100%";
    modelProgress.style.width = "100%";
    dropStage.dataset.ready = "true";
    processNext();
    return;
  }
  if (message.type === "result") {
    const item = items.get(message.id);
    if (!item) {
      return;
    }
    item.state = "done";
    item.inferenceMs = message.inferenceMs;
    item.card.dataset.state = "done";
    item.status.textContent = `${message.correctionCw}° · ${Math.round(message.confidence * 100)}%`;
    drawPhoto(
      item.afterCanvas,
      item.bitmap,
      item.simulateRotation + message.correctionCw,
    );
    activeItem = null;
    updateCounts();
    processNext();
    return;
  }
  const item = message.id ? items.get(message.id) : undefined;
  if (item) {
    item.state = "error";
    item.card.dataset.state = "error";
    item.status.textContent = "判定できませんでした";
  } else {
    modelStatus.textContent = message.message;
  }
  activeItem = null;
  updateCounts();
  processNext();
};

chooseFiles.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => {
  void addFiles([...(fileInput.files ?? [])]);
  fileInput.value = "";
});

loadSamples.addEventListener("click", async () => {
  loadSamples.disabled = true;
  try {
    const files = await Promise.all(
      SAMPLE_FILES.map(async (name) => {
        const response = await fetch(new URL(`samples/${name}`, baseUrl));
        if (!response.ok) {
          throw new Error(`Sample ${name} is unavailable`);
        }
        const blob = await response.blob();
        const type = name.endsWith(".webp") ? "image/webp" : "image/jpeg";
        return new File([blob], name, { type });
      }),
    );
    await addFiles(files);
  } finally {
    loadSamples.disabled = false;
  }
});

clearAll.addEventListener("click", () => {
  if (activeItem) {
    return;
  }
  for (const item of items.values()) {
    item.bitmap.close();
    item.card.remove();
  }
  queue.splice(0);
  items.clear();
  updateCounts();
});

for (const eventName of ["dragenter", "dragover"]) {
  dropStage.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropStage.dataset.drag = "true";
  });
}
for (const eventName of ["dragleave", "drop"]) {
  dropStage.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropStage.dataset.drag = "false";
  });
}
dropStage.addEventListener("drop", (event) => {
  const files = [...(event.dataTransfer?.files ?? [])];
  void addFiles(files);
});
dropStage.addEventListener("click", () => fileInput.click());
dropStage.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    fileInput.click();
  }
});
dropStage.tabIndex = 0;
dropStage.setAttribute("role", "button");
dropStage.setAttribute("aria-label", "写真を選択またはドロップ");

window.addEventListener("beforeunload", () => {
  worker.terminate();
  for (const item of items.values()) {
    item.bitmap.close();
  }
});

worker.postMessage({
  type: "init",
  models,
  wasmBaseUrl,
});
