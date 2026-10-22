import { chromium } from "@playwright/test";

const base = process.env.INTRO_URL ?? "http://127.0.0.1:5173/dev/intro.html";
const runs = [
  { name: "desktop", viewport: { width: 1440, height: 900 }, scale: 1, extra: "" },
  { name: "desktop-dpr2", viewport: { width: 1440, height: 900 }, scale: 2, extra: "" },
  { name: "mobile-lowPower", viewport: { width: 390, height: 844 }, scale: 3, extra: "&lowPower=1" },
];
const only = process.argv[2] ? process.argv[2].split(",") : runs.map((run) => run.name);
const browser = await chromium.launch({
  headless: true,
  args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan", "--use-angle=metal"],
});
for (const run of runs.filter((candidate) => only.includes(candidate.name))) {
  const page = await browser.newPage({ viewport: run.viewport, deviceScaleFactor: run.scale });
  page.on("pageerror", (error) => console.log(`[${run.name}] pageerror: ${error.message}`));
  await page.goto(`${base}?keep=1&bench=${process.env.BENCH ?? "1"}${run.extra}`);
  await page.waitForFunction(() => window.__intro !== undefined, undefined, { timeout: 60000 });
  await page.waitForFunction(() => window.__intro.done === true, undefined, { timeout: 60000, polling: 200 });
  const stats = await page.evaluate(() => ({ ...window.__intro.stats(), phases: window.__intro.phases }));
  console.log(run.name, JSON.stringify(stats));
  await page.close();
}
await browser.close();
