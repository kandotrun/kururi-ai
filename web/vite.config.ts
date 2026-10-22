import { createReadStream, realpathSync, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { defaultClientConditions, loadEnv, type Plugin } from "vite";
import { defineConfig } from "vitest/config";
import { publishedFile, type PublishedFile } from "./src/edge/models";

const FULL_LOCAL_ROUTE = "/full-local";

interface LocalModelFile {
  path: string;
  published: PublishedFile;
}

function within(root: string, path: string): boolean {
  const inside = relative(root, path);
  return (
    inside !== "" &&
    inside !== ".." &&
    !inside.startsWith(`..${sep}`) &&
    !isAbsolute(inside)
  );
}

function localModelFile(root: string, url: string): LocalModelFile | null {
  let name: string;
  try {
    name = decodeURIComponent(new URL(url, "http://localhost").pathname).slice(1);
  } catch {
    return null;
  }
  const published = publishedFile(name);
  if (published === undefined) {
    return null;
  }
  const candidate = resolve(root, published.source);
  if (!within(root, candidate)) {
    return null;
  }
  try {
    const real = realpathSync(candidate);
    return within(root, real) && statSync(real).isFile()
      ? { path: real, published }
      : null;
  } catch {
    return null;
  }
}

function serveLocalModel(
  root: string,
  request: IncomingMessage,
  response: ServerResponse,
): void {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { allow: "GET, HEAD" }).end();
    return;
  }
  const file = localModelFile(root, request.url ?? "/");
  if (file === null) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("Not found");
    return;
  }
  response.writeHead(200, {
    "content-type": file.published.contentType,
    "content-length": String(statSync(file.path).size),
    "cache-control": "no-cache",
    "x-content-type-options": "nosniff",
  });
  if (request.method === "HEAD") {
    response.end();
    return;
  }
  createReadStream(file.path)
    .on("error", () => response.destroy())
    .pipe(response);
}

function fullLocalModels(directory: string | undefined): Plugin {
  return {
    name: "kururi-full-local-models",
    apply: "serve",
    configureServer(server) {
      if (directory === undefined || directory.trim() === "") {
        return;
      }
      const root = realpathSync(resolve(directory));
      if (!statSync(root).isDirectory()) {
        throw new Error(`KURURI_FULL_MODEL_DIR is not a directory: ${root}`);
      }
      server.middlewares.use(FULL_LOCAL_ROUTE, (request, response) =>
        serveLocalModel(root, request, response),
      );
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, fileURLToPath(new URL(".", import.meta.url)), "KURURI_");
  return {
    base: "./",
    plugins: [fullLocalModels(env.KURURI_FULL_MODEL_DIR)],
    resolve: {
      conditions: ["onnxruntime-web-use-extern-wasm", ...defaultClientConditions],
    },
    optimizeDeps: {
      include: ["onnxruntime-web/webgpu", "onnxruntime-web/wasm"],
    },
    build: {
      target: "es2022",
      sourcemap: true,
    },
    test: {
      include: ["src/**/*.test.ts"],
      environment: "node",
    },
  };
});
