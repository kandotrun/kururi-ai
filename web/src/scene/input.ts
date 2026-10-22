export interface DeskInputHandlers {
  hover(x: number, y: number): void;
  leave(): void;
  tap(x: number, y: number): void;
  orbit(deltaX: number, deltaY: number): void;
  pan(deltaX: number, deltaY: number): void;
  zoom(factor: number): void;
  reset(): void;
  parallax(normalizedX: number, normalizedY: number): void;
}

interface ActivePointer {
  id: number;
  x: number;
  y: number;
  startX: number;
  startY: number;
  type: string;
  button: number;
}

const DRAG_THRESHOLD = 6;

export class DeskInput {
  private readonly canvas: HTMLCanvasElement;
  private readonly handlers: DeskInputHandlers;
  private readonly pointers = new Map<number, ActivePointer>();
  private dragging = false;
  private pinchDistance = 0;
  private readonly controller = new AbortController();

  constructor(canvas: HTMLCanvasElement, handlers: DeskInputHandlers) {
    this.canvas = canvas;
    this.handlers = handlers;
    const signal = this.controller.signal;
    canvas.addEventListener("pointermove", (event) => this.move(event), {
      signal,
    });
    canvas.addEventListener("pointerdown", (event) => this.down(event), {
      signal,
    });
    canvas.addEventListener("pointerup", (event) => this.up(event), {
      signal,
    });
    canvas.addEventListener("pointercancel", (event) => this.cancel(event), {
      signal,
    });
    canvas.addEventListener(
      "pointerleave",
      (event) => {
        if (event.pointerType === "mouse") {
          handlers.leave();
          handlers.parallax(0, 0);
        }
      },
      { signal },
    );
    canvas.addEventListener("wheel", (event) => this.wheel(event), {
      signal,
      passive: false,
    });
    canvas.addEventListener("dblclick", () => handlers.reset(), { signal });
    canvas.addEventListener("contextmenu", (event) => event.preventDefault(), {
      signal,
    });
  }

  dispose(): void {
    this.controller.abort();
    this.pointers.clear();
  }

  private local(event: PointerEvent | WheelEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  private move(event: PointerEvent): void {
    const point = this.local(event);
    const width = Math.max(1, this.canvas.clientWidth);
    const height = Math.max(1, this.canvas.clientHeight);
    const active = this.pointers.get(event.pointerId);
    if (!active) {
      if (event.pointerType === "mouse") {
        this.handlers.parallax(
          (point.x / width) * 2 - 1,
          (point.y / height) * 2 - 1,
        );
        this.handlers.hover(point.x, point.y);
      }
      return;
    }
    const deltaX = point.x - active.x;
    const deltaY = point.y - active.y;
    active.x = point.x;
    active.y = point.y;
    if (this.pointers.size >= 2) {
      const distance = this.pinchSpan();
      if (this.pinchDistance > 0 && distance > 0) {
        this.handlers.zoom(this.pinchDistance / distance);
      }
      this.pinchDistance = distance;
      this.dragging = true;
      return;
    }
    if (
      !this.dragging &&
      Math.hypot(point.x - active.startX, point.y - active.startY) >
        DRAG_THRESHOLD
    ) {
      this.dragging = true;
    }
    if (this.dragging) {
      if (active.button === 2 || event.shiftKey) {
        this.handlers.pan(deltaX, deltaY);
      } else {
        this.handlers.orbit(deltaX, deltaY);
      }
    }
  }

  private down(event: PointerEvent): void {
    const point = this.local(event);
    this.pointers.set(event.pointerId, {
      id: event.pointerId,
      x: point.x,
      y: point.y,
      startX: point.x,
      startY: point.y,
      type: event.pointerType,
      button: event.button,
    });
    try {
      this.canvas.setPointerCapture(event.pointerId);
    } catch {
      this.dragging = false;
    }
    if (this.pointers.size === 1) {
      this.dragging = false;
    }
    if (this.pointers.size === 2) {
      this.pinchDistance = this.pinchSpan();
    }
  }

  private up(event: PointerEvent): void {
    const active = this.pointers.get(event.pointerId);
    this.pointers.delete(event.pointerId);
    if (this.pointers.size < 2) {
      this.pinchDistance = 0;
    }
    if (!active) {
      return;
    }
    if (!this.dragging && this.pointers.size === 0 && active.button !== 2) {
      this.handlers.tap(active.x, active.y);
    }
    if (this.pointers.size === 0) {
      this.dragging = false;
    }
  }

  private cancel(event: PointerEvent): void {
    this.pointers.delete(event.pointerId);
    if (this.pointers.size === 0) {
      this.dragging = false;
      this.pinchDistance = 0;
    }
  }

  private wheel(event: WheelEvent): void {
    event.preventDefault();
    const scale = event.deltaMode === 1 ? 18 : event.deltaMode === 2 ? 300 : 1;
    const delta = Math.max(-120, Math.min(120, event.deltaY * scale));
    this.handlers.zoom(Math.exp(delta * 0.0018));
  }

  private pinchSpan(): number {
    const [first, second] = [...this.pointers.values()];
    if (!first || !second) {
      return 0;
    }
    return Math.hypot(first.x - second.x, first.y - second.y);
  }
}
