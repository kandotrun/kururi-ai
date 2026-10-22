import { h } from "./dom";

export interface Announcer {
  readonly element: HTMLElement;
  say(text: string): void;
  dispose(): void;
}

export function createAnnouncer(intervalMs: number): Announcer {
  const element = h("div", {
    class: "sr-only",
    "aria-live": "polite",
    "aria-atomic": "true",
  });
  let spoken = "";
  let pending = "";
  let lastAt = Number.NEGATIVE_INFINITY;
  let timer = 0;

  function speak(): void {
    timer = 0;
    if (pending === "" || pending === spoken) {
      return;
    }
    spoken = pending;
    lastAt = performance.now();
    element.textContent = spoken;
  }

  return {
    element,
    say(text) {
      pending = text;
      if (text === "" || text === spoken || timer !== 0) {
        return;
      }
      const wait = lastAt + intervalMs - performance.now();
      if (wait <= 0) {
        speak();
      } else {
        timer = window.setTimeout(speak, wait);
      }
    },
    dispose() {
      window.clearTimeout(timer);
      timer = 0;
    },
  };
}
