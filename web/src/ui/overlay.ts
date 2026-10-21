import "@fontsource/shippori-mincho-b1/500.css";
import "@fontsource/shippori-mincho-b1/800.css";
import "../style.css";
import type {
  DeskStats,
  ModelId,
  ModelProgress,
  Overlay,
  OverlayHandlers,
  PhotoRecord,
  StreamStatus,
} from "../contracts";
import { modelOptions } from "../core/model-profiles";
import { RAW_EXTENSIONS, classifyPhotoFile } from "../core/photo-files";
import { visitorPreviewBlob } from "../services/image-loader";
import { createAbout } from "./about";
import { createVisitorImages } from "./visitor-images";
import { createAnnouncer } from "./announcer";
import { createConfirmSlip } from "./confirm-slip";
import {
  type HeadlineState,
  type ModelName,
  headlineChange,
  headlineState,
  modelLoadingNote,
  modelStateText,
  progressAnnouncement,
} from "./copy";
import { createCounter } from "./counter";
import { createDecisionLog } from "./decision-log";
import { externalLink, h, mediaQuery, phrased, setText } from "./dom";
import { createDropZone } from "./drop-zone";
import { entryAccess } from "./folder-entries";
import { createFolderImport } from "./folder-import";
import { createFolderStatus } from "./folder-status";
import { formatCount } from "./format";
import { createInsetTracker } from "./inset-tracker";
import { createLedger } from "./ledger";
import { GITHUB_URL, RELEASE_URL } from "./links";
import { createLoupe } from "./loupe";
import { createModelPicker } from "./model-picker";
import { createRuler } from "./ruler";

const LEDGER_LIMIT = 200;
const VISITOR_PREVIEW_SIDE = 960;
const VISITOR_IMAGE_LIMIT = 64;
const ANNOUNCE_INTERVAL_MS = 5000;
const LOCAL_NOTICE_MS = 4500;

const LEDE_PHRASES = [
  "Wikimedia Commons\u00a0の写真を、",
  "わざと横向きや",
  "逆さまにして",
  "机に並べています。",
  "くるりAI\u00a0が",
  "このブラウザの中で",
  "1枚ずつ",
  "向きを見分けて、",
  "正しい向きに直します。",
] as const;

const DEFAULT_MODEL: ModelName = modelOptions({
  webgpu: false,
  fullBaseUrl: null,
})[0] ?? { label: "軽量", version: "v2-nano" };

const PHOTO_ACCEPT = [
  "image/*",
  ...RAW_EXTENSIONS.map((extension) => `.${extension}`),
].join(",");

function pathOf(file: File): string {
  return file.webkitRelativePath || file.name;
}

function countsAsPhoto(file: File): boolean {
  return classifyPhotoFile(pathOf(file), file.type) !== "skip";
}

function mayBePhoto(file: File): boolean {
  return classifyPhotoFile(pathOf(file), file.type, { heic: true }) !== "skip";
}

function supportsFolderPicker(): boolean {
  return (
    "webkitdirectory" in HTMLInputElement.prototype &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(any-pointer: fine)").matches
  );
}

const visitorImages = createVisitorImages({
  preview: (file) => visitorPreviewBlob(file, VISITOR_PREVIEW_SIDE),
  createUrl: (blob) => URL.createObjectURL(blob),
  revokeUrl: (url) => URL.revokeObjectURL(url),
  limit: VISITOR_IMAGE_LIMIT,
});

export function mountOverlay(
  root: HTMLElement,
  handlers: OverlayHandlers,
): Overlay {
  const reducedMotion = mediaQuery("(prefers-reduced-motion: reduce)");
  const sheet = mediaQuery("(max-width: 719px)");
  const records = new Map<string, PhotoRecord>();
  const log = createDecisionLog();

  let status: StreamStatus = "loading-model";
  let progress: ModelProgress = { loaded: 0, total: 0, ready: false };
  let stats: DeskStats | null = null;
  let mainNotice: string | null = null;
  let localNotice: string | null = null;
  let localTimer = 0;
  let webgl = true;
  let shownHeadline: HeadlineState | null = null;
  let modelName: ModelName = DEFAULT_MODEL;
  let introActive = false;
  let skipWithKeyboard = false;

  const canvas = h("canvas", {
    class: "desk-canvas",
    role: "img",
    "aria-label": "写真の向きを1枚ずつ直して並べていく机",
  });

  const aboutButton = h(
    "button",
    { type: "button", class: "text-button", "aria-haspopup": "dialog" },
    ["このデモについて"],
  );
  const releaseLink = externalLink(RELEASE_URL, "v2.0.0 をダウンロード");
  releaseLink.classList.add("nav-release");
  const masthead = h("header", { class: "masthead" }, [
    h("a", { class: "wordmark", href: "./" }, ["くるりAI"]),
    h("nav", { class: "masthead-nav", "aria-label": "関連リンク" }, [
      externalLink(GITHUB_URL, "GitHub"),
      releaseLink,
      aboutButton,
    ]),
  ]);

  const headlineLabel = h("span", { class: "headline-label" });
  const digits = h("span", { class: "count-digits" });
  const count = h("span", { class: "count", "aria-hidden": "true" }, [
    digits,
    h("span", { class: "count-unit" }, ["枚"]),
  ]);
  const countSpoken = h("span", { class: "sr-only" });
  const headline = h("h1", { class: "headline" }, [
    headlineLabel,
    h("span", { class: "headline-count" }, [count, countSpoken]),
  ]);
  const lede = h("p", { class: "lede" }, phrased(LEDE_PHRASES));

  const fileInput = h("input", {
    type: "file",
    accept: PHOTO_ACCEPT,
    multiple: true,
    hidden: true,
    tabindex: "-1",
  });
  const addButton = h("button", { type: "button", class: "paper-button" }, [
    "自分の写真を並べる",
  ]);
  const folderButton = h(
    "button",
    {
      type: "button",
      class: "text-button folder-button",
      hidden: !supportsFolderPicker(),
    },
    ["フォルダを選ぶ"],
  );
  const pauseButton = h("button", { type: "button", class: "text-button" }, [
    "一時停止",
  ]);
  const scatterButton = h(
    "button",
    { type: "button", class: "text-button", disabled: true },
    ["全部くずす"],
  );
  const listButton = h(
    "button",
    {
      type: "button",
      class: "text-button",
      "aria-expanded": "false",
      "aria-controls": "ledger",
    },
    ["一覧"],
  );
  const simulateInput = h("input", { type: "checkbox" });
  const ruler = createRuler();
  const confirmSlip = createConfirmSlip({
    sheet,
    reserveBottom: () => ruler.element.offsetHeight,
  });
  const picker = createModelPicker({
    confirm: confirmSlip,
    onSelect: (id: ModelId) => handlers.selectModel(id),
  });
  const folderImport = createFolderImport({
    access: entryAccess,
    countsAsPhoto,
    mayBePhoto,
    onFiles: (files) => handlers.addFiles(files),
    onScan: (photos) => folderStatus.scanning(photos),
    onNotice: (message, kind) => {
      if (kind === "empty") {
        folderStatus.empty(message);
      } else {
        flashNotice(message);
      }
    },
  });
  const folderStatus = createFolderStatus({
    onCancel: () => folderImport.cancel(),
  });
  const actions = h("div", { class: "actions" }, [
    h("div", { class: "action-row action-add" }, [addButton, folderButton]),
    h("label", { class: "check" }, [
      simulateInput,
      h("span", {}, ["自分の写真もわざと回転させる"]),
    ]),
    folderStatus.element,
    h("div", { class: "action-texts" }, [
      pauseButton,
      scatterButton,
      listButton,
    ]),
    picker.element,
    fileInput,
  ]);
  const skipButton = h(
    "button",
    {
      type: "button",
      class: "skip-intro",
      hidden: true,
      "aria-label": "オープニングをスキップ",
    },
    ["スキップ"],
  );

  const flatOpen = h("button", { type: "button", class: "ink-button" }, [
    "一覧を開く",
  ]);
  const flat = h("div", { class: "flat-message", hidden: true }, [
    h(
      "p",
      {},
      phrased([
        "このブラウザでは ",
        "3D\u00a0の机を",
        "表示できませんでした。",
        "写真の判定は",
        "このまま続くので、",
        "結果は一覧で",
        "見られます。",
      ]),
    ),
    flatOpen,
  ]);

  const headlineBlock = h("div", { class: "intro" }, [headline, lede]);
  const stage = h("main", { class: "stage" }, [headlineBlock, actions]);

  const counter = createCounter(digits, reducedMotion);

  function closeLedger(): void {
    if (!ledger.isOpen) {
      return;
    }
    const restore = ledger.element.contains(document.activeElement);
    ledger.close();
    listButton.setAttribute("aria-expanded", "false");
    if (restore) {
      listButton.focus({ preventScroll: true });
    }
  }

  function openLedger(): void {
    ledger.open();
    listButton.setAttribute("aria-expanded", "true");
  }

  const ledger = createLedger({
    images: visitorImages,
    records,
    log,
    limit: LEDGER_LIMIT,
    onSelect: (id) => handlers.selectRecord(id),
    onClose: closeLedger,
  });

  function closePin(): void {
    loupe.pin(null);
    handlers.selectRecord(null);
  }

  const loupe = createLoupe({
    images: visitorImages,
    onClose: closePin,
    sheet,
    reserveTop: () => masthead.offsetHeight,
    reserveBottom: () => ruler.element.offsetHeight,
  });

  function renderNotice(): void {
    ruler.setNotice(localNotice ?? mainNotice);
  }

  function flashNotice(message: string): void {
    localNotice = message;
    renderNotice();
    window.clearTimeout(localTimer);
    localTimer = window.setTimeout(() => {
      localNotice = null;
      renderNotice();
    }, LOCAL_NOTICE_MS);
  }

  const drop = createDropZone(window, {
    onDrop: ({ files, folders }) => {
      if (folders.length === 0 || files.some(mayBePhoto)) {
        folderImport.addFiles(files, "files");
      }
      void folderImport.importFolders(folders);
    },
  });

  const announcer = createAnnouncer(ANNOUNCE_INTERVAL_MS);

  const overlay = h(
    "div",
    { class: "overlay", "data-status": status },
    [
      masthead,
      stage,
      ruler.element,
      ledger.element,
      flat,
      loupe.element,
      skipButton,
      drop.element,
      announcer.element,
    ],
  );
  const about = createAbout();

  root.classList.add("desk-root");
  root.replaceChildren(canvas, overlay, about.element, confirmSlip.element);

  function photoPicker(): void {
    fileInput.webkitdirectory = false;
    fileInput.accept = PHOTO_ACCEPT;
  }

  function openPicker(folder: boolean): void {
    if (folder) {
      fileInput.webkitdirectory = true;
      fileInput.removeAttribute("accept");
    } else {
      photoPicker();
    }
    fileInput.click();
  }

  addButton.addEventListener("click", () => openPicker(false));
  folderButton.addEventListener("click", () => openPicker(true));
  fileInput.addEventListener("change", () => {
    const files = Array.from(fileInput.files ?? []);
    const origin = fileInput.webkitdirectory ? "folder" : "files";
    fileInput.value = "";
    photoPicker();
    folderImport.addFiles(files, origin);
  });
  fileInput.addEventListener("cancel", photoPicker);
  skipButton.addEventListener("click", (event) => {
    skipWithKeyboard = event.detail === 0;
    skipButton.disabled = true;
    handlers.skipIntro();
  });
  pauseButton.addEventListener("click", () => handlers.togglePause());
  scatterButton.addEventListener("click", () => handlers.scatter());
  listButton.addEventListener("click", () => {
    if (ledger.isOpen) {
      closeLedger();
    } else {
      openLedger();
    }
  });
  flatOpen.addEventListener("click", openLedger);
  simulateInput.addEventListener("change", () =>
    handlers.setSimulateUser(simulateInput.checked),
  );
  aboutButton.addEventListener("click", () => about.open());

  function onKeyDown(event: KeyboardEvent): void {
    if (event.key !== "Escape" || about.isOpen || confirmSlip.isOpen) {
      return;
    }
    if (introActive) {
      if (!skipButton.disabled) {
        event.preventDefault();
        skipButton.disabled = true;
        handlers.skipIntro();
      }
      return;
    }
    if (loupe.pinnedId() !== null) {
      event.preventDefault();
      closePin();
      return;
    }
    if (ledger.isOpen) {
      event.preventDefault();
      closeLedger();
    }
  }
  document.addEventListener("keydown", onKeyDown);

  function syncChromeSizes(): void {
    overlay.style.setProperty("--ruler-h", `${ruler.element.offsetHeight}px`);
    overlay.style.setProperty("--mast-h", `${masthead.offsetHeight}px`);
  }
  if (typeof ResizeObserver === "function") {
    const observer = new ResizeObserver(syncChromeSizes);
    observer.observe(ruler.element);
    observer.observe(masthead);
  }
  syncChromeSizes();
  window.addEventListener("resize", () => loupe.reposition());
  renderHeadline();

  const insets = createInsetTracker(
    {
      masthead,
      headline: [headlineLabel, headline.querySelector<HTMLElement>(".headline-count") ?? headline],
      text: [lede],
      actions: () =>
        Array.from(actions.children).filter(
          (child): child is HTMLElement =>
            child instanceof HTMLElement && child !== fileInput,
        ),
      ruler: ruler.element,
      observe: [masthead, headlineBlock, lede, actions, ruler.element],
    },
    sheet,
  );

  function setIntroActive(active: boolean): void {
    if (active === introActive) {
      return;
    }
    introActive = active;
    overlay.toggleAttribute("data-intro", active);
    stage.inert = active;
    ruler.element.inert = active;
    skipButton.hidden = !active;
    skipButton.disabled = false;
    if (active) {
      loupe.pin(null);
      loupe.hide();
      closeLedger();
    } else {
      const refocus =
        skipWithKeyboard &&
        (document.activeElement === skipButton ||
          document.activeElement === document.body);
      skipWithKeyboard = false;
      if (refocus) {
        addButton.focus({ preventScroll: true });
      }
    }
    insets.setSuspended(active);
  }

  function renderHeadline(): void {
    const next = headlineState(stats, status);
    const change = headlineChange(shownHeadline, next);
    if (change === "none") {
      return;
    }
    if (change === "jump") {
      const first = shownHeadline === null;
      setText(headlineLabel, next.label);
      counter.jump(next.value);
      if (!first) {
        headline.classList.remove("is-fresh");
        void headline.offsetWidth;
        headline.classList.add("is-fresh");
      }
    } else {
      counter.set(next.value);
    }
    setText(countSpoken, `${formatCount(next.value)}枚`);
    shownHeadline = next;
  }

  function renderState(): void {
    ruler.setState(modelStateText(status, progress, modelName));
    picker.setNote(progress.ready ? "" : modelLoadingNote(progress));
  }

  function updateScatter(): void {
    scatterButton.disabled = !webgl || !stats || stats.placed < 2;
  }

  return {
    canvas,
    setModelProgress(next) {
      progress = next;
      renderState();
    },
    setStatus(next) {
      status = next;
      overlay.dataset.status = next;
      setText(pauseButton, next === "paused" ? "再開" : "一時停止");
      pauseButton.disabled = next === "finished";
      renderState();
      renderHeadline();
      if (stats) {
        announcer.say(progressAnnouncement(stats, status));
      }
    },
    setStats(next) {
      stats = next;
      overlay.toggleAttribute("data-straightening", next.placed > 0);
      renderHeadline();
      ruler.setStats(next);
      updateScatter();
      announcer.say(progressAnnouncement(next, status));
    },
    upsertRecord(record) {
      records.set(record.id, record);
      if (record.prediction && log.note(record.id)) {
        ledger.notify();
      }
      loupe.refresh(record);
    },
    showLoupe(record, at) {
      if (webgl && !introActive) {
        loupe.show(record, at);
      }
    },
    hideLoupe() {
      loupe.hide();
    },
    pin(record) {
      loupe.pin(record);
    },
    notice(message) {
      mainNotice = message;
      renderNotice();
    },
    webglUnavailable() {
      webgl = false;
      overlay.dataset.webgl = "off";
      root.classList.add("is-flat");
      canvas.hidden = true;
      flat.hidden = false;
      loupe.pin(null);
      loupe.hide();
      updateScatter();
    },
    simulateUser() {
      return simulateInput.checked;
    },
    setModels(current, options) {
      modelName = options.find((option) => option.id === current) ?? DEFAULT_MODEL;
      overlay.dataset.model = current;
      picker.set(current, options);
      renderState();
    },
    setIntroActive,
    viewInsets() {
      return insets.current();
    },
    onViewInsetsChange(handler) {
      return insets.onChange(handler);
    },
    setFolderProgress(progress) {
      folderStatus.report(progress);
    },
  };
}
