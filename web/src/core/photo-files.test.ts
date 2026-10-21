import { describe, expect, it } from "vitest";
import {
  classifyPhotoFile,
  RAW_EXTENSIONS,
  splitPhotoFiles,
  type PhotoFileLike,
} from "./photo-files";

function entry(
  name: string,
  type = "",
  webkitRelativePath = "",
): PhotoFileLike {
  return { name, type, webkitRelativePath };
}

describe("classifyPhotoFile", () => {
  it("accepts the image formats every browser decodes", () => {
    for (const name of [
      "a.jpg",
      "b.JPEG",
      "c.jpe",
      "d.jfif",
      "e.png",
      "f.webp",
      "g.gif",
      "h.avif",
      "i.bmp",
    ]) {
      expect(classifyPhotoFile(name, "")).toBe("image");
    }
  });

  it("treats camera RAW files with an embedded JPEG as raw", () => {
    expect(classifyPhotoFile("photo-0001.DNG", "image/x-adobe-dng")).toBe(
      "raw",
    );
    expect(classifyPhotoFile("frame-0001.NEF", "")).toBe("raw");
    expect(classifyPhotoFile("frame-0001.nrw", "")).toBe("raw");
    expect(classifyPhotoFile("frame-01234.ARW", "")).toBe("raw");
    expect(classifyPhotoFile("photo-1234.CR2", "")).toBe("raw");
    expect([...RAW_EXTENSIONS].sort()).toEqual([
      "arw",
      "cr2",
      "dng",
      "nef",
      "nrw",
    ]);
  });

  it("skips RAW formats whose preview is not in a TIFF directory", () => {
    for (const name of ["a.CR3", "b.RAF", "c.ORF", "d.RW2", "e.PEF", "f.x3f"]) {
      expect(classifyPhotoFile(name, "")).toBe("skip");
    }
  });

  it("skips HEIC and TIFF unless the browser can decode HEIC", () => {
    expect(classifyPhotoFile("photo-0002.HEIC", "image/heic")).toBe("skip");
    expect(classifyPhotoFile("photo-0002.heif", "")).toBe("skip");
    expect(classifyPhotoFile("scan.tif", "image/tiff")).toBe("skip");
    expect(
      classifyPhotoFile("photo-0002.HEIC", "image/heic", { heic: true }),
    ).toBe("image");
    expect(classifyPhotoFile("photo", "image/heif", { heic: true })).toBe(
      "image",
    );
    expect(classifyPhotoFile("scan.tiff", "", { heic: true })).toBe("skip");
  });

  it("skips videos, sidecars and anything without a known type", () => {
    for (const [name, type] of [
      ["photo-0003.MOV", "video/quicktime"],
      ["clip.mp4", "video/mp4"],
      ["drone-0001.LRF", ""],
      ["photo-0003.AAE", ""],
      ["photo-0003.xmp", "application/rdf+xml"],
      ["notes.txt", "text/plain"],
      ["Thumbs.db", ""],
      ["README", ""],
      ["archive.zip", "application/zip"],
    ] as const) {
      expect(classifyPhotoFile(name, type)).toBe("skip");
    }
  });

  it("skips hidden files and macOS resource forks even with image names", () => {
    expect(classifyPhotoFile(".DS_Store", "")).toBe("skip");
    expect(classifyPhotoFile("._photo-0004.JPG", "image/jpeg")).toBe("skip");
    expect(classifyPhotoFile(".hidden.png", "image/png")).toBe("skip");
    expect(classifyPhotoFile("Album/.thumbs/a.jpg", "image/jpeg")).toBe("skip");
  });

  it("falls back to the MIME type when the name has no extension", () => {
    expect(classifyPhotoFile("photo", "image/jpeg")).toBe("image");
    expect(classifyPhotoFile("photo", "image/png")).toBe("image");
    expect(classifyPhotoFile("photo", "IMAGE/WEBP")).toBe("image");
    expect(classifyPhotoFile("raw", "image/x-adobe-dng")).toBe("raw");
    expect(classifyPhotoFile("raw", "image/x-nikon-nef")).toBe("raw");
    expect(classifyPhotoFile("raw", "image/x-sony-arw")).toBe("raw");
    expect(classifyPhotoFile("raw", "image/x-canon-cr2")).toBe("raw");
    expect(classifyPhotoFile("photo", "image/svg+xml")).toBe("skip");
    expect(classifyPhotoFile("photo", "image/heic")).toBe("skip");
    expect(classifyPhotoFile("clip", "video/mp4")).toBe("skip");
    expect(classifyPhotoFile("photo", "")).toBe("skip");
  });

  it("trusts a known extension over a misleading MIME type", () => {
    expect(classifyPhotoFile("photo.jpg", "application/octet-stream")).toBe(
      "image",
    );
    expect(classifyPhotoFile("photo.DNG", "application/octet-stream")).toBe(
      "raw",
    );
    expect(classifyPhotoFile("clip.mov", "image/jpeg")).toBe("skip");
  });

  it("reads the extension of the last path segment only", () => {
    expect(classifyPhotoFile("2026.10/photo-0005", "")).toBe("skip");
    expect(classifyPhotoFile("trip.v2/photo-0005.JPG", "")).toBe("image");
    expect(classifyPhotoFile("photo.", "")).toBe("skip");
  });
});

describe("splitPhotoFiles", () => {
  it("keeps photos and RAW files and counts everything else as skipped", () => {
    const files = [
      entry("a.jpg", "image/jpeg"),
      entry("b.MOV", "video/quicktime"),
      entry("c.DNG"),
      entry(".DS_Store"),
      entry("d.HEIC", "image/heic"),
      entry("e.png", "image/png"),
    ];
    const { photos, skipped } = splitPhotoFiles(files);
    expect(photos.map((file) => file.name)).toEqual([
      "a.jpg",
      "c.DNG",
      "e.png",
    ]);
    expect(skipped).toBe(3);
  });

  it("returns the same file objects it was given", () => {
    const first = entry("a.jpg", "image/jpeg");
    const { photos } = splitPhotoFiles([first]);
    expect(photos[0]).toBe(first);
  });

  it("orders photos by their path inside the folder, numbers by value", () => {
    const files = [
      entry("photo-10.JPG", "", "Album/2024/10/photo-10.JPG"),
      entry("photo-2.JPG", "", "Album/2024/10/photo-2.JPG"),
      entry("photo-9.DNG", "", "Album/2024/9/photo-9.DNG"),
      entry("cover.png", "", "Album/cover.png"),
      entry("photo-1.JPG", "", "Album/2023/12/photo-1.JPG"),
    ];
    expect(
      splitPhotoFiles(files).photos.map((file) => file.webkitRelativePath),
    ).toEqual([
      "Album/2023/12/photo-1.JPG",
      "Album/2024/9/photo-9.DNG",
      "Album/2024/10/photo-2.JPG",
      "Album/2024/10/photo-10.JPG",
      "Album/cover.png",
    ]);
  });

  it("orders by name when there is no folder path and keeps ties stable", () => {
    const later = entry("same.jpg", "image/jpeg");
    const earlier = entry("same.jpg", "image/jpeg");
    const files = [entry("b.jpg"), later, entry("a.png"), earlier];
    const { photos } = splitPhotoFiles(files);
    expect(photos.map((file) => file.name)).toEqual([
      "a.png",
      "b.jpg",
      "same.jpg",
      "same.jpg",
    ]);
    expect(photos[2]).toBe(later);
    expect(photos[3]).toBe(earlier);
  });

  it("works with real File objects and plain iterables", () => {
    const files = new Set([
      new File([new Uint8Array([1])], "z.jpg", { type: "image/jpeg" }),
      new File([new Uint8Array([1])], "y.mp4", { type: "video/mp4" }),
    ]);
    const { photos, skipped } = splitPhotoFiles(files);
    expect(photos.map((file) => file.name)).toEqual(["z.jpg"]);
    expect(photos[0]).toBeInstanceOf(File);
    expect(skipped).toBe(1);
  });

  it("passes the decoding support through to the classification", () => {
    const files = [entry("a.HEIC", "image/heic"), entry("b.jpg")];
    expect(splitPhotoFiles(files).photos).toHaveLength(1);
    expect(splitPhotoFiles(files, { heic: true }).photos).toHaveLength(2);
  });

  it("skips files inside hidden folders of the selection", () => {
    const files = [
      entry("a.jpg", "image/jpeg", "Album/.trash/a.jpg"),
      entry("b.jpg", "image/jpeg", "Album/b.jpg"),
    ];
    const { photos, skipped } = splitPhotoFiles(files);
    expect(photos.map((file) => file.name)).toEqual(["b.jpg"]);
    expect(skipped).toBe(1);
  });

  it("handles an empty selection", () => {
    expect(splitPhotoFiles([])).toEqual({ photos: [], skipped: 0 });
  });
});
