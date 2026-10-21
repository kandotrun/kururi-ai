import { chromium } from "@playwright/test";

const origin = process.env.OVERLAY_ORIGIN ?? "http://127.0.0.1:5173";
const shots = process.argv[2];
const fixture = process.argv[3] ?? process.env.FOLDER_FIXTURE ?? null;
const browser = await chromium.launch({ args: ["--enable-unsafe-swiftshader"] });
const results = [];
function check(name, ok, detail = "") {
  results.push(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
}
async function open(page, state, extra = "") {
  await page.goto(`${origin}/dev/overlay.html?state=${state}${extra}`);
  await page.waitForFunction(() => document.documentElement.dataset.harnessReady === "true");
  await page.evaluate(() => document.fonts.ready);
}
async function headingName(page) {
  return page.evaluate(() => {
    const heading = document.querySelector("h1");
    const label = heading?.querySelector(".headline-label")?.textContent ?? "";
    const spoken = heading?.querySelector(".sr-only")?.textContent ?? "";
    const hidden = heading?.querySelector("[aria-hidden='true']") !== null;
    return { label, spoken, hidden, digits: heading?.querySelector(".count-digits")?.textContent ?? "" };
  });
}
async function modelCalls(page) {
  return page.evaluate(() => window.harnessModelCalls.join(","));
}

const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const logs = [];
page.on("console", (message) => logs.push(message.text()));
page.on("pageerror", (error) => logs.push(`pageerror ${error.message}`));

await open(page, "running");
const hit = await page.evaluate(() => {
  const centre = (selector) => {
    const box = document.querySelector(selector).getBoundingClientRect();
    return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
  };
  const at = ({ x, y }) => {
    const element = document.elementFromPoint(x, y);
    return element ? `${element.tagName.toLowerCase()}.${element.className}` : "none";
  };
  const legend = document.querySelector(".model-legend").getBoundingClientRect();
  return {
    empty: at({ x: 1000, y: 500 }),
    label: at(centre(".headline-label")),
    count: at(centre(".headline-count")),
    lede: at(centre(".lede")),
    ruler: at(centre(".ruler-stats")),
    button: at(centre(".paper-button")),
    legend: at({ x: legend.left + 4, y: legend.top + legend.height / 2 }),
    option: at(centre(".model-option[data-model='full'] .model-name")),
  };
});
check("empty desk area reaches canvas", hit.empty.startsWith("canvas"), hit.empty);
check("headline label passes pointer to canvas", hit.label.startsWith("canvas"), hit.label);
check("headline count passes pointer to canvas", hit.count.startsWith("canvas"), hit.count);
check("lede passes pointer to canvas", hit.lede.startsWith("canvas"), hit.lede);
check("ruler passes pointer to canvas", hit.ruler.startsWith("canvas"), hit.ruler);
check("primary button is hit", hit.button.startsWith("button"), hit.button);
check("picker legend passes pointer to canvas", hit.legend.startsWith("canvas"), hit.legend);
check("model option is hit", !hit.option.startsWith("canvas"), hit.option);

const runningHeading = await headingName(page);
check(
  "running headline uses the straightened label",
  runningHeading.label === "向きを直した写真" && runningHeading.spoken === "1,284枚" && runningHeading.hidden,
  JSON.stringify(runningHeading),
);
const headingRole = await page.getByRole("heading", { level: 1, name: /向きを直した写真\s*1,284枚/ }).count();
check("h1 accessible name is label plus number", headingRole === 1, String(headingRole));
const headlineText = await page.evaluate(() => document.querySelector(".stage")?.textContent ?? "");
check("no まっすぐ in the stage", !headlineText.includes("まっすぐ"));
const lede = await page.evaluate(() => document.querySelector(".lede")?.textContent?.replace(/ /g, " ") ?? "");
check(
  "lede reads naturally",
  lede === "Wikimedia Commons の写真を、わざと横向きや逆さまにして机に並べています。くるりAI がこのブラウザの中で1枚ずつ向きを見分けて、正しい向きに直します。",
  lede,
);
const runningState = await page.locator(".stat-state").textContent();
check("ruler names the nano model", runningState === "v2-nano で判定中", runningState ?? "");

await page.evaluate(() => {
  window.__wheel = false;
  document.querySelector("canvas").addEventListener("wheel", () => { window.__wheel = true; });
});
const ledeBox = await page.locator(".lede").boundingBox();
await page.mouse.move(ledeBox.x + 40, ledeBox.y + ledeBox.height / 2);
await page.mouse.wheel(0, 100);
await page.waitForTimeout(100);
check("wheel over lede reaches canvas", await page.evaluate(() => window.__wheel === true));

const live = await page.evaluate(() => document.querySelector(".overlay > [aria-live]")?.textContent ?? "");
check("live region announces progress", live === "向きを直した写真 1,284枚。正解率 92.4%。", live);

await page.getByRole("button", { name: "一時停止" }).click();
check("pause label follows status", await page.getByRole("button", { name: "再開" }).isVisible());
await page.getByRole("button", { name: "再開" }).click();
check("resume label follows status", await page.getByRole("button", { name: "一時停止" }).isVisible());

check("picker is shown with two models", await page.locator(".model-picker").isVisible());
const nanoRadio = page.getByRole("radio", { name: /軽量 v2-nano 11.9MB/ });
const fullRadio = page.getByRole("radio", { name: /高精度 v2.0.0 551MB/ });
check("nano is the current model", await nanoRadio.isChecked());
const fullDescription = await fullRadio.evaluate((input) =>
  input.getAttribute("aria-describedby").split(" ").map((id) => document.getElementById(id)?.textContent).join(" "),
);
check("full option describes its test accuracy", fullDescription === "未使用テスト 99.4%", fullDescription);

await fullRadio.click();
const slip = page.locator("dialog.confirm-slip");
check("choosing full opens the confirmation", await slip.isVisible());
check("nano stays checked while confirming", await nanoRadio.isChecked());
const slipText = await slip.evaluate((dialog) => ({
  title: dialog.querySelector("h2")?.textContent,
  body: dialog.querySelector(".confirm-body")?.textContent,
  name: dialog.getAttribute("aria-labelledby"),
  focus: document.activeElement?.textContent,
  modal: dialog.matches(":modal"),
}));
check("confirmation title", slipText.title === "高精度モデルに切り替えますか", slipText.title ?? "");
check(
  "confirmation body",
  slipText.body === "約551MBのモデルを読み込みます。読み込みが終わるまで写真はばらばらの向きのまま並べておき、終わったらまとめて直します。2回目からはブラウザに保存したモデルを使います。",
  slipText.body ?? "",
);
check("confirmation is a modal dialog", slipText.modal === true && slipText.name === "confirm-title");
check("focus moves into the confirmation", slipText.focus === "やめる", String(slipText.focus));
const slipBox = await slip.boundingBox();
check(
  "confirmation stays inside the viewport above the ruler",
  slipBox !== null && slipBox.y >= 0 && slipBox.y + slipBox.height <= 900 - 70 && slipBox.x >= 0 && slipBox.x + slipBox.width <= 1440,
  JSON.stringify(slipBox),
);
if (shots) {
  await page.screenshot({ path: `${shots}/check-confirm-desktop.png` });
}
await page.keyboard.press("Escape");
await page.waitForTimeout(50);
check("escape cancels the confirmation", await slip.isHidden());
check("escape leaves nano checked", await nanoRadio.isChecked());
check("cancel does not select a model", (await modelCalls(page)) === "", await modelCalls(page));
const focusAfterCancel = await page.evaluate(() => document.activeElement?.getAttribute("value"));
check("focus returns to the checked radio", focusAfterCancel === "nano", String(focusAfterCancel));

await fullRadio.click();
await page.getByRole("button", { name: "やめる" }).click();
await page.waitForTimeout(50);
check("やめる cancels", (await slip.isHidden()) && (await modelCalls(page)) === "");

await fullRadio.click();
await page.mouse.click(1300, 120);
await page.waitForTimeout(50);
check("clicking the backdrop cancels", (await slip.isHidden()) && (await modelCalls(page)) === "");

await nanoRadio.focus();
await page.keyboard.press("ArrowRight");
await page.waitForTimeout(50);
check("arrow key to full also asks first", (await slip.isVisible()) && (await nanoRadio.isChecked()));
await page.getByRole("button", { name: "読み込む" }).click();
await page.waitForTimeout(50);
check("読み込む selects the full model", (await modelCalls(page)) === "full", await modelCalls(page));
check("full is shown as chosen after confirming", await fullRadio.isChecked());
check("confirmation closes after confirming", await slip.isHidden());

await open(page, "running");
await page.getByRole("button", { name: "一覧" }).click();
await page.getByRole("radio", { name: /高精度/ }).click();
await page.keyboard.press("Escape");
await page.waitForTimeout(50);
check("escape in the confirmation keeps the ledger open", await page.locator(".ledger").isVisible());
await page.keyboard.press("Escape");
check("next escape closes the ledger", await page.locator(".ledger").isHidden());

await page.getByRole("button", { name: "一覧" }).click();
const rows = await page.locator(".ledger tbody tr").count();
check("ledger renders rows", rows === 72, String(rows));
const firstRow = await page.locator(".ledger tbody tr").first().getAttribute("data-id");
check("ledger is newest first", firstRow === "commons-71" || firstRow === "sample-71", String(firstRow));
const focusInLedger = await page.evaluate(() => document.activeElement?.id);
check("ledger takes focus", focusInLedger === "ledger-title", String(focusInLedger));
await page.keyboard.press("Escape");
check("escape closes ledger", await page.locator(".ledger").isHidden());
const focusBack = await page.evaluate(() => document.activeElement?.textContent);
check("focus returns to list button", focusBack === "一覧", String(focusBack));

await page.getByRole("button", { name: "一覧" }).click();
await page.locator(".ledger-photo").nth(1).click();
const pinned = await page.locator(".loupe").getAttribute("data-state");
check("selecting a ledger row pins the slip", pinned === "pinned", String(pinned));
await page.keyboard.press("Escape");
check("escape closes pin first", (await page.locator(".loupe").getAttribute("data-state")) === "hidden");
check("ledger still open after first escape", await page.locator(".ledger").isVisible());
await page.keyboard.press("Escape");

await page.evaluate(() => {
  const overlay = window.harnessOverlay;
  const template = window.harnessRecords[0];
  for (let index = 0; index < 400; index += 1) {
    overlay.upsertRecord({ ...template, id: `bulk-${index}`, decidedAt: 10_000 + index });
  }
});
await page.getByRole("button", { name: "一覧" }).click();
await page.waitForTimeout(400);
const capped = await page.locator(".ledger tbody tr").count();
check("ledger caps at 200 rows", capped === 200, String(capped));
const top = await page.locator(".ledger tbody tr").first().getAttribute("data-id");
check("newest bulk row first", top === "bulk-399", String(top));
await page.evaluate(() => {
  const overlay = window.harnessOverlay;
  const template = window.harnessRecords[0];
  overlay.upsertRecord({ ...template, id: "late-1", decidedAt: 99_999 });
});
await page.waitForTimeout(500);
const lateTop = await page.locator(".ledger tbody tr").first().getAttribute("data-id");
const stillCapped = await page.locator(".ledger tbody tr").count();
check("ledger prepends while open", lateTop === "late-1" && stillCapped === 200, `${lateTop} ${stillCapped}`);
await page.locator(".ledger-close").click();
check("close button hides ledger", await page.locator(".ledger").isHidden());

await page.evaluate(() => {
  const transfer = new DataTransfer();
  transfer.items.add(new File([new Uint8Array([1])], "drop.jpg", { type: "image/jpeg" }));
  window.dispatchEvent(new DragEvent("dragenter", { dataTransfer: transfer }));
});
check("drop hint shows while dragging files", await page.locator(".drop-hint").isVisible());
const dropTitle = await page.locator(".drop-title").textContent();
check("drop hint wording", dropTitle === "ここで離すと、ほかの写真より先に判定します", dropTitle ?? "");
await page.evaluate(() => {
  const transfer = new DataTransfer();
  transfer.items.add(new File([new Uint8Array([1])], "drop.jpg", { type: "image/jpeg" }));
  window.dispatchEvent(new DragEvent("drop", { dataTransfer: transfer, cancelable: true }));
});
check("drop hint hides after drop", await page.locator(".drop-hint").isHidden());
check("drop forwards image files", logs.some((line) => line.includes("addFiles") && line.includes("drop.jpg")));
await page.evaluate(() => {
  const transfer = new DataTransfer();
  transfer.setData("text/plain", "hello");
  window.dispatchEvent(new DragEvent("dragenter", { dataTransfer: transfer }));
});
check("text drags do not show the hint", await page.locator(".drop-hint").isHidden());
await page.evaluate(() => {
  const transfer = new DataTransfer();
  transfer.items.add(new File([new Uint8Array([1])], "notes.txt", { type: "text/plain" }));
  window.dispatchEvent(new DragEvent("dragenter", { dataTransfer: transfer }));
  window.dispatchEvent(new DragEvent("drop", { dataTransfer: transfer, cancelable: true }));
});
const rejected = await page.locator(".folder-status-text").textContent();
check(
  "non-photo drop explains next to the photo buttons",
  rejected === "写真が見つかりませんでした。JPEG、PNG、WebP、DNG などの写真を選んでください。" &&
    (await page.locator(".folder-status").getAttribute("data-state")) === "empty",
  rejected ?? "",
);
check("non-photo drop is not handed over", !logs.some((line) => line.includes("addFiles") && line.includes("notes.txt")));

const chooser = page.waitForEvent("filechooser");
await page.getByRole("button", { name: "自分の写真を並べる" }).click();
const fileChooser = await chooser;
check("primary button opens a multi file picker", fileChooser.isMultiple());
const photoInput = await fileChooser.element().evaluate((input) => ({ folder: input.webkitdirectory, accept: input.accept }));
check(
  "primary picker accepts photos and RAW files, not folders",
  photoInput.folder === false && photoInput.accept.includes("image/*") && photoInput.accept.includes(".dng") && photoInput.accept.includes(".nef"),
  JSON.stringify(photoInput),
);
const inputCount = await page.locator('input[type="file"]').count();
check("one file input serves both pickers", inputCount === 1, String(inputCount));

const folderChooserEvent = page.waitForEvent("filechooser");
await page.getByRole("button", { name: "フォルダを選ぶ" }).click();
const folderChooser = await folderChooserEvent;
check("folder button opens a directory picker", await folderChooser.element().evaluate((input) => input.webkitdirectory === true));
await folderChooser.element().evaluate((input) => input.dispatchEvent(new Event("cancel")));
check("a dismissed folder picker returns to photo mode", await page.locator('input[type="file"]').evaluate((input) => input.webkitdirectory === false && input.accept.includes(".dng")));
const reopenedEvent = page.waitForEvent("filechooser");
await page.getByRole("button", { name: "フォルダを選ぶ" }).click();
const reopened = await reopenedEvent;
if (fixture) {
  await reopened.setFiles(fixture);
  await page.waitForTimeout(200);
  const calls = await page.evaluate(() => window.harnessFolderCalls);
  const lastCall = calls.at(-1);
  check(
    "picked folder is handed over once without system folders",
    calls.length === 2 && lastCall?.found === 6 && lastCall?.accepted === 4 && lastCall?.skipped === 2,
    JSON.stringify(calls),
  );
  const pickedPaths = logs.filter((line) => line.startsWith("addFiles")).at(-1) ?? "";
  check("picked folder keeps relative paths", pickedPaths.includes("Trip/sub/c.png"), pickedPaths);
  const folderText = await page.locator(".folder-status-text").textContent();
  check(
    "folder progress text from main is shown",
    folderText === `${lastCall?.accepted}枚を並べます（動画など ${lastCall?.skipped}件は対象外）`,
    folderText ?? "",
  );
  const reset = await page.locator('input[type="file"]').evaluate((input) => ({ folder: input.webkitdirectory, accept: input.accept }));
  check("input returns to photo mode after a folder pick", reset.folder === false && reset.accept.includes(".dng"), JSON.stringify(reset));
}

const simulateDefault = await page.evaluate(() => window.harnessOverlay.simulateUser());
check("visitor photos are judged as they are by default", simulateDefault === false);
check("rotate checkbox is unchecked", !(await page.getByLabel("自分の写真もわざと回転させる").isChecked()));
await page.getByLabel("自分の写真もわざと回転させる").click();
check("checkbox state reaches simulateUser", await page.evaluate(() => window.harnessOverlay.simulateUser() === true));

await page.evaluate(() => {
  const record = window.harnessRecords.find((item) => item.source.kind === "commons");
  window.harnessOverlay.showLoupe(record, { x: 1420, y: 20 });
});
const box = await page.locator(".loupe").boundingBox();
check(
  "loupe flips and clamps near the top-right corner",
  box !== null && box.x + box.width <= 1440 - 11 && box.y >= 11 && box.x < 1420,
  JSON.stringify(box),
);
const side = await page.locator(".loupe").getAttribute("data-side");
check("loupe flips to the left", side === "left", String(side));

await open(page, "running");
await page.focus("body");
await page.keyboard.press("Tab");
await page.keyboard.press("Tab");
const focused = await page.evaluate(() => {
  const element = document.activeElement;
  const style = element ? getComputedStyle(element) : null;
  return { text: element?.textContent, outline: style?.outlineStyle, width: style?.outlineWidth };
});
check("keyboard focus is visible", focused.outline === "solid" && focused.width === "2px", JSON.stringify(focused));
await page.getByRole("radio", { name: /軽量/ }).focus();
const radioRing = await page.evaluate(() => {
  const style = getComputedStyle(document.activeElement);
  return `${style.outlineStyle} ${style.outlineWidth}`;
});
check("radio focus ring is visible", radioRing === "solid 2px", radioRing);

const reduced = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
const calm = await reduced.newPage();
await open(calm, "running");
const immediate = await calm.evaluate(() => document.querySelector(".count-digits")?.textContent);
check("reduced motion shows the final count at once", immediate === "1,284", String(immediate));
await reduced.close();

await open(page, "crooked");
await page.waitForTimeout(1500);
const crooked = await headingName(page);
check("crooked headline label", crooked.label === "向きがばらばらの写真", crooked.label);
check("crooked headline counts crooked photos", crooked.spoken === "36枚", crooked.spoken);
check("crooked count counts up to the crooked total", crooked.digits === "36", crooked.digits);
const crookedState = await page.locator(".stat-state").textContent();
check("nano download progress on the ruler", crookedState === "軽量モデル 4.2 / 11.9 MB", crookedState ?? "");
const nanoNote = await page.locator(".model-option[data-model='nano'] .model-note").textContent();
check("picker shows the loading note on the current model", nanoNote === "読み込み中 35%", nanoNote ?? "");
check(
  "scatter is disabled before anything is straightened",
  await page.getByRole("button", { name: "全部くずす" }).isDisabled(),
);
await page.evaluate(() => {
  window.harnessOverlay.setStatus("running");
  window.harnessOverlay.setStats(window.harnessStats(0, 3005, 40));
});
await page.waitForTimeout(1500);
const grown = await page.evaluate(() => document.querySelector(".count-digits")?.textContent);
check("crooked count eases up within the same label", grown === "40", String(grown));
await page.evaluate(() => {
  window.harnessOverlay.setStats(window.harnessStats(1, 3005, 39));
});
const switched = await headingName(page);
check(
  "first straightened photo resets the counter instantly",
  switched.label === "向きを直した写真" && switched.digits === "1" && switched.spoken === "1枚",
  JSON.stringify(switched),
);
const fresh = await page.evaluate(() => document.querySelector(".headline")?.classList.contains("is-fresh"));
check("label change replays the headline entrance", fresh === true);
await page.evaluate(() => {
  window.harnessOverlay.setStats(window.harnessStats(3005, 3005, 0));
  window.harnessOverlay.setStatus("finished");
});
const finishedHeading = await headingName(page);
check(
  "finished label jumps to the final count",
  finishedHeading.label === "並べ終えた写真" && finishedHeading.digits === "3,005",
  JSON.stringify(finishedHeading),
);

await open(page, "full-loading");
const fullState = await page.locator(".stat-state").textContent();
check("full download progress on the ruler", fullState === "高精度モデル 231 / 551 MB", fullState ?? "");
const fullNote = await page.locator(".model-option[data-model='full'] .model-note").textContent();
check("full option shows its loading note", fullNote === "読み込み中 41%", fullNote ?? "");
check("full is checked while it loads", await page.getByRole("radio", { name: /高精度/ }).isChecked());
const fullLoadingHeading = await headingName(page);
check("crooked label while the full model loads", fullLoadingHeading.label === "向きがばらばらの写真" && fullLoadingHeading.spoken === "48枚", JSON.stringify(fullLoadingHeading));
await page.evaluate(() => {
  window.harnessOverlay.setModelProgress({ loaded: 551_055_739, total: 551_055_739, ready: false });
});
const preparing = await page.locator(".stat-state").textContent();
check("ruler says preparing after the download", preparing === "高精度モデルを準備中", preparing ?? "");

await open(page, "full-running");
const fullRunning = await page.locator(".stat-state").textContent();
check("ruler names the full model", fullRunning === "v2.0.0 で判定中", fullRunning ?? "");
await page.getByRole("radio", { name: /軽量/ }).click();
await page.waitForTimeout(50);
check("choosing nano on full switches at once", (await modelCalls(page)) === "nano" && (await page.locator("dialog.confirm-slip").isHidden()), await modelCalls(page));

await open(page, "full-unavailable");
const unavailable = page.getByRole("radio", { name: /高精度/ });
check("unavailable full option is disabled", await unavailable.isDisabled());
const reason = await page.locator(".model-reason").textContent();
check("unavailable reason is visible", (await page.locator(".model-reason").isVisible()) && reason === "このブラウザは WebGPU に対応していないため使えません。", reason ?? "");
const describedReason = await unavailable.evaluate((input) =>
  input.getAttribute("aria-describedby").split(" ").map((id) => document.getElementById(id)?.textContent).join(" "),
);
check("unavailable reason is linked to the radio", describedReason.includes("WebGPU"), describedReason);
await page.locator(".model-option[data-model='full']").click({ force: true });
check("clicking a disabled option does nothing", (await modelCalls(page)) === "" && (await page.locator("dialog.confirm-slip").isHidden()));

await open(page, "nano-only");
check("picker hides with a single model", await page.locator(".model-picker").isHidden());

await open(page, "nowebgl");
check("webgl fallback hides canvas", await page.locator("canvas").isHidden());
await page.getByRole("button", { name: "一覧を開く" }).click();
check("webgl fallback opens list", await page.locator(".ledger").isVisible());

await open(page, "finished");
check("finished disables pause", await page.getByRole("button", { name: "一時停止" }).isDisabled());

async function measuredInsets(target) {
  return target.evaluate(() => {
    const rect = (element) => element.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(document.querySelector(".lede"));
    const lede = range.getBoundingClientRect();
    const actions = Array.from(document.querySelector(".actions").children)
      .filter((child) => child.tagName !== "INPUT" && rect(child).width > 0 && rect(child).height > 0)
      .map(rect);
    return {
      reported: window.harnessOverlay.viewInsets(),
      masthead: rect(document.querySelector(".masthead")).bottom,
      ruler: window.innerHeight - rect(document.querySelector(".ruler")).top,
      right: Math.max(lede.right, ...actions.map((box) => box.right), rect(document.querySelector(".headline-label")).right, rect(document.querySelector(".headline-count")).right),
      ledeBottom: lede.bottom,
      actionsTop: Math.min(...actions.map((box) => box.top)),
      height: window.innerHeight,
    };
  });
}

await open(page, "running");
const wide = await measuredInsets(page);
check(
  "desktop insets cover masthead, headline column and ruler",
  wide.reported.top === Math.ceil(wide.masthead) &&
    wide.reported.left === Math.ceil(wide.right) &&
    wide.reported.bottom === Math.ceil(wide.ruler) &&
    wide.reported.right === 0,
  JSON.stringify(wide),
);
const insetEvents = await page.evaluate(async () => {
  const seen = [];
  const stop = window.harnessOverlay.onViewInsetsChange((insets) => seen.push(insets));
  window.harnessOverlay.setIntroActive(true);
  await new Promise((resolve) => setTimeout(resolve, 60));
  const during = window.harnessOverlay.viewInsets();
  window.harnessOverlay.setIntroActive(false);
  await new Promise((resolve) => setTimeout(resolve, 60));
  stop();
  return { seen, during };
});
check(
  "insets are zero while the intro plays and come back after it",
  JSON.stringify(insetEvents.during) === JSON.stringify({ top: 0, right: 0, bottom: 0, left: 0 }) &&
    insetEvents.seen.length === 2 &&
    insetEvents.seen[0].left === 0 &&
    insetEvents.seen[1].left === wide.reported.left,
  JSON.stringify(insetEvents),
);
await page.setViewportSize({ width: 1200, height: 800 });
await page.waitForTimeout(150);
const resized = await measuredInsets(page);
check(
  "insets follow a window resize",
  resized.reported.bottom === Math.ceil(resized.ruler) && resized.reported.left === Math.ceil(resized.right),
  JSON.stringify(resized),
);
await page.setViewportSize({ width: 1440, height: 900 });

await open(page, "intro");
await page.waitForTimeout(1700);
const introChrome = await page.evaluate(() => {
  const visible = (selector) => {
    const element = document.querySelector(selector);
    if (!element) return false;
    const style = getComputedStyle(element);
    return style.visibility !== "hidden" && style.display !== "none" && Number(style.opacity) > 0.01;
  };
  const skip = document.querySelector(".skip-intro").getBoundingClientRect();
  const hit = document.elementFromPoint(skip.left + skip.width / 2, skip.top + skip.height / 2);
  const nav = document.querySelector(".masthead-nav a").getBoundingClientRect();
  const navHit = document.elementFromPoint(nav.left + 4, nav.top + nav.height / 2);
  return {
    stage: visible(".stage"),
    ruler: visible(".ruler"),
    masthead: visible(".masthead"),
    skip: visible(".skip-intro"),
    skipHit: hit?.className ?? "",
    navHit: navHit?.tagName ?? "",
    insets: window.harnessOverlay.viewInsets(),
    inert: document.querySelector(".stage").inert,
  };
});
check("intro hides headline, actions and ruler", !introChrome.stage && !introChrome.ruler && introChrome.inert, JSON.stringify(introChrome));
check("intro keeps the masthead above the intro canvas", introChrome.masthead && introChrome.navHit === "A", introChrome.navHit);
check("skip button sits above the intro canvas", introChrome.skip && introChrome.skipHit.includes("skip-intro"), introChrome.skipHit);
await page.evaluate(() => {
  const record = window.harnessRecords[0];
  window.harnessOverlay.showLoupe(record, { x: 700, y: 400 });
});
check("loupe stays hidden during the intro", (await page.locator(".loupe").getAttribute("data-state")) === "hidden");
await page.keyboard.press("Tab");
const firstTab = await page.evaluate(() => document.activeElement?.textContent);
check("keyboard reaches the masthead first during the intro", firstTab === "くるりAI", String(firstTab));
await page.keyboard.press("Escape");
await page.waitForTimeout(40);
check("escape asks to skip the intro", (await page.evaluate(() => window.harnessSkipCalls.length)) === 1);
await page.waitForTimeout(400);
const revealStart = await page.evaluate(() => Number(getComputedStyle(document.querySelector(".intro")).opacity));
const stageLayer = await page.evaluate(() => getComputedStyle(document.querySelector(".stage")).opacity);
check("stage scrim stays under the masthead while the ui fades in", stageLayer === "1", stageLayer);
await page.waitForTimeout(1000);
const revealed = await page.evaluate(() => ({
  stage: Math.min(
    Number(getComputedStyle(document.querySelector(".intro")).opacity),
    Number(getComputedStyle(document.querySelector(".actions")).opacity),
  ),
  ruler: Number(getComputedStyle(document.querySelector(".ruler")).opacity),
  skip: document.querySelector(".skip-intro").hidden,
  insets: window.harnessOverlay.viewInsets(),
}));
check("ui fades back in after the intro", revealStart < 1 && revealed.stage === 1 && revealed.ruler === 1, `${revealStart} ${JSON.stringify(revealed)}`);
check("skip button leaves with the intro", revealed.skip === true);
check("insets return after the intro", revealed.insets.left > 300 && revealed.insets.top > 40, JSON.stringify(revealed.insets));

await open(page, "intro");
await page.getByRole("button", { name: "スキップ" }).click();
check("skip button calls skipIntro once", (await page.evaluate(() => window.harnessSkipCalls.length)) === 1);
check("skip button is disabled after use", await page.getByRole("button", { name: "スキップ" }).isDisabled());

await open(page, "running", "&hold=1");
await page.evaluate(() => {
  window.harnessDropFakeFolder(window.harnessFakeFolder("Photos", { photos: 400, raw: 0, videos: 100, other: 0 }, 25));
});
await page.waitForFunction(() => /[0-9]+枚/.test(document.querySelector(".folder-status-text")?.textContent ?? ""), null, { timeout: 8000 });
const scanning = await page.evaluate(() => ({
  text: document.querySelector(".folder-status-text").textContent,
  state: document.querySelector(".folder-status").dataset.state,
  cancel: !document.querySelector(".folder-cancel").hidden,
}));
check("folder drop shows reading progress in photos", /^フォルダを読み込み中 [0-9,]+枚$/.test(scanning.text) && scanning.state === "scanning" && scanning.cancel, JSON.stringify(scanning));
await page.getByRole("button", { name: "やめる" }).click();
await page.waitForTimeout(600);
check("cancel hides the folder status", await page.locator(".folder-status").isHidden());
check("cancelled folder is not handed over", (await page.evaluate(() => window.harnessFolderCalls.length)) === 0);

await page.evaluate(() => {
  window.harnessDropFakeFolder(window.harnessFakeFolder("Photos", { photos: 160, raw: 580, videos: 417, other: 2 }, 0));
});
await page.waitForFunction(() => window.harnessFolderCalls.length === 1, null, { timeout: 8000 });
const handed = await page.evaluate(() => window.harnessFolderCalls[0]);
check("dropped folder is handed over once with every file", handed.found === 1159 && handed.accepted === 740 && handed.skipped === 419, JSON.stringify(handed));
const readyText = await page.locator(".folder-status-text").textContent();
check("folder summary uses plain copy", readyText === "740枚を並べます（動画など 419件は対象外）", readyText ?? "");
await page.evaluate(() => window.harnessOverlay.setFolderProgress({ found: 1159, accepted: 740, skipped: 419, done: true }));
await page.waitForTimeout(150);
check("done keeps the summary readable for a moment", await page.locator(".folder-status").isVisible());
await page.waitForTimeout(3000);
check("done clears the folder status", await page.locator(".folder-status").isHidden());

await page.evaluate(() => {
  window.harnessDropFakeFolder(window.harnessFakeFolder("Clips", { photos: 0, raw: 0, videos: 3, other: 0 }, 0));
});
await page.waitForTimeout(300);
const emptyText = await page.locator(".folder-status-text").textContent();
check("folder without photos is explained", emptyText === "並べられる写真がありませんでした（動画など 3件は対象外）", emptyText ?? "");

if (fixture) {
  await open(page, "running", "&hold=1");
  const cdp = await page.context().newCDPSession(page);
  const data = { items: [], files: [fixture], dragOperationsMask: 1 };
  await cdp.send("Input.dispatchDragEvent", { type: "dragEnter", x: 900, y: 400, data });
  await cdp.send("Input.dispatchDragEvent", { type: "dragOver", x: 900, y: 400, data });
  await cdp.send("Input.dispatchDragEvent", { type: "drop", x: 900, y: 400, data });
  await page.waitForFunction(() => window.harnessFolderCalls.length === 1, null, { timeout: 8000 });
  const dropped = logs.filter((line) => line.startsWith("addFiles")).at(-1) ?? "";
  check(
    "a real folder drop walks subfolders and skips system folders",
    dropped.includes("Trip/sub/deeper/d.jpeg") && dropped.includes("Trip/a.jpg") && !dropped.includes("@eaDir") && !dropped.includes(".hidden/"),
    dropped,
  );
}

await open(page, "place");
const slipPlace = await page.evaluate(() => {
  const facts = Array.from(document.querySelectorAll(".loupe .slip-fact")).filter((fact) => !fact.hidden);
  return facts.map((fact) => fact.textContent).join("|");
});
check("pinned slip names the capture place", slipPlace.includes("撮影地日本"), slipPlace);
await page.evaluate(() => {
  const record = window.harnessRecords.find((item) => item.source.kind === "commons" && item.source.location === null);
  window.harnessOverlay.pin(null);
  window.harnessOverlay.showLoupe(record, { x: 700, y: 400 });
});
const noPlace = await page.evaluate(() => Array.from(document.querySelectorAll(".loupe .slip-fact")).filter((fact) => !fact.hidden).map((fact) => fact.textContent).join("|"));
check("slip hides the place when it is unknown", !noPlace.includes("撮影地"), noPlace);
await page.evaluate(() => {
  const template = window.harnessRecords[0];
  window.harnessOverlay.showLoupe(
    { ...template, id: "visitor-1", source: { ...template.source, id: "visitor-1", kind: "user", attribution: null, title: "IMG_0001.JPG", location: { lat: 35, lon: 139, country: "JP" } } },
    { x: 700, y: 400 },
  );
});
const visitorPlace = await page.evaluate(() => Array.from(document.querySelectorAll(".loupe .slip-fact")).filter((fact) => !fact.hidden).map((fact) => fact.textContent).join("|"));
check("visitor photos never show a place", !visitorPlace.includes("撮影地"), visitorPlace);
await page.getByRole("button", { name: "一覧" }).click();
const ledgerPlaces = await page.locator(".ledger-place").allTextContents();
check("ledger lists capture places", ledgerPlaces.length > 0 && ledgerPlaces.every((text) => text.startsWith("撮影地 ")), ledgerPlaces.slice(0, 3).join(","));

const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
const phone = await mobile.newPage();
phone.on("pageerror", (error) => logs.push(`pageerror ${error.message}`));
await open(phone, "running");
const pickerBox = await phone.locator(".model-picker").boundingBox();
const rulerBox = await phone.locator(".ruler").boundingBox();
check(
  "mobile picker sits above the ruler",
  pickerBox !== null && rulerBox !== null && pickerBox.y + pickerBox.height <= rulerBox.y + 1,
  `${JSON.stringify(pickerBox)} ${JSON.stringify(rulerBox)}`,
);
const optionTops = await phone.locator(".model-option").evaluateAll((items) => items.map((item) => Math.round(item.getBoundingClientRect().top)));
check("mobile options share one row", optionTops.length === 2 && optionTops[0] === optionTops[1], optionTops.join(","));
const narrow = await measuredInsets(phone);
check(
  "mobile insets cover the headline block and the bottom controls",
  narrow.reported.top === Math.ceil(narrow.ledeBottom) &&
    narrow.reported.bottom === Math.ceil(narrow.height - narrow.actionsTop) &&
    narrow.reported.left === 0 &&
    narrow.reported.right === 0,
  JSON.stringify(narrow),
);
check("mobile hides the folder button on touch screens", await phone.locator(".folder-button").isHidden());
const scrollWidth = await phone.evaluate(() => document.documentElement.scrollWidth);
check("mobile has no horizontal overflow", scrollWidth <= 390, String(scrollWidth));
await phone.getByRole("radio", { name: /高精度/ }).tap();
await phone.waitForTimeout(400);
const sheet = await phone.locator("dialog.confirm-slip").boundingBox();
check(
  "mobile confirmation is a bottom sheet",
  sheet !== null && Math.round(sheet.y + sheet.height) === 844 && Math.round(sheet.width) === 390,
  JSON.stringify(sheet),
);
if (shots) {
  await phone.screenshot({ path: `${shots}/check-confirm-mobile.png` });
}
await mobile.close();

const errors = logs.filter((line) => line.startsWith("pageerror"));
check("no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
console.log(results.join("\n"));
const failed = results.filter((line) => line.startsWith("FAIL")).length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exitCode = failed > 0 ? 1 : 0;
