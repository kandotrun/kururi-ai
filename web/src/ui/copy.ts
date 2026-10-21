import type {
  DeskStats,
  FolderProgress,
  ModelId,
  ModelOption,
  ModelProgress,
  PhotoRecord,
  PhotoSource,
  Quarter,
  StreamStatus,
} from "../contracts";
import { placeLabel } from "../core/geo";
import { expectedCorrection } from "../core/rotation";
import {
  correctionPhrase,
  formatCount,
  formatMegabytePair,
  formatPercent,
  formatSize,
} from "./format";

export type VerdictTone = "pending" | "correct" | "miss" | "unknown" | "failed";

export interface Verdict {
  tone: VerdictTone;
  label: string;
  detail: string | null;
}

const TURN_DEGREES: Readonly<Record<Quarter, number>> = {
  0: 0,
  1: 90,
  2: 180,
  3: -90,
};

function pendingText(record: PhotoRecord): string {
  if (record.phase === "failed") {
    return "読み込めませんでした";
  }
  return record.phase === "scanning" ? "判定中" : "判定待ち";
}

export function judgementText(record: PhotoRecord): string {
  return record.prediction
    ? correctionPhrase(record.prediction.correction)
    : pendingText(record);
}

export function verdictOf(record: PhotoRecord): Verdict {
  if (!record.prediction) {
    return {
      tone: record.phase === "failed" ? "failed" : "pending",
      label: pendingText(record),
      detail: null,
    };
  }
  if (record.correct === true) {
    return { tone: "correct", label: "正解", detail: null };
  }
  const fix = record.source.uprightFix;
  if (record.correct === false && fix !== null) {
    const expected = correctionPhrase(
      expectedCorrection(fix, record.simulated),
    );
    const spacer = /^[0-9]/.test(expected) ? " " : "";
    return {
      tone: "miss",
      label: "不正解",
      detail: `正しくは${spacer}${expected}`,
    };
  }
  return { tone: "unknown", label: "答え合わせなし", detail: null };
}

export function verdictText(verdict: Verdict): string {
  return verdict.detail === null
    ? verdict.label
    : `${verdict.label}（${verdict.detail}）`;
}

export function creditText(source: PhotoSource): string {
  if (source.kind === "sample") {
    return "サンプル写真";
  }
  if (source.kind === "user") {
    return "あなたの写真";
  }
  return source.attribution
    ? `${source.attribution.author} / ${source.attribution.license}`
    : "Wikimedia Commons";
}

export function photoPlace(source: PhotoSource): string | null {
  return source.kind === "user" ? null : placeLabel(source.location);
}

export function loupeRotation(record: PhotoRecord): number {
  const base = record.simulated * 90;
  if (record.phase !== "placed" || !record.prediction) {
    return base;
  }
  return base + TURN_DEGREES[record.prediction.correction];
}

export interface HeadlineState {
  label: string;
  value: number;
}

export function headlineState(
  stats: DeskStats | null,
  status: StreamStatus,
): HeadlineState {
  if (!stats || stats.placed === 0) {
    return { label: "向きがばらばらの写真", value: stats?.crooked ?? 0 };
  }
  return {
    label: status === "finished" ? "並べ終えた写真" : "向きを直した写真",
    value: stats.placed,
  };
}

export function progressAnnouncement(
  stats: DeskStats,
  status: StreamStatus,
): string {
  if (stats.placed === 0) {
    return "";
  }
  const { label, value } = headlineState(stats, status);
  const head = `${label} ${formatCount(value)}枚。`;
  const tail =
    stats.accuracy === null ? "" : `正解率 ${formatPercent(stats.accuracy)}。`;
  return `${head}${tail}`;
}

export type HeadlineChange = "jump" | "ease" | "none";

export function headlineChange(
  previous: HeadlineState | null,
  next: HeadlineState,
): HeadlineChange {
  if (!previous || previous.label !== next.label) {
    return "jump";
  }
  return previous.value === next.value ? "none" : "ease";
}

export type ModelName = Pick<ModelOption, "label" | "version">;

function downloaded(progress: ModelProgress): boolean {
  return progress.total > 0 && progress.loaded >= progress.total;
}

export function modelStateText(
  status: StreamStatus,
  progress: ModelProgress,
  model: ModelName,
): string {
  if (status === "loading-model" || !progress.ready) {
    if (progress.total <= 0 || downloaded(progress)) {
      return `${model.label}モデルを準備中`;
    }
    return `${model.label}モデル ${formatMegabytePair(progress.loaded, progress.total)}`;
  }
  if (status === "paused") {
    return "一時停止中";
  }
  if (status === "finished") {
    return "並べ終えました";
  }
  return `${model.version} で判定中`;
}

export interface ModelOptionText {
  label: string;
  detail: string;
  meta: string;
}

export function modelOptionText(option: ModelOption): ModelOptionText {
  return {
    label: option.label,
    detail: `${option.version} ${formatSize(option.sizeBytes)}`,
    meta: `未使用テスト ${formatPercent(option.testAccuracy)}`,
  };
}

export type ModelSwitch = "none" | "confirm" | "switch";

export function modelSwitch(current: ModelId, chosen: ModelOption): ModelSwitch {
  if (chosen.id === current || !chosen.available) {
    return "none";
  }
  return chosen.id === "full" ? "confirm" : "switch";
}

export function switchConfirmText(option: ModelOption): string {
  return `約${formatSize(option.sizeBytes)}のモデルを読み込みます。読み込みが終わるまで写真はばらばらの向きのまま並べておき、終わったらまとめて直します。2回目からはブラウザに保存したモデルを使います。`;
}

export function modelLoadingNote(progress: ModelProgress): string {
  if (progress.ready) {
    return "";
  }
  if (downloaded(progress)) {
    return "準備中";
  }
  if (progress.total <= 0) {
    return "読み込み中";
  }
  const percent = Math.floor((Math.max(0, progress.loaded) / progress.total) * 100);
  return `読み込み中 ${percent}%`;
}

export const NO_PHOTO_FILES_NOTICE =
  "写真が見つかりませんでした。JPEG、PNG、WebP、DNG などの写真を選んでください。";

export function folderScanText(photos: number): string {
  return photos > 0
    ? `フォルダを読み込み中 ${formatCount(photos)}枚`
    : "フォルダを読み込み中";
}

export function folderProgressText(progress: FolderProgress): string {
  const left =
    progress.skipped > 0
      ? `（動画など ${formatCount(progress.skipped)}件は対象外）`
      : "";
  if (progress.accepted > 0) {
    return `${formatCount(progress.accepted)}枚を並べます${left}`;
  }
  return progress.skipped > 0
    ? `並べられる写真がありませんでした${left}`
    : "写真が見つかりませんでした";
}

export function folderTruncatedText(limit: number): string {
  return `フォルダの中のファイルが多いため、最初の ${formatCount(limit)}件だけ読み込みました。`;
}
