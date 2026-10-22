import {
  NO_PHOTO_FILES_NOTICE,
  folderProgressText,
  folderTruncatedText,
} from "./copy";
import {
  FOLDER_FILE_LIMIT,
  type FolderAccess,
  type FolderEntry,
  inSystemFolder,
  walkFolder,
} from "./folder-walk";

export type FileOrigin = "files" | "folder";

export type NoticeKind = "empty" | "warning";

export interface FolderImportOptions<E extends FolderEntry> {
  access: FolderAccess<E>;
  countsAsPhoto(file: File): boolean;
  mayBePhoto(file: File): boolean;
  onFiles(files: File[]): void;
  onScan(photos: number | null): void;
  onNotice(message: string, kind: NoticeKind): void;
  maxFiles?: number;
  throttleMs?: number;
  now?: () => number;
}

export interface FolderImport<E extends FolderEntry> {
  readonly busy: boolean;
  importFolders(folders: readonly E[]): Promise<void>;
  addFiles(files: readonly File[], origin: FileOrigin): void;
  cancel(): void;
}

const DEFAULT_THROTTLE_MS = 120;

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

export function createFolderImport<E extends FolderEntry>(
  options: FolderImportOptions<E>,
): FolderImport<E> {
  const maxFiles = options.maxFiles ?? FOLDER_FILE_LIMIT;
  const throttleMs = options.throttleMs ?? DEFAULT_THROTTLE_MS;
  const now = options.now ?? (() => performance.now());
  let queue: Promise<void> = Promise.resolve();
  let waiting = 0;
  let controller: AbortController | null = null;
  let generation = 0;

  function addFiles(picked: readonly File[], origin: FileOrigin): void {
    const files =
      origin === "folder"
        ? picked.filter((file) => !inSystemFolder(file.webkitRelativePath || file.name))
        : [...picked];
    if (files.some((file) => options.mayBePhoto(file))) {
      options.onFiles(files);
      return;
    }
    if (origin === "folder") {
      options.onNotice(
        folderProgressText({
          found: files.length,
          accepted: 0,
          skipped: files.length,
          done: true,
        }),
        "empty",
      );
    } else if (files.length > 0) {
      options.onNotice(NO_PHOTO_FILES_NOTICE, "empty");
    }
  }

  async function run(folders: readonly E[], ticket: number): Promise<void> {
    if (ticket !== generation) {
      return;
    }
    const abort = new AbortController();
    controller = abort;
    let photos = 0;
    let shownAt = Number.NEGATIVE_INFINITY;
    options.onScan(0);
    function count(file: File): void {
      if (!options.countsAsPhoto(file)) {
        return;
      }
      photos += 1;
      const time = now();
      if (time - shownAt >= throttleMs) {
        shownAt = time;
        options.onScan(photos);
      }
    }
    try {
      for (const folder of folders) {
        const result = await walkFolder(folder, options.access, {
          signal: abort.signal,
          maxFiles,
          onFile: count,
        });
        if (abort.signal.aborted) {
          return;
        }
        if (result.truncated) {
          options.onNotice(folderTruncatedText(maxFiles), "warning");
        }
        addFiles(result.files, "folder");
      }
    } catch (error) {
      if (!isAbort(error)) {
        console.warn(error);
        options.onNotice("フォルダを読み込めませんでした。", "warning");
      }
    } finally {
      if (controller === abort) {
        controller = null;
      }
      options.onScan(null);
    }
  }

  return {
    get busy() {
      return waiting > 0;
    },
    importFolders(folders) {
      if (folders.length === 0) {
        return queue;
      }
      const ticket = generation;
      waiting += 1;
      queue = queue
        .then(() => run(folders, ticket))
        .finally(() => {
          waiting -= 1;
        });
      return queue;
    },
    addFiles,
    cancel() {
      generation += 1;
      controller?.abort();
      options.onScan(null);
    },
  };
}
