import type { DeskScene, NewPrint } from "./contracts";

export function createFallbackScene(capacity: number): DeskScene {
  return {
    capacity,
    tileSize: 96,
    start() {},
    async addPrint(print: NewPrint) {
      print.image.close();
    },
    setScanning() {},
    decide() {},
    async place() {},
    removePrint() {},
    async scatterAll() {},
    focus() {},
    select() {},
    screenPosition() {
      return null;
    },
    setReducedMotion() {},
    setViewInsets() {},
    on() {
      return () => {};
    },
    dispose() {},
  };
}
