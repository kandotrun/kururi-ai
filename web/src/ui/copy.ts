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
import { FULL_FALLBACK_BYTES } from "../core/model-profiles";
import { expectedCorrection } from "../core/rotation";
import type { ConfirmContent } from "./confirm-slip";
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

const UNGRADED = "答え合わせなし";

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
    return record.phase === "failed"
      ? { tone: "failed", label: UNGRADED, detail: null }
      : { tone: "pending", label: pendingText(record), detail: null };
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
  return { tone: "unknown", label: UNGRADED, detail: null };
}

export function failureReason(record: PhotoRecord): string | null {
  if (record.phase !== "failed" || record.prediction) {
    return null;
  }
  const reason = record.error?.trim() ?? "";
  return reason === "" ? "写真を読み込めませんでした" : reason;
}

export function failedPhotosNotice(count: number): string {
  return `読み込めなかった写真が ${formatCount(count)}枚あります。理由は一覧で見られます。`;
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

export interface CreditParts {
  license: string | null;
  author: string;
  full: string;
}

export function creditParts(source: PhotoSource): CreditParts {
  const full = creditText(source);
  const attribution = source.kind === "commons" ? source.attribution : null;
  return attribution
    ? { license: attribution.license, author: attribution.author, full }
    : { license: null, author: full, full };
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
    label: status === "finished" ? "並べ終えた写真" : "判定して並べた写真",
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
  const lead = status === "paused" ? "一時停止中。" : "";
  const head = `${label} ${formatCount(value)}枚。`;
  const tail =
    stats.accuracy === null ? "" : `正解率 ${formatPercent(stats.accuracy)}。`;
  return `${lead}${head}${tail}`;
}

const ANNOUNCE_STEP = 500;

export function announcementKey(
  stats: DeskStats,
  status: StreamStatus,
): string | null {
  if (stats.placed === 0) {
    return null;
  }
  return `${status}:${Math.floor(stats.placed / ANNOUNCE_STEP)}`;
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
  if (status === "model-failed") {
    return "モデルを読み込めませんでした";
  }
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

function followUpBytes(option: ModelOption): number {
  return option.id === "full" ? FULL_FALLBACK_BYTES : 0;
}

export function modelOptionText(option: ModelOption): ModelOptionText {
  return {
    label: option.label,
    detail: `${option.version} ${formatSize(option.sizeBytes + followUpBytes(option))}`,
    meta: `正解率 ${formatPercent(option.testAccuracy)}（未使用テスト）`,
  };
}

export type ModelSwitch = "none" | "confirm";

export function modelSwitch(current: ModelId, chosen: ModelOption): ModelSwitch {
  return chosen.id === current || !chosen.available ? "none" : "confirm";
}

export function switchConfirmText(option: ModelOption): string {
  const extra = followUpBytes(option);
  if (extra === 0) {
    return `約${formatSize(option.sizeBytes)}の${option.label}モデルで判定します。`;
  }
  return `約${formatSize(option.sizeBytes)}のモデルを読み込みます。準備ができると、判定に迷う写真に使う補助モデル（約${formatSize(extra)}）も続けて読み込むので、合わせて約${formatSize(option.sizeBytes + extra)}です。読み込みが終わるまで写真はばらばらの向きのまま並べておき、終わったらまとめて直します。2回目からはブラウザに保存したモデルを使います。`;
}

const SWITCH_NOTE =
  "切り替えるとページを開き直し、最初から並べ直します。並べていた自分の写真は、もう一度選んでください。";

export function switchConfirmContent(option: ModelOption): ConfirmContent {
  return {
    title: `${option.label}モデルに切り替えますか`,
    body: switchConfirmText(option),
    note: SWITCH_NOTE,
    confirmLabel: option.id === "full" ? "読み込む" : "切り替える",
    cancelLabel: "やめる",
  };
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

export function folderProgressText(
  progress: FolderProgress,
  heicSkipped = 0,
): string {
  const heic = Math.min(Math.max(0, heicSkipped), progress.skipped);
  const other = progress.skipped - heic;
  const notes = [
    heic > 0 ? `HEIC の写真 ${formatCount(heic)}枚は、このブラウザでは開けません` : "",
    other > 0 ? `動画など ${formatCount(other)}件は対象外` : "",
  ].filter((note) => note !== "");
  const left = notes.length > 0 ? `（${notes.join("。")}）` : "";
  if (progress.accepted > 0) {
    return `${formatCount(progress.accepted)}枚を並べます${left}`;
  }
  return progress.skipped > 0
    ? `並べられる写真がありませんでした${left}`
    : "写真が見つかりませんでした";
}

export function newRowsText(count: number): string {
  return `新しい ${formatCount(count)}枚を表示`;
}

export function folderTruncatedText(limit: number): string {
  return `フォルダの中のファイルが多いため、最初の ${formatCount(limit)}件だけ読み込みました。`;
}

export function sentenceOf(text: string): string {
  const trimmed = text.trim();
  return /[。．！？]$/.test(trimmed) ? trimmed : `${trimmed}。`;
}
