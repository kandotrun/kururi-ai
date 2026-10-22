import type { DeskStats } from "../contracts";
import { h, setText } from "./dom";
import {
  formatCount,
  formatMs,
  formatPercent,
  formatPerSecond,
} from "./format";

const NUMERAL_STEP = 100;

export interface RulerOptions {
  onReload(): void;
}

export interface RulerView {
  readonly element: HTMLElement;
  setStats(stats: DeskStats): void;
  setState(text: string): void;
  setReloadable(reloadable: boolean): void;
  setNotice(text: string | null): void;
  repeatNotice(): void;
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

export function createRuler(options: RulerOptions): RulerView {
  const fill = h("span", { class: "ruler-fill", "aria-hidden": "true" });
  const numerals = h("span", { class: "ruler-numerals", "aria-hidden": "true" });
  const notice = h("p", {
    class: "ruler-notice",
    role: "status",
    "aria-live": "polite",
  });
  const scale = h("div", { class: "ruler-scale" }, [fill, numerals]);
  const judged = stat("judged", "判定", null, true);
  const fixed = stat("fixed", "向きを変えた", null, false);
  const correct = stat("correct", "正解", null, true);
  const rate = stat("rate", null, "枚/秒", false);
  const ms = stat("ms", "1枚", "ms", false);
  const stateText = h("span", { class: "stat-state-text" }, ["モデルを準備中"]);
  const reload = h(
    "button",
    { type: "button", class: "text-button ruler-reload", hidden: true },
    ["再読み込み"],
  );
  reload.addEventListener("click", () => options.onReload());
  const state = h("p", { class: "stat stat-state", "data-key": "state" }, [
    stateText,
    reload,
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
  let noticeText: string | null = null;
  let repeatFrame = 0;

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
      setText(stateText, text);
    },
    setReloadable(reloadable) {
      reload.hidden = !reloadable;
    },
    setNotice(text) {
      noticeText = text;
      window.cancelAnimationFrame(repeatFrame);
      repeatFrame = 0;
      setText(notice, text ?? "");
      element.toggleAttribute("data-notice", text !== null);
    },
    repeatNotice() {
      if (noticeText === null || repeatFrame !== 0) {
        return;
      }
      const text = noticeText;
      setText(notice, "");
      repeatFrame = window.requestAnimationFrame(() => {
        repeatFrame = 0;
        if (noticeText === text) {
          setText(notice, text);
        }
      });
    },
    dispose() {
      observer?.disconnect();
      window.cancelAnimationFrame(repeatFrame);
    },
  };
}
