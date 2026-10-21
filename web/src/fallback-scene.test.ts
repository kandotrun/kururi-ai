import { describe, expect, it, vi } from "vitest";
import { createFallbackScene } from "./fallback-scene";

function fakeBitmap(): { bitmap: ImageBitmap; close: ReturnType<typeof vi.fn> } {
  const close = vi.fn();
  return { bitmap: { width: 4, height: 3, close } as unknown as ImageBitmap, close };
}

describe("createFallbackScene", () => {
  it("releases images immediately and resolves every motion at once", async () => {
    const scene = createFallbackScene(500);
    const { bitmap, close } = fakeBitmap();
    await scene.addPrint({ id: "a", slot: 0, aspect: 4 / 3, simulated: 1, image: bitmap, emphasis: false });
    expect(close).toHaveBeenCalledOnce();
    scene.setScanning("a", true);
    scene.decide("a", 3);
    await expect(scene.place("a", 0)).resolves.toBeUndefined();
    await expect(scene.scatterAll()).resolves.toBeUndefined();
    expect(scene.screenPosition("a")).toBeNull();
  });

  it("reports its capacity and never emits pointer events", () => {
    const scene = createFallbackScene(120);
    const hover = vi.fn();
    const off = scene.on("hover", hover);
    expect(scene.capacity).toBe(120);
    expect(scene.tileSize).toBeGreaterThan(0);
    off();
    scene.dispose();
    expect(hover).not.toHaveBeenCalled();
  });
});
