import type { VisitorImageLease, VisitorImages } from "./visitor-images";
import type { PhotoRecord } from "../contracts";
import { finalQuarter } from "../core/rotation";
import {
  failureReason,
  judgementText,
  newRowsText,
  photoPlace,
  verdictOf,
} from "./copy";
import { renderCredit } from "./credit";
import type { DecisionLog } from "./decision-log";
import { externalLink, h, setText } from "./dom";
import { formatCount } from "./format";
import { renderVerdict } from "./verdict";

const RENDER_DELAY_MS = 250;
const HOLD_SCROLL_PX = 24;
const THUMB_MARGIN = "240px 0px";

export interface LedgerOptions {
  records: ReadonlyMap<string, PhotoRecord>;
  log: DecisionLog;
  limit: number;
  images: VisitorImages;
  onSelect(id: string): void;
  onClose(): void;
}

export interface LedgerView {
  readonly element: HTMLElement;
  readonly isOpen: boolean;
  open(): void;
  close(): void;
  notify(): void;
  dispose(): void;
}

interface VisitorThumb {
  readonly frame: HTMLElement;
  readonly image: HTMLImageElement;
  readonly file: File;
  lease: VisitorImageLease | null;
}

function columnHeader(text: string): HTMLTableCellElement {
  return h("th", { scope: "col" }, [text]);
}

export function createLedger(options: LedgerOptions): LedgerView {
  const { records, log, limit } = options;
  const heading = h(
    "h2",
    { class: "ledger-title", id: "ledger-title", tabindex: "-1" },
    ["一覧"],
  );
  const summary = h("p", { class: "ledger-summary" });
  const closeButton = h(
    "button",
    { type: "button", class: "text-button ledger-close" },
    ["閉じる"],
  );
  const moreButton = h("button", {
    type: "button",
    class: "ledger-more",
    hidden: true,
  });
  const tbody = h("tbody");
  const table = h("table", { class: "ledger-table" }, [
    h("caption", { class: "sr-only" }, ["判定した写真（新しい順）"]),
    h("thead", {}, [
      h("tr", {}, [
        columnHeader("写真"),
        columnHeader("判定"),
        columnHeader("答え合わせ"),
      ]),
    ]),
    tbody,
  ]);
  const empty = h("p", { class: "ledger-empty" }, [
    "まだ判定した写真はありません。判定が終わると、新しい順にここに並びます。",
  ]);
  const scroller = h(
    "div",
    {
      class: "ledger-scroll",
      tabindex: "0",
      role: "group",
      "aria-label": "判定した写真の表",
    },
    [table, empty],
  );
  const element = h(
    "section",
    {
      class: "ledger",
      id: "ledger",
      "aria-labelledby": "ledger-title",
      hidden: true,
    },
    [
      h("div", { class: "ledger-head" }, [
        h("div", {}, [heading, summary]),
        closeButton,
      ]),
      moreButton,
      scroller,
    ],
  );

  let open = false;
  let renderedSize = 0;
  let timer = 0;
  const thumbs = new Map<HTMLTableRowElement, VisitorThumb>();
  const frames = new Map<Element, HTMLTableRowElement>();

  const watcher =
    typeof IntersectionObserver === "function"
      ? new IntersectionObserver(
          (entries) => {
            for (const entry of entries) {
              if (entry.isIntersecting) {
                showThumb(entry.target);
              }
            }
          },
          { root: scroller, rootMargin: THUMB_MARGIN },
        )
      : null;

  function showThumb(frame: Element): void {
    watcher?.unobserve(frame);
    const line = frames.get(frame);
    const thumb = line ? thumbs.get(line) : undefined;
    if (!thumb || thumb.lease) {
      return;
    }
    const lease = options.images.acquire(thumb.file);
    thumb.lease = lease;
    lease.url.then(
      (url) => {
        if (thumb.lease === lease) {
          thumb.image.src = url;
        }
      },
      () => {
        if (thumb.lease === lease) {
          thumb.frame.dataset.failed = "true";
        }
      },
    );
  }

  function forgetThumb(line: HTMLTableRowElement): void {
    const thumb = thumbs.get(line);
    if (!thumb) {
      return;
    }
    watcher?.unobserve(thumb.frame);
    frames.delete(thumb.frame);
    thumbs.delete(line);
    thumb.lease?.release();
    thumb.lease = null;
  }

  function holding(): boolean {
    const active = document.activeElement;
    return (
      (active instanceof Node && tbody.contains(active)) ||
      scroller.scrollTop > HOLD_SCROLL_PX
    );
  }

  function schedule(): void {
    if (open && timer === 0) {
      timer = window.setTimeout(render, RENDER_DELAY_MS);
    }
  }

  closeButton.addEventListener("click", () => options.onClose());
  moreButton.addEventListener("click", () => {
    window.clearTimeout(timer);
    render(true);
    scroller.scrollTop = 0;
    const first = tbody.querySelector<HTMLElement>(".ledger-photo");
    (first ?? heading).focus({ preventScroll: true });
  });
  tbody.addEventListener("focusout", schedule);
  scroller.addEventListener(
    "scroll",
    () => {
      if (scroller.scrollTop <= HOLD_SCROLL_PX && !moreButton.hidden) {
        schedule();
      }
    },
    { passive: true },
  );
  tbody.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    const trigger = target.closest<HTMLElement>(".ledger-photo, .ledger-thumb");
    const id = trigger?.closest<HTMLTableRowElement>("tr")?.dataset.id;
    if (id) {
      options.onSelect(id);
    }
  });

  function thumbnail(record: PhotoRecord, line: HTMLTableRowElement): Node {
    const { source } = record;
    const url = source.thumbUrl ?? source.largeUrl;
    const frame = h("span", { class: "ledger-thumb", "aria-hidden": "true" });
    if (url || source.file) {
      const image = h("img", {
        alt: "",
        loading: "lazy",
        decoding: "async",
      });
      if (url) {
        image.src = url;
      } else if (source.file) {
        thumbs.set(line, { frame, image, file: source.file, lease: null });
        frames.set(frame, line);
      }
      const quarter = record.prediction
        ? finalQuarter(record.simulated, record.prediction.correction)
        : record.simulated;
      image.style.transform = `rotate(${quarter * 90}deg)`;
      frame.append(image);
    }
    return frame;
  }

  function credit(record: PhotoRecord): HTMLElement {
    const line = h("span", { class: "ledger-credit" });
    renderCredit(line, record.source, true);
    return line;
  }

  function failure(record: PhotoRecord): Node | null {
    const reason = failureReason(record);
    return reason === null
      ? null
      : h("span", { class: "ledger-error" }, [reason]);
  }

  function place(record: PhotoRecord): Node | null {
    const where = photoPlace(record.source);
    return where === null
      ? null
      : h("span", { class: "ledger-place" }, [`撮影地 ${where}`]);
  }

  function row(record: PhotoRecord): HTMLTableRowElement {
    const verdict = verdictOf(record);
    const line = h("tr", { "data-tone": verdict.tone, "data-id": record.id });
    const verdictNode = h("span", { class: "verdict" });
    renderVerdict(verdictNode, verdict);
    line.append(
      h("th", { scope: "row" }, [
        h("div", { class: "ledger-item" }, [
          thumbnail(record, line),
          h(
            "button",
            { type: "button", class: "ledger-photo", "data-id": record.id },
            [
              h("span", { class: "ledger-name" }, [
                record.source.title || record.source.file?.name || "写真",
              ]),
            ],
          ),
          credit(record),
          failure(record),
          place(record),
        ]),
      ]),
      h("td", {}, [judgementText(record)]),
      h("td", {}, [verdictNode]),
    );
    return line;
  }

  function watchThumbs(): void {
    for (const thumb of thumbs.values()) {
      if (thumb.lease) {
        continue;
      }
      if (watcher) {
        watcher.observe(thumb.frame);
      } else {
        showThumb(thumb.frame);
      }
    }
  }

  function clearRows(): void {
    watcher?.disconnect();
    for (const line of Array.from(thumbs.keys())) {
      forgetThumb(line);
    }
    tbody.replaceChildren();
    renderedSize = 0;
    moreButton.hidden = true;
  }

  function updateSummary(): void {
    const count = log.size;
    setText(
      summary,
      count <= limit
        ? `判定した写真 ${formatCount(count)}枚`
        : `判定した ${formatCount(count)}枚のうち、新しい ${formatCount(limit)}枚`,
    );
    empty.hidden = count > 0;
    table.hidden = count === 0;
  }

  function render(force = false): void {
    timer = 0;
    if (!open) {
      return;
    }
    const waiting = log.size - renderedSize;
    if (waiting > 0 && renderedSize > 0 && !force && holding()) {
      setText(moreButton, newRowsText(waiting));
      moreButton.hidden = false;
      updateSummary();
      return;
    }
    moreButton.hidden = true;
    const fresh = log.since(renderedSize, limit);
    renderedSize = log.size;
    if (fresh.length > 0) {
      const fragment = document.createDocumentFragment();
      for (const id of fresh) {
        const record = records.get(id);
        if (record) {
          fragment.append(row(record));
        }
      }
      tbody.insertBefore(fragment, tbody.firstChild);
      while (tbody.rows.length > limit) {
        const last = tbody.rows[tbody.rows.length - 1];
        if (!last) {
          break;
        }
        forgetThumb(last);
        last.remove();
      }
      watchThumbs();
    }
    updateSummary();
  }

  return {
    element,
    get isOpen() {
      return open;
    },
    open() {
      if (open) {
        heading.focus({ preventScroll: true });
        return;
      }
      open = true;
      element.hidden = false;
      render();
      scroller.scrollTop = 0;
      heading.focus({ preventScroll: true });
    },
    close() {
      if (!open) {
        return;
      }
      open = false;
      element.hidden = true;
      window.clearTimeout(timer);
      timer = 0;
      clearRows();
    },
    notify: schedule,
    dispose() {
      window.clearTimeout(timer);
      clearRows();
    },
  };
}
