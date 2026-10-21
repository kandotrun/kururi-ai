export type AttributeValue = string | number | boolean | null | undefined;

export type Child = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes: Record<string, AttributeValue> = {},
  children: readonly Child[] = [],
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (value === null || value === undefined || value === false) {
      continue;
    }
    if (name === "class") {
      element.className = String(value);
    } else {
      element.setAttribute(name, value === true ? "" : String(value));
    }
  }
  append(element, children);
  return element;
}

export function append(parent: Node, children: readonly Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) {
      continue;
    }
    parent.appendChild(
      typeof child === "string" ? document.createTextNode(child) : child,
    );
  }
}

export function phrased(phrases: readonly string[]): Node[] {
  return phrases.flatMap((phrase, index) =>
    index === 0
      ? [document.createTextNode(phrase)]
      : [document.createElement("wbr"), document.createTextNode(phrase)],
  );
}

export function setText(element: HTMLElement, text: string): void {
  if (element.textContent !== text) {
    element.textContent = text;
  }
}

export function externalLink(href: string, text: string): HTMLAnchorElement {
  return h("a", { href, target: "_blank", rel: "noopener noreferrer" }, [
    text,
  ]);
}

export function mediaQuery(query: string): () => boolean {
  if (typeof window.matchMedia !== "function") {
    return () => false;
  }
  const list = window.matchMedia(query);
  return () => list.matches;
}
