import type { PhotoSource } from "../contracts";
import { creditParts } from "./copy";
import { externalLink, h } from "./dom";

export function renderCredit(
  target: HTMLElement,
  source: PhotoSource,
  withLinks: boolean,
): void {
  const parts = creditParts(source);
  const attribution = source.kind === "commons" ? source.attribution : null;
  if (!attribution || parts.license === null) {
    target.removeAttribute("title");
    target.replaceChildren(parts.author);
    return;
  }
  target.title = parts.full;
  const license =
    withLinks && attribution.licenseUrl
      ? externalLink(attribution.licenseUrl, parts.license)
      : parts.license;
  const author = withLinks
    ? externalLink(attribution.pageUrl, parts.author)
    : parts.author;
  target.replaceChildren(
    h("span", { class: "credit-license" }, [license]),
    " / ",
    h("span", { class: "credit-author" }, [author]),
  );
}
