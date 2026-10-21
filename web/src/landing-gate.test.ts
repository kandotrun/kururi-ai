import { describe, expect, it, vi } from "vitest";
import type { NewPrint } from "./contracts";
import { holdLandings, type StreamScene } from "./landing-gate";

function print(id: string): NewPrint {
  return {
    id,
    slot: 0,
    aspect: 1.5,
    simulated: 1,
    image: { close: vi.fn() } as unknown as ImageBitmap,
    emphasis: false,
  };
}

function fakeScene() {
  const addPrint = vi.fn(async (_print: NewPrint) => {});
  const scene: StreamScene = {
    addPrint,
    setScanning: vi.fn(),
    decide: vi.fn(),
    place: vi.fn(async () => {}),
    focus: vi.fn(),
    removePrint: vi.fn(),
  };
  return Object.assign(scene, { addPrint });
}

describe("holdLandings", () => {
  it("keeps prints off the desk until the gate opens", async () => {
    const scene = fakeScene();
    let open: () => void = () => {};
    const held = holdLandings(scene, new Promise<void>((resolve) => (open = resolve)));
    const landing = held.addPrint(print("a"));
    await Promise.resolve();
    expect(scene.addPrint).not.toHaveBeenCalled();
    open();
    await landing;
    expect(scene.addPrint).toHaveBeenCalledOnce();
  });

  it("lands prints in the order they arrived", async () => {
    const scene = fakeScene();
    let open: () => void = () => {};
    const held = holdLandings(scene, new Promise<void>((resolve) => (open = resolve)));
    const landings = [held.addPrint(print("a")), held.addPrint(print("b"))];
    open();
    await Promise.all(landings);
    expect(scene.addPrint.mock.calls.map(([value]) => value.id)).toEqual(["a", "b"]);
  });

  it("passes every other call straight through", () => {
    const scene = fakeScene();
    const held = holdLandings(scene, new Promise<void>(() => {}));
    held.setScanning("a", true);
    held.decide("a", 2);
    void held.place("a", 0);
    held.focus("a");
    held.removePrint("a");
    expect(scene.setScanning).toHaveBeenCalledWith("a", true);
    expect(scene.decide).toHaveBeenCalledWith("a", 2);
    expect(scene.place).toHaveBeenCalledWith("a", 0);
    expect(scene.focus).toHaveBeenCalledWith("a");
    expect(scene.removePrint).toHaveBeenCalledWith("a");
  });
});
