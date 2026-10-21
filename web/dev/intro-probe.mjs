import { readFileSync } from "node:fs";
import { chromium } from "@playwright/test";

const out = process.argv[2];
const snippet = readFileSync(process.argv[3], "utf8");
const time = Number(process.argv[4] ?? 3000);
const width = Number(process.env.PROBE_W ?? 1440);
const height = Number(process.env.PROBE_H ?? 900);
const base = process.env.INTRO_URL ?? "http://127.0.0.1:5191/dev/intro.html";
const browser = await chromium.launch({
  headless: true,
  args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan", "--use-angle=metal"],
});
const page = await browser.newPage({ viewport: { width, height } });
page.on("console", (m) => console.log("console", m.type(), m.text().slice(0, 400)));
page.on("pageerror", (e) => console.log("pageerror", e.message));
await page.goto(`${base}?t=0&${process.env.INTRO_EXTRA ?? ""}`);
await page.waitForFunction(() => window.__intro !== undefined);
await page.evaluate(() => window.__intro.ready);
await page.evaluate((ms) => window.__intro.seek(ms), time);
const result = await page.evaluate(`(async () => { const c = window.__intro.controller; ${snippet} })()`);
console.log(JSON.stringify(result));
await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
await page.screenshot({ path: out });
await browser.close();
