import { lstat, readdir } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(root, process.argv[2] ?? "dist");
const ALLOWED_MODELS = new Set(["model/kururi-ai-v2-nano.onnx", "model/kururi-ai-v2-nano-small.onnx"]);
const MODEL_FILE = /\.(onnx|ort|safetensors|pth?)$|\.data$/i;
const ASSET_LIMIT = 25 * 1024 * 1024;

async function* walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    yield resolve(directory, entry.name);
    if (entry.isDirectory()) {
      yield* walk(resolve(directory, entry.name));
    }
  }
}

const problems = [];
const models = [];
let files = 0;
let bytes = 0;
for await (const path of walk(dist)) {
  const name = relative(dist, path).split(sep).join("/");
  const info = await lstat(path);
  if (name === "full-local" || name.startsWith("full-local/")) {
    problems.push(`${name}: the local full-model mount must not be built into dist`);
  }
  if (info.isSymbolicLink()) {
    problems.push(`${name}: symbolic link`);
    continue;
  }
  if (!info.isFile()) {
    continue;
  }
  files += 1;
  bytes += info.size;
  if (MODEL_FILE.test(name)) {
    models.push(`${name} ${info.size}`);
    if (!ALLOWED_MODELS.has(name)) {
      problems.push(`${name}: only the v2-nano models may ship in dist`);
    }
  }
  if (info.size > ASSET_LIMIT) {
    problems.push(`${name}: ${info.size} bytes exceeds the 25 MiB static asset limit`);
  }
}

process.stdout.write(`dist: ${files} files, ${bytes} bytes; models: ${models.join(", ") || "none"}\n`);
if (problems.length > 0) {
  process.stderr.write(`${problems.join("\n")}\n`);
  process.exitCode = 1;
}
