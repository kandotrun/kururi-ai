import { h, phrased } from "./dom";
import { carriesFiles, pickImageFiles } from "./files";

export interface DropZoneOptions {
  onFiles(files: File[]): void;
  onRejected(): void;
}

export interface DropZone {
  readonly element: HTMLElement;
  dispose(): void;
}

export function createDropZone(
  target: Window,
  options: DropZoneOptions,
): DropZone {
  const element = h("div", { class: "drop-hint", hidden: true }, [
    h("div", { class: "drop-frame" }, [
      h(
        "p",
        { class: "drop-title" },
        phrased(["ここで離すと、", "ほかの写真より", "先に判定します"]),
      ),
      h("p", { class: "drop-note" }, [
        "写真はこのブラウザの中で判定します。どこにも送信しません。",
      ]),
    ]),
  ]);
  let depth = 0;

  function setVisible(visible: boolean): void {
    element.hidden = !visible;
    document.documentElement.toggleAttribute("data-dragging", visible);
  }

  function onEnter(event: DragEvent): void {
    if (!carriesFiles(event.dataTransfer?.types)) {
      return;
    }
    event.preventDefault();
    depth += 1;
    setVisible(true);
  }

  function onOver(event: DragEvent): void {
    if (!carriesFiles(event.dataTransfer?.types)) {
      return;
    }
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "copy";
    }
    if (element.hidden) {
      setVisible(true);
    }
  }

  function onLeave(event: DragEvent): void {
    if (!carriesFiles(event.dataTransfer?.types)) {
      return;
    }
    depth = Math.max(0, depth - 1);
    if (depth === 0) {
      setVisible(false);
    }
  }

  function onDrop(event: DragEvent): void {
    if (!carriesFiles(event.dataTransfer?.types)) {
      return;
    }
    event.preventDefault();
    depth = 0;
    setVisible(false);
    const files = pickImageFiles(event.dataTransfer?.files ?? null);
    if (files.length > 0) {
      options.onFiles(files);
    } else {
      options.onRejected();
    }
  }

  function onEnd(): void {
    depth = 0;
    setVisible(false);
  }

  target.addEventListener("dragenter", onEnter);
  target.addEventListener("dragover", onOver);
  target.addEventListener("dragleave", onLeave);
  target.addEventListener("drop", onDrop);
  target.addEventListener("dragend", onEnd);
  target.addEventListener("blur", onEnd);

  return {
    element,
    dispose() {
      target.removeEventListener("dragenter", onEnter);
      target.removeEventListener("dragover", onOver);
      target.removeEventListener("dragleave", onLeave);
      target.removeEventListener("drop", onDrop);
      target.removeEventListener("dragend", onEnd);
      target.removeEventListener("blur", onEnd);
      setVisible(false);
    },
  };
}
