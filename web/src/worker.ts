import * as ort from "onnxruntime-web/wasm";
import type {
  InitRequest,
  ProcessRequest,
  WorkerRequest,
  WorkerResponse,
} from "./types";

const SIDE = 224;
const ELEMENTS = 3 * SIDE * SIDE;
const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];

let sessions: Array<{ session: ort.InferenceSession; weight: number }> = [];

function post(message: WorkerResponse, transfer: Transferable[] = []): void {
  self.postMessage(message, { transfer });
}

function rotateChw(data: Float32Array, quartersCw: number): Float32Array {
  if (quartersCw === 0) {
    return data;
  }
  const result = new Float32Array(ELEMENTS);
  for (let channel = 0; channel < 3; channel += 1) {
    for (let y = 0; y < SIDE; y += 1) {
      for (let x = 0; x < SIDE; x += 1) {
        let sourceY = y;
        let sourceX = x;
        if (quartersCw === 1) {
          sourceY = SIDE - 1 - x;
          sourceX = y;
        } else if (quartersCw === 2) {
          sourceY = SIDE - 1 - y;
          sourceX = SIDE - 1 - x;
        } else if (quartersCw === 3) {
          sourceY = x;
          sourceX = SIDE - 1 - y;
        }
        result[channel * SIDE * SIDE + y * SIDE + x] =
          data[channel * SIDE * SIDE + sourceY * SIDE + sourceX]!;
      }
    }
  }
  return result;
}

async function fetchModel(
  url: string,
  modelIndex: number,
  modelCount: number,
): Promise<ArrayBuffer> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`モデルを取得できませんでした (${response.status})`);
  }
  const total = Number(response.headers.get("content-length") ?? "0");
  if (!response.body) {
    return response.arrayBuffer();
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    chunks.push(value);
    loaded += value.byteLength;
    post({
      type: "load-progress",
      loaded,
      total,
      modelIndex,
      modelCount,
    });
  }
  const bytes = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes.buffer;
}

async function initialize(request: InitRequest): Promise<void> {
  const started = performance.now();
  ort.env.wasm.wasmPaths = request.wasmBaseUrl;
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = false;
  sessions = [];
  for (let index = 0; index < request.models.length; index += 1) {
    const source = request.models[index]!;
    const model = await fetchModel(source.url, index, request.models.length);
    const session = await ort.InferenceSession.create(model, {
      executionProviders: ["wasm"],
      graphOptimizationLevel: "all",
      enableCpuMemArena: false,
      enableMemPattern: true,
    });
    const warmup = new ort.Tensor(
      "float32",
      new Float32Array(ELEMENTS),
      [1, 3, SIDE, SIDE],
    );
    await session.run({ images: warmup });
    warmup.dispose();
    sessions.push({ session, weight: source.weight });
  }
  post({ type: "ready", loadMs: performance.now() - started });
}

async function decodeImage(file: Blob): Promise<Float32Array> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    bitmap = await createImageBitmap(file);
  }
  const canvas = new OffscreenCanvas(SIDE, SIDE);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    throw new Error("画像の変換を開始できませんでした");
  }
  context.drawImage(bitmap, 0, 0, SIDE, SIDE);
  bitmap.close();
  const rgba = context.getImageData(0, 0, SIDE, SIDE).data;
  const data = new Float32Array(ELEMENTS);
  for (let index = 0; index < SIDE * SIDE; index += 1) {
    for (let channel = 0; channel < 3; channel += 1) {
      const value = rgba[index * 4 + channel]! / 255;
      data[channel * SIDE * SIDE + index] =
        (value - MEAN[channel]!) / STD[channel]!;
    }
  }
  return data;
}

function softmax(values: Float32Array): number[] {
  let maximum = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    maximum = Math.max(maximum, value);
  }
  const exponentials = Array.from(values, (value) => Math.exp(value - maximum));
  const total = exponentials.reduce((sum, value) => sum + value, 0);
  return exponentials.map((value) => value / total);
}

async function processImage(request: ProcessRequest): Promise<void> {
  if (sessions.length === 0) {
    throw new Error("モデルはまだ準備できていません");
  }
  const started = performance.now();
  const decoded = await decodeImage(request.file);
  const input = rotateChw(decoded, ((request.simulateRotation / 90) % 4 + 4) % 4);
  const probabilities = [0, 0, 0, 0];
  for (const { session, weight } of sessions) {
    for (let view = 0; view < 4; view += 1) {
      const tensor = new ort.Tensor(
        "float32",
        rotateChw(input, view),
        [1, 3, SIDE, SIDE],
      );
      const output = await session.run({ images: tensor });
      tensor.dispose();
      const logits = output.logits;
      if (!logits || !(logits.data instanceof Float32Array)) {
        throw new Error("モデル出力を読み取れませんでした");
      }
      const viewProbability = softmax(logits.data);
      for (let correction = 0; correction < 4; correction += 1) {
        probabilities[(correction + view) % 4]! +=
          weight * viewProbability[correction]! / 4;
      }
      logits.dispose();
    }
  }
  let correctionCw = 0;
  for (let index = 1; index < 4; index += 1) {
    if (probabilities[index]! > probabilities[correctionCw]!) {
      correctionCw = index;
    }
  }
  post({
    type: "result",
    id: request.id,
    correctionCw: correctionCw * 90,
    confidence: probabilities[correctionCw]!,
    probabilities,
    inferenceMs: performance.now() - started,
  });
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  try {
    if (request.type === "init") {
      await initialize(request);
    } else {
      await processImage(request);
    }
  } catch (error) {
    post({
      type: "error",
      id: request.type === "process" ? request.id : undefined,
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
