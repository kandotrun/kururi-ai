export type PhotoFileKind = "image" | "raw" | "skip";

export interface PhotoFileLike {
  readonly name: string;
  readonly type: string;
  readonly webkitRelativePath?: string;
}

export interface PhotoDecodeSupport {
  heic: boolean;
}

export interface PhotoFileSplit<T> {
  photos: T[];
  skipped: number;
}

export const RAW_EXTENSIONS: readonly string[] = [
  "dng",
  "nef",
  "nrw",
  "arw",
  "cr2",
];

const IMAGE_EXTENSIONS: ReadonlySet<string> = new Set([
  "jpg",
  "jpeg",
  "jpe",
  "jfif",
  "png",
  "webp",
  "gif",
  "avif",
  "bmp",
]);

const HEIC_EXTENSIONS: ReadonlySet<string> = new Set(["heic", "heif"]);

const RAW_EXTENSION_SET: ReadonlySet<string> = new Set(RAW_EXTENSIONS);

const IMAGE_TYPES: ReadonlySet<string> = new Set([
  "image/jpeg",
  "image/pjpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
  "image/bmp",
]);

const HEIC_TYPES: ReadonlySet<string> = new Set([
  "image/heic",
  "image/heif",
  "image/heic-sequence",
  "image/heif-sequence",
]);

const RAW_TYPES: ReadonlySet<string> = new Set([
  "image/x-adobe-dng",
  "image/dng",
  "image/x-nikon-nef",
  "image/x-nikon-nrw",
  "image/x-sony-arw",
  "image/x-canon-cr2",
]);

const NO_EXTRA_SUPPORT: PhotoDecodeSupport = { heic: false };

const pathCollator = new Intl.Collator("ja", {
  numeric: true,
  sensitivity: "variant",
});

function segmentsOf(path: string): string[] {
  return path.split(/[\\/]/).filter((segment) => segment.length > 0);
}

function extensionOf(segment: string): string | null {
  const dot = segment.lastIndexOf(".");
  if (dot <= 0 || dot === segment.length - 1) {
    return null;
  }
  return segment.slice(dot + 1).toLowerCase();
}

function byExtension(
  extension: string,
  support: PhotoDecodeSupport,
): PhotoFileKind {
  if (RAW_EXTENSION_SET.has(extension)) {
    return "raw";
  }
  if (IMAGE_EXTENSIONS.has(extension)) {
    return "image";
  }
  if (HEIC_EXTENSIONS.has(extension)) {
    return support.heic ? "image" : "skip";
  }
  return "skip";
}

function byType(mimeType: string, support: PhotoDecodeSupport): PhotoFileKind {
  const type = mimeType.trim().toLowerCase();
  if (RAW_TYPES.has(type)) {
    return "raw";
  }
  if (IMAGE_TYPES.has(type)) {
    return "image";
  }
  if (HEIC_TYPES.has(type)) {
    return support.heic ? "image" : "skip";
  }
  return "skip";
}

export function classifyPhotoFile(
  name: string,
  mimeType: string,
  support: PhotoDecodeSupport = NO_EXTRA_SUPPORT,
): PhotoFileKind {
  const segments = segmentsOf(name);
  const last = segments.at(-1);
  if (
    last === undefined ||
    segments.some((segment) => segment.startsWith("."))
  ) {
    return "skip";
  }
  const extension = extensionOf(last);
  return extension === null
    ? byType(mimeType, support)
    : byExtension(extension, support);
}

function pathOf(file: PhotoFileLike): string {
  return file.webkitRelativePath || file.name;
}

export function splitPhotoFiles<T extends PhotoFileLike>(
  files: Iterable<T>,
  support: PhotoDecodeSupport = NO_EXTRA_SUPPORT,
): PhotoFileSplit<T> {
  const kept: Array<{ file: T; path: string; index: number }> = [];
  let skipped = 0;
  let index = 0;
  for (const file of files) {
    const path = pathOf(file);
    if (classifyPhotoFile(path, file.type, support) === "skip") {
      skipped += 1;
    } else {
      kept.push({ file, path, index });
    }
    index += 1;
  }
  kept.sort(
    (left, right) =>
      pathCollator.compare(left.path, right.path) || left.index - right.index,
  );
  return { photos: kept.map((entry) => entry.file), skipped };
}
