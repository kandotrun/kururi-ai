import { mkdir } from "node:fs/promises";
import { chromium } from "@playwright/test";

const output = process.argv[2];
const round = process.argv[3] ?? "r1";
const folder = process.argv[4];
const query = process.argv[5] ?? "seed=7&intro=off&limit=60";
const marks = (process.argv[6] ?? "300,1500,4000,9000").split(",").map(Number);
const origin = process.env.OVERLAY_ORIGIN ?? "http://127.0.0.1:5173";

await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan", "--use-angle=metal"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: "ja-JP" });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
await page.goto(`${origin}/dev/overlay-live.html?${query}`);
await page.waitForTimeout(6000);
const cdp = await page.context().newCDPSession(page);
const data = { items: [], files: [folder], dragOperationsMask: 1 };
await cdp.send("Input.dispatchDragEvent", { type: "dragEnter", x: 900, y: 400, data });
await cdp.send("Input.dispatchDragEvent", { type: "dragOver", x: 900, y: 400, data });
await page.screenshot({ path: `${output}/${round}-drop-hint.png` });
await cdp.send("Input.dispatchDragEvent", { type: "drop", x: 900, y: 400, data });
const started = Date.now();
for (const mark of marks) {
  const wait = mark - (Date.now() - started);
  if (wait > 0) {
    await page.waitForTimeout(wait);
  }
  const path = `${output}/${round}-drop-${String(mark).padStart(5, "0")}.png`;
  await page.screenshot({ path });
  const status = await page.locator(".folder-status").evaluate((element) => ({
    hidden: element.hidden,
    text: element.querySelector(".folder-status-text")?.textContent,
  }));
  console.log(path, JSON.stringify(status));
}
const records = await page.evaluate(() =>
  Array.from(window.liveStore.getState().records.values())
    .filter((record) => record.source.kind === "user")
    .map((record) => `${record.phase}:${record.source.file?.webkitRelativePath}`),
);
console.log(records.length, records.slice(0, 20).join("\n"));
console.log("errors", errors.join(" | "));
await browser.close();
