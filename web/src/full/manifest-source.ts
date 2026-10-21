import { FullModelError } from "./download";
import {
  decodeEnsembleManifest,
  type EnsembleManifest,
} from "./ensemble-manifest";

export interface ManifestSourceDeps {
  fetcher: (url: string, init: RequestInit) => Promise<Response>;
  lookup: (url: string) => Promise<Response | undefined>;
}

export interface LoadedManifest {
  manifest: EnsembleManifest;
  text: string;
  fromCache: boolean;
}

const FETCH_FAILED = "高精度モデルを取得できませんでした";
const UNREADABLE = "高精度モデルの設定ファイルを読み取れませんでした";

async function fromNetwork(
  url: string,
  deps: ManifestSourceDeps,
): Promise<{ text: string | null; problem: string }> {
  try {
    const response = await deps.fetcher(url, { cache: "no-cache" });
    if (!response.ok) {
      return { text: null, problem: `HTTP ${response.status}` };
    }
    return { text: await response.text(), problem: "" };
  } catch {
    return { text: null, problem: "ネットワークに接続できません" };
  }
}

async function fromStore(
  url: string,
  deps: ManifestSourceDeps,
): Promise<string | null> {
  try {
    const stored = await deps.lookup(url);
    return stored ? await stored.text() : null;
  } catch {
    return null;
  }
}

function decode(text: string): EnsembleManifest {
  try {
    return decodeEnsembleManifest(JSON.parse(text));
  } catch (error) {
    throw new FullModelError(UNREADABLE, { cause: error });
  }
}

export async function loadEnsembleManifest(
  url: string,
  deps: ManifestSourceDeps,
): Promise<LoadedManifest> {
  const network = await fromNetwork(url, deps);
  if (network.text !== null) {
    return {
      manifest: decode(network.text),
      text: network.text,
      fromCache: false,
    };
  }
  const stored = await fromStore(url, deps);
  if (stored === null) {
    throw new FullModelError(`${FETCH_FAILED}（${network.problem}）`);
  }
  return { manifest: decode(stored), text: stored, fromCache: true };
}

export function folderUrl(value: string, base: string): string {
  const url = new URL(value, base);
  url.search = "";
  url.hash = "";
  if (!url.pathname.endsWith("/")) {
    url.pathname = `${url.pathname}/`;
  }
  return url.href;
}
