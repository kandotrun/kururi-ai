import type { ModelId } from "./contracts";

export interface DeviceHints {
  randomSeed: number;
  prefersReducedMotion: boolean;
  coarsePointer: boolean;
  shortestScreenSide: number;
  deviceMemory: number | undefined;
  hardwareConcurrency: number | undefined;
}

export interface AppConfig {
  seed: number;
  limit: number | null;
  commons: boolean;
  reducedMotion: boolean;
  lowPower: boolean;
  workers: number | null;
  model: ModelId;
  intro: boolean;
}

const MAX_WORKERS = 8;

function positiveInteger(value: string | null): number | null {
  if (value === null || !/^\d+$/.test(value)) {
    return null;
  }
  const parsed = Number(value);
  return parsed > 0 ? parsed : null;
}

export function readAppConfig(search: string, hints: DeviceHints): AppConfig {
  const params = new URLSearchParams(search);
  const seed = positiveInteger(params.get("seed")) ?? hints.randomSeed;
  const workers = positiveInteger(params.get("workers"));
  const phone = hints.coarsePointer && hints.shortestScreenSide < 820;
  const smallMemory =
    hints.deviceMemory !== undefined && hints.deviceMemory <= 4;
  const reducedMotion =
    hints.prefersReducedMotion || params.get("motion") === "reduce";
  return {
    seed,
    limit: positiveInteger(params.get("limit")),
    commons: params.get("commons") !== "off",
    reducedMotion,
    lowPower: phone || smallMemory,
    workers: workers === null ? null : Math.min(workers, MAX_WORKERS),
    model: params.get("model") === "full" ? "full" : "nano",
    intro: !reducedMotion && params.get("intro") !== "off",
  };
}
