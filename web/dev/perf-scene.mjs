import { chromium } from "@playwright/test";

const base = process.env.SCENE_URL ?? "http://127.0.0.1:5173/dev/scene.html";
const count = Number(process.argv[2] ?? 3000);
const width = Number(process.argv[3] ?? 1440);
const height = Number(process.argv[4] ?? 900);

const launchArgs =
  process.env.SCENE_GPU === "0"
    ? ["--enable-unsafe-swiftshader"]
    : ["--enable-unsafe-webgpu", "--enable-features=Vulkan", "--use-angle=metal"];
const browser = await chromium.launch({ headless: true, args: launchArgs });
const page = await browser.newPage({
  viewport: { width, height },
  deviceScaleFactor: Number(process.env.SCENE_DPR ?? 1),
});
const started = Date.now();
await page.goto(
  `${base}?insets=ui&n=${count}&rate=160&pile=64&loading=48&workers=64&infer=40&seed=13`,
);
const progress = setInterval(async () => {
  const placed = await page
    .evaluate(() => window.__harness?.placed)
    .catch(() => null);
  console.log(`progress placed=${placed}`);
}, 30000);
await page.waitForFunction(
  () => window.__harness?.finished === true,
  undefined,
  {
    timeout: 2_400_000,
    polling: 1000,
  },
);
clearInterval(progress);
const renderer = await page.evaluate(() => {
  const canvas = document.createElement("canvas");
  const gl = canvas.getContext("webgl2");
  const extension = gl?.getExtension("WEBGL_debug_renderer_info");
  return gl && extension
    ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL)
    : "unknown";
});
console.log(`renderer ${renderer}`);
console.log(
  `filled ${count} prints in ${((Date.now() - started) / 1000).toFixed(1)} s`,
);
await page.waitForTimeout(12000);
const idle = await page.evaluate(async () => {
  const before = window.__harness.stats().frames;
  const report = await window.__harness.measure(2);
  return { ...report, sceneFrames: window.__harness.stats().frames - before };
});
console.log("idle (no rendering expected)", JSON.stringify(idle));
const dolly = await page.evaluate(async () => {
  const h = window.__harness;
  const id = h.ids[Math.floor(h.ids.length / 2)];
  h.focus(id);
  const report = await h.measure(3);
  h.focus(null);
  return report;
});
console.log("camera dolly, all prints static", JSON.stringify(dolly));
await page.waitForTimeout(4000);
const scatter = await page.evaluate(async () => {
  const h = window.__harness;
  const done = h.scatter();
  const report = await h.measure(3.2);
  await done;
  return report;
});
console.log("scatterAll, every print animating", JSON.stringify(scatter));
console.log(
  "stats",
  JSON.stringify(await page.evaluate(() => window.__harness.stats())),
);
await browser.close();
