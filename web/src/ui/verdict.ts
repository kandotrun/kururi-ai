import type { Verdict } from "./copy";
import { h } from "./dom";

export function renderVerdict(element: HTMLElement, verdict: Verdict): void {
  element.dataset.tone = verdict.tone;
  if (verdict.tone === "miss") {
    element.replaceChildren(
      h("span", { class: "verdict-mark" }, [verdict.label]),
      verdict.detail === null
        ? ""
        : h("span", { class: "verdict-detail" }, [`（${verdict.detail}）`]),
    );
    return;
  }
  element.replaceChildren(verdict.label);
}
