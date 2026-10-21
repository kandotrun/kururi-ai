import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const base = process.env.INTRO_URL ?? "http://127.0.0.1:5173/dev/intro.html";
const outDir = process.argv[2];
const only = process.argv[3] ? process.argv[3].split(",") : ["desktop", "mobile"];
const at = Number(process.argv[4] ?? 9380);
if (!outDir) {
  throw new Error("usage: node dev/intro-match.mjs <out-dir> [desktop,mobile] [ms]");
}
mkdirSync(outDir, { recursive: true });

const viewports = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
  wide: { width: 1920, height: 820 },
  square: { width: 900, height: 900 },
};

const browser = await chromium.launch({
  headless: true,
  args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan", "--use-angle=metal"],
});
for (const name of only) {
  const page = await browser.newPage({ viewport: viewports[name], deviceScaleFactor: 1 });
  page.on("pageerror", (error) => console.log(`[${name}] pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") {
      console.log(`[${name}] ${message.type()}: ${message.text().slice(0, 300)}`);
    }
  });
  await page.goto(`${base}?t=0&desk=scene`);
  await page.waitForFunction(() => window.__intro !== undefined, undefined, { timeout: 60000 });
  await page.evaluate(() => window.__intro.ready);
  await page.waitForTimeout(Number(process.env.MATCH_SETTLE ?? 8000));
  await page.evaluate((ms) => window.__intro.seek(ms), at);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.screenshot({ path: join(outDir, `${name}-intro.png`) });
  await page.evaluate(() => {
    document.querySelector(".intro-canvas").style.visibility = "hidden";
  });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.screenshot({ path: join(outDir, `${name}-desk.png`) });
  console.log(`[${name}] desk=${await page.evaluate(() => window.__intro.desk !== null)}`);
  await page.close();
}
await browser.close();
