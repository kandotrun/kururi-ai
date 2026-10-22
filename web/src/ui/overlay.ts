import "@fontsource/shippori-mincho-b1/500.css";
import "@fontsource/shippori-mincho-b1/800.css";
import "../style.css";
import type {
  DeskStats,
  ModelId,
  ModelOption,
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
  announcementKey,
  failedPhotosNotice,
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
import { createHeicTracker } from "./heic-tracker";
import { createInsetTracker } from "./inset-tracker";
import { createLedger } from "./ledger";
import { GITHUB_URL, RELEASE_URL } from "./links";
import { createLoupe } from "./loupe";
import { createModelPicker } from "./model-picker";
import { createRuler } from "./ruler";

const LEDGER_LIMIT = 200;
const VISITOR_PREVIEW_SIDE = 960;
const VISITOR_IMAGE_IDLE = 48;
const ANNOUNCE_INTERVAL_MS = 5000;
const LOCAL_NOTICE_MS = 4500;
const FAILED_NOTICE_MS = 9000;
const FAILED_GATHER_MS = 800;
const REVEAL_DELAY_MS = 1000;
const REVEAL_FADE_MS = 760;
const LEDE_FOLD_DELAY_MS = 6000;

const LEDE_PHRASES = [
  "Wikimedia Commons の写真を、",
  "わざと横向きや",
  "逆さまにして",
  "机に並べています。",
  "くるりAI が",
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
  idleLimit: VISITOR_IMAGE_IDLE,
});

export function mountOverlay(
  root: HTMLElement,
  handlers: OverlayHandlers,
): Overlay {
  const reducedMotion = mediaQuery("(prefers-reduced-motion: reduce)");
  const sheet = mediaQuery("(max-width: 719px)");
  const records = new Map<string, PhotoRecord>();
  const log = createDecisionLog();
  const heic = createHeicTracker();

  let status: StreamStatus = "loading-model";
  let progress: ModelProgress = { loaded: 0, total: 0, ready: false };
  let stats: DeskStats | null = null;
  let mainNotice: string | null = null;
  let failureNotice: string | null = null;
  let localNotice: string | null = null;
  let localTimer = 0;
  let webgl = true;
  let shownHeadline: HeadlineState | null = null;
  let modelName: ModelName = DEFAULT_MODEL;
  let introActive = false;
  let revealing = false;
  let revealTimer = 0;
  let revealEndTimer = 0;
  let skipWithKeyboard = false;
  let spokenKey: string | null = null;
  let failedWaiting = 0;
  let failedTimer = 0;
  let ledeTimer = 0;
  let pendingConfirm: (() => void) | null = null;

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
  const releaseLink = externalLink(RELEASE_URL, "CLI 版 v2.0.0");
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
  const settingsButton = h(
    "button",
    {
      type: "button",
      class: "text-button settings-toggle",
      "aria-expanded": "false",
      "aria-controls": "desk-check desk-models",
    },
    ["設定"],
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
  const ruler = createRuler({ onReload: () => window.location.reload() });
  const confirmSlip = createConfirmSlip({
    sheet,
    reserveBottom: () => ruler.element.offsetHeight,
  });
  const picker = createModelPicker({
    confirm: confirmSlip,
    onSelect: (id: ModelId) => handlers.selectModel(id),
  });
  picker.element.id = "desk-models";
  const folderImport = createFolderImport({
    access: entryAccess,
    countsAsPhoto,
    mayBePhoto,
    onFiles: (files) => {
      heic.handOff({
        found: files.length,
        photos: files.filter(countsAsPhoto).length,
        photosWithHeic: files.filter(mayBePhoto).length,
      });
      handlers.addFiles(files);
    },
    onScan: (photos) => folderStatus.scanning(photos),
    onNotice: (message, kind) => {
      if (kind === "empty") {
        folderStatus.empty(message);
      } else {
        flashNotice(message, LOCAL_NOTICE_MS);
      }
    },
  });
  const folderStatus = createFolderStatus({
    onCancel: () => folderImport.cancel(),
    heicLeftOut: (report) => heic.leftOut(report),
  });
  const actions = h("div", { class: "actions" }, [
    h("div", { class: "action-row action-add" }, [
      addButton,
      folderButton,
      settingsButton,
    ]),
    h("label", { class: "check", id: "desk-check" }, [
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
        "3D の机を",
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
  const stageScroll = h("div", { class: "stage-scroll" }, [
    headlineBlock,
    actions,
  ]);
  const stage = h("main", { class: "stage" }, [stageScroll]);

  const counter = createCounter(digits, reducedMotion);

  function closeLedger(): void {
    if (!ledger.isOpen) {
      return;
    }
    const restore = ledger.element.contains(document.activeElement);
    ledger.close();
    listButton.setAttribute("aria-expanded", "false");
    loupe.reposition();
    if (restore) {
      listButton.focus({ preventScroll: true });
    }
  }

  function openLedger(): void {
    ledger.open();
    listButton.setAttribute("aria-expanded", "true");
    loupe.reposition();
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

  function ledgerReserve(): number {
    if (!ledger.isOpen || sheet()) {
      return 0;
    }
    const left = ledger.element.getBoundingClientRect().left;
    return left > 0 ? Math.max(0, window.innerWidth - left) : 0;
  }

  const loupe = createLoupe({
    images: visitorImages,
    onClose: closePin,
    sheet,
    reserveTop: () => masthead.offsetHeight,
    reserveBottom: () => ruler.element.offsetHeight,
    reserveRight: ledgerReserve,
  });

  function renderNotice(): void {
    ruler.setNotice(failureNotice ?? localNotice ?? mainNotice);
  }

  function flashNotice(message: string, duration: number): void {
    localNotice = message;
    renderNotice();
    window.clearTimeout(localTimer);
    localTimer = window.setTimeout(() => {
      localNotice = null;
      renderNotice();
    }, duration);
  }

  function noteFailedPhoto(): void {
    failedWaiting += 1;
    if (failedTimer !== 0) {
      return;
    }
    failedTimer = window.setTimeout(() => {
      failedTimer = 0;
      const failed = failedWaiting;
      failedWaiting = 0;
      if (failed > 0) {
        flashNotice(failedPhotosNotice(failed), FAILED_NOTICE_MS);
      }
    }, FAILED_GATHER_MS);
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
      folderStatus.live,
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

  function setSettingsOpen(open: boolean): void {
    settingsButton.setAttribute("aria-expanded", String(open));
    actions.toggleAttribute("data-settings-open", open);
  }

  addButton.addEventListener("click", () => openPicker(false));
  folderButton.addEventListener("click", () => openPicker(true));
  settingsButton.addEventListener("click", () =>
    setSettingsOpen(settingsButton.getAttribute("aria-expanded") !== "true"),
  );
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
        skipWithKeyboard = true;
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
  function syncStageScroll(): void {
    stageScroll.toggleAttribute(
      "data-scrolls",
      stageScroll.scrollHeight > stageScroll.clientHeight + 1,
    );
  }
  if (typeof ResizeObserver === "function") {
    const observer = new ResizeObserver(syncChromeSizes);
    observer.observe(ruler.element);
    observer.observe(masthead);
    const stageObserver = new ResizeObserver(syncStageScroll);
    stageObserver.observe(stage);
    stageObserver.observe(headlineBlock);
    stageObserver.observe(actions);
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
  stageScroll.addEventListener("scroll", () => insets.refresh(), {
    passive: true,
  });

  function bodyHasFocus(): boolean {
    const active = document.activeElement;
    return active === null || active === document.body;
  }

  function finishReveal(refocus: boolean): void {
    revealTimer = 0;
    stage.inert = false;
    ruler.element.inert = false;
    ruler.repeatNotice();
    if (refocus && bodyHasFocus()) {
      addButton.focus({ preventScroll: true });
    }
    const confirm = pendingConfirm;
    pendingConfirm = null;
    confirm?.();
    revealEndTimer = window.setTimeout(() => {
      revealEndTimer = 0;
      revealing = false;
      overlay.removeAttribute("data-revealing");
    }, REVEAL_FADE_MS);
  }

  function setIntroActive(active: boolean): void {
    if (active === introActive) {
      return;
    }
    introActive = active;
    window.clearTimeout(revealTimer);
    window.clearTimeout(revealEndTimer);
    revealTimer = 0;
    revealEndTimer = 0;
    if (active) {
      revealing = false;
      overlay.removeAttribute("data-revealing");
      overlay.setAttribute("data-intro", "");
      stage.inert = true;
      ruler.element.inert = true;
      skipButton.hidden = false;
      skipButton.disabled = false;
      loupe.pin(null);
      loupe.hide();
      closeLedger();
      insets.setSuspended(true);
      return;
    }
    const refocus =
      skipWithKeyboard || document.activeElement === skipButton;
    skipWithKeyboard = false;
    const delay = reducedMotion() ? 0 : REVEAL_DELAY_MS;
    revealing = delay > 0;
    overlay.toggleAttribute("data-revealing", revealing);
    overlay.removeAttribute("data-intro");
    skipButton.hidden = true;
    skipButton.disabled = false;
    insets.setSuspended(false);
    if (revealing) {
      revealTimer = window.setTimeout(() => finishReveal(refocus), delay);
    } else {
      finishReveal(refocus);
    }
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
    ruler.setReloadable(status === "model-failed");
    if (status === "model-failed") {
      picker.setNote("読み込めませんでした");
    } else {
      picker.setNote(progress.ready ? "" : modelLoadingNote(progress));
    }
  }

  function updateScatter(): void {
    scatterButton.disabled = !webgl || !stats || stats.placed < 2;
  }

  function readingDetail(): boolean {
    const active = document.activeElement;
    if (!(active instanceof Node)) {
      return false;
    }
    return (
      ledger.element.contains(active) ||
      (loupe.pinnedId() !== null && loupe.element.contains(active))
    );
  }

  function announceProgress(): void {
    if (!stats) {
      return;
    }
    const key = announcementKey(stats, status);
    if (key === null || key === spokenKey || readingDetail()) {
      return;
    }
    spokenKey = key;
    announcer.say(progressAnnouncement(stats, status));
  }

  function foldLedeLater(): void {
    if (ledeTimer !== 0 || overlay.hasAttribute("data-lede-folded")) {
      return;
    }
    ledeTimer = window.setTimeout(() => {
      overlay.setAttribute("data-lede-folded", "");
    }, LEDE_FOLD_DELAY_MS);
  }

  function confirmFullModel(option: ModelOption): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const ask = (): void => {
        void picker.ask(option).then(resolve);
      };
      if (introActive || revealing) {
        pendingConfirm = ask;
      } else {
        ask();
      }
    });
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
      pauseButton.disabled = next === "finished" || next === "model-failed";
      if (next === "model-failed") {
        failureNotice = failureNotice ?? mainNotice ?? localNotice;
      } else {
        failureNotice = null;
      }
      renderNotice();
      renderState();
      renderHeadline();
      announceProgress();
    },
    setStats(next) {
      stats = next;
      overlay.toggleAttribute("data-straightening", next.placed > 0);
      if (next.placed > 0) {
        foldLedeLater();
      }
      renderHeadline();
      ruler.setStats(next);
      updateScatter();
      announceProgress();
    },
    upsertRecord(record) {
      records.set(record.id, record);
      const failedVisitor =
        record.phase === "failed" &&
        record.prediction === null &&
        record.source.kind === "user";
      if ((record.prediction || failedVisitor) && log.note(record.id)) {
        ledger.notify();
        if (failedVisitor) {
          noteFailedPhoto();
        }
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
    confirmFullModel,
  };
}
