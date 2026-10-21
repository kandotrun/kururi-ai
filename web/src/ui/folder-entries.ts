import type { FolderAccess } from "./folder-walk";

function isDirectoryEntry(entry: FileSystemEntry): entry is FileSystemDirectoryEntry {
  return entry.isDirectory;
}

function isFileEntry(entry: FileSystemEntry): entry is FileSystemFileEntry {
  return entry.isFile;
}

export const entryAccess: FolderAccess<FileSystemEntry> = {
  reader(directory) {
    if (!isDirectoryEntry(directory)) {
      return async () => [];
    }
    const reader = directory.createReader();
    return () =>
      new Promise<FileSystemEntry[]>((resolve, reject) =>
        reader.readEntries(resolve, reject),
      );
  },
  file(entry) {
    if (!isFileEntry(entry)) {
      return Promise.reject(new Error(`${entry.fullPath} is not a file`));
    }
    return new Promise<File>((resolve, reject) => entry.file(resolve, reject));
  },
};

export interface DroppedItems {
  files: File[];
  folders: FileSystemEntry[];
}

function entryOf(item: DataTransferItem): FileSystemEntry | null {
  return typeof item.webkitGetAsEntry === "function"
    ? item.webkitGetAsEntry()
    : null;
}

export function droppedItems(transfer: DataTransfer | null): DroppedItems {
  if (!transfer) {
    return { files: [], folders: [] };
  }
  const items = Array.from(transfer.items).filter((item) => item.kind === "file");
  if (items.length === 0) {
    return { files: Array.from(transfer.files), folders: [] };
  }
  const files: File[] = [];
  const folders: FileSystemEntry[] = [];
  for (const item of items) {
    const entry = entryOf(item);
    if (entry?.isDirectory) {
      folders.push(entry);
      continue;
    }
    const file = item.getAsFile();
    if (file) {
      files.push(file);
    }
  }
  return { files, folders };
}
