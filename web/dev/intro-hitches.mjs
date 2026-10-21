import { chromium } from "@playwright/test";

const base = process.env.INTRO_URL ?? "http://127.0.0.1:5173/dev/intro.html";
const browser = await chromium.launch({
  headless: true,
  args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan", "--use-angle=metal"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.addInitScript(() => {
  const samples = [];
  let last = 0;
  const loop = (now) => {
    if (last > 0 && window.__intro) {
      samples.push([now - last, window.__intro.time]);
    }
    last = now;
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  window.__samples = samples;
});
await page.goto(`${base}?keep=1&bench=1`);
await page.waitForFunction(() => window.__intro !== undefined, undefined, { timeout: 60000 });
await page.waitForFunction(() => window.__intro.done === true, undefined, { timeout: 60000, polling: 200 });
const worst = await page.evaluate(() =>
  window.__samples
    .filter(([, t]) => t >= 0 && t < 10000)
    .sort((a, b) => b[0] - a[0])
    .slice(0, 12)
    .map(([d, t]) => `${d.toFixed(1)}ms@${t.toFixed(0)}`),
);
console.log(worst.join(" "));
await browser.close();
