import { mkdir } from "node:fs/promises";
import { chromium } from "@playwright/test";

const output = process.argv[2];
const round = process.argv[3] ?? "r1";
const only = process.argv[4] ? process.argv[4].split(",") : null;
const origin = process.env.OVERLAY_ORIGIN ?? "http://127.0.0.1:5173";
const states = [
  "crooked",
  "running",
  "loupe",
  "pinned",
  "list",
  "about",
  "drop",
  "offline",
  "nowebgl",
  "finished",
  "full-loading",
  "full-running",
  "confirm",
  "full-unavailable",
  "nano-only",
  "intro",
  "folder-scan",
  "folder-ready",
  "folder-empty",
  "place",
];
const extra = process.env.OVERLAY_QUERY ?? "";
const settle = { "folder-scan": 3600, "folder-ready": 900, "folder-empty": 900, intro: 2000 };
const viewports = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
];

await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  args: ["--enable-unsafe-swiftshader"],
});
const errors = [];
for (const viewport of viewports) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 1,
    locale: "ja-JP",
    hasTouch: viewport.name === "mobile",
    isMobile: viewport.name === "mobile",
  });
  const page = await context.newPage();
  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(`${viewport.name}: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) =>
    errors.push(`${viewport.name}: ${error.message}`),
  );
  for (const state of states) {
    if (only && !only.includes(state)) {
      continue;
    }
    await page.goto(`${origin}/dev/overlay.html?state=${state}${extra}`);
    await page.waitForFunction(
      () => document.documentElement.dataset.harnessReady === "true",
    );
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(settle[state] ?? 1800);
    const path = `${output}/${round}-${viewport.name}-${state}.png`;
    await page.screenshot({ path });
    console.log(path);
  }
  await context.close();
}
await browser.close();
if (errors.length > 0) {
  console.log("errors:");
  for (const error of errors) {
    console.log(error);
  }
}
