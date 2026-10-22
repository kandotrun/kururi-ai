import { MODEL_ROUTE, serveModel, type ModelBucket } from "./models";

interface AssetFetcher {
  fetch(request: Request): Promise<Response>;
}

interface Env {
  ASSETS: AssetFetcher;
  MODELS: ModelBucket;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname.startsWith(MODEL_ROUTE)) {
      return serveModel(request, env.MODELS);
    }
    return env.ASSETS.fetch(request);
  },
};
