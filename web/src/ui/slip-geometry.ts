export interface AnchorBox {
  left: number;
  top: number;
  bottom: number;
}

export interface SlipSize {
  width: number;
  height: number;
}

export interface SlipPlacementOptions {
  gap: number;
  margin: number;
  reserveBottom: number;
}

export interface SlipPlacement {
  left: number;
  top: number;
  side: "below" | "above";
}

function clamp(value: number, minimum: number, maximum: number): number {
  return maximum < minimum ? minimum : Math.min(maximum, Math.max(minimum, value));
}

export function placeSlip(
  anchor: AnchorBox,
  size: SlipSize,
  viewport: SlipSize,
  options: SlipPlacementOptions,
): SlipPlacement {
  const { gap, margin, reserveBottom } = options;
  const floor = viewport.height - reserveBottom - margin;
  const below = anchor.bottom + gap;
  const above = anchor.top - gap - size.height;
  const left = Math.round(
    clamp(anchor.left, margin, viewport.width - margin - size.width),
  );
  if (below + size.height <= floor) {
    return { left, top: Math.round(below), side: "below" };
  }
  if (above >= margin) {
    return { left, top: Math.round(above), side: "above" };
  }
  const roomBelow = floor - below;
  const roomAbove = anchor.top - gap - margin;
  const side = roomBelow >= roomAbove ? "below" : "above";
  const top = clamp(side === "below" ? below : above, margin, floor - size.height);
  return { left, top: Math.round(top), side };
}
