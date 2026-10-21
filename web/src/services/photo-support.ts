import type { PhotoDecodeSupport } from "../core/photo-files";

export const HEIC_PROBE_SIDE = 16;

const PROBE_TIMEOUT_MS = 3_000;

const HEIC_PROBE = [
  "AAAAJGZ0eXBoZWljAAAAAG1pZjFNaVBybWlhZk1pSEJoZWljAAABhm1ldGEAAAAAAAAAIWhk",
  "bHIAAAAAAAAAAHBpY3QAAAAAAAAAAAAAAAAAAAAAJGRpbmYAAAAcZHJlZgAAAAAAAAABAAAA",
  "DHVybCAAAAABAAAADnBpdG0AAAAAAAEAAAAjaWluZgAAAAAAAQAAABVpbmZlAgAAAAABAABo",
  "dmMxAAAAAOZpcHJwAAAAxWlwY28AAAATY29scm5jbHgAAgACAAaAAAAADGNsbGkAywBAAAAA",
  "FGlzcGUAAAAAAAAAEAAAABAAAAAJaXJvdAAAAAAQcGl4aQAAAAADCAgIAAAAcWh2Y0MBA3AA",
  "AACwAAAAAAAe8AD8/fj4AAALA6AAAQAXQAEMAf//A3AAAAMAsAAAAwAAAwAecCShAAEAI0IB",
  "AQNwAAADALAAAAMAAAMAHqAUIEHAkwziHuRZVNwICBgCogABAAlEAcBh4shEU2QAAAAZaXBt",
  "YQAAAAAAAAABAAEGgQIDBYaEAAAAHmlsb2MAAAAARAAAAQABAAAAAQAAAboAAAAoAAAAAW1k",
  "YXQAAAAAAAAAOAAAACQoAa+ixvlD7/Cw5M7KnBSVBktmG+uKuqF6vxnNxt8e1DZoB2A=",
].join("");

interface ProbeBitmap {
  readonly width: number;
  readonly height: number;
  close(): void;
}

function probeBlob(): Blob {
  const binary = atob(HEIC_PROBE);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: "image/heic" });
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(null), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export async function detectPhotoSupport(
  decode: (blob: Blob) => Promise<ProbeBitmap> = (blob) =>
    createImageBitmap(blob),
): Promise<PhotoDecodeSupport> {
  try {
    const bitmap = await withTimeout(decode(probeBlob()), PROBE_TIMEOUT_MS);
    if (!bitmap) {
      return { heic: false };
    }
    const decoded =
      bitmap.width === HEIC_PROBE_SIDE && bitmap.height === HEIC_PROBE_SIDE;
    bitmap.close();
    return { heic: decoded };
  } catch {
    return { heic: false };
  }
}
