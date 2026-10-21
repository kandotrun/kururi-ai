import { mkdir } from "node:fs/promises";
import { chromium } from "@playwright/test";

const output = process.argv[2];
const round = process.argv[3] ?? "r1";
const query = process.argv[4] ?? "seed=7";
const marks = (process.argv[5] ?? "800,4500,8800,10200,11400,16000").split(",").map(Number);
const viewportName = process.argv[6] ?? "desktop";
const frame = process.env.LIVE_FRAME === "1";
const origin = process.env.OVERLAY_ORIGIN ?? "http://127.0.0.1:5173";
const custom = /^(\d+)x(\d+)$/.exec(viewportName);
const viewport = custom
  ? { width: Number(custom[1]), height: Number(custom[2]) }
  : viewportName === "mobile"
    ? { width: 390, height: 844 }
    : { width: 1440, height: 900 };

await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan", "--use-angle=metal"],
});
const context = await browser.newContext({
  viewport,
  deviceScaleFactor: 1,
  locale: "ja-JP",
  hasTouch: viewportName === "mobile",
  isMobile: viewportName === "mobile",
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("console", (message) => {
  if (message.type() === "error") {
    errors.push(message.text());
  }
});
const started = Date.now();
await page.goto(`${origin}/dev/overlay-live.html?${query}`);
for (const mark of marks) {
  const wait = mark - (Date.now() - started);
  if (wait > 0) {
    await page.waitForTimeout(wait);
  }
  if (frame) {
    await page.evaluate(() => {
      const insets = window.liveOverlay.viewInsets();
      let box = document.querySelector(".live-inset-frame");
      if (!box) {
        box = document.createElement("div");
        box.className = "live-inset-frame";
        document.body.append(box);
      }
      Object.assign(box.style, {
        position: "fixed",
        top: `${insets.top}px`,
        right: `${insets.right}px`,
        bottom: `${insets.bottom}px`,
        left: `${insets.left}px`,
        zIndex: "60",
        outline: "2px dashed #ff3bd4",
        outlineOffset: "-2px",
        pointerEvents: "none",
      });
    });
  }
  const path = `${output}/${round}-${viewportName}-live-${String(mark).padStart(5, "0")}.png`;
  await page.screenshot({ path });
  console.log(path);
}
const info = await page.evaluate(() => ({
  insets: window.liveOverlay.viewInsets(),
  intro: document.querySelector(".overlay")?.hasAttribute("data-intro"),
  introCanvas: document.querySelectorAll(".intro-canvas").length,
}));
console.log(JSON.stringify(info));
if (errors.length > 0) {
  console.log("errors:");
  for (const error of errors.slice(0, 20)) {
    console.log(error);
  }
}
await browser.close();
