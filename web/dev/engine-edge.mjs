import { chromium } from "@playwright/test";

const origin = "http://127.0.0.1:5173";
const baseUrl = `${origin}/full-local/`;
const wasmBaseUrl = `${origin}/node_modules/onnxruntime-web/dist/`;

async function scenario(label, launch, init) {
  const browser = await chromium.launch(launch);
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on("console", (message) => {
    if (message.type() === "error") console.log(`  [${label} console]`, message.text().slice(0, 200));
  });
  await page.goto(`${origin}/dev/engine-parity.html`);
  await page.waitForFunction(() => "engineParity" in window, null, { timeout: 60_000 });
  const outcome = await page.evaluate(
    async ({ baseUrl, wasmBaseUrl, init }) => {
      const gpu = navigator.gpu ? await navigator.gpu.requestAdapter() : null;
      const before = await navigator.storage.estimate();
      try {
        const ready = await window.engineParity.open("edge", "production", init.baseUrl ?? baseUrl, wasmBaseUrl);
        const sample = await window.engineParity.process("edge", "/samples/sample5.jpg", 0);
        const cache = await window.engineParity.cacheState();
        return { ok: true, adapter: gpu?.info?.architecture ?? null, quota: before.quota, loadMs: ready.loadMs, result: sample.result, cache };
      } catch (error) {
        return { ok: false, adapter: gpu?.info?.architecture ?? null, quota: before.quota, error: String(error) };
      }
    },
    { baseUrl, wasmBaseUrl, init },
  );
  console.log(label, JSON.stringify(outcome));
  await browser.close();
}

await scenario("ephemeral context (small quota)", { headless: true, args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan", "--use-angle=metal"] }, {});
await scenario("software WebGPU only", { headless: true, args: ["--enable-unsafe-webgpu"] }, {});
await scenario("no WebGPU", { headless: true, args: ["--enable-unsafe-swiftshader"] }, {});
await scenario("missing model folder", { headless: true, args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan", "--use-angle=metal"] }, { baseUrl: `${origin}/no-such-models/` });
