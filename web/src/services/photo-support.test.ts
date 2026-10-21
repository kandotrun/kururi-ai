import { afterEach, describe, expect, it, vi } from "vitest";
import { detectPhotoSupport, HEIC_PROBE_SIDE } from "./photo-support";

function fakeBitmap(width: number, height: number) {
  return { width, height, close: vi.fn() };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("detectPhotoSupport", () => {
  it("reports HEIC support when the browser decodes the probe image", async () => {
    const bitmap = fakeBitmap(HEIC_PROBE_SIDE, HEIC_PROBE_SIDE);
    const decode = vi.fn(async (_blob: Blob) => bitmap);
    expect(await detectPhotoSupport(decode)).toEqual({ heic: true });
    expect(bitmap.close).toHaveBeenCalled();
    const probe = decode.mock.calls[0]![0];
    expect(probe.type).toBe("image/heic");
    const head = new Uint8Array(await probe.slice(4, 12).arrayBuffer());
    expect(new TextDecoder().decode(head)).toBe("ftypheic");
  });

  it("reports no HEIC support when decoding fails", async () => {
    const decode = vi.fn(async () => {
      throw new DOMException("unsupported", "InvalidStateError");
    });
    expect(await detectPhotoSupport(decode)).toEqual({ heic: false });
  });

  it("does not trust a decoder that returns the wrong size", async () => {
    const bitmap = fakeBitmap(0, 0);
    expect(await detectPhotoSupport(async () => bitmap)).toEqual({
      heic: false,
    });
    expect(bitmap.close).toHaveBeenCalled();
  });

  it("gives up on a decoder that never answers", async () => {
    vi.useFakeTimers();
    const result = detectPhotoSupport(() => new Promise(() => {}));
    await vi.advanceTimersByTimeAsync(3_000);
    expect(await result).toEqual({ heic: false });
  });
});
