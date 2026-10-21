import type { VisitorImages } from "./visitor-images";
import type { PhotoRecord } from "../contracts";
import { finalQuarter } from "../core/rotation";
import { creditText, judgementText, photoPlace, verdictOf } from "./copy";
import type { DecisionLog } from "./decision-log";
import { externalLink, h, setText } from "./dom";
import { formatCount } from "./format";
import { renderVerdict } from "./verdict";

const RENDER_DELAY_MS = 250;

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
      scroller,
    ],
  );

  let open = false;
  let renderedSize = 0;
  let timer = 0;

  closeButton.addEventListener("click", () => options.onClose());
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

  function thumbnail(record: PhotoRecord): Node {
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
        options.images.url(source.file).then(
          (visitorUrl) => {
            image.src = visitorUrl;
          },
          () => {
            frame.dataset.failed = "true";
          },
        );
      }
      const quarter = record.prediction
        ? finalQuarter(record.simulated, record.prediction.correction)
        : record.simulated;
      image.style.transform = `rotate(${quarter * 90}deg)`;
      frame.append(image);
    }
    return frame;
  }

  function credit(record: PhotoRecord): Node {
    const { source } = record;
    const text = creditText(source);
    return source.kind === "commons" && source.attribution
      ? externalLink(source.attribution.pageUrl, text)
      : document.createTextNode(text);
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
          thumbnail(record),
          h(
            "button",
            { type: "button", class: "ledger-photo", "data-id": record.id },
            [
              h("span", { class: "ledger-name" }, [
                record.source.title || record.source.file?.name || "写真",
              ]),
            ],
          ),
          h("span", { class: "ledger-credit" }, [credit(record)]),
          place(record),
        ]),
      ]),
      h("td", {}, [judgementText(record)]),
      h("td", {}, [verdictNode]),
    );
    return line;
  }

  function clearRows(): void {
    tbody.replaceChildren();
    renderedSize = 0;
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

  function render(): void {
    timer = 0;
    if (!open) {
      return;
    }
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
        last.remove();
      }
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
    notify() {
      if (open && timer === 0) {
        timer = window.setTimeout(render, RENDER_DELAY_MS);
      }
    },
    dispose() {
      window.clearTimeout(timer);
      clearRows();
    },
  };
}
