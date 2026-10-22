import { prepareModelInput, rotateRgbClockwise } from "../src/core/full-ensemble";
import type { Rgb8Image } from "../src/core/pillow-resize";
import { normalizeQuarter } from "../src/core/rotation";
import { createBrowserEngine } from "../src/full/browser-engine";
import { decodeRgb } from "../src/full/decode";
import { createFullRuntime } from "../src/full/runtime";
import type { WorkerRequest, WorkerResponse } from "../src/types";

interface ProbeFile {
  type: "probe-file";
  id: string;
  file: Blob;
  simulateRotation: number;
  reference: ArrayBuffer | null;
}

interface ProbeRgb {
  type: "probe-rgb";
  id: string;
  rgb: ArrayBuffer;
  width: number;
  height: number;
  simulateRotation: number;
}

interface RgbDifference {
  maxAbs: number;
  meanAbs: number;
  differing: number;
  sameSize: boolean;
}

type ProbeRequest = WorkerRequest | ProbeFile | ProbeRgb;

function post(message: WorkerResponse | Record<string, unknown>): void {
  self.postMessage(message);
}

const runtime = createFullRuntime({
  post,
  now: () => performance.now(),
  createEngine: createBrowserEngine,
  decode: decodeRgb,
});

async function hex(data: Float32Array<ArrayBuffer> | Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function tensors(image: Rgb8Image): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const side of [224, 288]) {
    result[String(side)] = await hex(prepareModelInput(image, side));
  }
  return result;
}

function difference(decoded: Rgb8Image, reference: Rgb8Image): RgbDifference {
  if (decoded.width !== reference.width || decoded.height !== reference.height) {
    return { maxAbs: 255, meanAbs: 255, differing: 1, sameSize: false };
  }
  let maxAbs = 0;
  let total = 0;
  let differing = 0;
  for (let index = 0; index < decoded.data.length; index += 1) {
    const delta = Math.abs(decoded.data[index]! - reference.data[index]!);
    maxAbs = Math.max(maxAbs, delta);
    total += delta;
    if (delta > 0) {
      differing += 1;
    }
  }
  return {
    maxAbs,
    meanAbs: total / decoded.data.length,
    differing: differing / decoded.data.length,
    sameSize: true,
  };
}

async function probe(
  id: string,
  image: Rgb8Image,
  extra: Record<string, unknown>,
): Promise<void> {
  const outcome = await runtime.processImage(id, image);
  post({
    type: "detail",
    id,
    ok: outcome !== null,
    fallbackUsed: outcome?.decision.fallbackUsed ?? null,
    generalMargin: outcome?.decision.generalMargin ?? null,
    engineMs: outcome?.totalMs ?? null,
    width: image.width,
    height: image.height,
    rgbSha256: await hex(image.data),
    tensorSha256: await tensors(image),
    ...extra,
  });
}

async function handle(request: ProbeRequest): Promise<void> {
  if (request.type === "probe-file") {
    const turns = normalizeQuarter(request.simulateRotation / 90);
    const started = performance.now();
    const image = await decodeRgb(request.file, turns);
    const decodeMs = performance.now() - started;
    const width = turns % 2 === 0 ? image.width : image.height;
    const height = turns % 2 === 0 ? image.height : image.width;
    const rgbDifference =
      request.reference === null
        ? null
        : request.reference.byteLength !== width * height * 3
          ? { maxAbs: 255, meanAbs: 255, differing: 1, sameSize: false }
          : difference(
              image,
              rotateRgbClockwise(
                { data: new Uint8Array(request.reference), width, height },
                turns,
              ),
            );
    await probe(request.id, image, { decodeMs, rgbDifference });
    return;
  }
  if (request.type === "probe-rgb") {
    const started = performance.now();
    const image = rotateRgbClockwise(
      { data: new Uint8Array(request.rgb), width: request.width, height: request.height },
      normalizeQuarter(request.simulateRotation / 90),
    );
    await probe(request.id, image, { decodeMs: performance.now() - started });
    return;
  }
  await runtime.handle(request);
}

self.onmessage = (event: MessageEvent<ProbeRequest>) => {
  void handle(event.data);
};
