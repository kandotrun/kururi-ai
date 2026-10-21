import type { DeskScene } from "./contracts";

export type StreamScene = Pick<
  DeskScene,
  "addPrint" | "setScanning" | "decide" | "place" | "focus" | "removePrint"
>;

export function holdLandings(
  scene: StreamScene,
  gate: Promise<void>,
): StreamScene {
  return {
    async addPrint(print) {
      await gate;
      return scene.addPrint(print);
    },
    setScanning: (id, scanning) => scene.setScanning(id, scanning),
    decide: (id, correction) => scene.decide(id, correction),
    place: (id, slot) => scene.place(id, slot),
    focus: (id) => scene.focus(id),
    removePrint: (id) => scene.removePrint(id),
  };
}
