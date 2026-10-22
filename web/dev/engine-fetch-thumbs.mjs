import { createHash } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { commonsThumbUrl, decodeManifest } from "../src/core/manifest.ts";

const [outDir, countText] = process.argv.slice(2);
const count = Number(countText ?? "32");
const UA = "kururi-ai-web-demo/1.0 (https://github.com/kandotrun/kururi-ai; engine parity fetch)";
const manifest = decodeManifest(
  JSON.parse(await readFile(new URL("../public/commons/manifest.json", import.meta.url), "utf8")),
);
const key = (value) => createHash("sha256").update(`engine:${value}`).digest("hex");
const perTopic = Math.ceil(count / manifest.topics.length);
const picked = [];
for (const topic of manifest.topics) {
  manifest.items
    .filter((entry) => entry.topic === topic)
    .sort((left, right) => (key(left.file) < key(right.file) ? -1 : 1))
    .slice(0, perTopic)
    .forEach((entry, index) => picked.push({ id: `${topic}-${index}`, entry }));
}
const chosen = picked.slice(0, count);
await mkdir(outDir, { recursive: true });
const wait = (ms) => new Promise((done) => setTimeout(done, ms));

async function fetchOne({ id, entry }) {
  const path = resolve(outDir, `${id}.jpg`);
  const url = commonsThumbUrl(manifest, entry, 330);
  try {
    await access(path);
    return { id, file: `${id}.jpg`, url, ok: true, cached: true };
  } catch {}
  for (let attempt = 0; attempt < 7; attempt += 1) {
    const response = await fetch(url, { headers: { "User-Agent": UA, Accept: "image/*" } });
    if (response.status === 429 || response.status >= 500) {
      const retry = Number(response.headers.get("retry-after") ?? "0");
      await wait(Math.max(retry * 1000, 1500 * 2 ** attempt));
      continue;
    }
    if (!response.ok) {
      return { id, url, ok: false, status: response.status };
    }
    await writeFile(path, new Uint8Array(await response.arrayBuffer()));
    await wait(Number(process.argv[5] ?? "1000"));
    return { id, file: `${id}.jpg`, url, ok: true, cached: false };
  }
  return { id, url, ok: false, status: 429 };
}

const results = [];
const queue = [...chosen];
await Promise.all(
  Array.from({ length: Number(process.argv[4] ?? "2") }, async () => {
    while (queue.length > 0) {
      results.push(await fetchOne(queue.shift()));
    }
  }),
);
results.sort((left, right) => (left.id < right.id ? -1 : 1));
await writeFile(resolve(outDir, "index.json"), JSON.stringify(results, null, 1));
console.log(results.filter((item) => item.ok).length, "ok of", results.length, results.filter((item) => !item.ok));
