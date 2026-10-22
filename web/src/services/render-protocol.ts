import type { RenderPlan } from "./render-image";

export interface RenderRequest {
  type: "render";
  id: number;
  source: Blob;
  plan: RenderPlan;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isBitmapLike(value: unknown): value is ImageBitmap {
  return (
    isRecord(value) &&
    typeof value.width === "number" &&
    typeof value.height === "number" &&
    typeof value.close === "function"
  );
}

export function isRenderRequest(value: unknown): value is RenderRequest {
  return (
    isRecord(value) &&
    value.type === "render" &&
    typeof value.id === "number" &&
    value.source instanceof Blob &&
    isRecord(value.plan)
  );
}
