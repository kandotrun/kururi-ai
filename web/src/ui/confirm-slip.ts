import { h, setText } from "./dom";
import { placeSlip } from "./slip-geometry";

export interface ConfirmContent {
  title: string;
  body: string;
  note: string;
  confirmLabel: string;
  cancelLabel: string;
}

export interface ConfirmSlipOptions {
  sheet(): boolean;
  reserveBottom(): number;
}

export interface ConfirmSlipView {
  readonly element: HTMLDialogElement;
  readonly isOpen: boolean;
  ask(content: ConfirmContent, anchor: HTMLElement): Promise<boolean>;
  close(): void;
}

const CONFIRM = "confirm";

export function createConfirmSlip(options: ConfirmSlipOptions): ConfirmSlipView {
  const title = h("h2", { class: "confirm-title", id: "confirm-title" });
  const body = h("p", { class: "confirm-body", id: "confirm-body" });
  const note = h("p", { class: "confirm-note" });
  const confirmButton = h(
    "button",
    { type: "submit", class: "ink-fill-button", value: CONFIRM },
    [],
  );
  const cancelButton = h(
    "button",
    { type: "submit", class: "ink-button", value: "cancel", autofocus: true },
    [],
  );
  const form = h("form", { method: "dialog", class: "confirm-form" }, [
    title,
    body,
    note,
    h("div", { class: "confirm-actions" }, [confirmButton, cancelButton]),
  ]);
  const element = h(
    "dialog",
    {
      class: "confirm-slip",
      "aria-labelledby": "confirm-title",
      "aria-describedby": "confirm-body",
    },
    [form],
  );

  let anchor: HTMLElement | null = null;
  let settle: ((confirmed: boolean) => void) | null = null;

  function place(): void {
    if (!element.open || !anchor) {
      return;
    }
    if (options.sheet()) {
      element.style.removeProperty("left");
      element.style.removeProperty("top");
      element.dataset.side = "sheet";
      return;
    }
    const box = anchor.getBoundingClientRect();
    const placement = placeSlip(
      { left: box.left, top: box.top, bottom: box.bottom },
      { width: element.offsetWidth, height: element.offsetHeight },
      { width: window.innerWidth, height: window.innerHeight },
      { gap: 12, margin: 16, reserveBottom: options.reserveBottom() },
    );
    element.style.left = `${placement.left}px`;
    element.style.top = `${placement.top}px`;
    element.dataset.side = placement.side;
  }

  element.addEventListener("close", () => {
    window.removeEventListener("resize", place);
    const done = settle;
    settle = null;
    anchor = null;
    done?.(element.returnValue === CONFIRM);
  });
  element.addEventListener("click", (event) => {
    if (event.target === element) {
      element.close("cancel");
    }
  });

  return {
    element,
    get isOpen() {
      return element.open;
    },
    ask(content, target) {
      if (element.open) {
        element.close("cancel");
      }
      setText(title, content.title);
      setText(body, content.body);
      setText(note, content.note);
      note.hidden = content.note === "";
      setText(confirmButton, content.confirmLabel);
      setText(cancelButton, content.cancelLabel);
      anchor = target;
      element.returnValue = "";
      return new Promise<boolean>((resolve) => {
        settle = resolve;
        element.showModal();
        place();
        cancelButton.focus({ preventScroll: true });
        window.addEventListener("resize", place);
      });
    },
    close() {
      if (element.open) {
        element.close("cancel");
      }
    },
  };
}
