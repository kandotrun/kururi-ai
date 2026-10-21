const IMAGE_EXTENSIONS = new Set([
  "jpg",
  "jpeg",
  "png",
  "webp",
  "gif",
  "avif",
  "bmp",
  "heic",
  "heif",
  "tif",
  "tiff",
]);

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot + 1).toLowerCase();
}

function isImage(file: File): boolean {
  if (file.type) {
    return file.type.startsWith("image/");
  }
  return IMAGE_EXTENSIONS.has(extensionOf(file.name));
}

export function pickImageFiles(files: Iterable<File> | null): File[] {
  return files ? Array.from(files).filter(isImage) : [];
}

export function carriesFiles(
  types: Iterable<string> | null | undefined,
): boolean {
  return types ? Array.from(types).includes("Files") : false;
}
