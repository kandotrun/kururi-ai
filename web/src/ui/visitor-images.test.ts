import { describe, expect, it, vi } from "vitest";
import { createVisitorImages } from "./visitor-images";

function file(name: string): File {
  return new File(["x"], name, { type: "image/jpeg" });
}

function setup(limit = 2) {
  let next = 0;
  const preview = vi.fn(async (source: File) => new Blob([source.name]));
  const createUrl = vi.fn((_blob: Blob) => `blob:${(next += 1)}`);
  const revokeUrl = vi.fn((_url: string) => {});
  const images = createVisitorImages({ preview, createUrl, revokeUrl, limit });
  return { images, preview, createUrl, revokeUrl };
}

describe("createVisitorImages", () => {
  it("makes one display URL per file and reuses it", async () => {
    const { images, preview } = setup();
    const photo = file("a.dng");
    const first = await images.url(photo);
    const second = await images.url(photo);
    expect(first).toBe("blob:1");
    expect(second).toBe(first);
    expect(preview).toHaveBeenCalledOnce();
  });

  it("releases the least recently used URL beyond the limit", async () => {
    const { images, revokeUrl } = setup(2);
    const a = file("a.jpg");
    const b = file("b.jpg");
    const c = file("c.jpg");
    await images.url(a);
    await images.url(b);
    await images.url(a);
    await images.url(c);
    expect(revokeUrl).toHaveBeenCalledWith("blob:2");
    expect(revokeUrl).toHaveBeenCalledOnce();
    expect(await images.url(a)).toBe("blob:1");
  });

  it("forgets a failed preview so it can be tried again", async () => {
    const { images, preview } = setup();
    preview.mockRejectedValueOnce(new Error("broken"));
    const photo = file("broken.nef");
    await expect(images.url(photo)).rejects.toThrow("broken");
    await expect(images.url(photo)).resolves.toBe("blob:1");
  });
});
