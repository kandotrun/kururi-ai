import type { ViewInsets } from "../contracts";
import {
  type Box,
  ZERO_INSETS,
  computeViewInsets,
  sameInsets,
} from "./view-insets";

export interface InsetTargets {
  masthead: HTMLElement;
  headline: readonly HTMLElement[];
  text: readonly HTMLElement[];
  actions: () => readonly HTMLElement[];
  ruler: HTMLElement;
  observe: readonly HTMLElement[];
}

export interface InsetTracker {
  current(): ViewInsets;
  onChange(handler: (insets: ViewInsets) => void): () => void;
  setSuspended(suspended: boolean): void;
  refresh(): void;
  dispose(): void;
}

function toBox(rect: DOMRect): Box {
  return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
}

function elementBox(element: HTMLElement): Box | null {
  return element.isConnected ? toBox(element.getBoundingClientRect()) : null;
}

function textBox(element: HTMLElement): Box | null {
  if (!element.isConnected) {
    return null;
  }
  const range = document.createRange();
  range.selectNodeContents(element);
  const rect = range.getBoundingClientRect();
  range.detach();
  return rect.width > 0 && rect.height > 0 ? toBox(rect) : elementBox(element);
}

function present(boxes: readonly (Box | null)[]): Box[] {
  return boxes.filter((box): box is Box => box !== null);
}

export function createInsetTracker(
  targets: InsetTargets,
  compact: () => boolean,
): InsetTracker {
  const handlers = new Set<(insets: ViewInsets) => void>();
  let suspended = false;
  let last: ViewInsets = ZERO_INSETS;
  let frame = 0;

  function measure(): ViewInsets {
    if (suspended) {
      return ZERO_INSETS;
    }
    const root = document.documentElement;
    return computeViewInsets({
      width: root.clientWidth || window.innerWidth,
      height: root.clientHeight || window.innerHeight,
      compact: compact(),
      masthead: elementBox(targets.masthead),
      headline: present([
        ...targets.headline.map(elementBox),
        ...targets.text.map(textBox),
      ]),
      actions: present(targets.actions().map(elementBox)),
      ruler: elementBox(targets.ruler),
    });
  }

  function publish(): void {
    frame = 0;
    const next = measure();
    if (sameInsets(next, last)) {
      return;
    }
    last = next;
    for (const handler of handlers) {
      handler(next);
    }
  }

  function schedule(): void {
    if (frame === 0) {
      frame = window.requestAnimationFrame(publish);
    }
  }

  const observer =
    typeof ResizeObserver === "function" ? new ResizeObserver(schedule) : null;
  for (const element of targets.observe) {
    observer?.observe(element);
  }
  window.addEventListener("resize", schedule);
  const compactQuery =
    typeof window.matchMedia === "function"
      ? window.matchMedia("(max-width: 719px)")
      : null;
  compactQuery?.addEventListener("change", schedule);
  document.fonts?.addEventListener("loadingdone", schedule);
  void document.fonts?.ready.then(schedule);

  return {
    current() {
      last = measure();
      return last;
    },
    onChange(handler) {
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    },
    setSuspended(next) {
      if (suspended === next) {
        return;
      }
      suspended = next;
      if (frame !== 0) {
        window.cancelAnimationFrame(frame);
      }
      publish();
    },
    refresh: schedule,
    dispose() {
      observer?.disconnect();
      window.removeEventListener("resize", schedule);
      compactQuery?.removeEventListener("change", schedule);
      document.fonts?.removeEventListener("loadingdone", schedule);
      window.cancelAnimationFrame(frame);
      frame = 0;
      handlers.clear();
    },
  };
}
