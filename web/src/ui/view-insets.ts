import type { ViewInsets } from "../contracts";

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface InsetLayout {
  width: number;
  height: number;
  compact: boolean;
  masthead: Box | null;
  headline: readonly Box[];
  actions: readonly Box[];
  ruler: Box | null;
}

export const ZERO_INSETS: ViewInsets = Object.freeze({
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
});

function visible(box: Box): boolean {
  return box.right - box.left > 0 && box.bottom - box.top > 0;
}

function shown(boxes: readonly (Box | null)[]): Box[] {
  return boxes.filter((box): box is Box => box !== null && visible(box));
}

function clamp(value: number, maximum: number): number {
  return Math.min(Math.max(0, Math.ceil(value)), Math.max(0, maximum));
}

function lowestEdge(boxes: readonly Box[]): number {
  return boxes.reduce((edge, box) => Math.max(edge, box.bottom), 0);
}

function rightEdge(boxes: readonly Box[]): number {
  return boxes.reduce((edge, box) => Math.max(edge, box.right), 0);
}

function coverFromBottom(boxes: readonly Box[], height: number): number {
  if (boxes.length === 0) {
    return 0;
  }
  const highest = boxes.reduce((edge, box) => Math.min(edge, box.top), height);
  return height - highest;
}

function freeArea(layout: InsetLayout, insets: ViewInsets): number {
  const width = Math.max(0, layout.width - insets.left - insets.right);
  const height = Math.max(0, layout.height - insets.top - insets.bottom);
  return width * height;
}

function settle(layout: InsetLayout, insets: ViewInsets): ViewInsets {
  const top = clamp(insets.top, layout.height);
  const left = clamp(insets.left, layout.width);
  return {
    top,
    right: clamp(insets.right, layout.width - left),
    bottom: clamp(insets.bottom, layout.height - top),
    left,
  };
}

function compactInsets(layout: InsetLayout): ViewInsets {
  const ruler = shown([layout.ruler]);
  const actions = shown(layout.actions);
  return settle(layout, {
    top: lowestEdge(shown([layout.masthead, ...layout.headline])),
    right: 0,
    bottom: coverFromBottom([...actions, ...ruler], layout.height),
    left: 0,
  });
}

function wideInsets(layout: InsetLayout): ViewInsets {
  const top = lowestEdge(shown([layout.masthead]));
  const bottom = coverFromBottom(shown([layout.ruler]), layout.height);
  const content = shown([...layout.headline, ...layout.actions]);
  if (content.length === 0) {
    return settle(layout, { top, right: 0, bottom, left: 0 });
  }
  const beside = settle(layout, {
    top,
    right: 0,
    bottom,
    left: rightEdge(content),
  });
  const below = settle(layout, {
    top: Math.max(top, lowestEdge(content)),
    right: 0,
    bottom,
    left: 0,
  });
  return freeArea(layout, below) > freeArea(layout, beside) ? below : beside;
}

export function computeViewInsets(layout: InsetLayout): ViewInsets {
  return layout.compact ? compactInsets(layout) : wideInsets(layout);
}

export function sameInsets(left: ViewInsets, right: ViewInsets): boolean {
  return (
    left.top === right.top &&
    left.right === right.right &&
    left.bottom === right.bottom &&
    left.left === right.left
  );
}
