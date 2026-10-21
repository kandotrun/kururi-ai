import { copyFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(root, "public/ort");
await mkdir(output, { recursive: true });
await Promise.all([
  copyFile(
    resolve(root, "node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm"),
    resolve(output, "ort-wasm-simd-threaded.wasm"),
  ),
  copyFile(
    resolve(root, "node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs"),
    resolve(output, "ort-wasm-simd-threaded.mjs"),
  ),
  copyFile(
    resolve(root, "../licenses/onnxruntime/LICENSE"),
    resolve(output, "onnxruntime-web-LICENSE"),
  ),
]);
