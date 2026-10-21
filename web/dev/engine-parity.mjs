import { chromium } from "@playwright/test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const scratch = process.argv[2];
const mode = process.argv[3] ?? "all";
const origin = "http://127.0.0.1:5173";
const baseUrl = `${origin}/full-local/`;
const wasmBaseUrl = process.env.ENGINE_WASM_BASE ?? `${origin}/node_modules/onnxruntime-web/dist/`;
const reference = JSON.parse(await readFile(resolve(scratch, "reference.json"), "utf8"));
const sources = new Map(reference.sources.map((source) => [source.id, source]));

const profile = await mkdtemp(resolve(scratch, "profile-"));
const context = await chromium.launchPersistentContext(profile, {
  headless: true,
  args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan", "--use-angle=metal"],
});
const networkHits = [];
context.on("request", (request) => {
  if (request.url().includes("/full-local/")) {
    networkHits.push(request.url().split("/").at(-1));
  }
});
await context.route(`${origin}/engine-data/**`, async (route) => {
  const path = new URL(route.request().url()).pathname.replace("/engine-data/", "");
  try {
    await route.fulfill({ status: 200, body: await readFile(resolve(scratch, path)) });
  } catch {
    await route.fulfill({ status: 404, body: "missing" });
  }
});
const page = await context.newPage();
page.on("console", (message) => {
  if (message.type() === "error" || message.type() === "warning") {
    console.log(`[page ${message.type()}]`, message.text().slice(0, 400));
  }
});
page.on("pageerror", (error) => console.log("[pageerror]", String(error).slice(0, 400)));

async function ready() {
  await page.goto(`${origin}/dev/engine-parity.html`);
  await page.waitForFunction(() => "engineParity" in window, null, { timeout: 60_000 });
}

const openChannels = new Map();

async function evaluate(method, args) {
  return page.evaluate(
    async ({ method, args }) => window.engineParity[method](...args),
    { method, args },
  );
}

async function call(method, ...args) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      const value = await evaluate(method, args);
      if (method === "open") openChannels.set(args[0], args);
      if (method === "close") openChannels.delete(args[0]);
      return value;
    } catch (error) {
      const text = String(error);
      const reloaded = text.includes("Execution context was destroyed") || text.includes("unknown channel");
      if (attempt >= 3 || !reloaded) {
        throw error;
      }
      console.log("page reloaded, reopening channels and retrying", method);
      await page.waitForLoadState("load");
      await page.waitForFunction(() => "engineParity" in window, null, { timeout: 60_000 });
      for (const [name, openArgs] of openChannels) {
        if (method === "open" && name === args[0]) continue;
        await evaluate("open", openArgs);
      }
    }
  }
}

function fileUrl(source) {
  return source.kind === "sample"
    ? `${origin}/samples/${source.path.split("/").at(-1)}`
    : `${origin}/engine-data/thumbs/${source.path.split("/").at(-1)}`;
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted.length === 0 ? null : sorted[Math.floor((sorted.length - 1) / 2)];
}

function percentile(values, fraction) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted.length === 0 ? null : sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))];
}

function argmaxLast(values) {
  let best = 0;
  values.forEach((value, index) => {
    if (value >= values[best]) best = index;
  });
  return best;
}

function compare(cases, label) {
  let agree = 0;
  let fallbackAgree = 0;
  let maxDiff = 0;
  let tensorEqual = { 224: 0, 288: 0 };
  let generalMaxDiff = 0;
  const disagreements = [];
  for (const item of cases) {
    const expected = reference.cases.find((entry) => entry.id === item.id && entry.simulated === item.simulated);
    const probabilities = item.result.probabilities;
    const correction = item.result.correctionCw / 90;
    if (correction === expected.correction) agree += 1;
    else disagreements.push({ id: item.id, simulated: item.simulated, browser: correction, reference: expected.correction, browserProbabilities: probabilities, referenceProbabilities: expected.probabilities });
    if (item.detail && item.detail.fallbackUsed === expected.fallbackUsed) fallbackAgree += 1;
    probabilities.forEach((value, index) => {
      maxDiff = Math.max(maxDiff, Math.abs(value - expected.probabilities[index]));
    });
    if (item.detail) {
      for (const side of ["224", "288"]) {
        if (item.detail.tensorSha256[side] === expected.tensorSha256[side]) tensorEqual[side] += 1;
      }
      generalMaxDiff = Math.max(generalMaxDiff, Math.abs(item.detail.generalMargin - expected.generalMargin));
    }
  }
  return {
    label,
    cases: cases.length,
    argmaxAgreement: agree / cases.length,
    agree,
    fallbackAgreement: cases[0]?.detail ? fallbackAgree / cases.length : null,
    maxProbabilityDiff: maxDiff,
    maxGeneralMarginDiff: generalMaxDiff,
    tensorIdentical: cases[0]?.detail ? tensorEqual : null,
    disagreements,
  };
}

const report = { wasmBaseUrl, chrome: context.browser()?.version() ?? null };
await ready();
const gpu = await page.evaluate(async () => {
  const adapter = await navigator.gpu?.requestAdapter();
  return adapter ? { vendor: adapter.info.vendor, architecture: adapter.info.architecture } : null;
});
report.gpu = gpu;
console.log("gpu", JSON.stringify(gpu));

if (mode === "all" || mode === "production") {
  networkHits.length = 0;
  const cold = await call("open", "production", "production", baseUrl, wasmBaseUrl);
  const progress = cold.progress;
  report.coldLoad = {
    loadMs: cold.loadMs,
    wallMs: cold.wallMs,
    progressMessages: progress.length,
    monotonic: progress.every((entry, index) => index === 0 || entry.loaded >= progress[index - 1].loaded),
    last: progress.at(-1) ?? null,
    networkFiles: [...new Set(networkHits)],
  };
  console.log("cold load", JSON.stringify(report.coldLoad));
  report.cacheAfterCold = await call("cacheState");
  console.log("cache", JSON.stringify(report.cacheAfterCold));
  const production = [];
  for (const id of ["sample1", "sample2", "sample3", "sample4", "sample5"]) {
    for (let simulated = 0; simulated < 4; simulated += 1) {
      const outcome = await call("process", "production", fileUrl(sources.get(id)), simulated * 90);
      production.push({ id, simulated, ...outcome });
    }
  }
  report.productionSamples = {
    ...compare(production, "production worker, sample files"),
    corrections: production.filter((item) => item.simulated === 0).map((item) => [item.id, item.result.correctionCw / 90]),
    inferenceMs: production.map((item) => Math.round(item.result.inferenceMs)),
  };
  console.log("production samples", JSON.stringify({ ...report.productionSamples, disagreements: report.productionSamples.disagreements.length }));
  await call("close", "production");
  networkHits.length = 0;
  const warm = await call("open", "production-warm", "production", baseUrl, wasmBaseUrl);
  report.warmLoad = { loadMs: warm.loadMs, wallMs: warm.wallMs, networkFiles: [...new Set(networkHits)] };
  console.log("warm load", JSON.stringify(report.warmLoad));
  await call("close", "production-warm");
}

if (mode === "all" || mode === "probe") {
  const probeReady = await call("open", "probe", "probe", baseUrl, wasmBaseUrl);
  report.probeLoad = { loadMs: probeReady.loadMs };
  const fileCases = [];
  const rgbCases = [];
  let fallbackLoadMs = null;
  for (const source of reference.sources) {
    for (let simulated = 0; simulated < 4; simulated += 1) {
      const referenceUrl = simulated === 0 ? `${origin}/engine-data/rgb/${source.id}.rgb` : null;
      const fileOutcome = await call("probeFile", "probe", fileUrl(source), simulated * 90, referenceUrl);
      const expected = reference.cases.find((entry) => entry.id === source.id && entry.simulated === simulated);
      if (fallbackLoadMs === null && fileOutcome.detail?.fallbackUsed) {
        fallbackLoadMs = fileOutcome.detail.engineMs;
      }
      fileCases.push({ id: source.id, kind: source.kind, simulated, ...fileOutcome, firstFallback: fallbackLoadMs !== null && fileCases.every((item) => !item.detail?.fallbackUsed) && fileOutcome.detail?.fallbackUsed });
      const rgbOutcome = await call("probeRgb", "probe", `${origin}/engine-data/rgb/${source.id}.rgb`, source.width, source.height, simulated * 90);
      rgbCases.push({ id: source.id, kind: source.kind, simulated, ...rgbOutcome });
      if (!fileOutcome.result || fileOutcome.result.type !== "result" || !rgbOutcome.result || rgbOutcome.result.type !== "result") {
        console.log("failure", source.id, simulated, JSON.stringify(fileOutcome.result), JSON.stringify(rgbOutcome.result));
      }
      void expected;
    }
  }
  const okFile = fileCases.filter((item) => item.result?.type === "result");
  const okRgb = rgbCases.filter((item) => item.result?.type === "result");
  report.fileDecode = compare(okFile, "browser decode (createImageBitmap) vs Pillow decode reference");
  report.pillowRgb = compare(okRgb, "Pillow-decoded RGB fed into browser path vs Python reference");
  report.decodeDifference = okFile
    .filter((item) => item.detail?.rgbDifference)
    .map((item) => ({ id: item.id, ...item.detail.rgbDifference }));
  const timing = (items, kind, fallback) =>
    items
      .filter((item) => item.kind === kind && Boolean(item.detail?.fallbackUsed) === fallback && !item.firstFallback)
      .map((item) => item.detail.decodeMs + item.detail.engineMs);
  report.timing = {
    sampleFileMsMedian: median(timing(okFile, "sample", false)),
    sampleFileMsP90: percentile(timing(okFile, "sample", false), 0.9),
    commonsFileMsMedian: median(timing(okFile, "commons", false)),
    commonsFileMsP90: percentile(timing(okFile, "commons", false), 0.9),
    commonsFallbackMsMedian: median(timing(okFile, "commons", true)),
    sampleDecodeMsMedian: median(okFile.filter((item) => item.kind === "sample").map((item) => item.detail.decodeMs)),
    commonsDecodeMsMedian: median(okFile.filter((item) => item.kind === "commons").map((item) => item.detail.decodeMs)),
    firstFallbackEngineMs: fallbackLoadMs,
  };
  console.log("file path", JSON.stringify({ ...report.fileDecode, disagreements: report.fileDecode.disagreements }));
  console.log("rgb path", JSON.stringify({ ...report.pillowRgb, disagreements: report.pillowRgb.disagreements }));
  console.log("timing", JSON.stringify(report.timing));
  const diffs = report.decodeDifference;
  console.log(
    "decode diff",
    JSON.stringify({
      photos: diffs.length,
      identical: diffs.filter((item) => item.differing === 0).length,
      maxAbs: Math.max(...diffs.map((item) => item.maxAbs)),
      meanAbsMax: Math.max(...diffs.map((item) => item.meanAbs)),
      sameSize: diffs.every((item) => item.sameSize),
    }),
  );
  report.fileCases = fileCases.map((item) => ({ id: item.id, simulated: item.simulated, result: item.result, detail: item.detail && { ...item.detail, rgbSha256: undefined } }));
  report.rgbCases = rgbCases.map((item) => ({ id: item.id, simulated: item.simulated, result: item.result, detail: item.detail && { ...item.detail, rgbSha256: undefined } }));
  await call("close", "probe");
}

await writeFile(resolve(scratch, `parity-report-${mode}.json`), JSON.stringify(report, null, 1));
await context.close();
