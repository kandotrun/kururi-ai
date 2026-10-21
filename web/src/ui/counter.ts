import { stepCount } from "./count-step";
import { formatCount } from "./format";

const TAU_MS = 320;

export interface Counter {
  set(value: number): void;
  jump(value: number): void;
  dispose(): void;
}

function glyph(character: string): HTMLSpanElement {
  const span = document.createElement("span");
  span.className = /[0-9]/.test(character) ? "count-digit" : "count-sep";
  span.textContent = character;
  return span;
}

export function createCounter(
  digits: HTMLElement,
  reducedMotion: () => boolean,
): Counter {
  let target = 0;
  let shown = 0;
  let rendered = "";
  let frame = 0;
  let last = 0;

  function render(value: number): void {
    const text = formatCount(value);
    if (text === rendered) {
      return;
    }
    if (text.length !== rendered.length) {
      digits.replaceChildren(...Array.from(text, glyph));
    } else {
      const spans = digits.children;
      for (let index = 0; index < text.length; index += 1) {
        const character = text[index]!;
        const span = spans[index];
        if (span && span.textContent !== character) {
          span.textContent = character;
        }
      }
    }
    rendered = text;
  }

  function tick(time: number): void {
    const elapsed = last === 0 ? 16 : time - last;
    last = time;
    shown = stepCount(shown, target, elapsed, TAU_MS);
    render(Math.round(shown));
    if (shown === target) {
      frame = 0;
      last = 0;
      return;
    }
    frame = requestAnimationFrame(tick);
  }

  function settle(value: number): void {
    cancelAnimationFrame(frame);
    frame = 0;
    last = 0;
    target = Math.max(0, Math.round(value));
    shown = target;
    render(target);
  }

  render(0);

  return {
    set(value) {
      if (reducedMotion()) {
        settle(value);
        return;
      }
      target = Math.max(0, Math.round(value));
      if (frame === 0 && shown !== target) {
        frame = requestAnimationFrame(tick);
      }
    },
    jump(value) {
      settle(value);
    },
    dispose() {
      cancelAnimationFrame(frame);
      frame = 0;
    },
  };
}
