import { createBrowserEngine } from "./full/browser-engine";
import { decodeRgb } from "./full/decode";
import { createFullRuntime } from "./full/runtime";
import type { WorkerRequest, WorkerResponse } from "./types";

const runtime = createFullRuntime({
  post: (message: WorkerResponse) => self.postMessage(message),
  now: () => performance.now(),
  createEngine: createBrowserEngine,
  decode: decodeRgb,
});

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  void runtime.handle(event.data);
};
