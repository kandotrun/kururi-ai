import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const base = process.env.INTRO_URL ?? "http://127.0.0.1:5173/dev/intro.html";
const extra = process.env.INTRO_EXTRA ?? "";
const outDir = process.argv[2];
const only = process.argv[3] ? process.argv[3].split(",") : ["desktop", "mobile"];
const times = process.argv[4]
  ? process.argv[4].split(",").map(Number)
  : [300, 1200, 2200, 3000, 3800, 4600, 5400, 6200, 7000, 7800, 8600, 9300];

if (!outDir) {
  throw new Error("usage: node dev/intro-shoot.mjs <out-dir> [desktop,mobile] [ms,ms]");
}
mkdirSync(outDir, { recursive: true });

const viewports = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
};

const gpuArgs = ["--enable-unsafe-webgpu", "--enable-features=Vulkan", "--use-angle=metal"];
const browser = await chromium.launch({
  headless: true,
  args: process.env.INTRO_SWIFTSHADER === "1" ? ["--enable-unsafe-swiftshader"] : gpuArgs,
});

for (const name of only) {
  const viewport = viewports[name];
  const page = await browser.newPage({
    viewport,
    deviceScaleFactor: Number(process.env.INTRO_DPR ?? 1),
  });
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") {
      console.log(`[${name}] ${message.type()}: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => console.log(`[${name}] pageerror: ${error.message}`));
  await page.goto(`${base}?t=0&${extra}`);
  await page.waitForFunction(() => window.__intro !== undefined, undefined, { timeout: 60000 });
  const ok = await page.evaluate(() => window.__intro.ready);
  console.log(`[${name}] ready=${ok} origins=${await page.evaluate(() => `${window.__intro.origins} ${window.__intro.source}`)}`);
  for (const ms of times) {
    await page.evaluate((value) => window.__intro.seek(value), ms);
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    const file = join(outDir, `${name}-${String(ms).padStart(5, "0")}.png`);
    await page.screenshot({ path: file });
    console.log(file);
  }
  await page.close();
}
await browser.close();
