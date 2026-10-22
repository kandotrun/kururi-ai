import type { ModelId, ModelOption } from "../contracts";

export const NANO_BYTES = 11_908_441;
export const FULL_GENERAL_BYTES = 551_055_739;
export const FULL_FALLBACK_BYTES = 199_309_562;

const NO_WEBGPU = "このブラウザは WebGPU に対応していないため使えません";
const NO_WEBGPU_FALLBACK =
  "このブラウザは WebGPU に対応していないため、軽量モデルで判定します。";

export interface ModelEnvironment {
  webgpu: boolean;
  fullBaseUrl: string | null;
}

export function modelOptions(environment: ModelEnvironment): ModelOption[] {
  const nano: ModelOption = {
    id: "nano",
    label: "軽量",
    version: "v2-nano",
    sizeBytes: NANO_BYTES,
    testAccuracy: 0.8182,
    needsWebGPU: false,
    available: true,
    unavailableReason: null,
  };
  if (environment.fullBaseUrl === null) {
    return [nano];
  }
  return [
    nano,
    {
      id: "full",
      label: "高精度",
      version: "v2.0.0",
      sizeBytes: FULL_GENERAL_BYTES,
      testAccuracy: 0.9943,
      needsWebGPU: true,
      available: environment.webgpu,
      unavailableReason: environment.webgpu ? null : NO_WEBGPU,
    },
  ];
}

export function resolveModel(
  requested: ModelId,
  options: readonly ModelOption[],
): { model: ModelId; notice: string | null } {
  const option = options.find((candidate) => candidate.id === requested);
  if (option?.available) {
    return { model: requested, notice: null };
  }
  if (!option) {
    return {
      model: "nano",
      notice: "高精度モデルは公開準備中のため、軽量モデルで判定します。",
    };
  }
  return {
    model: "nano",
    notice: option.needsWebGPU
      ? NO_WEBGPU_FALLBACK
      : "高精度モデルは使えないため、軽量モデルで判定します。",
  };
}
