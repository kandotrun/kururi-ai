import type { ModelProgress } from "../contracts";

export interface ModelSpec {
  url: string;
  weight: number;
}

export interface LoadedModel {
  bytes: ArrayBuffer;
  weight: number;
}

const FETCH_FAILED = "モデルを取得できませんでした";

function contentLength(response: Response): number | null {
  const header = response.headers.get("content-length");
  if (header === null || !/^\d+$/.test(header.trim())) {
    return null;
  }
  return Number(header.trim());
}

function concatenate(
  chunks: readonly Uint8Array[],
  length: number,
): ArrayBuffer {
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result.buffer;
}

async function readBody(
  response: Response,
  onChunk: (bytes: number) => void,
): Promise<ArrayBuffer> {
  if (!response.body) {
    const buffer = await response.arrayBuffer();
    onChunk(buffer.byteLength);
    return buffer;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    chunks.push(value);
    length += value.byteLength;
    onChunk(value.byteLength);
  }
  return concatenate(chunks, length);
}

async function request(fetcher: typeof fetch, url: string): Promise<Response> {
  let response: Response;
  try {
    response = await fetcher(url);
  } catch {
    throw new Error(`${FETCH_FAILED}（ネットワークに接続できません）`);
  }
  if (!response.ok) {
    throw new Error(`${FETCH_FAILED}（HTTP ${response.status}）`);
  }
  return response;
}

export async function loadModels(
  specs: readonly ModelSpec[],
  onProgress: (progress: ModelProgress) => void,
  fetcher: typeof fetch = (input, init) => fetch(input, init),
): Promise<LoadedModel[]> {
  const loaded = specs.map(() => 0);
  const sizes: Array<number | null | undefined> = specs.map(() => undefined);
  const sum = (values: readonly number[]) =>
    values.reduce((total, value) => total + value, 0);
  const report = () => {
    const loadedBytes = sum(loaded);
    const known = sizes.every((size) => typeof size === "number");
    const total = known ? sum(sizes.map((size) => size ?? 0)) : 0;
    onProgress({
      loaded: loadedBytes,
      total: total > 0 ? Math.max(total, loadedBytes) : 0,
      ready: false,
    });
  };
  const models = await Promise.all(
    specs.map(async (spec, index) => {
      const response = await request(fetcher, spec.url);
      sizes[index] = contentLength(response);
      report();
      const bytes = await readBody(response, (count) => {
        loaded[index] = (loaded[index] ?? 0) + count;
        report();
      });
      return { bytes, weight: spec.weight };
    }),
  );
  const finalBytes = sum(loaded);
  onProgress({ loaded: finalBytes, total: finalBytes, ready: true });
  return models;
}
