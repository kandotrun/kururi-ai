import type { Quarter } from "../contracts";

const DASH = "—";

const WHOLE = new Intl.NumberFormat("ja-JP", {
  maximumFractionDigits: 0,
});

const ONE_DECIMAL = new Intl.NumberFormat("ja-JP", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

const CORRECTION_PHRASES: Readonly<Record<Quarter, string>> = {
  0: "回転なし",
  1: "時計回りに 90°",
  2: "180°",
  3: "反時計回りに 90°",
};

function known(value: number | null): value is number {
  return value !== null && Number.isFinite(value);
}

export function formatCount(value: number): string {
  return known(value) ? WHOLE.format(Math.round(value)) : DASH;
}

export function formatPercent(ratio: number | null): string {
  return known(ratio) ? `${ONE_DECIMAL.format(ratio * 100)}%` : DASH;
}

export function formatPerSecond(value: number | null): string {
  return known(value) ? ONE_DECIMAL.format(value) : DASH;
}

export function formatMs(value: number | null): string {
  return known(value) ? WHOLE.format(Math.round(value)) : DASH;
}

export function formatConfidence(probability: number): string {
  const clamped = Math.min(1, Math.max(0, probability));
  return `${Math.floor(clamped * 100 + 1e-9)}%`;
}

const LARGE_BYTES = 100_000_000;
const MEGABYTE = 1_000_000;

function megabytes(bytes: number, whole: boolean, roundDown: boolean): string {
  const scale = whole ? 1 : 10;
  const value = bytes / MEGABYTE;
  const rounded = roundDown
    ? Math.floor(value * scale + 1e-9) / scale
    : Math.round(value * scale) / scale;
  return (whole ? WHOLE : ONE_DECIMAL).format(rounded);
}

export function formatSize(bytes: number): string {
  return `${megabytes(bytes, bytes >= LARGE_BYTES, false)}MB`;
}

export function formatMegabytePair(loaded: number, total: number): string {
  const whole = total >= LARGE_BYTES;
  const shown = Math.min(Math.max(0, loaded), total);
  return `${megabytes(shown, whole, true)} / ${megabytes(total, whole, false)} MB`;
}

export function correctionPhrase(quarter: Quarter): string {
  return CORRECTION_PHRASES[quarter];
}
