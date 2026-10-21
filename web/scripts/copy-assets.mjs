import { copyFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const runtime = resolve(root, "node_modules/onnxruntime-web/dist");
const output = resolve(root, "public/ort");
const runtimeFiles = [
  "ort-wasm-simd-threaded.wasm",
  "ort-wasm-simd-threaded.mjs",
  "ort-wasm-simd-threaded.asyncify.wasm",
  "ort-wasm-simd-threaded.asyncify.mjs",
];
await mkdir(output, { recursive: true });
await Promise.all([
  ...runtimeFiles.map((name) =>
    copyFile(resolve(runtime, name), resolve(output, name)),
  ),
  copyFile(
    resolve(root, "../licenses/onnxruntime/LICENSE"),
    resolve(output, "onnxruntime-web-LICENSE"),
  ),
]);
