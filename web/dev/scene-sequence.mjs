import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const [outDir, label, query, width, height, startPlaced, count, everyMs] =
  process.argv.slice(2);
if (!outDir || !label || !query) {
  throw new Error(
    "usage: node dev/scene-sequence.mjs <out> <label> <query> [w] [h] [placed] [count] [everyMs]",
  );
}
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan", "--use-angle=metal"],
});
try {
  const context = await browser.newContext({
    viewport: { width: Number(width ?? 390), height: Number(height ?? 844) },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:5173/dev/scene.html?${query}`);
  await page.waitForFunction(
    (placed) => window.__harness?.placed >= placed,
    Number(startPlaced ?? 100),
    { timeout: 300_000, polling: 200 },
  );
  for (let index = 0; index < Number(count ?? 4); index += 1) {
    const file = join(outDir, `${label}-${index}.png`);
    await page.screenshot({ path: file });
    const report = await page.evaluate(() => {
      const harness = window.__harness;
      const stats = harness.stats();
      const recent = harness.ids.slice(-16);
      return {
        placed: harness.placed,
        mode: stats.mode,
        free: harness.freeReport(recent).inFree,
        action: stats.action,
        camera: stats.camera,
      };
    });
    console.log(label, index, JSON.stringify(report));
    await page.waitForTimeout(Number(everyMs ?? 1500));
  }
} finally {
  await browser.close();
}
