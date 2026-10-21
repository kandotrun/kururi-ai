export interface FolderEntry {
  readonly name: string;
  readonly fullPath: string;
  readonly isFile: boolean;
  readonly isDirectory: boolean;
}

export interface FolderAccess<E extends FolderEntry> {
  reader(directory: E): () => Promise<readonly E[]>;
  file(entry: E): Promise<File>;
}

export interface FolderWalkOptions {
  onFile?(file: File): void;
  signal?: AbortSignal;
  maxFiles?: number;
  maxDepth?: number;
  concurrency?: number;
}

export interface FolderWalkResult {
  files: File[];
  failed: number;
  truncated: boolean;
}

export const FOLDER_FILE_LIMIT = 20_000;
const DEFAULT_DEPTH = 24;
const DEFAULT_CONCURRENCY = 8;

const SYSTEM_FOLDERS: ReadonlySet<string> = new Set([
  "@eadir",
  "@recycle",
  "@recently-snapshot",
  "#recycle",
  "#snapshot",
  "$recycle.bin",
  "system volume information",
]);

const collator = new Intl.Collator("ja", { numeric: true });

export function isSystemFolder(name: string): boolean {
  return name.startsWith(".") || SYSTEM_FOLDERS.has(name.toLowerCase());
}

export function inSystemFolder(path: string): boolean {
  const segments = path.split(/[\\/]/).filter((segment) => segment.length > 0);
  return segments.slice(0, -1).some(isSystemFolder);
}

export function withRelativePath(file: File, path: string): File {
  if (path === "" || file.webkitRelativePath) {
    return file;
  }
  Object.defineProperty(file, "webkitRelativePath", {
    value: path,
    configurable: true,
    enumerable: true,
  });
  return file;
}

function relativePath(entry: FolderEntry): string {
  return entry.fullPath.replace(/^\/+/, "") || entry.name;
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

type Limiter = (task: () => Promise<void>) => Promise<void>;

function createLimiter(size: number): Limiter {
  let active = 0;
  const waiting: Array<() => void> = [];
  return async (task) => {
    if (active >= size) {
      await new Promise<void>((resolve) => waiting.push(resolve));
    }
    active += 1;
    try {
      await task();
    } finally {
      active -= 1;
      waiting.shift()?.();
    }
  };
}

async function readAll<E extends FolderEntry>(
  read: () => Promise<readonly E[]>,
  budget: number,
  signal: AbortSignal | undefined,
): Promise<E[]> {
  const entries: E[] = [];
  for (;;) {
    signal?.throwIfAborted();
    const batch = await read();
    if (batch.length === 0) {
      return entries;
    }
    entries.push(...batch);
    if (entries.length >= budget) {
      return entries;
    }
  }
}

function inPathOrder<E extends FolderEntry>(entries: readonly E[]): E[] {
  return [...entries].sort((left, right) => collator.compare(left.name, right.name));
}

export async function walkFolder<E extends FolderEntry>(
  root: E,
  access: FolderAccess<E>,
  options: FolderWalkOptions = {},
): Promise<FolderWalkResult> {
  const { signal, onFile } = options;
  const maxFiles = Math.max(1, options.maxFiles ?? FOLDER_FILE_LIMIT);
  const maxDepth = options.maxDepth ?? DEFAULT_DEPTH;
  const budget = maxFiles * 2 + 64;
  const limit = createLimiter(Math.max(1, options.concurrency ?? DEFAULT_CONCURRENCY));
  const slots: Array<File | null> = [];
  const pending: Promise<void>[] = [];
  const visited = new Set<string>();
  let failed = 0;
  let truncated = false;

  function take(entry: E): void {
    const index = slots.length;
    slots.push(null);
    pending.push(
      limit(async () => {
        signal?.throwIfAborted();
        try {
          const file = withRelativePath(await access.file(entry), relativePath(entry));
          slots[index] = file;
          onFile?.(file);
        } catch (error) {
          if (isAbort(error)) {
            throw error;
          }
          failed += 1;
        }
      }),
    );
  }

  async function visit(directory: E, depth: number): Promise<void> {
    if (visited.has(directory.fullPath)) {
      return;
    }
    visited.add(directory.fullPath);
    let children: E[];
    try {
      children = await readAll(access.reader(directory), budget, signal);
    } catch (error) {
      if (isAbort(error)) {
        throw error;
      }
      failed += 1;
      return;
    }
    for (const child of inPathOrder(children)) {
      signal?.throwIfAborted();
      if (child.isDirectory) {
        if (depth < maxDepth && !isSystemFolder(child.name)) {
          await visit(child, depth + 1);
        }
      } else if (child.isFile) {
        if (slots.length >= maxFiles) {
          truncated = true;
        } else {
          take(child);
        }
      }
      if (truncated) {
        return;
      }
    }
  }

  try {
    if (root.isDirectory) {
      await visit(root, 0);
    } else if (root.isFile) {
      take(root);
    }
  } catch (error) {
    await Promise.allSettled(pending);
    throw error;
  }
  const outcomes = await Promise.allSettled(pending);
  const aborted = outcomes.find(
    (outcome): outcome is PromiseRejectedResult => outcome.status === "rejected",
  );
  if (aborted) {
    throw aborted.reason;
  }
  signal?.throwIfAborted();
  return {
    files: slots.filter((file): file is File => file !== null),
    failed,
    truncated,
  };
}
