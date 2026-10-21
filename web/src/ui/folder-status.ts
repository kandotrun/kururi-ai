import type { FolderProgress } from "../contracts";
import { folderProgressText, folderScanText } from "./copy";
import { h, setText } from "./dom";

const MIN_SHOWN_MS = 2600;
const EMPTY_SHOWN_MS = 6000;

export interface FolderStatusOptions {
  onCancel(): void;
}

export interface FolderStatusView {
  readonly element: HTMLElement;
  scanning(photos: number | null): void;
  report(progress: FolderProgress | null): void;
  empty(message: string): void;
  dispose(): void;
}

export function createFolderStatus(options: FolderStatusOptions): FolderStatusView {
  const text = h("span", { class: "folder-status-text" });
  const cancel = h(
    "button",
    { type: "button", class: "folder-cancel", hidden: true },
    ["やめる"],
  );
  const spoken = h("span", {
    class: "sr-only",
    role: "status",
    "aria-live": "polite",
  });
  const element = h("p", { class: "folder-status", hidden: true }, [
    h("span", { class: "folder-status-line", "aria-hidden": "true" }, [text]),
    cancel,
    spoken,
  ]);

  let scan: number | null = null;
  let reported: FolderProgress | null = null;
  let emptyMessage: string | null = null;
  let reportedAt = 0;
  let timer = 0;

  cancel.addEventListener("click", () => options.onCancel());

  function say(message: string): void {
    setText(spoken, message);
  }

  function render(): void {
    if (scan !== null) {
      setText(text, folderScanText(scan));
      cancel.hidden = false;
      element.hidden = false;
      element.dataset.state = "scanning";
      return;
    }
    cancel.hidden = true;
    if (emptyMessage !== null) {
      setText(text, emptyMessage);
      element.hidden = false;
      element.dataset.state = "empty";
      return;
    }
    if (reported) {
      setText(text, folderProgressText(reported));
      element.hidden = false;
      element.dataset.state = reported.accepted > 0 ? "ready" : "empty";
      return;
    }
    element.hidden = true;
    delete element.dataset.state;
  }

  function clearLater(delay: number): void {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      timer = 0;
      reported = null;
      emptyMessage = null;
      render();
    }, Math.max(0, delay));
  }

  return {
    element,
    scanning(photos) {
      const started = scan === null && photos !== null;
      scan = photos;
      if (started) {
        say("フォルダを読み込んでいます");
      }
      render();
    },
    empty(message) {
      reported = null;
      emptyMessage = message;
      say(message);
      render();
      clearLater(EMPTY_SHOWN_MS);
    },
    report(progress) {
      emptyMessage = null;
      if (progress === null) {
        window.clearTimeout(timer);
        timer = 0;
        reported = null;
        render();
        return;
      }
      const fresh =
        reported === null ||
        reported.found !== progress.found ||
        reported.accepted !== progress.accepted ||
        reported.skipped !== progress.skipped;
      if (fresh) {
        reportedAt = performance.now();
        say(folderProgressText(progress));
      }
      reported = progress;
      render();
      if (progress.accepted === 0) {
        if (fresh) {
          clearLater(EMPTY_SHOWN_MS);
        }
        return;
      }
      if (progress.done) {
        clearLater(MIN_SHOWN_MS - (performance.now() - reportedAt));
      } else {
        window.clearTimeout(timer);
        timer = 0;
      }
    },
    dispose() {
      window.clearTimeout(timer);
    },
  };
}
