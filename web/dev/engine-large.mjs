import { chromium } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";

const folder = process.argv[2];
const rounds = Number(process.argv[3] ?? 3);
const origin = process.env.ENGINE_ORIGIN ?? "http://127.0.0.1:5173";
const baseUrl = `${origin}/full-local/`;
const wasmBaseUrl = process.env.ENGINE_WASM_BASE ?? `${origin}/node_modules/onnxruntime-web/dist/`;
const tag = `kururi-engine-large-${Date.now()}`;
const names = (await readdir(folder)).filter((name) => [".jpg", ".jpeg", ".webp", ".png"].includes(extname(name).toLowerCase())).sort();

const server = createServer(async (request, response) => {
  const name = decodeURIComponent(new URL(request.url ?? "/", "http://data").pathname.slice(1));
  if (!names.includes(name)) {
    response.writeHead(404, { "access-control-allow-origin": "*" }).end();
    return;
  }
  const body = await readFile(resolve(folder, name));
  response.writeHead(200, { "access-control-allow-origin": "*", "content-length": body.length });
  response.end(body);
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const dataOrigin = `http://127.0.0.1:${server.address().port}`;

function rss() {
  const rows = execFileSync("ps", ["-axo", "pid=,ppid=,rss=,command="], { maxBuffer: 64 << 20 })
    .toString()
    .split("\n")
    .map((line) => line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/))
    .filter(Boolean)
    .map((match) => ({ pid: Number(match[1]), ppid: Number(match[2]), rss: Number(match[3]), command: match[4] }));
  const root = rows.find((row) => row.command.includes(tag) && !row.command.includes("--type="));
  const result = { renderer: 0, gpu: 0 };
  for (const row of rows) {
    if (root && row.ppid === root.pid) {
      if (row.command.includes("--type=renderer")) result.renderer += Math.round(row.rss / 1024);
      if (row.command.includes("--type=gpu-process")) result.gpu += Math.round(row.rss / 1024);
    }
  }
  return result;
}

const profile = await mkdtemp(join(tmpdir(), "kururi-engine-large-"));
const context = await chromium.launchPersistentContext(profile, {
  headless: true,
  args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan", "--use-angle=metal", `--${tag}`],
});
const page = context.pages()[0] ?? (await context.newPage());
page.on("console", (message) => {
  if (message.type() === "warning" || message.type() === "error") console.log("[console]", message.text().slice(0, 300));
});
const cdp = await context.newCDPSession(page);
const workerSessions = new Set();
cdp.on("Target.attachedToTarget", (event) => {
  if (event.targetInfo.type === "worker") workerSessions.add(event.sessionId);
});
cdp.on("Target.detachedFromTarget", (event) => workerSessions.delete(event.sessionId));
await cdp.send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: false, flatten: false });
let messageId = 0;

async function workerCommand(sessionId, method) {
  messageId += 1;
  const id = messageId;
  return new Promise((done) => {
    const timer = setTimeout(() => done(null), 5_000);
    const listen = (event) => {
      if (event.sessionId !== sessionId) return;
      const message = JSON.parse(event.message);
      if (message.id === id) {
        clearTimeout(timer);
        cdp.off("Target.receivedMessageFromTarget", listen);
        done(message.result ?? null);
      }
    };
    cdp.on("Target.receivedMessageFromTarget", listen);
    cdp.send("Target.sendMessageToTarget", { sessionId, message: JSON.stringify({ id, method }) });
  });
}

async function workerBacking(collect = false) {
  let total = 0;
  for (const sessionId of workerSessions) {
    if (collect) {
      await workerCommand(sessionId, "HeapProfiler.collectGarbage");
    }
    const usage = await workerCommand(sessionId, "Runtime.getHeapUsage");
    total += usage?.backingStorageSize ?? 0;
  }
  return Math.round(total / 1048576);
}
await page.routeWebSocket((url) => url.host === new URL(origin).host, () => {});
await page.goto(`${origin}/dev/engine-parity.html`);
await page.waitForFunction(() => "engineParity" in window, null, { timeout: 60_000 });
await page.evaluate(
  ({ baseUrl, wasmBaseUrl }) => window.engineParity.open("production", "production", baseUrl, wasmBaseUrl),
  { baseUrl, wasmBaseUrl },
);
await page.waitForTimeout(3_000);
const baseline = rss();
let peak = { ...baseline };
const backingBaseline = await workerBacking();
let backingPeak = backingBaseline;
let sampling = true;
const sampler = (async () => {
  while (sampling) {
    const now = rss();
    peak = { renderer: Math.max(peak.renderer, now.renderer), gpu: Math.max(peak.gpu, now.gpu) };
    backingPeak = Math.max(backingPeak, await workerBacking());
  }
})();
const timings = Object.fromEntries(names.map((name) => [name, []]));
const corrections = Object.fromEntries(names.map((name) => [name, []]));
for (let round = 0; round < rounds; round += 1) {
  for (const name of names) {
    const outcome = await page.evaluate(
      ({ url }) => window.engineParity.process("production", url, 0),
      { url: `${dataOrigin}/${encodeURIComponent(name)}` },
    );
    timings[name].push(Math.round(outcome.result.inferenceMs));
    corrections[name].push(outcome.result.correctionCw / 90);
  }
}
sampling = false;
await sampler;
await page.waitForTimeout(Number(process.env.ENGINE_SETTLE_MS ?? 5_000));
const settled = await workerBacking(true);
const storage = await page.evaluate(async () => {
  const estimate = await navigator.storage.estimate();
  const names = await caches.keys();
  const files = [];
  for (const name of names) {
    for (const request of await (await caches.open(name)).keys()) files.push(request.url.split("/").pop());
  }
  return { quotaMB: Math.round((estimate.quota ?? 0) / 1048576), usageMB: Math.round((estimate.usage ?? 0) / 1048576), files };
});
const median = (values) => [...values].sort((left, right) => left - right)[Math.floor((values.length - 1) / 2)];
console.log(
  JSON.stringify({
    rounds,
    baselineMB: baseline,
    peakMB: peak,
    peakAboveBaselineMB: { renderer: peak.renderer - baseline.renderer, gpu: peak.gpu - baseline.gpu },
    workerArrayBuffersMB: { baseline: backingBaseline, peak: backingPeak, settledAfterGc: settled },
    storage,
    medianMs: Object.fromEntries(names.map((name) => [name, median(timings[name])])),
    corrections: Object.fromEntries(names.map((name) => [name, corrections[name][0]])),
  }),
);
await context.close();
await rm(profile, { recursive: true, force: true });
server.close();
