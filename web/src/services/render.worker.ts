import { BROWSER_RENDER_PORTS, renderImage } from "./render-image";
import { isRenderRequest } from "./render-protocol";

self.onmessage = async (event: MessageEvent<unknown>) => {
  const request = event.data;
  if (!isRenderRequest(request)) {
    return;
  }
  try {
    const rendered = await renderImage(
      request.source,
      request.plan,
      BROWSER_RENDER_PORTS,
    );
    self.postMessage(
      {
        type: "rendered",
        id: request.id,
        tile: rendered.tile,
        blob: rendered.blob,
        aspect: rendered.aspect,
      },
      { transfer: [rendered.tile] },
    );
  } catch (error) {
    self.postMessage({
      type: "failed",
      id: request.id,
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
