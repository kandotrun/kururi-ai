import type { PhotoRecord, Quarter, ScreenPoint } from "../contracts";
import { expectedCorrection } from "../core/rotation";
import {
  creditText,
  judgementText,
  loupeRotation,
  verdictOf,
} from "./copy";
import { externalLink, h, setText } from "./dom";
import { correctionPhrase, formatConfidence, formatMs } from "./format";
import { placeLoupe } from "./loupe-geometry";
import { renderVerdict } from "./verdict";

const QUARTERS: readonly Quarter[] = [0, 1, 2, 3];

export interface LoupeOptions {
  onClose(): void;
  sheet(): boolean;
  reserveTop(): number;
  reserveBottom(): number;
}

export interface LoupeView {
  readonly element: HTMLElement;
  show(record: PhotoRecord, at: ScreenPoint): void;
  hide(): void;
  pin(record: PhotoRecord | null): void;
  refresh(record: PhotoRecord): void;
  pinnedId(): string | null;
  reposition(): void;
  dispose(): void;
}

type Mode = "hidden" | "hover" | "pinned";

interface OddsRow {
  row: HTMLTableRowElement;
  bar: HTMLElement;
  value: HTMLElement;
}

function fact(label: string, value: HTMLElement): HTMLElement {
  return h("div", { class: "slip-fact" }, [h("dt", {}, [label]), value]);
}

function oddsRow(quarter: Quarter): OddsRow {
  const bar = h("i");
  const value = h("td", { class: "odds-value" });
  const row = h("tr", {}, [
    h("th", { scope: "row" }, [correctionPhrase(quarter)]),
    h("td", { class: "odds-track" }, [h("span", { class: "odds-bar" }, [bar])]),
    value,
  ]);
  return { row, bar, value };
}

function displayTitle(record: PhotoRecord): string {
  return record.source.title || record.source.file?.name || "写真";
}

export function createLoupe(options: LoupeOptions): LoupeView {
  const photo = h("img", {
    class: "loupe-photo",
    alt: "",
    decoding: "async",
    draggable: "false",
  });
  const lens = h("div", { class: "loupe-lens", "aria-hidden": "true" }, [
    photo,
    h("span", { class: "loupe-glass" }),
  ]);
  const title = h("p", { class: "slip-title", id: "loupe-title" });
  const judgement = h("dd");
  const confidence = h("dd");
  const timing = h("dd");
  const timingFact = fact("処理時間", timing);
  const facts = h("dl", { class: "slip-facts" }, [
    fact("判定", judgement),
    fact("確信度", confidence),
    timingFact,
  ]);
  const verdict = h("p", { class: "verdict slip-verdict" });
  const credit = h("p", { class: "slip-credit" });
  const odds = QUARTERS.map(oddsRow);
  const oddsTable = h("table", { class: "odds" }, [
    h("caption", {}, ["向きごとの確率"]),
    h(
      "tbody",
      {},
      odds.map((item) => item.row),
    ),
  ]);
  const links = h("p", { class: "slip-links" });
  const close = h("button", { type: "button", class: "slip-close" }, [
    "閉じる",
  ]);
  const extras = h("div", { class: "slip-extras" }, [
    oddsTable,
    h("div", { class: "slip-foot" }, [links, close]),
  ]);
  const slip = h("div", { class: "loupe-slip", tabindex: "-1" }, [
    title,
    facts,
    verdict,
    credit,
    extras,
  ]);
  const element = h(
    "div",
    {
      class: "loupe",
      "data-state": "hidden",
      role: "dialog",
      "aria-modal": "false",
      "aria-labelledby": "loupe-title",
      "aria-hidden": "true",
    },
    [lens, slip],
  );

  let mode: Mode = "hidden";
  let current: PhotoRecord | null = null;
  let point: ScreenPoint | null = null;
  let lastHover: { id: string; at: ScreenPoint } | null = null;
  let renderedKey = "";
  let size = { width: 0, height: 0 };
  let photoId: string | null = null;
  let photoUrl: string | null = null;
  let photoToken = 0;
  let objectUrl: { id: string; url: string } | null = null;
  let returnFocus: HTMLElement | null = null;

  close.addEventListener("click", () => options.onClose());

  function releaseObjectUrl(keepId: string | null): void {
    if (objectUrl && objectUrl.id !== keepId) {
      URL.revokeObjectURL(objectUrl.url);
      objectUrl = null;
    }
  }

  function urlFor(record: PhotoRecord, pinned: boolean): string | null {
    const { source } = record;
    if (source.file) {
      releaseObjectUrl(record.id);
      if (!objectUrl) {
        objectUrl = { id: record.id, url: URL.createObjectURL(source.file) };
      }
      return objectUrl.url;
    }
    releaseObjectUrl(null);
    return pinned
      ? (source.largeUrl ?? source.thumbUrl)
      : (source.thumbUrl ?? source.largeUrl);
  }

  function setAspect(aspect: number): void {
    const safe = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
    photo.style.setProperty("--aspect", safe.toFixed(4));
  }

  function setPhoto(record: PhotoRecord, pinned: boolean): void {
    const url = urlFor(record, pinned);
    if (record.id !== photoId) {
      photoId = record.id;
      photoUrl = null;
      photoToken += 1;
      photo.removeAttribute("src");
      photo.dataset.ready = "false";
      setAspect(record.aspect);
    }
    if (url === photoUrl || url === null) {
      return;
    }
    photoUrl = url;
    const token = ++photoToken;
    const probe = new Image();
    probe.decoding = "async";
    probe.src = url;
    probe
      .decode()
      .then(() => {
        if (token !== photoToken) {
          return;
        }
        if (probe.naturalWidth > 0 && probe.naturalHeight > 0) {
          setAspect(probe.naturalWidth / probe.naturalHeight);
        }
        photo.src = url;
        photo.dataset.ready = "true";
      })
      .catch(() => {
        if (token === photoToken && photo.dataset.ready !== "true") {
          photo.dataset.ready = "failed";
        }
      });
  }

  function setTurn(record: PhotoRecord, instant: boolean): void {
    const turn = `${loupeRotation(record)}deg`;
    if (photo.style.getPropertyValue("--turn") === turn) {
      return;
    }
    if (instant) {
      photo.classList.add("is-instant");
      photo.style.setProperty("--turn", turn);
      void photo.offsetWidth;
      photo.classList.remove("is-instant");
      return;
    }
    photo.style.setProperty("--turn", turn);
  }

  function renderOdds(record: PhotoRecord): void {
    const prediction = record.prediction;
    const fix = record.source.uprightFix;
    const truth =
      prediction && record.correct === false && fix !== null
        ? expectedCorrection(fix, record.simulated)
        : null;
    oddsTable.hidden = prediction === null;
    for (const quarter of QUARTERS) {
      const item = odds[quarter]!;
      const probability = prediction ? prediction.probabilities[quarter] : 0;
      item.bar.style.setProperty("--p", probability.toFixed(3));
      setText(item.value, formatConfidence(probability));
      item.row.toggleAttribute(
        "data-pick",
        prediction?.correction === quarter,
      );
      item.row.toggleAttribute("data-truth", truth === quarter);
      item.row.toggleAttribute("data-miss", record.correct === false);
    }
  }

  function renderLinks(record: PhotoRecord): void {
    const attribution = record.source.attribution;
    if (record.source.kind !== "commons" || !attribution) {
      links.replaceChildren();
      links.hidden = true;
      return;
    }
    links.hidden = false;
    links.replaceChildren(
      externalLink(attribution.pageUrl, "Commons のページ"),
      attribution.licenseUrl
        ? externalLink(attribution.licenseUrl, attribution.license)
        : "",
    );
  }

  function measure(): void {
    size = { width: element.offsetWidth, height: element.offsetHeight };
  }

  function defaultPoint(): ScreenPoint {
    return { x: window.innerWidth * 0.56, y: window.innerHeight * 0.46 };
  }

  function place(): void {
    if (mode === "hidden") {
      return;
    }
    if (options.sheet()) {
      element.style.transform = "";
      return;
    }
    const placement = placeLoupe(
      point ?? defaultPoint(),
      size,
      { width: window.innerWidth, height: window.innerHeight },
      {
        gap: 28,
        margin: 12,
        lift: mode === "pinned" ? 120 : 110,
        reserveTop: options.reserveTop(),
        reserveBottom: options.reserveBottom(),
      },
    );
    element.dataset.side = placement.side;
    element.style.transform = `translate3d(${placement.left}px, ${placement.top}px, 0)`;
  }

  function render(record: PhotoRecord): void {
    const pinned = mode === "pinned";
    const key = [
      record.id,
      record.phase,
      record.prediction?.correction ?? "-",
      String(record.correct),
      mode,
    ].join("|");
    if (key === renderedKey) {
      return;
    }
    const switched = !renderedKey.startsWith(`${record.id}|`);
    renderedKey = key;
    setText(title, displayTitle(record));
    setText(judgement, judgementText(record));
    setText(
      confidence,
      record.prediction ? formatConfidence(record.prediction.confidence) : "—",
    );
    timingFact.hidden = !pinned || record.prediction === null;
    setText(
      timing,
      record.prediction ? `${formatMs(record.prediction.inferenceMs)} ms` : "",
    );
    renderVerdict(verdict, verdictOf(record));
    setText(credit, creditText(record.source));
    extras.hidden = !pinned;
    if (pinned) {
      renderOdds(record);
      renderLinks(record);
    }
    setPhoto(record, pinned);
    setTurn(record, switched);
    measure();
  }

  function setMode(next: Mode): void {
    mode = next;
    element.dataset.state = next;
    if (next === "pinned") {
      element.removeAttribute("aria-hidden");
    } else {
      element.setAttribute("aria-hidden", "true");
    }
  }

  function reset(): void {
    current = null;
    renderedKey = "";
    photoId = null;
    photoUrl = null;
    photoToken += 1;
    releaseObjectUrl(null);
  }

  return {
    element,
    show(record, at) {
      if (mode === "pinned") {
        if (current?.id === record.id) {
          current = record;
          point = at;
          render(record);
          place();
        }
        return;
      }
      lastHover = { id: record.id, at };
      current = record;
      point = at;
      if (mode !== "hover") {
        setMode("hover");
      }
      render(record);
      place();
    },
    hide() {
      if (mode !== "hover") {
        return;
      }
      setMode("hidden");
      reset();
    },
    pin(record) {
      if (record === null) {
        if (mode !== "pinned") {
          return;
        }
        const restore = element.contains(document.activeElement)
          ? returnFocus
          : null;
        setMode("hidden");
        reset();
        if (restore && restore.isConnected) {
          restore.focus({ preventScroll: true });
        }
        returnFocus = null;
        return;
      }
      if (mode !== "pinned") {
        const active = document.activeElement;
        returnFocus =
          active instanceof HTMLElement && active !== document.body
            ? active
            : null;
      }
      point =
        lastHover?.id === record.id
          ? lastHover.at
          : current?.id === record.id
            ? point
            : null;
      current = record;
      setMode("pinned");
      render(record);
      place();
      slip.focus({ preventScroll: true });
    },
    refresh(record) {
      if (mode === "hidden" || current?.id !== record.id) {
        return;
      }
      current = record;
      render(record);
      place();
    },
    pinnedId() {
      return mode === "pinned" ? (current?.id ?? null) : null;
    },
    reposition() {
      if (mode === "hidden") {
        return;
      }
      measure();
      place();
    },
    dispose() {
      reset();
    },
  };
}
