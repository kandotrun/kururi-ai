import { describe, expect, it, vi } from "vitest";
import { createVisitorImages } from "./visitor-images";

function file(name: string): File {
  return new File(["x"], name, { type: "image/jpeg" });
}

function setup(idleLimit = 2) {
  let next = 0;
  const preview = vi.fn(async (source: File) => new Blob([source.name]));
  const createUrl = vi.fn((_blob: Blob) => `blob:${(next += 1)}`);
  const revokeUrl = vi.fn((_url: string) => {});
  const images = createVisitorImages({
    preview,
    createUrl,
    revokeUrl,
    idleLimit,
  });
  return { images, preview, createUrl, revokeUrl };
}

async function settle(): Promise<void> {
  for (let round = 0; round < 5; round += 1) {
    await Promise.resolve();
  }
}

describe("createVisitorImages", () => {
  it("makes one display URL per file and shares it between holders", async () => {
    const { images, preview } = setup();
    const photo = file("a.dng");
    const first = images.acquire(photo);
    const second = images.acquire(photo);
    expect(await first.url).toBe("blob:1");
    expect(await second.url).toBe("blob:1");
    expect(preview).toHaveBeenCalledOnce();
  });

  it("never revokes a URL that is still held, however many files are shown", async () => {
    const { images, revokeUrl } = setup(1);
    const leases = ["a.jpg", "b.jpg", "c.jpg", "d.jpg"].map((name) =>
      images.acquire(file(name)),
    );
    await Promise.all(leases.map((lease) => lease.url));
    await settle();
    expect(revokeUrl).not.toHaveBeenCalled();
  });

  it("revokes released URLs beyond the idle limit, oldest release first", async () => {
    const { images, revokeUrl } = setup(1);
    const a = images.acquire(file("a.jpg"));
    const b = images.acquire(file("b.jpg"));
    await Promise.all([a.url, b.url]);
    a.release();
    await settle();
    expect(revokeUrl).not.toHaveBeenCalled();
    b.release();
    await settle();
    expect(revokeUrl).toHaveBeenCalledOnce();
    expect(revokeUrl).toHaveBeenCalledWith("blob:1");
  });

  it("reuses a released URL that is still in the idle cache", async () => {
    const { images, preview, revokeUrl } = setup(2);
    const photo = file("a.jpg");
    const first = images.acquire(photo);
    await first.url;
    first.release();
    const again = images.acquire(photo);
    expect(await again.url).toBe("blob:1");
    expect(preview).toHaveBeenCalledOnce();
    expect(revokeUrl).not.toHaveBeenCalled();
  });

  it("keeps a URL while any holder remains and ignores repeated releases", async () => {
    const { images, revokeUrl } = setup(0);
    const photo = file("a.jpg");
    const row = images.acquire(photo);
    const loupe = images.acquire(photo);
    await row.url;
    row.release();
    row.release();
    await settle();
    expect(revokeUrl).not.toHaveBeenCalled();
    loupe.release();
    await settle();
    expect(revokeUrl).toHaveBeenCalledWith("blob:1");
  });

  it("revokes a URL released before its preview finished", async () => {
    const { images, revokeUrl } = setup(0);
    const lease = images.acquire(file("slow.nef"));
    lease.release();
    await lease.url;
    await settle();
    expect(revokeUrl).toHaveBeenCalledWith("blob:1");
  });

  it("forgets a failed preview so it can be tried again", async () => {
    const { images, preview, revokeUrl } = setup();
    preview.mockRejectedValueOnce(new Error("broken"));
    const photo = file("broken.nef");
    const failed = images.acquire(photo);
    await expect(failed.url).rejects.toThrow("broken");
    failed.release();
    await expect(images.acquire(photo).url).resolves.toBe("blob:1");
    await settle();
    expect(revokeUrl).not.toHaveBeenCalled();
  });
});
