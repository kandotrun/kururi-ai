import { chromium } from "@playwright/test";
const [output, state, x, y, width, height, viewportWidth = "1440", viewportHeight = "900", scroll = "0"] = process.argv.slice(2);
const browser = await chromium.launch({ args: ["--enable-unsafe-swiftshader"] });
const page = await browser.newPage({
  viewport: { width: Number(viewportWidth), height: Number(viewportHeight) },
  deviceScaleFactor: 2,
});
await page.goto(`${process.env.OVERLAY_ORIGIN ?? "http://127.0.0.1:5173"}/dev/overlay.html?state=${state}`);
await page.waitForFunction(() => document.documentElement.dataset.harnessReady === "true");
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(2000);
if (Number(scroll) > 0) {
  await page.evaluate((top) => {
    document.querySelector(".about-inner")?.scrollTo({ top });
  }, Number(scroll));
  await page.waitForTimeout(200);
}
await page.screenshot({
  path: output,
  clip: { x: Number(x), y: Number(y), width: Number(width), height: Number(height) },
});
await browser.close();
