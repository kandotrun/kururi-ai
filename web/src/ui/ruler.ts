import type { DeskStats } from "../contracts";
import { h, setText } from "./dom";
import {
  formatCount,
  formatMs,
  formatPercent,
  formatPerSecond,
} from "./format";

const NUMERAL_STEP = 100;

export interface RulerView {
  readonly element: HTMLElement;
  setStats(stats: DeskStats): void;
  setState(text: string): void;
  setNotice(text: string | null): void;
  dispose(): void;
}

interface StatCell {
  element: HTMLElement;
  value: HTMLElement;
  extra: HTMLElement | null;
}

function stat(
  key: string,
  before: string | null,
  after: string | null,
  withExtra: boolean,
): StatCell {
  const value = h("b", { class: "stat-value" }, ["—"]);
  const extra = withExtra ? h("span", { class: "stat-extra" }) : null;
  const element = h("p", { class: "stat", "data-key": key }, [
    before ? h("span", { class: "stat-label" }, [before]) : null,
    value,
    extra,
    after ? h("span", { class: "stat-label" }, [after]) : null,
  ]);
  return { element, value, extra };
}

export function createRuler(): RulerView {
  const fill = h("span", { class: "ruler-fill", "aria-hidden": "true" });
  const numerals = h("span", { class: "ruler-numerals", "aria-hidden": "true" });
  const notice = h("p", { class: "ruler-notice", hidden: true });
  const scale = h("div", { class: "ruler-scale" }, [fill, numerals]);
  const judged = stat("judged", "判定", null, true);
  const fixed = stat("fixed", "回した", null, false);
  const correct = stat("correct", "正解", null, true);
  const rate = stat("rate", null, "枚/秒", false);
  const ms = stat("ms", "1枚", "ms", false);
  const state = h("p", { class: "stat stat-state", "data-key": "state" }, [
    "モデルを準備中",
  ]);
  const row = h("div", { class: "ruler-stats" }, [
    judged.element,
    fixed.element,
    correct.element,
    rate.element,
    ms.element,
    state,
  ]);
  const element = h(
    "section",
    { class: "ruler", "aria-label": "進み具合" },
    [scale, notice, row],
  );

  let numeralCount = -1;

  function layoutNumerals(width: number): void {
    const count = Math.max(0, Math.floor(width / NUMERAL_STEP));
    if (count === numeralCount) {
      return;
    }
    numeralCount = count;
    const items: HTMLElement[] = [];
    for (let index = 1; index <= count; index += 1) {
      const item = h("span", { class: "ruler-numeral" }, [String(index)]);
      item.style.left = `${index * NUMERAL_STEP}px`;
      items.push(item);
    }
    numerals.replaceChildren(...items);
  }

  const observer =
    typeof ResizeObserver === "function"
      ? new ResizeObserver((entries) => {
          const entry = entries[0];
          if (entry) {
            layoutNumerals(entry.contentRect.width);
          }
        })
      : null;
  observer?.observe(scale);
  layoutNumerals(window.innerWidth);

  let progress = -1;

  return {
    element,
    setStats(stats) {
      const ratio =
        stats.total > 0 ? Math.min(1, stats.processed / stats.total) : 0;
      if (Math.abs(ratio - progress) > 0.0005) {
        progress = ratio;
        element.style.setProperty("--progress", ratio.toFixed(4));
      }
      setText(judged.value, formatCount(stats.processed));
      setText(judged.extra!, ` / ${formatCount(stats.total)}`);
      setText(fixed.value, formatCount(stats.rotatedFixed));
      setText(correct.value, formatCount(stats.correct));
      setText(
        correct.extra!,
        stats.accuracy === null ? "" : `（${formatPercent(stats.accuracy)}）`,
      );
      setText(rate.value, formatPerSecond(stats.perSecond));
      setText(ms.value, formatMs(stats.medianMs));
    },
    setState(text) {
      setText(state, text);
    },
    setNotice(text) {
      notice.hidden = text === null;
      setText(notice, text ?? "");
      element.toggleAttribute("data-notice", text !== null);
    },
    dispose() {
      observer?.disconnect();
    },
  };
}
