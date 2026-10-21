import { describe, expect, it } from "vitest";
import { carriesFiles, pickImageFiles } from "./files";

function file(name: string, type: string): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type });
}

describe("pickImageFiles", () => {
  it("keeps image files and drops the rest", () => {
    const picked = pickImageFiles([
      file("a.jpg", "image/jpeg"),
      file("notes.txt", "text/plain"),
      file("b.webp", "image/webp"),
    ]);
    expect(picked.map((item) => item.name)).toEqual(["a.jpg", "b.webp"]);
  });

  it("accepts known image extensions when the type is empty", () => {
    const picked = pickImageFiles([
      file("IMG_0001.HEIC", ""),
      file("photo.jpeg", ""),
      file("archive.zip", ""),
    ]);
    expect(picked.map((item) => item.name)).toEqual([
      "IMG_0001.HEIC",
      "photo.jpeg",
    ]);
  });

  it("returns an empty list for null", () => {
    expect(pickImageFiles(null)).toEqual([]);
  });
});

describe("carriesFiles", () => {
  it("detects file drags", () => {
    expect(carriesFiles(["Files"])).toBe(true);
    expect(carriesFiles(["text/plain", "Files"])).toBe(true);
  });

  it("ignores text and link drags", () => {
    expect(carriesFiles(["text/plain", "text/uri-list"])).toBe(false);
    expect(carriesFiles([])).toBe(false);
    expect(carriesFiles(null)).toBe(false);
  });
});
