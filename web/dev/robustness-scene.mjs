import { chromium } from "@playwright/test";

const base = process.env.SCENE_URL ?? "http://127.0.0.1:5173/dev/scene.html";
const launchArgs =
  process.env.SCENE_GPU === "0"
    ? ["--enable-unsafe-swiftshader"]
    : ["--enable-unsafe-webgpu", "--enable-features=Vulkan", "--use-angle=metal"];
const browser = await chromium.launch({ headless: true, args: launchArgs });

async function run(label, action) {
  const page = await browser.newPage({
    viewport: { width: 1024, height: 640 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(message.text());
    }
  });
  await page.goto(`${base}?n=60&rate=12&seed=21`);
  await page.waitForFunction(() => window.__harness?.placed >= 8, undefined, {
    timeout: 180000,
  });
  const result = await page.evaluate(action);
  await page.waitForTimeout(6000);
  const after = await page.evaluate(() => ({
    added: window.__harness.added,
    landed: window.__harness.landed,
    placed: window.__harness.placed,
    error: window.__harness.error,
  }));
  console.log(label, JSON.stringify({ result, after, errors }));
  await page.close();
}

await run("context-loss", () => window.__harness.loseContext());
await run("dispose", () => {
  window.__harness.dispose();
  return true;
});
await browser.close();
