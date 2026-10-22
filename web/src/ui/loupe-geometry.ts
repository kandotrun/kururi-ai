import type { ScreenPoint } from "../contracts";

export interface BoxSize {
  width: number;
  height: number;
}

export interface LoupePlacementOptions {
  gap: number;
  margin: number;
  lift: number;
  reserveTop?: number;
  reserveBottom?: number;
  reserveRight?: number;
}

export interface LoupePlacement {
  left: number;
  top: number;
  side: "left" | "right";
}

function clamp(value: number, minimum: number, maximum: number): number {
  if (maximum < minimum) {
    return minimum;
  }
  return Math.min(maximum, Math.max(minimum, value));
}

export function placeLoupe(
  point: ScreenPoint,
  size: BoxSize,
  viewport: BoxSize,
  options: LoupePlacementOptions,
): LoupePlacement {
  const { gap, margin, lift } = options;
  const reserveTop = options.reserveTop ?? 0;
  const reserveBottom = options.reserveBottom ?? 0;
  const usableWidth = viewport.width - Math.max(0, options.reserveRight ?? 0);
  const minLeft = margin;
  const maxLeft = usableWidth - margin - size.width;
  const rightLeft = point.x + gap;
  const leftLeft = point.x - gap - size.width;
  let side: LoupePlacement["side"] = "right";
  let left = rightLeft;
  if (rightLeft > maxLeft) {
    const roomRight = usableWidth - point.x;
    if (leftLeft >= minLeft || point.x > roomRight) {
      side = "left";
      left = leftLeft;
    }
  }
  const top = clamp(
    point.y - lift,
    margin + reserveTop,
    viewport.height - margin - reserveBottom - size.height,
  );
  return {
    left: Math.round(clamp(left, minLeft, maxLeft)),
    top: Math.round(top),
    side,
  };
}
