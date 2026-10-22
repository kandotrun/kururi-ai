import { chromium } from "@playwright/test";

const base = process.env.INTRO_URL ?? "http://127.0.0.1:5173/dev/intro.html";
const browser = await chromium.launch({
  headless: true,
  args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan", "--use-angle=metal"],
});
for (const at of [0, 2500, 8200]) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`${base}?keep=1`);
  await page.waitForFunction(() => window.__intro !== undefined, undefined, { timeout: 60000 });
  if (at > 0) {
    await page.waitForFunction((ms) => window.__intro.time >= ms, at, { timeout: 30000, polling: 16 });
  }
  const result = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const started = performance.now();
        const before = window.__intro.phase;
        window.__intro.skip();
        const check = () => {
          if (window.__intro.done) {
            const canvas = document.querySelector(".intro-canvas");
            resolve({ before, ms: Math.round(performance.now() - started), opacity: canvas ? getComputedStyle(canvas).opacity : "removed", phases: window.__intro.phases.join(" ") });
          } else {
            requestAnimationFrame(check);
          }
        };
        check();
      }),
  );
  console.log(`skip at ${at}ms`, JSON.stringify(result));
  await page.close();
}
await browser.close();
